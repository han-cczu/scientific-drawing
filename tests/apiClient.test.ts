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
});
