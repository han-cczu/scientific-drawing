import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  AI_CONFIG_LIMITS,
  buildSafeAiProviderConfig,
  ConfigValidationError,
  deletePersistedConfig,
  fetchOpenAiCompatibleModels,
  maskApiKeyTail,
  normalizeModelListPayload,
  readAiRuntimeConfig,
  readPersistedConfig,
  resolveOpenAiCompatibleUrls,
  validateWritableConfig,
  writePersistedConfig
} from "../server/src/scene/aiProviderConfig";

describe("OpenAI-compatible AI provider config", () => {
  it("resolves base, responses, and models URLs", () => {
    /*
     * ========================================================================
     * 步骤1：验证 OpenAI 兼容地址解析
     * ========================================================================
     * 目标：
     *   1) baseUrl 允许写根地址或 /v1 地址
     *   2) responses 和 models 路径保持稳定
     */

    // 1.1 校验根地址
    assert.deepEqual(resolveOpenAiCompatibleUrls("https://gateway.example.com"), {
      apiRoot: "https://gateway.example.com/v1",
      responsesUrl: "https://gateway.example.com/v1/responses",
      modelsUrl: "https://gateway.example.com/v1/models"
    });

    // 1.2 校验 /v1 地址
    assert.deepEqual(resolveOpenAiCompatibleUrls("https://gateway.example.com/v1/"), {
      apiRoot: "https://gateway.example.com/v1",
      responsesUrl: "https://gateway.example.com/v1/responses",
      modelsUrl: "https://gateway.example.com/v1/models"
    });
  });

  it("normalizes /v1/models payloads", () => {
    /*
     * ========================================================================
     * 步骤1：验证模型列表归一化
     * ========================================================================
     * 目标：
     *   1) 兼容 OpenAI 标准 data 数组
     *   2) 丢弃没有 id 的异常项
     */

    // 1.1 归一化模型列表
    const models = normalizeModelListPayload({
      data: [
        { id: "gpt-4o" },
        { id: "gpt-4o-mini" },
        { name: "bad" }
      ]
    });

    // 1.2 校验模型名称
    assert.deepEqual(models, ["gpt-4o", "gpt-4o-mini"]);
  });

  it("normalizes upstream model ids before exposing them to the frontend", () => {
    /*
     * ========================================================================
     * 步骤1：验证上游模型 id 的安全边界
     * ========================================================================
     * 目标：
     *   1) trim 掉上游返回的模型 id 空白
     *   2) 丢弃空白 id 和超过 reconstructModel 写入上限的 id
     */

    // 1.1 构造包含空白和超长 id 的上游响应
    const oversizedModelId = "m".repeat(AI_CONFIG_LIMITS.reconstructModel + 1);
    const models = normalizeModelListPayload({
      data: [
        { id: " gpt-4o " },
        { id: "   " },
        { id: oversizedModelId },
        { id: "gpt-4o-mini" }
      ]
    });

    // 1.2 校验只暴露符合前端/写入约束的模型名
    assert.deepEqual(models, ["gpt-4o", "gpt-4o-mini"]);
  });

  it("caps normalized model list size before exposing it to the frontend", () => {
    /*
     * ========================================================================
     * 步骤1：验证模型列表规模上界
     * ========================================================================
     * 目标：
     *   1) 不可信 OpenAI-compatible 网关可能返回超大 data 数组
     *   2) 后端不应把超大模型列表继续放大到 /api/config 响应和前端 datalist
     */

    // 1.1 构造远超 UI 所需规模的模型列表
    const models = normalizeModelListPayload({
      data: Array.from({ length: 2000 }, (_, index) => ({ id: `model-${index.toString().padStart(4, "0")}` }))
    });

    // 1.2 归一化结果应被裁剪到固定上界
    assert.equal(models.length, 256);
    assert.equal(models[0], "model-0000");
    assert.equal(models.at(-1), "model-0255");
  });

  it("returns safe config without exposing api key", () => {
    /*
     * ========================================================================
     * 步骤1：验证前端安全配置
     * ========================================================================
     * 目标：
     *   1) 前端只知道能力、baseUrl 和模型名
     *   2) API Key 不进入响应体
     */

    // 1.1 构建安全配置
    const config = buildSafeAiProviderConfig({
      apiKey: "sk-test-abcd1234",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o",
      models: ["gpt-4o", "gpt-4o-mini"],
      source: "env"
    });

    // 1.2 校验安全字段
    assert.equal(config.aiReconstructionAvailable, true);
    assert.equal(config.reconstructModel, "gpt-4o");
    assert.deepEqual(config.reconstructModels, ["gpt-4o", "gpt-4o-mini"]);
    assert.equal(Object.hasOwn(config, "apiKey"), false);
    assert.equal(config.hasApiKey, true);
    assert.equal(config.source, "env");
    assert.equal(config.maskedTail, "****1234");
  });

  it("masks short and long api keys", () => {
    /*
     * ========================================================================
     * 步骤1：验证 API Key 掩码
     * ========================================================================
     * 目标：
     *   1) 末四位可识别 + 前缀完全遮蔽
     *   2) 异常短 key 也不暴露
     */
    assert.equal(maskApiKeyTail("sk-abcdefgh"), "****efgh");
    assert.equal(maskApiKeyTail("ab"), "****");
    assert.equal(maskApiKeyTail(""), "****");
  });

  it("validates writable config payload", () => {
    /*
     * ========================================================================
     * 步骤1：验证 POST /api/config 字段白名单
     * ========================================================================
     * 目标：
     *   1) 拒绝缺字段、空字段、超长字段
     *   2) 拒绝非 http(s) baseUrl
     */
    assert.equal(validateWritableConfig(null).ok, false);
    assert.equal(validateWritableConfig({ apiKey: "", baseUrl: "https://x", reconstructModel: "m" }).ok, false);
    assert.equal(validateWritableConfig({ apiKey: "k", baseUrl: "ftp://x", reconstructModel: "m" }).ok, false);
    assert.equal(validateWritableConfig({ apiKey: "k", baseUrl: "javascript:alert(1)", reconstructModel: "m" }).ok, false);
    assert.equal(validateWritableConfig({ apiKey: "k", baseUrl: "https://", reconstructModel: "m" }).ok, false);
    assert.equal(validateWritableConfig({ apiKey: "k", baseUrl: "https://exa mple.com", reconstructModel: "m" }).ok, false);
    assert.equal(validateWritableConfig({ apiKey: "k", baseUrl: "https://example.com\n.evil.test", reconstructModel: "m" }).ok, false);
    assert.equal(validateWritableConfig({ apiKey: "a".repeat(600), baseUrl: "https://x", reconstructModel: "m" }).ok, false);

    const ok = validateWritableConfig({ apiKey: " sk-1 ", baseUrl: " https://x.com ", reconstructModel: " gpt-4o " });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.value.apiKey, "sk-1");
      assert.equal(ok.value.baseUrl, "https://x.com");
      assert.equal(ok.value.reconstructModel, "gpt-4o");
    }
  });

  it("validateWritableConfig allowEmptyKey accepts empty apiKey but stays strict on other fields", () => {
    /*
     * ========================================================================
     * 步骤1：验证 allowEmptyKey=true 软校验语义
     * ========================================================================
     * 目标：
     *   1) saved-key fallback 场景允许 apiKey 为空字符串
     *   2) 其它字段（baseUrl scheme、长度）仍严格
     */
    // 1.1 apiKey 空字符串在 allowEmptyKey=true 时通过
    const empty = validateWritableConfig(
      { apiKey: "", baseUrl: "https://x.com", reconstructModel: "gpt-4o" },
      { allowEmptyKey: true }
    );
    assert.equal(empty.ok, true);
    if (empty.ok) {
      assert.equal(empty.value.apiKey, "");
      assert.equal(empty.value.baseUrl, "https://x.com");
      assert.equal(empty.value.reconstructModel, "gpt-4o");
    }

    // 1.2 apiKey 全空白在 allowEmptyKey=true 时也通过（trim 后为空）
    const blank = validateWritableConfig(
      { apiKey: "   ", baseUrl: "https://x.com", reconstructModel: "gpt-4o" },
      { allowEmptyKey: true }
    );
    assert.equal(blank.ok, true);

    // 1.3 默认严格模式仍拒绝空 apiKey（向后兼容）
    assert.equal(
      validateWritableConfig({ apiKey: "", baseUrl: "https://x.com", reconstructModel: "gpt-4o" }).ok,
      false
    );
    assert.equal(
      validateWritableConfig(
        { apiKey: "", baseUrl: "https://x.com", reconstructModel: "gpt-4o" },
        { allowEmptyKey: false }
      ).ok,
      false
    );
  });

  it("validateWritableConfig allowEmptyKey still rejects bad baseUrl and oversized fields", () => {
    /*
     * ========================================================================
     * 步骤1：safety regression — allowEmptyKey 不能放过其它字段
     * ========================================================================
     * 目标：
     *   1) 非 http(s) baseUrl 仍拒绝
     *   2) 超长 baseUrl / reconstructModel 仍拒绝
     *   3) 超长 apiKey（即便允许为空）仍拒绝
     */
    // 1.1 非 http(s) scheme
    assert.equal(
      validateWritableConfig(
        { apiKey: "", baseUrl: "ftp://x", reconstructModel: "m" },
        { allowEmptyKey: true }
      ).ok,
      false
    );
    assert.equal(
      validateWritableConfig(
        { apiKey: "", baseUrl: "javascript:alert(1)", reconstructModel: "m" },
        { allowEmptyKey: true }
      ).ok,
      false
    );
    assert.equal(
      validateWritableConfig(
        { apiKey: "", baseUrl: "https://", reconstructModel: "m" },
        { allowEmptyKey: true }
      ).ok,
      false
    );

    // 1.2 baseUrl 超长
    assert.equal(
      validateWritableConfig(
        { apiKey: "", baseUrl: "https://" + "a".repeat(300), reconstructModel: "m" },
        { allowEmptyKey: true }
      ).ok,
      false
    );

    // 1.3 reconstructModel 超长
    assert.equal(
      validateWritableConfig(
        { apiKey: "", baseUrl: "https://x.com", reconstructModel: "m".repeat(200) },
        { allowEmptyKey: true }
      ).ok,
      false
    );

    // 1.4 apiKey 超长（即便允许空也不允许超长）
    assert.equal(
      validateWritableConfig(
        { apiKey: "a".repeat(600), baseUrl: "https://x.com", reconstructModel: "m" },
        { allowEmptyKey: true }
      ).ok,
      false
    );

    // 1.5 reconstructModel 缺失/空仍拒绝
    assert.equal(
      validateWritableConfig(
        { apiKey: "", baseUrl: "https://x.com", reconstructModel: "" },
        { allowEmptyKey: true }
      ).ok,
      false
    );
  });

  it("fetchOpenAiCompatibleModels returns models normally when Content-Type is application/json", async () => {
    /*
     * ========================================================================
     * 步骤1：验证 Content-Type 检查不破坏正常 JSON 路径
     * ========================================================================
     * 目标：
     *   1) application/json + 编码后缀仍走正常解析
     *   2) status 透传 200 而非 sentinel -1
     */
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response(
        JSON.stringify({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] }),
        { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
      )) as typeof fetch;

      const result = await fetchOpenAiCompatibleModels({
        apiKey: "sk-test",
        baseUrl: "https://api.example.com"
      });

      assert.deepEqual(result.models, ["gpt-4o", "gpt-4o-mini"]);
      assert.equal(result.status, 200);
      assert.equal(result.error, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fetchOpenAiCompatibleModels returns INVALID_RESPONSE sentinel when Content-Type is not JSON", async () => {
    /*
     * ========================================================================
     * 步骤1：验证 Content-Type 非 JSON 时不调 .json() 且返 status=-1
     * ========================================================================
     * 目标：
     *   1) baseUrl 指向错误网关返回 HTML 时不抛出 .json() 解析错
     *   2) 上层据 status=-1 映射为 INVALID_RESPONSE 错误码
     */
    const originalFetch = globalThis.fetch;
    try {
      // 1.1 桩 fetch 返回 200 + text/html
      globalThis.fetch = (async () => new Response("<html>not a json gateway</html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      })) as typeof fetch;

      const result = await fetchOpenAiCompatibleModels({
        apiKey: "sk-test",
        baseUrl: "https://wrong-gateway.example.com"
      });

      assert.deepEqual(result.models, []);
      assert.equal(result.status, -1);
      assert.ok(result.error);
      assert.match(result.error ?? "", /not JSON/i);
      assert.match(result.error ?? "", /text\/html/i);

      // 1.2 即便 Content-Type 为空也走 INVALID_RESPONSE
      globalThis.fetch = (async () => new Response("plain body", {
        status: 200,
        headers: {}
      })) as typeof fetch;
      const noCt = await fetchOpenAiCompatibleModels({
        apiKey: "sk-test",
        baseUrl: "https://wrong-gateway.example.com"
      });
      assert.equal(noCt.status, -1);
      assert.deepEqual(noCt.models, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("AI runtime config persistence", () => {
  let tmpDir: string;
  let configFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "ai-config-"));
    configFile = path.join(tmpDir, "config.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("falls back to env when persisted file is missing", () => {
    /*
     * ========================================================================
     * 步骤1：file 不存在 → 读 env
     * ========================================================================
     */
    const config = readAiRuntimeConfig(
      { OPENAI_API_KEY: "sk-env", OPENAI_BASE_URL: "https://env.example.com/v1", OPENAI_RECONSTRUCT_MODEL: "gpt-env" },
      configFile
    );
    assert.equal(config.source, "env");
    assert.equal(config.apiKey, "sk-env");
    assert.equal(config.baseUrl, "https://env.example.com/v1");
    assert.equal(config.defaultModel, "gpt-env");
  });

  it("reports source=none when neither env nor file has a key", () => {
    /*
     * ========================================================================
     * 步骤1：env 和 file 都空 → source=none
     * ========================================================================
     */
    const config = readAiRuntimeConfig({}, configFile);
    assert.equal(config.source, "none");
    assert.equal(config.apiKey, "");
  });

  it("sanitizes invalid env baseUrl and reconstruct model instead of trusting them", () => {
    /*
     * ========================================================================
     * 步骤1：验证环境变量配置同样受运行时边界约束
     * ========================================================================
     * 目标：
     *   1) OPENAI_BASE_URL 可能由部署环境误配为非 http(s) 或带控制字符
     *   2) OPENAI_RECONSTRUCT_MODEL 可能为空或超长
     *   3) readAiRuntimeConfig 不应把这些值继续传给 fetch/前端配置
     */

    // 1.1 构造非法 env 字段
    const config = readAiRuntimeConfig(
      {
        OPENAI_API_KEY: "sk-env",
        OPENAI_BASE_URL: "javascript:alert(1)",
        OPENAI_RECONSTRUCT_MODEL: "m".repeat(AI_CONFIG_LIMITS.reconstructModel + 1)
      },
      configFile
    );

    // 1.2 保留合法 key，但 URL/model 回退到安全默认值
    assert.equal(config.source, "env");
    assert.equal(config.apiKey, "sk-env");
    assert.equal(config.baseUrl, "https://api.openai.com/v1");
    assert.equal(config.defaultModel, "gpt-4o");
  });

  it("uses persisted file when present and overrides env", () => {
    /*
     * ========================================================================
     * 步骤1：file 存在 → 覆盖 env
     * ========================================================================
     */
    writeFileSync(
      configFile,
      JSON.stringify({
        provider: "openai-compatible",
        apiKey: "sk-file",
        baseUrl: "https://file.example.com/v1",
        reconstructModel: "gpt-file",
        updatedAt: "2026-05-22T00:00:00.000Z"
      }),
      "utf-8"
    );

    const config = readAiRuntimeConfig(
      { OPENAI_API_KEY: "sk-env", OPENAI_BASE_URL: "https://env.example.com/v1", OPENAI_RECONSTRUCT_MODEL: "gpt-env" },
      configFile
    );
    assert.equal(config.source, "file");
    assert.equal(config.apiKey, "sk-file");
    assert.equal(config.baseUrl, "https://file.example.com/v1");
    assert.equal(config.defaultModel, "gpt-file");
  });

  it("safely falls back to env when persisted file is corrupt JSON", () => {
    /*
     * ========================================================================
     * 步骤1：文件损坏 → 不抛出，fallback env
     * ========================================================================
     */
    writeFileSync(configFile, "{ not json", "utf-8");
    const config = readAiRuntimeConfig({ OPENAI_API_KEY: "sk-env" }, configFile);
    assert.equal(config.source, "env");
    assert.equal(config.apiKey, "sk-env");
  });

  it("safely falls back to env when persisted file is missing required fields", () => {
    /*
     * ========================================================================
     * 步骤1：字段不全 → fallback env
     * ========================================================================
     */
    writeFileSync(configFile, JSON.stringify({ provider: "openai-compatible" }), "utf-8");
    const config = readAiRuntimeConfig({ OPENAI_API_KEY: "sk-env" }, configFile);
    assert.equal(config.source, "env");

    assert.equal(readPersistedConfig(configFile), null);
  });

  it("safely falls back to env when persisted file has invalid field values", () => {
    /*
     * ========================================================================
     * 步骤1：持久化配置值域非法 → fallback env
     * ========================================================================
     * 目标：
     *   1) 读盘路径必须复用写盘的 baseUrl/model/apiKey 值域约束
     *   2) 手动损坏的 config.json 不得成为运行时有效配置
     */
    writeFileSync(
      configFile,
      JSON.stringify({
        provider: "openai-compatible",
        apiKey: "sk-file",
        baseUrl: "ftp://attacker.example.com",
        reconstructModel: "gpt-file",
        updatedAt: "2026-05-22T00:00:00.000Z"
      }),
      "utf-8"
    );

    const config = readAiRuntimeConfig({ OPENAI_API_KEY: "sk-env", OPENAI_BASE_URL: "https://env.example.com/v1" }, configFile);
    assert.equal(readPersistedConfig(configFile), null);
    assert.equal(config.source, "env");
    assert.equal(config.apiKey, "sk-env");
    assert.equal(config.baseUrl, "https://env.example.com/v1");
  });

  it("writes and re-reads persisted config", () => {
    /*
     * ========================================================================
     * 步骤1：写入 → 读取一致
     * ========================================================================
     */
    const persisted = writePersistedConfig(
      {
        apiKey: "sk-write",
        baseUrl: "https://write.example.com/v1",
        reconstructModel: "gpt-write"
      },
      configFile
    );
    assert.equal(persisted.apiKey, "sk-write");
    assert.equal(persisted.provider, "openai-compatible");
    assert.ok(persisted.updatedAt);

    assert.ok(existsSync(configFile));
    const re = readPersistedConfig(configFile);
    assert.equal(re?.apiKey, "sk-write");
    assert.equal(re?.baseUrl, "https://write.example.com/v1");
    assert.equal(re?.reconstructModel, "gpt-write");

    // 落盘格式是有效 JSON
    const raw = JSON.parse(readFileSync(configFile, "utf-8")) as { apiKey: string };
    assert.equal(raw.apiKey, "sk-write");
  });

  it("rejects invalid writable configs", () => {
    /*
     * ========================================================================
     * 步骤1：写入前字段校验
     * ========================================================================
     */
    assert.throws(
      () => writePersistedConfig({ apiKey: "", baseUrl: "https://x", reconstructModel: "m" }, configFile),
      ConfigValidationError
    );
    assert.throws(
      () => writePersistedConfig({ apiKey: "k", baseUrl: "ftp://x", reconstructModel: "m" }, configFile),
      ConfigValidationError
    );
    assert.equal(existsSync(configFile), false);
  });

  it("deletes persisted config and falls back to env on next read", () => {
    /*
     * ========================================================================
     * 步骤1：DELETE 后 fallback env
     * ========================================================================
     */
    writePersistedConfig(
      { apiKey: "sk-file", baseUrl: "https://file.example.com/v1", reconstructModel: "gpt-file" },
      configFile
    );
    assert.equal(deletePersistedConfig(configFile), true);
    assert.equal(existsSync(configFile), false);

    const after = readAiRuntimeConfig({ OPENAI_API_KEY: "sk-env" }, configFile);
    assert.equal(after.source, "env");
    assert.equal(after.apiKey, "sk-env");

    // 再次 delete 应该是 noop
    assert.equal(deletePersistedConfig(configFile), false);
  });
});
