import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { visibleSceneNodes, visibleSceneEdges } from "../src/shared/sceneVisibility";
import type { Scene } from "../src/shared/scene";

function visibilityScene(): Scene {
  /*
   * ========================================================================
   * 步骤1：创建可见性测试场景
   * ========================================================================
   * 目标：
   *   1) 覆盖隐藏节点和可见节点
   *   2) 覆盖显式坐标边和引用节点边
   */

  // 1.1 返回测试 scene
  return {
    version: "0.1",
    page: { width: 200, height: 120, background: "#FFFFFF", units: "px" },
    metadata: { id: "visibility", title: "Visibility", createdAt: "2026-05-19T00:00:00.000Z", engine: "test", notes: [] },
    nodes: [
      { id: "visible", type: "rect", x: 10, y: 10, w: 40, h: 20, style: { fill: "#FFFFFF", stroke: "#111111" } },
      { id: "hidden", type: "rect", x: 80, y: 10, w: 40, h: 20, hidden: true, style: { fill: "#FFFFFF", stroke: "#111111" } }
    ],
    edges: [
      { id: "visible-edge", type: "line", fromPoint: { x: 0, y: 0 }, toPoint: { x: 20, y: 20 }, style: { stroke: "#111111" } },
      { id: "hidden-edge", type: "arrow", from: "visible:right@0.5", to: "hidden:left@0.5", style: { stroke: "#111111" } }
    ]
  };
}

describe("scene visibility helpers", () => {
  it("filters hidden nodes and edges that reference them", () => {
    /*
     * ========================================================================
     * 步骤1：验证可见性过滤
     * ========================================================================
     * 目标：
     *   1) hidden=true 的节点不进入可见节点列表
     *   2) 引用隐藏节点的边不进入可见边列表
     */

    // 1.1 过滤节点和边
    const scene = visibilityScene();
    const nodes = visibleSceneNodes(scene.nodes);
    const edges = visibleSceneEdges(scene.edges, scene.nodes);

    // 1.2 校验过滤结果
    assert.deepEqual(nodes.map((node) => node.id), ["visible"]);
    assert.deepEqual(edges.map((edge) => edge.id), ["visible-edge"]);
  });
});
