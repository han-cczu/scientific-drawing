import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { moveNodes, normalizeBox, resizeNode, selectNodesInRect } from "../src/editor/sceneOps";
import type { Scene } from "../src/shared/scene";

function editorScene(): Scene {
  /*
   * ========================================================================
   * 步骤1：创建编辑操作测试场景
   * ========================================================================
   * 目标：
   *   1) 覆盖普通节点、锁定底图和线段节点
   *   2) 给移动、缩放和框选提供稳定输入
   */

  // 1.1 返回测试 scene
  return {
    version: "0.1",
    page: { width: 400, height: 240, background: "#FFFFFF", units: "px" },
    metadata: { id: "editor-scene", title: "Editor Scene", createdAt: "2026-05-19T00:00:00.000Z", engine: "test", notes: [] },
    nodes: [
      { id: "base", type: "image", x: 0, y: 0, w: 400, h: 240, source: "/uploads/source.png", locked: true, style: { opacity: 1 } },
      { id: "a", type: "rect", x: 20, y: 30, w: 60, h: 40, style: { fill: "#FFFFFF", stroke: "#111111" } },
      { id: "b", type: "ellipse", x: 140, y: 40, w: 50, h: 50, locked: true, style: { fill: "#FFFFFF", stroke: "#111111" } },
      {
        id: "line",
        type: "line",
        x: 70,
        y: 140,
        w: 80,
        h: 0,
        points: [{ x: 70, y: 140 }, { x: 150, y: 140 }],
        style: { fill: "none", stroke: "#111111" }
      }
    ],
    edges: []
  };
}

describe("editor scene operations", () => {
  it("moves multiple unlocked nodes and their point arrays", () => {
    /*
     * ========================================================================
     * 步骤1：验证多选移动
     * ========================================================================
     * 目标：
     *   1) 多个未锁定节点一起移动
     *   2) 线段 points 跟随节点坐标移动
     */

    // 1.1 移动多个节点
    const scene = moveNodes(editorScene(), ["a", "line"], 10, -5);

    // 1.2 校验节点和点数组
    assert.deepEqual(scene.nodes.find((node) => node.id === "a"), {
      id: "a",
      type: "rect",
      x: 30,
      y: 25,
      w: 60,
      h: 40,
      style: { fill: "#FFFFFF", stroke: "#111111" }
    });
    assert.deepEqual(scene.nodes.find((node) => node.id === "line")?.points, [{ x: 80, y: 135 }, { x: 160, y: 135 }]);
  });

  it("does not move locked nodes", () => {
    /*
     * ========================================================================
     * 步骤1：验证锁定节点保护
     * ========================================================================
     * 目标：
     *   1) 多选移动时跳过锁定节点
     *   2) 保留锁定节点原坐标
     */

    // 1.1 尝试移动锁定节点
    const scene = moveNodes(editorScene(), ["base", "b"], 20, 20);

    // 1.2 校验坐标不变
    assert.equal(scene.nodes.find((node) => node.id === "base")?.x, 0);
    assert.equal(scene.nodes.find((node) => node.id === "b")?.x, 140);
  });

  it("normalizes and clamps resized boxes", () => {
    /*
     * ========================================================================
     * 步骤1：验证尺寸调整
     * ========================================================================
     * 目标：
     *   1) 负宽高会转成正向盒子
     *   2) 宽高会被限制到最小尺寸
     */

    // 1.1 校验盒子归一化
    assert.deepEqual(normalizeBox({ x: 80, y: 90, w: -30, h: -20 }), { x: 50, y: 70, w: 30, h: 20 });

    // 1.2 调整节点尺寸
    const scene = resizeNode(editorScene(), "a", { x: 40, y: 50, w: 2, h: -4 });
    const node = scene.nodes.find((item) => item.id === "a");
    assert.equal(node?.x, 40);
    assert.equal(node?.y, 46);
    assert.equal(node?.w, 8);
    assert.equal(node?.h, 8);
  });

  it("selects nodes in a rectangle and ignores locked source images", () => {
    /*
     * ========================================================================
     * 步骤1：验证框选
     * ========================================================================
     * 目标：
     *   1) 选中和选择框相交的可编辑节点
     *   2) 默认忽略锁定底图
     */

    // 1.1 执行框选
    const ids = selectNodesInRect(editorScene(), { x: -10, y: -10, w: 120, h: 180 });

    // 1.2 校验选中结果
    assert.deepEqual(ids, ["a", "line"]);
  });
});
