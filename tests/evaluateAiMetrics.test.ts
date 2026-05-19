import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createEvaluationModeResult } from "../server/src/evaluate";

describe("AI evaluation metrics", () => {
  it("records mode, latency, estimated cost field, and failure state", () => {
    /*
     * ========================================================================
     * 步骤1：验证 AI 评估结果结构
     * ========================================================================
     * 目标：
     *   1) AI 链路指标不依赖真实 OpenAI 调用
     *   2) 失败率和耗时可记录
     */

    // 1.1 创建失败结果
    const result = createEvaluationModeResult({
      mode: "ai",
      file: "a.png",
      startedAt: 100,
      endedAt: 350,
      error: "missing key"
    });

    // 1.2 校验结构
    assert.equal(result.mode, "ai");
    assert.equal(result.latencyMs, 250);
    assert.equal(result.success, false);
    assert.equal(result.error, "missing key");
    assert.equal(result.estimatedCostUsd, null);
  });
});
