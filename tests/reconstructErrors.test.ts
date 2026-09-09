import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { toReconstructEnvelope } from "../server/src/routes/reconstructErrors";
import { ReconstructError, reconstructWithOpenAI, RECONSTRUCT_TIMEOUT_MS } from "../server/src/scene/reconstructWithOpenAI";

describe("reconstruct error envelope", () => {
  it("maps typed reconstruct errors to HTTP status and envelope", () => {
    /*
     * ========================================================================
     * 步骤1：验证错误码 → 状态码映射
     * ========================================================================
     * 目标：
     *   1) AUTH=401 / TIMEOUT=504 / 上游类=502 / INVALID_SCENE=500
     *   2) message 使用公开文案，hint 仍保留给前端恢复建议
     */

    // 1.1 各错误码映射
    const auth = toReconstructEnvelope(new ReconstructError("AUTH", "no key", "配置 Key"));
    assert.deepEqual(
      { status: auth.status, code: auth.code, message: auth.message, hint: auth.hint },
      { status: 401, code: "AUTH", message: "AI reconstruction authentication failed.", hint: "配置 Key" }
    );
    assert.equal(toReconstructEnvelope(new ReconstructError("TIMEOUT", "t")).status, 504);
    assert.equal(toReconstructEnvelope(new ReconstructError("BAD_MODEL_OUTPUT", "b")).status, 502);
    assert.equal(toReconstructEnvelope(new ReconstructError("NETWORK", "n")).status, 502);
    assert.equal(toReconstructEnvelope(new ReconstructError("UPSTREAM", "u")).status, 502);
    assert.equal(toReconstructEnvelope(new ReconstructError("INVALID_SCENE", "i")).status, 500);
  });

  it("falls back to UNKNOWN/500 for untyped errors", () => {
    /*
     * ========================================================================
     * 步骤1：验证未知错误兜底
     * ========================================================================
     */

    // 1.1 普通 Error 与非 Error 值
    const plain = toReconstructEnvelope(new Error("boom"));
    assert.equal(plain.status, 500);
    assert.equal(plain.code, "UNKNOWN");
    assert.equal(plain.message, "boom");
    assert.equal(toReconstructEnvelope("oops").code, "UNKNOWN");
  });

  it("does not expose upstream reconstruct error payloads to the browser", () => {
    /*
     * ========================================================================
     * 步骤1：验证重建错误信封不泄露上游详情
     * ========================================================================
     * 目标：
     *   1) 上游网关错误体可能包含内部主机名、trace id 或 key 片段
     *   2) 返回给浏览器的 message/hint 只应是受控文案
     */
    const upstream = toReconstructEnvelope(new ReconstructError(
      "UPSTREAM",
      "OpenAI reconstruct failed: {\"error\":\"internal host gpu-a.internal\",\"trace\":\"trace-123\"}"
    ));
    assert.equal(upstream.status, 502);
    assert.equal(upstream.code, "UPSTREAM");
    assert.doesNotMatch(upstream.message, /gpu-a\.internal|trace-123|OpenAI reconstruct failed/i);

    const auth = toReconstructEnvelope(new ReconstructError(
      "AUTH",
      "OpenAI reconstruct failed: {\"error\":\"invalid key sk-live-secret-tail\"}",
      "请检查 API Key 是否对所选 Base URL 有效"
    ));
    assert.equal(auth.status, 401);
    assert.equal(auth.code, "AUTH");
    assert.doesNotMatch(auth.message, /sk-live-secret-tail|OpenAI reconstruct failed/i);
    assert.match(auth.hint ?? "", /API Key/);
  });

  it("pins the upstream timeout constant", () => {
    /*
     * ========================================================================
     * 步骤1：固定超时常量
     * ========================================================================
     * 目标：防止超时被无意调成过短（vision 大图可达 60-120s）
     */
    assert.equal(RECONSTRUCT_TIMEOUT_MS, 120_000);
  });
});

describe("reconstruct upstream payload parsing", () => {
  it("classifies non-object success payloads as bad model output", async () => {
    /*
     * ========================================================================
     * 步骤1：验证成功 HTTP 响应的 payload 结构边界
     * ========================================================================
     * 目标：
     *   1) OpenAI-compatible 网关返回 200 但 body 不是对象时，不应泄漏普通 TypeError
     *   2) 这类协议/模型输出异常应归入 BAD_MODEL_OUTPUT，供路由返回 502 可恢复信封
     */
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "reconstruct-payload-"));
    const imagePath = path.join(tmpDir, "tiny.png");
    const originalFetch = globalThis.fetch;


    try {
      await sharp({
        create: {
          width: 1,
          height: 1,
          channels: 3,
          background: "#ffffff"
        }
      }).png().toFile(imagePath);

      globalThis.fetch = (async () => new Response("null", {
        status: 200,
        headers: { "content-type": "application/json" }
      })) as typeof fetch;

      await assert.rejects(
        () => reconstructWithOpenAI({ imagePath, mimeType: "image/png", mode: "color" }, { apiKey: "fixture-key", baseUrl: "https://gateway.example.com/v1", defaultModel: "gpt-test", source: "env" }),
        (error) => {
          assert.ok(error instanceof ReconstructError);
          assert.equal(error.code, "BAD_MODEL_OUTPUT");
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
      assert.equal(path.dirname(tmpDir), path.resolve(os.tmpdir()));
      assert.match(path.basename(tmpDir), /^reconstruct-payload-/);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
