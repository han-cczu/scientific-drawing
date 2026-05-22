import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  buildSafeAiProviderConfig,
  ConfigValidationError,
  deletePersistedConfig,
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
    assert.equal(validateWritableConfig({ apiKey: "a".repeat(600), baseUrl: "https://x", reconstructModel: "m" }).ok, false);

    const ok = validateWritableConfig({ apiKey: " sk-1 ", baseUrl: " https://x.com ", reconstructModel: " gpt-4o " });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.value.apiKey, "sk-1");
      assert.equal(ok.value.baseUrl, "https://x.com");
      assert.equal(ok.value.reconstructModel, "gpt-4o");
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
