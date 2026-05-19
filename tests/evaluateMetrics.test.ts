import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeSceneComplexity, countEditableNodes, formatSummaryLine, summarizeTypes } from "../server/src/evaluate";
import type { Scene } from "../src/shared/scene";

function sampleScene(): Scene {
  /*
   * ========================================================================
   * 步骤1：创建评估指标测试场景
   * ========================================================================
   * 目标：
   *   1) 覆盖锁定底图、文本、形状和连线
   *   2) 给统计函数提供稳定输入
   */

  // 1.1 返回测试 scene
  return {
    version: "0.1",
    page: { width: 100, height: 80, background: "#FFFFFF", units: "px" },
    metadata: { id: "metric-scene", title: "Metric Scene", createdAt: "2026-05-19T00:00:00.000Z", engine: "test", notes: [] },
    nodes: [
      { id: "image", type: "image", x: 0, y: 0, w: 100, h: 80, source: "/uploads/a.png", locked: true, style: { opacity: 1 } },
      { id: "label", type: "text", x: 10, y: 10, w: 30, h: 10, text: "A", style: { color: "#111111" } },
      { id: "box", type: "rect", x: 50, y: 10, w: 30, h: 20, style: { stroke: "#111111" } }
    ],
    edges: [
      { id: "e1", type: "arrow", from: "label:right@0.5", to: "box:left@0.5", style: { stroke: "#111111" } },
      { id: "e2", type: "arrow", from: "missing:right@0.5", to: "box:left@0.5", style: { stroke: "#111111" } }
    ]
  };
}

describe("evaluation metrics", () => {
  it("summarizes scene structure deterministically", () => {
    /*
     * ========================================================================
     * 步骤1：验证结构指标
     * ========================================================================
     * 目标：
     *   1) 节点类型摘要稳定排序
     *   2) 结构复杂度包含端点问题
     */

    // 1.1 计算指标
    const scene = sampleScene();
    const complexity = computeSceneComplexity(scene);

    // 1.2 校验指标
    assert.equal(summarizeTypes(scene), "image=1, rect=1, text=1");
    assert.equal(countEditableNodes(scene), 2);
    assert.deepEqual(complexity, {
      lockedNodes: 1,
      imageNodes: 1,
      textNodes: 1,
      shapeNodes: 1,
      edgeEndpointIssues: 1
    });
  });

  it("formats summary lines with visual and structure metrics", () => {
    /*
     * ========================================================================
     * 步骤1：验证评估摘要输出
     * ========================================================================
     * 目标：
     *   1) 保留 meanDiff 和编辑对象数量
     *   2) 输出新增结构指标
     */

    // 1.1 格式化评估结果
    const line = formatSummaryLine({
      file: "sample.png",
      width: 100,
      height: 80,
      nodes: 3,
      editableNodes: 2,
      edges: 2,
      typeSummary: "image=1, rect=1, text=1",
      meanDiff: 1.25,
      normalizedMeanDiff: 0.0049,
      psnr: 35.12,
      ssim: 0.98,
      normalizedMeanDiffDelta: 0.001,
      ssimDelta: -0.01,
      lockedNodes: 1,
      imageNodes: 1,
      textNodes: 1,
      shapeNodes: 1,
      edgeEndpointIssues: 1
    });

    // 1.2 校验输出内容
    assert.match(line, /sample\.png \| 100x80/);
    assert.match(line, /editable=2/);
    assert.match(line, /endpointIssues=1/);
    assert.match(line, /meanDiff=1.25/);
    assert.match(line, /normalized=0.0049/);
    assert.match(line, /normalizedDelta=0.001/);
    assert.match(line, /psnr=35.12/);
    assert.match(line, /ssim=0.98/);
    assert.match(line, /ssimDelta=-0.01/);
  });
});
