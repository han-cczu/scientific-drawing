import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toReconstructEnvelope } from "../server/src/routes/api";
import { ReconstructError, RECONSTRUCT_TIMEOUT_MS } from "../server/src/scene/reconstructWithOpenAI";

describe("reconstruct error envelope", () => {
  it("maps typed reconstruct errors to HTTP status and envelope", () => {
    /*
     * ========================================================================
     * 步骤1：验证错误码 → 状态码映射
     * ========================================================================
     * 目标：
     *   1) AUTH=401 / TIMEOUT=504 / 上游类=502 / INVALID_SCENE=500
     *   2) message 与 hint 原样透传
     */

    // 1.1 各错误码映射
    const auth = toReconstructEnvelope(new ReconstructError("AUTH", "no key", "配置 Key"));
    assert.deepEqual(
      { status: auth.status, code: auth.code, message: auth.message, hint: auth.hint },
      { status: 401, code: "AUTH", message: "no key", hint: "配置 Key" }
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
