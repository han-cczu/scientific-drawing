import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildForegroundMask } from "../server/src/scene/analysis/mask";
import { findComponents, mergeNearbyBoxes } from "../server/src/scene/analysis/components";
import { dedupeElements } from "../server/src/scene/analysis/elements";
import type { AnalysisElement, ComponentBox } from "../server/src/scene/analysis/types";

describe("analysis helpers", () => {
  it("marks dark pixels against a light background", () => {
    /*
     * ========================================================================
     * 步骤1：验证前景掩码
     * ========================================================================
     * 目标：
     *   1) 白底图中提取深色前景
     *   2) 背景像素保持为 0
     */

    // 1.1 准备灰度像素
    const buffer = Buffer.from([
      255, 0, 255,
      0, 0, 0,
      255, 0, 255
    ]);

    // 1.2 生成掩码并校验中心点
    const mask = buildForegroundMask(buffer, 3, 3);
    assert.equal(mask[4], 1);
    assert.equal(mask[0], 0);
  });

  it("finds and merges component boxes", () => {
    /*
     * ========================================================================
     * 步骤1：验证连通域和外框合并
     * ========================================================================
     * 目标：
     *   1) 相连像素生成一个组件框
     *   2) 接近的外框按 gap 合并
     */

    // 1.1 构造连通域掩码
    const mask = new Uint8Array(16);
    mask[0] = 1;
    mask[1] = 1;
    mask[4] = 1;
    const components = findComponents(mask, 4, 4);

    // 1.2 校验组件和合并结果
    assert.deepEqual(components[0], { x: 0, y: 0, w: 2, h: 2, area: 3 });
    const boxes: ComponentBox[] = [
      { x: 0, y: 0, w: 4, h: 4, area: 16 },
      { x: 5, y: 0, w: 4, h: 4, area: 16 },
      { x: 30, y: 0, w: 4, h: 4, area: 16 }
    ];
    assert.equal(mergeNearbyBoxes(boxes, 2).length, 2);
  });

  it("deduplicates near-identical analysis elements", () => {
    /*
     * ========================================================================
     * 步骤1：验证图元去重
     * ========================================================================
     * 目标：
     *   1) 删除位置和尺寸接近的重复图元
     *   2) 保留不同类型或距离较远的图元
     */

    // 1.1 准备重复图元
    const elements: AnalysisElement[] = [
      { type: "rect", x: 10, y: 10, w: 40, h: 20, style: { stroke: "#111111" } },
      { type: "rect", x: 12, y: 12, w: 42, h: 21, style: { stroke: "#111111" } },
      { type: "text", x: 12, y: 12, w: 42, h: 21, text: "Text", style: { color: "#111111" } },
      { type: "rect", x: 100, y: 10, w: 40, h: 20, style: { stroke: "#111111" } }
    ];

    // 1.2 校验去重数量
    assert.equal(dedupeElements(elements).length, 3);
  });
});
