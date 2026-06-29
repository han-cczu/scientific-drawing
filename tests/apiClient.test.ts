import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { testAppConfig } from "../src/lib/api";

const originalFetch = globalThis.fetch;

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
});
