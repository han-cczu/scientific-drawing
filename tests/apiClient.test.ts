import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeImage,
  deleteAppConfig,
  exportScene,
  loadAppConfig,
  reconstructImage,
  reconstructRegion,
  ReconstructApiError,
  saveAppConfig,
  testAppConfig
} from "../src/lib/api";
import type { Scene } from "../src/shared/scene";

const originalFetch = globalThis.fetch;

function sampleScene(): Scene {
  return {
    version: "0.1",
    page: { width: 100, height: 80, background: "#FFFFFF", units: "px" },
    metadata: {
      id: "api-client-scene",
      title: "API Client Scene",
      createdAt: "2026-06-29T00:00:00.000Z",
      engine: "test",
      notes: []
    },
    nodes: [],
    edges: []
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("frontend API client", () => {
  it("loads valid analyze responses", async () => {
    /*
     * ========================================================================
     * 步骤1：验证合法 AnalyzeResponse
     * ========================================================================
     * 目标：
     *   1) AnalyzeResponse runtime guard 不误拒后端正常响应
     *   2) sceneUrl/sourceUrl 字符串按协议保留
     */
    globalThis.fetch = (async () => new Response(JSON.stringify({
      scene: sampleScene(),
      sceneUrl: "/api/scenes/api-client-scene",
      sourceUrl: "/uploads/api-client-scene.png"
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    const result = await analyzeImage(new File(["png"], "sample.png", { type: "image/png" }));

    assert.equal(result.scene.metadata.id, "api-client-scene");
    assert.equal(result.sceneUrl, "/api/scenes/api-client-scene");
    assert.equal(result.sourceUrl, "/uploads/api-client-scene.png");
  });

  it("rejects malformed analyze responses", async () => {
    /*
     * ========================================================================
     * 步骤1：验证图片分析响应结构
     * ========================================================================
     * 目标：
     *   1) /api/analyze 返回合法 JSON 也必须符合 AnalyzeResponse 协议
     *   2) 非法 scene 不能进入编辑器历史
     */
    globalThis.fetch = (async () => new Response(JSON.stringify({
      scene: { ...sampleScene(), nodes: "bad" },
      sceneUrl: "/api/scenes/api-client-scene",
      sourceUrl: "/uploads/api-client-scene.png"
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    await assert.rejects(
      () => analyzeImage(new File(["png"], "sample.png", { type: "image/png" })),
      /响应格式异常|Analyze response/
    );
  });

  it("rejects malformed reconstruct responses", async () => {
    /*
     * ========================================================================
     * 步骤1：验证整图重建响应结构
     * ========================================================================
     * 目标：
     *   1) /api/reconstruct 成功响应必须校验 scene schema
     *   2) AI/代理返回的畸形 scene 不能写入画布
     */
    globalThis.fetch = (async () => new Response(JSON.stringify({
      scene: { ...sampleScene(), page: { width: 0, height: 80, background: "#FFFFFF", units: "px" } },
      sceneUrl: "/api/scenes/api-client-scene",
      sourceUrl: "/uploads/api-client-scene.png"
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    await assert.rejects(
      () => reconstructImage(new File(["png"], "sample.png", { type: "image/png" }), "color", "gpt-test"),
      /响应格式异常|Analyze response/
    );
  });

  it("normalizes unknown reconstruct error codes to UNKNOWN", async () => {
    /*
     * ========================================================================
     * 步骤1：验证重建错误 code 白名单
     * ========================================================================
     * 目标：
     *   1) 失败响应中的 error.code 来自不可信 JSON
     *   2) 未知字符串不能被 cast 成受支持 ReconstructErrorCode
     */
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: {
        code: "BILLING_REQUIRED",
        message: "billing required",
        hint: "check account"
      }
    }), {
      status: 402,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    await assert.rejects(
      () => reconstructImage(new File(["png"], "sample.png", { type: "image/png" }), "color", "gpt-test"),
      (error: unknown) => {
        assert.ok(error instanceof ReconstructApiError);
        assert.equal(error.code, "UNKNOWN");
        assert.equal(error.message, "billing required");
        assert.equal(error.hint, "check account");
        return true;
      }
    );
  });

  it("rejects malformed region reconstruction responses", async () => {
    /*
     * ========================================================================
     * 步骤1：验证局部重建响应结构
     * ========================================================================
     * 目标：
     *   1) /api/reconstruct-region 成功响应同样必须校验
     *   2) 非字符串 sceneUrl/sourceUrl 不能穿透 API client
     */
    globalThis.fetch = (async () => new Response(JSON.stringify({
      scene: sampleScene(),
      sceneUrl: 123,
      sourceUrl: null
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    await assert.rejects(
      () => reconstructRegion(sampleScene(), { x: 0, y: 0, w: 10, h: 10 }, "mono", "gpt-test", "replace"),
      /响应格式异常|Analyze response/
    );
  });

  it("loads valid app config payloads", async () => {
    /*
     * ========================================================================
     * 步骤1：验证读取合法配置响应
     * ========================================================================
     * 目标：
     *   1) AppConfig runtime validator 不误拒后端正常响应
     *   2) 字符串数组与可空字段按协议保留
     */
    globalThis.fetch = (async () => new Response(JSON.stringify({
      aiReconstructionAvailable: true,
      provider: "openai-compatible",
      baseUrl: "https://api.example.com",
      reconstructModel: "gpt-test",
      reconstructModels: ["gpt-test", "gpt-test-mini"],
      modelListAvailable: true,
      modelListError: null,
      hasApiKey: true,
      source: "file",
      maskedTail: "test"
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    const config = await loadAppConfig();

    assert.equal(config.aiReconstructionAvailable, true);
    assert.equal(config.source, "file");
    assert.deepEqual(config.reconstructModels, ["gpt-test", "gpt-test-mini"]);
    assert.equal(config.maskedTail, "test");
  });

  it("rejects malformed app config payloads when loading config", async () => {
    /*
     * ========================================================================
     * 步骤1：验证读取配置响应结构
     * ========================================================================
     * 目标：
     *   1) /api/config 返回合法 JSON 也必须符合 AppConfig 协议
     *   2) 畸形 reconstructModels/source 等字段不能进入 App state
     */
    globalThis.fetch = (async () => new Response(JSON.stringify({
      aiReconstructionAvailable: "yes",
      provider: "openai-compatible",
      baseUrl: "https://api.example.com",
      reconstructModel: "gpt-test",
      reconstructModels: "gpt-test",
      modelListAvailable: true,
      modelListError: null,
      hasApiKey: true,
      source: "file",
      maskedTail: null
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    await assert.rejects(
      () => loadAppConfig(),
      /响应格式异常|Invalid app config response/
    );
  });

  it("rejects non-JSON app config responses with a controlled format error", async () => {
    /*
     * ========================================================================
     * 步骤1：验证读取配置响应 Content-Type
     * ========================================================================
     * 目标：
     *   1) 网关/历史服务可能返回 200 + text/html
     *   2) API client 不应把底层 JSON parse 错误直接暴露给 UI
     */
    globalThis.fetch = (async () => new Response("<html>not json</html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    })) as typeof fetch;

    await assert.rejects(
      () => loadAppConfig(),
      /响应格式异常/
    );
  });

  it("rejects malformed app config payloads after saving config", async () => {
    /*
     * ========================================================================
     * 步骤1：验证保存配置响应结构
     * ========================================================================
     * 目标：
     *   1) POST /api/config 的成功响应同样必须校验
     *   2) 保存后不能把畸形配置热刷新进 App state
     */
    globalThis.fetch = (async () => new Response(JSON.stringify({
      aiReconstructionAvailable: true,
      provider: "openai-compatible",
      baseUrl: "https://api.example.com",
      reconstructModel: 123,
      reconstructModels: ["gpt-test"],
      modelListAvailable: true,
      modelListError: null,
      hasApiKey: true,
      source: "file",
      maskedTail: "test"
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    await assert.rejects(
      () => saveAppConfig({
        apiKey: "sk-test",
        baseUrl: "https://api.example.com",
        reconstructModel: "gpt-test"
      }),
      /响应格式异常|Invalid app config response/
    );
  });

  it("rejects malformed app config payloads after deleting config", async () => {
    /*
     * ========================================================================
     * 步骤1：验证清空配置响应结构
     * ========================================================================
     * 目标：
     *   1) DELETE /api/config 的成功响应也必须校验
     *   2) 非法 source 不能影响 SettingsDialog 的来源判断
     */
    globalThis.fetch = (async () => new Response(JSON.stringify({
      aiReconstructionAvailable: false,
      provider: "openai-compatible",
      baseUrl: "https://api.example.com",
      reconstructModel: "gpt-test",
      reconstructModels: ["gpt-test"],
      modelListAvailable: false,
      modelListError: null,
      hasApiKey: false,
      source: "remote",
      maskedTail: null
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    await assert.rejects(
      () => deleteAppConfig(),
      /响应格式异常|Invalid app config response/
    );
  });

  it("returns INVALID_RESPONSE when config test returns malformed JSON", async () => {
    /*
     * ========================================================================
     * 步骤1：验证配置测试响应解析兜底
     * ========================================================================
     * 目标：
     *   1) 网关/后端可能返回 application/json 但 body 损坏
     *   2) UI 不应收到 SyntaxError，而应得到可展示的 INVALID_RESPONSE 结果
     */
    globalThis.fetch = (async () => new Response("{ not json", {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    const result = await testAppConfig({
      apiKey: "sk-test",
      baseUrl: "https://api.example.com",
      reconstructModel: "gpt-test"
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "INVALID_RESPONSE");
      assert.match(result.error, /invalid|json|响应/i);
    }
  });

  it("returns INVALID_RESPONSE when config test success payload has invalid shape", async () => {
    /*
     * ========================================================================
     * 步骤1：验证配置测试成功响应结构
     * ========================================================================
     * 目标：
     *   1) application/json 且可解析不等于协议可信
     *   2) 成功响应里的模型列表必须是字符串数组，否则 UI 访问 length/map 时会失真
     */
    globalThis.fetch = (async () => new Response(JSON.stringify({
      ok: true,
      modelCount: 1,
      models: "gpt-test"
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    const result = await testAppConfig({
      apiKey: "sk-test",
      baseUrl: "https://api.example.com",
      reconstructModel: "gpt-test"
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "INVALID_RESPONSE");
      assert.match(result.error, /format|格式|响应/i);
      assert.deepEqual(result.models, []);
    }
  });

  it("returns INVALID_RESPONSE when config test error payload has invalid shape", async () => {
    /*
     * ========================================================================
     * 步骤1：验证配置测试失败响应结构
     * ========================================================================
     * 目标：
     *   1) 错误响应也必须遵守 code/error/models 类型约定
     *   2) 非法 code 或 error 不能直接穿透到 SettingsDialog
     */
    globalThis.fetch = (async () => new Response(JSON.stringify({
      ok: false,
      code: 401,
      error: ["bad key"],
      models: null
    }), {
      status: 401,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    const result = await testAppConfig({
      apiKey: "sk-test",
      baseUrl: "https://api.example.com",
      reconstructModel: "gpt-test"
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "INVALID_RESPONSE");
      assert.match(result.error, /format|格式|响应/i);
      assert.deepEqual(result.models, []);
    }
  });

  it("sanitizes export filenames parsed from Content-Disposition", async () => {
    /*
     * ========================================================================
     * 步骤1：验证前端下载文件名兜底清洗
     * ========================================================================
     * 目标：
     *   1) exportScene 不直接信任 Content-Disposition
     *   2) 路径分隔符、路径穿越和非法字符不能进入 <a download>
     */
    globalThis.fetch = (async () => new Response("svg", {
      status: 200,
      headers: {
        "content-disposition": "attachment; filename=\"..\\bad/path:name?.svg\""
      }
    })) as typeof fetch;

    const result = await exportScene(sampleScene(), "svg");

    assert.equal(result.filename, "bad-path-name.svg");
    assert.equal(await result.blob.text(), "svg");
  });

  it("sanitizes RFC 5987 export filenames while preserving unicode", async () => {
    /*
     * ========================================================================
     * 步骤1：验证 RFC 5987 文件名清洗
     * ========================================================================
     * 目标：
     *   1) filename* 分支同样不能带路径片段
     *   2) 中文标题应保留，避免降级成不可读 ASCII
     */
    globalThis.fetch = (async () => new Response("{}", {
      status: 200,
      headers: {
        "content-disposition": `attachment; filename="fallback.scene.json"; filename*=UTF-8''${encodeURIComponent("../图:path?.scene.json")}`
      }
    })) as typeof fetch;

    const result = await exportScene(sampleScene(), "json");

    assert.equal(result.filename, "图-path.scene.json");
    assert.equal(await result.blob.text(), "{}");
  });
});
