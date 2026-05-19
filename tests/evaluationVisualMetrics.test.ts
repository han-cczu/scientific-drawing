import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computePsnr, computeSsimApprox, normalizeMeanDiff } from "../server/src/evaluate";

describe("visual evaluation metrics", () => {
  it("normalizes meanDiff to 0..1", () => {
    /*
     * ========================================================================
     * 步骤1：验证 meanDiff 归一化
     * ========================================================================
     * 目标：
     *   1) 让不同尺寸样本更容易横向比较
     *   2) 保留原始 meanDiff
     */

    // 1.1 校验归一化
    assert.equal(normalizeMeanDiff(0), 0);
    assert.equal(normalizeMeanDiff(255), 1);
  });

  it("computes PSNR and approximate SSIM", () => {
    /*
     * ========================================================================
     * 步骤1：验证视觉指标
     * ========================================================================
     * 目标：
     *   1) PSNR 可衡量像素级误差
     *   2) SSIM 近似值落在合法范围
     */

    // 1.1 校验 PSNR
    assert.equal(computePsnr(0), Infinity);
    assert.ok(computePsnr(100) > 20);

    // 1.2 校验 SSIM 近似范围
    const ssim = computeSsimApprox(Buffer.from([0, 10, 20]), Buffer.from([0, 10, 25]));
    assert.ok(ssim <= 1);
    assert.ok(ssim >= -1);
  });
});
