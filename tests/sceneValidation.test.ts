import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertScene, validateScene } from "../src/shared/sceneValidation";
import type { Scene } from "../src/shared/scene";

function validScene(): Scene {
  /*
   * ========================================================================
   * 步骤1：创建合法测试场景
   * ========================================================================
   * 目标：
   *   1) 提供校验器的基线输入
   *   2) 覆盖节点和连线最小结构
   */

  // 1.1 返回合法 scene
  return {
    version: "0.1",
    page: { width: 320, height: 180, background: "#FFFFFF", units: "px" },
    metadata: { id: "scene-1", title: "Scene", createdAt: "2026-05-19T00:00:00.000Z", engine: "test", notes: [] },
    nodes: [
      { id: "a", type: "rect", x: 10, y: 10, w: 80, h: 40, style: { fill: "#FFFFFF", stroke: "#111111" } },
      { id: "b", type: "rect", x: 160, y: 10, w: 80, h: 40, style: { fill: "#FFFFFF", stroke: "#111111" } }
    ],
    edges: [
      { id: "e1", type: "arrow", from: "a:right@0.5", to: "b:left@0.5", style: { stroke: "#111111" } }
    ]
  };
}

describe("scene validation", () => {
  it("accepts a valid scene", () => {
    /*
     * ========================================================================
     * 步骤1：验证合法 scene
     * ========================================================================
     * 目标：
     *   1) 合法输入不产生错误
     *   2) 校验器返回 ok=true
     */

    // 1.1 校验合法 scene
    const result = validateScene(validScene());

    // 1.2 判断结果
    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, []);
    assert.equal(assertScene(validScene()).metadata.id, "scene-1");
  });

  it("rejects duplicate ids and invalid edge endpoints", () => {
    /*
     * ========================================================================
     * 步骤1：验证结构错误
     * ========================================================================
     * 目标：
     *   1) 捕获重复节点 id
     *   2) 捕获引用不存在节点的边
     */

    // 1.1 构造非法 scene
    const scene = validScene();
    scene.nodes[1].id = "a";
    scene.edges[0].to = "missing:left@0.5";

    // 1.2 校验错误码
    const result = validateScene(scene);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === "duplicate_node_id"));
    assert.ok(result.issues.some((issue) => issue.code === "missing_edge_target"));
    assert.throws(() => assertScene(scene), /duplicate_node_id/);
  });

  it("rejects invalid page, node geometry, style, and edge type", () => {
    /*
     * ========================================================================
     * 步骤1：验证字段错误
     * ========================================================================
     * 目标：
     *   1) 捕获页面尺寸和颜色错误
     *   2) 捕获节点和连线非法字段
     */

    // 1.1 构造非法字段
    const scene = validScene();
    scene.page.width = 0;
    scene.page.background = "white";
    scene.nodes[0].w = -1;
    scene.nodes[0].style.opacity = 1.5;
    scene.nodes[0].style.fill = "#12";
    scene.edges[0].type = "bad" as Scene["edges"][number]["type"];

    // 1.2 校验错误码
    const result = validateScene(scene);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === "invalid_page_width"));
    assert.ok(result.issues.some((issue) => issue.code === "invalid_color"));
    assert.ok(result.issues.some((issue) => issue.code === "invalid_node_width"));
    assert.ok(result.issues.some((issue) => issue.code === "invalid_opacity"));
    assert.ok(result.issues.some((issue) => issue.code === "invalid_edge_type"));
  });
});
