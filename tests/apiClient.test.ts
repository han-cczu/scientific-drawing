import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { exportScene, testAppConfig } from "../src/lib/api";
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
