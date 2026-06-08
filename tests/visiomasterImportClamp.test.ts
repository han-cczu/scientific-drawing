import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeImportedScene } from "../src/editor/visiomasterAdapter";
import { MAX_GRID_DIMENSION, validateScene } from "../src/shared/sceneValidation";

describe("Visiomaster 前端导入：网格维度钳制（前后端一致）", () => {
  it("把超界的 Visiomaster 网格 rows/cols 钳到上界，使客户端导入通过校验", () => {
    /*
     * ========================================================================
     * 步骤1：验证前端导入路径钳制大网格
     * ========================================================================
     * 目标：
     *   1) 旧实现 intOptional 不设上界 → rows=1000 经 validateScene(无 repair) 被拒
     *   2) 修复后钳到 MAX_GRID_DIMENSION，与服务端 repair 行为一致
     */

    // 1.1 首节点为 Visiomaster 专有类型，走 Visiomaster 适配路径（触发 intOptional）
    const input = {
      page: { width: 320, height: 180, background: "#FFFFFF" },
      metadata: { title: "v" },
      nodes: [
        { id: "g1", type: "grid_matrix", x: 0, y: 0, w: 100, h: 100, rows: 1000, cols: 5, style: {} }
      ],
      edges: []
    };

    // 1.2 导入后钳制并通过校验
    const scene = normalizeImportedScene(input);
    const grid = scene.nodes.find((node) => node.id === "g1");
    assert.equal(grid?.rows, MAX_GRID_DIMENSION);
    assert.equal(grid?.cols, 5);
    assert.equal(validateScene(scene).ok, true);
  });
});
