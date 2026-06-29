import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeImportedScene } from "../src/editor/visiomasterAdapter";
import {
  MAX_GRID_CELLS,
  MAX_GRID_DIMENSION,
  MAX_POLYLINE_POINTS,
  MAX_SCENE_EDGES,
  MAX_SCENE_NODES,
  validateScene
} from "../src/shared/sceneValidation";

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

  it("把超长 Visiomaster colored_cells 钳到上界，使客户端导入通过校验", () => {
    /*
     * ========================================================================
     * 步骤1：验证前端导入路径钳制超长 cells
     * ========================================================================
     * 目标：
     *   1) 前端导入不经 repairScene，超长 colored_cells 若透传会被 validateScene 拒绝
     *   2) 修复后与服务端 repairScene 一样钳到 MAX_GRID_CELLS
     */

    // 1.1 构造超过上限的 Visiomaster 单元格
    const coloredCells = Array.from({ length: MAX_GRID_CELLS + 10 }, () => [0, 0, "#ABC"]);
    const input = {
      page: { width: 320, height: 180, background: "#FFFFFF" },
      metadata: { title: "v" },
      nodes: [
        { id: "g1", type: "grid_matrix", x: 0, y: 0, w: 100, h: 100, rows: 1, cols: 1, colored_cells: coloredCells, style: {} }
      ],
      edges: []
    };

    // 1.2 导入后钳制并通过校验
    const scene = normalizeImportedScene(input);
    const grid = scene.nodes.find((node) => node.id === "g1");
    assert.equal(grid?.cells?.length, MAX_GRID_CELLS);
    assert.equal(validateScene(scene).ok, true);
  });

  it("清洗 Visiomaster 样式颜色，避免命名色导致前端导入失败", () => {
    /*
     * ========================================================================
     * 步骤1：验证前端导入路径的颜色修复
     * ========================================================================
     * 目标：
     *   1) 前端导入不经 server repairScene，适配器必须自行清洗颜色
     *   2) Visiomaster/AI 常见 named color 或坏色不能让 validateScene 拒绝导入
     */

    // 1.1 构造含 named color / 坏色的 Visiomaster 输入
    const input = {
      page: { width: 320, height: 180, background: "white" },
      metadata: { title: "v" },
      nodes: [
        {
          id: "box",
          type: "process_box",
          x: 0,
          y: 0,
          w: 100,
          h: 40,
          style: {
            fill: "white",
            stroke: "black",
            text_color: "blue"
          }
        },
        {
          id: "grid",
          type: "grid_matrix",
          x: 0,
          y: 50,
          w: 100,
          h: 40,
          rows: 1,
          cols: 1,
          row_colors: ["red", "#ABC"],
          colored_cells: [[0, 0, "not-a-color", "1"]],
          cell_labels: [[0, 0, "1", "green"]],
          style: { stroke: "#111111" }
        }
      ],
      edges: []
    };

    // 1.2 导入后颜色落到 scene 协议可接受范围
    const scene = normalizeImportedScene(input);
    const box = scene.nodes.find((node) => node.id === "box");
    const grid = scene.nodes.find((node) => node.id === "grid");

    assert.equal(box?.style.fill, "#FFFFFF");
    assert.equal(box?.style.stroke, "#111111");
    assert.equal(box?.style.color, "#111111");
    assert.deepEqual(grid?.rowColors, ["#FFFFFF", "#AABBCC"]);
    assert.equal(grid?.cells?.[0].fill, "#FFFFFF");
    assert.equal(grid?.cells?.[0].color, "#111111");
    assert.equal(validateScene(scene).ok, true);
  });

  it("钳制 Visiomaster 顶层数组和边 points，避免前端导入放大渲染链路", () => {
    /*
     * ========================================================================
     * 步骤1：验证前端导入路径的规模上界
     * ========================================================================
     * 目标：
     *   1) Visiomaster nodes/edges 在适配器层钳到共享上界
     *   2) edge.points 同样钳到共享上界，使导入后 scene 可直接校验
     */

    // 1.1 构造超长 Visiomaster 场景
    const points = Array.from({ length: MAX_POLYLINE_POINTS + 10 }, (_, index) => [index, index]);
    const input = {
      page: { width: 320, height: 180, background: "#FFFFFF" },
      metadata: { title: "v" },
      nodes: Array.from({ length: MAX_SCENE_NODES + 10 }, (_, index) => ({
        id: `n-${index}`,
        type: "process_box",
        x: index,
        y: 0,
        w: 1,
        h: 1,
        style: {}
      })),
      edges: Array.from({ length: MAX_SCENE_EDGES + 10 }, (_, index) => ({
        id: `e-${index}`,
        type: "line_segment",
        from: "n-0",
        to: "n-1",
        points,
        style: {}
      }))
    };

    // 1.2 导入后钳制并通过校验
    const scene = normalizeImportedScene(input);
    assert.equal(scene.nodes.length, MAX_SCENE_NODES);
    assert.equal(scene.edges.length, MAX_SCENE_EDGES);
    assert.equal(scene.edges[0].points?.length, MAX_POLYLINE_POINTS);
    assert.equal(validateScene(scene).ok, true);
  });
});
