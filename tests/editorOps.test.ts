import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveEndpoint } from "../src/shared/geometry";
import { createEdgeBetweenNodes, moveNodes, normalizeBox, removeNode, resizeNode, resizeNodeFromHandle, selectNodesInRect } from "../src/editor/sceneOps";
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
      },
      {
        id: "arrow",
        type: "arrow",
        x: 220,
        y: 160,
        w: 80,
        h: 0,
        points: [{ x: 220, y: 160 }, { x: 300, y: 160 }],
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

  it("resizes shape nodes from directional handles", () => {
    /*
     * ========================================================================
     * 步骤1：验证形状手柄缩放
     * ========================================================================
     * 目标：
     *   1) 东侧手柄只增加宽度
     *   2) 西侧手柄修改 x 和 w，并受最小尺寸保护
     */

    // 1.1 从东侧放大节点
    const east = resizeNodeFromHandle(editorScene(), "a", "e", { x: 20, y: 30, w: 60, h: 40 }, 15, 0);
    const eastNode = east.nodes.find((node) => node.id === "a");
    assert.equal(eastNode?.x, 20);
    assert.equal(eastNode?.w, 75);

    // 1.2 从西侧缩小到最小尺寸
    const west = resizeNodeFromHandle(editorScene(), "a", "w", { x: 20, y: 30, w: 60, h: 40 }, 100, 0);
    const westNode = west.nodes.find((node) => node.id === "a");
    assert.equal(westNode?.x, 72);
    assert.equal(westNode?.w, 8);
  });

  it("resizes line and arrow nodes by endpoint handles", () => {
    /*
     * ========================================================================
     * 步骤1：验证线条端点手柄
     * ========================================================================
     * 目标：
     *   1) 线段结束点拖拽会更新 points
     *   2) 箭头起点拖拽会更新 points 和包围盒
     */

    // 1.1 调整线段结束点
    const lineScene = resizeNodeFromHandle(editorScene(), "line", "line-end", { x: 70, y: 140, w: 80, h: 0 }, 20, 10);
    const line = lineScene.nodes.find((node) => node.id === "line");
    assert.deepEqual(line?.points, [{ x: 70, y: 140 }, { x: 170, y: 150 }]);
    assert.equal(line?.w, 100);
    assert.equal(line?.h, 10);

    // 1.2 调整箭头起点
    const arrowScene = resizeNodeFromHandle(editorScene(), "arrow", "line-start", { x: 220, y: 160, w: 80, h: 0 }, -10, -20);
    const arrow = arrowScene.nodes.find((node) => node.id === "arrow");
    assert.deepEqual(arrow?.points, [{ x: 210, y: 140 }, { x: 300, y: 160 }]);
    assert.equal(arrow?.x, 210);
    assert.equal(arrow?.y, 140);
  });

  it("creates semantic edges and keeps endpoint behavior tied to nodes", () => {
    /*
     * ========================================================================
     * 步骤1：验证语义连线
     * ========================================================================
     * 目标：
     *   1) 从两个节点创建 arrow edge
     *   2) 删除节点清理依赖 edge，移动节点后端点随节点变化
     */

    // 1.1 创建语义连线
    const scene = createEdgeBetweenNodes(editorScene(), "a", "b");
    const edge = scene.edges[0];
    assert.equal(edge.type, "arrow");
    assert.equal(edge.from, "a:right@0.5");
    assert.equal(edge.to, "b:left@0.5");

    // 1.2 删除节点时清理连线
    assert.equal(removeNode(scene, "a").edges.length, 0);

    // 1.3 移动节点后端点跟随变化
    const moved = moveNodes(scene, ["a"], 20, 0);
    assert.deepEqual(resolveEndpoint(edge.from ?? "", moved.nodes), { x: 100, y: 50 });
  });
});
