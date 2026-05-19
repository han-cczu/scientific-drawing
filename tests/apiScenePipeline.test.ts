import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { repairAndValidateSceneForPersistence } from "../server/src/routes/api";
import type { Scene } from "../src/shared/scene";

function invalidButRepairableScene(): Scene {
  /*
   * ========================================================================
   * 步骤1：创建可修复 scene
   * ========================================================================
   * 目标：
   *   1) 模拟 analyzeImage 或 AI 产出的异常 scene
   *   2) 覆盖非法颜色、负尺寸、悬空边
   */

  // 1.1 返回可修复 scene
  return {
    version: "0.1",
    page: { width: 300, height: 200, background: "bad", units: "px" },
    metadata: { id: "", title: "", createdAt: "", engine: "", notes: [] },
    nodes: [
      { id: "a", type: "rect", x: 10, y: 10, w: -40, h: 20, style: { fill: "bad", stroke: "#111111" } }
    ],
    edges: [
      { id: "e1", type: "arrow", from: "a:right@0.5", to: "missing:left@0.5", style: { stroke: "#111111" } }
    ]
  };
}

describe("api scene persistence pipeline", () => {
  it("repairs and validates scenes before writing them", () => {
    /*
     * ========================================================================
     * 步骤1：验证写盘前修复校验
     * ========================================================================
     * 目标：
     *   1) 修复可修复字段
     *   2) 丢弃无法可靠渲染的边
     */

    // 1.1 执行修复校验
    const result = repairAndValidateSceneForPersistence(invalidButRepairableScene(), {
      id: "scene-1",
      sourceUrl: "/uploads/a.png"
    });

    // 1.2 校验输出
    assert.equal(result.ok, true);
    assert.equal(result.scene.metadata.id, "scene-1");
    assert.equal(result.scene.metadata.sourceImage, "/uploads/a.png");
    const repairedNode = result.scene.nodes.find((node) => node.id === "a");
    assert.equal(repairedNode?.w, 40);
    assert.equal(result.scene.edges.length, 0);
  });
});
