import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeRegionReconstruction, sceneRegionToImageExtract, sourceImageUrlFromScene } from "../server/src/scene/regionReconstruction";
import type { Scene } from "../src/shared/scene";

function baseScene(): Scene {
  /*
   * ========================================================================
   * 步骤1：创建局部重建测试场景
   * ========================================================================
   * 目标：
   *   1) 包含锁定底图、区域内节点和区域外节点
   *   2) 覆盖旧边删除和新边平移
   */

  // 1.1 返回测试 scene
  return {
    version: "0.1",
    page: { width: 400, height: 200, background: "#FFFFFF", units: "px" },
    metadata: {
      id: "scene",
      title: "Region Scene",
      sourceImage: "/uploads/base.png",
      createdAt: "2026-05-19T00:00:00.000Z",
      engine: "test",
      notes: []
    },
    nodes: [
      { id: "source-image", type: "image", x: 0, y: 0, w: 400, h: 200, source: "/uploads/base.png", locked: true, style: { opacity: 1 } },
      { id: "inside", type: "rect", x: 110, y: 60, w: 60, h: 40, style: { fill: "#FFFFFF", stroke: "#111111" } },
      { id: "outside", type: "ellipse", x: 260, y: 60, w: 40, h: 40, style: { fill: "#FFFFFF", stroke: "#111111" } }
    ],
    edges: [
      { id: "old-edge", type: "arrow", from: "inside:right@0.5", to: "outside:left@0.5", style: { stroke: "#111111" } }
    ]
  };
}

function regionScene(): Scene {
  /*
   * ========================================================================
   * 步骤1：创建 AI 局部输出场景
   * ========================================================================
   * 目标：
   *   1) 模拟裁剪图内的局部坐标
   *   2) 故意使用重复 id 验证合并时去重
   */

  // 1.1 返回局部 scene
  return {
    version: "0.1",
    page: { width: 100, height: 80, background: "#FFFFFF", units: "px" },
    metadata: {
      id: "region",
      title: "Region",
      createdAt: "2026-05-19T00:00:00.000Z",
      engine: "test",
      notes: []
    },
    nodes: [
      { id: "outside", type: "rect", x: 10, y: 15, w: 50, h: 30, style: { fill: "#FFFFFF", stroke: "#111111" } },
      { id: "region-label", type: "text", x: 12, y: 54, w: 70, h: 20, text: "New", style: { color: "#111111" } }
    ],
    edges: [
      { id: "region-edge", type: "arrow", from: "outside:right@0.5", to: "region-label:left@0.5", points: [{ x: 66, y: 30 }], style: { stroke: "#111111" } }
    ]
  };
}

describe("region reconstruction helpers", () => {
  it("maps scene region boxes to source image extract boxes", () => {
    /*
     * ========================================================================
     * 步骤1：验证区域裁剪坐标
     * ========================================================================
     * 目标：
     *   1) 负向框选会归一化
     *   2) scene 坐标会按原图尺寸映射成 sharp extract 坐标
     */

    // 1.1 转换裁剪区域
    const extract = sceneRegionToImageExtract(
      { x: 200, y: 120, w: -100, h: -80 },
      { width: 400, height: 200 },
      { width: 800, height: 400 }
    );

    // 1.2 校验映射结果
    assert.deepEqual(extract, { left: 200, top: 80, width: 200, height: 160 });
  });

  it("finds the original image url from scene metadata or base image", () => {
    /*
     * ========================================================================
     * 步骤1：验证原图来源解析
     * ========================================================================
     * 目标：
     *   1) 优先读取 metadata.sourceImage
     *   2) 缺失时回退到 image 节点
     */

    // 1.1 校验 metadata 来源
    assert.equal(sourceImageUrlFromScene(baseScene()), "/uploads/base.png");

    // 1.2 校验 image 节点回退
    const scene = baseScene();
    scene.metadata.sourceImage = undefined;
    assert.equal(sourceImageUrlFromScene(scene), "/uploads/base.png");
  });

  it("replaces editable nodes inside the region and translates AI output", () => {
    /*
     * ========================================================================
     * 步骤1：验证替换式局部合并
     * ========================================================================
     * 目标：
     *   1) 删除区域内旧节点和依赖旧边
     *   2) 新节点从局部坐标平移到全局坐标并去重 id
     */

    // 1.1 合并局部输出
    const scene = mergeRegionReconstruction(baseScene(), regionScene(), { x: 100, y: 50, w: 100, h: 80 }, "replace");

    // 1.2 校验旧节点和旧边处理
    assert.equal(scene.nodes.some((node) => node.id === "inside"), false);
    assert.equal(scene.edges.some((edge) => edge.id === "old-edge"), false);
    assert.equal(scene.nodes.some((node) => node.id === "source-image"), true);

    // 1.3 校验新节点坐标和 id 去重
    const inserted = scene.nodes.find((node) => node.id === "outside-2");
    assert.equal(inserted?.x, 110);
    assert.equal(inserted?.y, 65);
    assert.equal(scene.edges[0]?.from, "outside-2:right@0.5");
    assert.deepEqual(scene.edges[0]?.points, [{ x: 166, y: 80 }]);
  });

  it("overlays AI output without removing existing region nodes", () => {
    /*
     * ========================================================================
     * 步骤1：验证叠加式局部合并
     * ========================================================================
     * 目标：
     *   1) 保留区域内旧节点
     *   2) 追加 AI 新节点和新边
     */

    // 1.1 叠加局部输出
    const scene = mergeRegionReconstruction(baseScene(), regionScene(), { x: 100, y: 50, w: 100, h: 80 }, "overlay");

    // 1.2 校验旧内容仍存在
    assert.equal(scene.nodes.some((node) => node.id === "inside"), true);
    assert.equal(scene.edges.some((edge) => edge.id === "old-edge"), true);

    // 1.3 校验新内容追加
    assert.equal(scene.nodes.some((node) => node.id === "outside-2"), true);
    assert.equal(scene.edges.some((edge) => edge.id === "region-edge"), true);
  });
});
