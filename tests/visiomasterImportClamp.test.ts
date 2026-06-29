import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeImportedScene } from "../src/editor/visiomasterAdapter";
import {
  MAX_GEOMETRY_COORDINATE,
  MAX_GRID_CELLS,
  MAX_GRID_DIMENSION,
  MAX_NODE_SIZE,
  MAX_PAGE_DIMENSION,
  MAX_POLYLINE_POINTS,
  MAX_PROTOCOL_STRING_LENGTH,
  MAX_SCENE_EDGES,
  MAX_SCENE_ID_LENGTH,
  MAX_SCENE_NODES,
  MAX_STYLE_FONT_SIZE,
  MAX_STYLE_STROKE_WIDTH,
  MAX_TEXT_LENGTH,
  MAX_TICK_POSITIONS,
  validateScene
} from "../src/shared/sceneValidation";

describe("Visiomaster 前端导入：网格维度钳制（前后端一致）", () => {
  it("修复当前协议 scene，避免前端导入旧草稿被 schema 收紧拒绝", () => {
    /*
     * ========================================================================
     * 步骤1：验证前端当前协议导入修复
     * ========================================================================
     * 目标：
     *   1) 当前协议 scene 也可能来自旧版本或手写 JSON，需要复用 repairScene
     *   2) normalizeImportedScene 输出应能直接通过 validateScene
     */

    // 1.1 构造当前协议但 schema 已不接受的旧 scene
    const scene = normalizeImportedScene({
      version: "0.1",
      page: { width: MAX_PAGE_DIMENSION + 100, height: 180, background: "white", units: "px" },
      metadata: { id: "old", title: "Old", createdAt: "2026-06-29T00:00:00.000Z", engine: "old", notes: [] },
      nodes: [
        {
          id: "box",
          type: "rect",
          x: 0,
          y: 0,
          w: 100,
          h: 80,
          style: {
            fill: "red",
            strokeWidth: MAX_STYLE_STROKE_WIDTH + 100,
            fontSize: MAX_STYLE_FONT_SIZE + 100
          }
        }
      ],
      edges: []
    });

    // 1.2 导入后应修复而不是保留非法字段
    assert.equal(scene.page.width, MAX_PAGE_DIMENSION);
    assert.equal(scene.page.background, "#FFFFFF");
    assert.equal(scene.nodes[0].style.fill, "#FFFFFF");
    assert.equal(scene.nodes[0].style.strokeWidth, MAX_STYLE_STROKE_WIDTH);
    assert.equal(scene.nodes[0].style.fontSize, MAX_STYLE_FONT_SIZE);
    assert.equal(validateScene(scene).ok, true);
  });

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

  it("钳制 Visiomaster cell_labels，避免前端导入完整展开无效标签", () => {
    /*
     * ========================================================================
     * 步骤1：验证前端 Visiomaster 标签数组规模上界
     * ========================================================================
     * 目标：
     *   1) cell_labels/labels 只用于补充 colored_cells，不应先完整构建超大 Map
     *   2) 超过 MAX_GRID_CELLS 的后置标签不应覆盖已钳制范围内的单元格
     */

    // 1.1 构造超长标签数组，末尾标签与唯一 colored cell 同坐标
    const labels = Array.from({ length: MAX_GRID_CELLS }, (_, index) => [index + 1, 0, "ignored", "#111111"]);
    labels.push([0, 0, "late", "#111111"]);
    const input = {
      page: { width: 320, height: 180, background: "#FFFFFF" },
      metadata: { title: "v" },
      nodes: [
        {
          id: "g1",
          type: "grid_matrix",
          x: 0,
          y: 0,
          w: 100,
          h: 100,
          rows: 1,
          cols: 1,
          colored_cells: [[0, 0, "#ABC"]],
          cell_labels: labels,
          style: {}
        }
      ],
      edges: []
    };

    // 1.2 越界标签被忽略，导入结果仍合法
    const scene = normalizeImportedScene(input);
    const grid = scene.nodes.find((node) => node.id === "g1");
    assert.equal(grid?.cells?.[0]?.text, undefined);
    assert.equal(validateScene(scene).ok, true);
  });

  it("钳制 Visiomaster row_colors 和 column_shades，避免前端导入保留无效尾部", () => {
    /*
     * ========================================================================
     * 步骤1：验证前端 Visiomaster 网格行/列辅助数组规模上界
     * ========================================================================
     * 目标：
     *   1) row_colors 最多保留 MAX_GRID_DIMENSION 项
     *   2) column_shades 最多保留 MAX_GRID_DIMENSION 项
     */

    // 1.1 构造超长行颜色和列阴影数组
    const input = {
      page: { width: 320, height: 180, background: "#FFFFFF" },
      metadata: { title: "v" },
      nodes: [
        {
          id: "grid",
          type: "grid_matrix",
          x: 0,
          y: 0,
          w: 100,
          h: 100,
          rows: 1,
          cols: 1,
          row_colors: Array.from({ length: MAX_GRID_DIMENSION + 10 }, () => "#ABC"),
          column_shades: Array.from({ length: MAX_GRID_DIMENSION + 10 }, () => 0.25),
          style: {}
        }
      ],
      edges: []
    };

    // 1.2 导入后裁剪并通过校验
    const scene = normalizeImportedScene(input);
    const grid = scene.nodes.find((node) => node.id === "grid");
    assert.equal(grid?.rowColors?.length, MAX_GRID_DIMENSION);
    assert.equal(grid?.columnShades?.length, MAX_GRID_DIMENSION);
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

  it("清洗 Visiomaster 非有限数值，避免前端导入产生非法 scene", () => {
    /*
     * ========================================================================
     * 步骤1：验证前端 Visiomaster 数值字段有限性
     * ========================================================================
     * 目标：
     *   1) page/node/style 数值字段不能保留 Infinity/NaN
     *   2) edge points 中的非有限坐标不能进入 scene
     */

    // 1.1 构造包含非有限数值的 Visiomaster 输入
    const input = {
      page: { width: Number.POSITIVE_INFINITY, height: Number.NaN, background: "#FFFFFF" },
      metadata: { title: "v" },
      nodes: [
        {
          id: "box",
          type: "process_box",
          x: Number.POSITIVE_INFINITY,
          y: Number.NaN,
          w: Number.NEGATIVE_INFINITY,
          h: Number.NaN,
          style: {
            line_weight_pt: Number.POSITIVE_INFINITY,
            font_size_pt: Number.NaN,
            opacity: Number.POSITIVE_INFINITY
          }
        }
      ],
      edges: [
        {
          id: "edge",
          type: "line_segment",
          points: [[0, 0], [Number.POSITIVE_INFINITY, 1], [2, Number.NaN]],
          style: {}
        }
      ]
    };

    // 1.2 导入后非法数值被 fallback 或丢弃，scene 可直接校验
    const scene = normalizeImportedScene(input);
    assert.equal(scene.page.width, 1280);
    assert.equal(scene.page.height, 720);
    assert.equal(scene.nodes[0].x, 0);
    assert.equal(scene.nodes[0].y, 0);
    assert.equal(scene.nodes[0].w, 100);
    assert.equal(scene.nodes[0].h, 40);
    assert.equal(scene.nodes[0].style.strokeWidth, undefined);
    assert.equal(scene.nodes[0].style.fontSize, undefined);
    assert.equal(scene.nodes[0].style.opacity, undefined);
    assert.deepEqual(scene.edges[0].points, [{ x: 0, y: 0 }]);
    assert.equal(validateScene(scene).ok, true);
  });

  it("钳制 Visiomaster 页面尺寸，避免前端导入放大渲染和导出布局", () => {
    /*
     * ========================================================================
     * 步骤1：验证前端页面尺寸规模上界
     * ========================================================================
     * 目标：
     *   1) page.width/page.height 在适配器层钳到共享页面上界
     *   2) 小于 1px 的正数会被提升到 1px，避免 PPTX/坐标比例异常
     */

    // 1.1 构造超界页面尺寸
    const scene = normalizeImportedScene({
      page: { width: MAX_PAGE_DIMENSION + 100, height: 0.5, background: "#FFFFFF" },
      metadata: { title: "v" },
      nodes: [
        { id: "box", type: "process_box", x: 0, y: 0, w: 100, h: 80, style: {} }
      ],
      edges: []
    });

    // 1.2 导入结果页面尺寸在共享合法范围内
    assert.equal(scene.page.width, MAX_PAGE_DIMENSION);
    assert.equal(scene.page.height, 1);
    assert.equal(validateScene(scene).ok, true);
  });

  it("钳制 Visiomaster 节点和点几何，避免前端导入放大渲染坐标", () => {
    /*
     * ========================================================================
     * 步骤1：验证前端几何数值规模上界
     * ========================================================================
     * 目标：
     *   1) node.x/y/w/h 在适配器层钳到共享几何上界
     *   2) edge points/from_point/to_point 同步钳到共享坐标上界
     */

    // 1.1 构造超界几何数值
    const scene = normalizeImportedScene({
      page: { width: 320, height: 180, background: "#FFFFFF" },
      metadata: { title: "v" },
      nodes: [
        {
          id: "box",
          type: "process_box",
          x: MAX_GEOMETRY_COORDINATE + 100,
          y: -MAX_GEOMETRY_COORDINATE - 100,
          w: MAX_NODE_SIZE + 100,
          h: MAX_NODE_SIZE + 100,
          style: {}
        },
        { id: "target", type: "process_box", x: 0, y: 0, w: 10, h: 10, style: {} }
      ],
      edges: [
        {
          id: "edge",
          type: "line_segment",
          from: "box",
          to: "target",
          from_point: [MAX_GEOMETRY_COORDINATE + 100, 0],
          to_point: [0, -MAX_GEOMETRY_COORDINATE - 100],
          points: [[MAX_GEOMETRY_COORDINATE + 100, -MAX_GEOMETRY_COORDINATE - 100]],
          style: {}
        }
      ]
    });

    // 1.2 导入结果几何字段在共享合法范围内
    assert.equal(scene.nodes[0].x, MAX_GEOMETRY_COORDINATE);
    assert.equal(scene.nodes[0].y, -MAX_GEOMETRY_COORDINATE);
    assert.equal(scene.nodes[0].w, MAX_NODE_SIZE);
    assert.equal(scene.nodes[0].h, MAX_NODE_SIZE);
    assert.deepEqual(scene.edges[0].fromPoint, { x: MAX_GEOMETRY_COORDINATE, y: 0 });
    assert.deepEqual(scene.edges[0].toPoint, { x: 0, y: -MAX_GEOMETRY_COORDINATE });
    assert.deepEqual(scene.edges[0].points, [{ x: MAX_GEOMETRY_COORDINATE, y: -MAX_GEOMETRY_COORDINATE }]);
    assert.equal(validateScene(scene).ok, true);
  });

  it("钳制 Visiomaster 样式数值，避免前端导入放大渲染和导出样式", () => {
    /*
     * ========================================================================
     * 步骤1：验证前端样式数值规模上界
     * ========================================================================
     * 目标：
     *   1) node style 的 line_weight_pt/font_size_pt 被钳到共享上界
     *   2) edge style 的 line_weight_pt/font_size_pt 被钳到共享上界
     */

    // 1.1 构造超界样式数值
    const scene = normalizeImportedScene({
      page: { width: 320, height: 180, background: "#FFFFFF" },
      metadata: { title: "v" },
      nodes: [
        {
          id: "box",
          type: "process_box",
          x: 0,
          y: 0,
          w: 100,
          h: 80,
          style: {
            line_weight_pt: MAX_STYLE_STROKE_WIDTH + 100,
            font_size_pt: MAX_STYLE_FONT_SIZE + 100
          }
        },
        { id: "target", type: "process_box", x: 120, y: 0, w: 10, h: 10, style: {} }
      ],
      edges: [
        {
          id: "edge",
          type: "line_segment",
          from: "box",
          to: "target",
          style: {
            line_weight_pt: MAX_STYLE_STROKE_WIDTH + 100,
            font_size_pt: MAX_STYLE_FONT_SIZE + 100
          }
        }
      ]
    });

    // 1.2 导入结果样式数值在共享合法范围内
    assert.equal(scene.nodes[0].style.strokeWidth, MAX_STYLE_STROKE_WIDTH);
    assert.equal(scene.nodes[0].style.fontSize, MAX_STYLE_FONT_SIZE);
    assert.equal(scene.edges[0].style.strokeWidth, MAX_STYLE_STROKE_WIDTH);
    assert.equal(scene.edges[0].style.fontSize, MAX_STYLE_FONT_SIZE);
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

  it("钳制 Visiomaster tick_positions，避免前端导入放大 bracket 渲染", () => {
    /*
     * ========================================================================
     * 步骤1：验证前端 Visiomaster tick_positions 规模上界
     * ========================================================================
     * 目标：
     *   1) 前端导入不经 repairScene，适配器需要自行钳制 tick_positions
     *   2) bracket tickPositions 不能放大 Canvas/SVG/PPTX 绘制链路
     */

    // 1.1 构造超长 Visiomaster tick_positions
    const input = {
      page: { width: 320, height: 180, background: "#FFFFFF" },
      metadata: { title: "v" },
      nodes: [
        {
          id: "br",
          type: "bracket",
          x: 0,
          y: 0,
          w: 100,
          h: 40,
          orientation: "right",
          tick_positions: Array.from({ length: MAX_TICK_POSITIONS + 10 }, () => 0.5),
          style: {}
        }
      ],
      edges: []
    };

    // 1.2 导入后钳制并通过校验
    const scene = normalizeImportedScene(input);
    const bracket = scene.nodes.find((node) => node.id === "br");
    assert.equal(bracket?.tickPositions?.length, MAX_TICK_POSITIONS);
    assert.equal(validateScene(scene).ok, true);
  });

  it("钳制 Visiomaster 文本字段，避免前端导入放大渲染和持久化", () => {
    /*
     * ========================================================================
     * 步骤1：验证前端 Visiomaster 文本字段规模上界
     * ========================================================================
     * 目标：
     *   1) node.text/symbol 和 cell_labels 文本最多保留共享上界
     *   2) edge.label 同样最多保留共享上界
     */

    // 1.1 构造超长文本字段
    const longText = "x".repeat(MAX_TEXT_LENGTH + 10);
    const input = {
      page: { width: 320, height: 180, background: "#FFFFFF" },
      metadata: { title: "v" },
      nodes: [
        {
          id: "grid",
          type: "grid_matrix",
          x: 0,
          y: 0,
          w: 100,
          h: 100,
          rows: 1,
          cols: 1,
          text: longText,
          symbol: longText,
          colored_cells: [[0, 0, "#ABC"]],
          cell_labels: [[0, 0, longText, "#111111"]],
          style: {}
        }
      ],
      edges: [
        { id: "edge", type: "line_segment", from: "grid", to: "grid", label: longText, style: {} }
      ]
    };

    // 1.2 导入后文本被裁剪并通过校验
    const scene = normalizeImportedScene(input);
    assert.equal(scene.nodes[0].text?.length, MAX_TEXT_LENGTH);
    assert.equal(scene.nodes[0].symbol?.length, MAX_TEXT_LENGTH);
    assert.equal(scene.nodes[0].cells?.[0]?.text?.length, MAX_TEXT_LENGTH);
    assert.equal(scene.edges[0].label?.length, MAX_TEXT_LENGTH);
    assert.equal(validateScene(scene).ok, true);
  });

  it("钳制 Visiomaster 协议字符串，确保前端导入后直接通过共享校验", () => {
    /*
     * ========================================================================
     * 步骤1：验证前端适配器结构字符串上界
     * ========================================================================
     * 目标：
     *   1) node/edge id 按短 id 上界裁剪
     *   2) from/to/source/style 等协议字符串按通用上界裁剪
     */

    // 1.1 构造超长结构字符串
    const longId = "n".repeat(MAX_SCENE_ID_LENGTH + 10);
    const longString = "x".repeat(MAX_PROTOCOL_STRING_LENGTH + 10);
    const input = {
      page: { width: 320, height: 180, background: "#FFFFFF" },
      metadata: { title: longString },
      nodes: [
        {
          id: longId,
          type: "image_tile",
          x: 0,
          y: 0,
          w: 100,
          h: 80,
          source: longString,
          style: { font_family: longString, font_weight: longString, line_dash: "dash" }
        },
        { id: "target", type: "process_box", x: 140, y: 0, w: 100, h: 80, style: {} }
      ],
      edges: [
        { id: longId, type: "arrow_connector", from: "target", to: `${longId}:left@0.5`, style: {} }
      ]
    };

    // 1.2 导入结果不应再含超界协议字符串
    const scene = normalizeImportedScene(input);
    assert.equal(scene.metadata.title.length, MAX_PROTOCOL_STRING_LENGTH);
    assert.equal(scene.nodes[0].id.length, MAX_SCENE_ID_LENGTH);
    assert.equal(scene.nodes[0].source?.length, MAX_PROTOCOL_STRING_LENGTH);
    assert.equal(scene.nodes[0].style.fontFamily?.length, MAX_PROTOCOL_STRING_LENGTH);
    assert.equal(scene.nodes[0].style.fontWeight?.length, MAX_PROTOCOL_STRING_LENGTH);
    assert.equal(scene.edges[0].id.length, MAX_SCENE_ID_LENGTH);
    assert.equal(scene.edges[0].from, "target");
    assert.equal(scene.edges[0].to, `${scene.nodes[0].id}:left@0.5`);
    assert.equal(validateScene(scene).ok, true);
  });

  it("为裁剪后碰撞的 Visiomaster id 生成唯一 id，并重写端点", () => {
    /*
     * ========================================================================
     * 步骤1：验证裁剪后 id 碰撞处理
     * ========================================================================
     * 目标：
     *   1) 两个超长 id 共享前缀时，裁剪后仍保持节点 id 唯一
     *   2) 边端点分别重写到对应的唯一化 id
     */

    // 1.1 构造两个裁剪后会碰撞的 id
    const prefix = "n".repeat(MAX_SCENE_ID_LENGTH);
    const firstId = `${prefix}-a`;
    const secondId = `${prefix}-b`;
    const input = {
      page: { width: 320, height: 180, background: "#FFFFFF" },
      metadata: { title: "v" },
      nodes: [
        { id: firstId, type: "process_box", x: 0, y: 0, w: 100, h: 80, style: {} },
        { id: secondId, type: "process_box", x: 140, y: 0, w: 100, h: 80, style: {} }
      ],
      edges: [
        { id: "edge", type: "arrow_connector", from: firstId, to: `${secondId}:left@0.5`, style: {} }
      ]
    };

    // 1.2 导入后 id 唯一且端点映射不串线
    const scene = normalizeImportedScene(input);
    assert.notEqual(scene.nodes[0].id, scene.nodes[1].id);
    assert.equal(scene.nodes[0].id.length, MAX_SCENE_ID_LENGTH);
    assert.equal(scene.nodes[1].id.length, MAX_SCENE_ID_LENGTH);
    assert.equal(scene.edges[0].from, scene.nodes[0].id);
    assert.equal(scene.edges[0].to, `${scene.nodes[1].id}:left@0.5`);
    assert.equal(validateScene(scene).ok, true);
  });
});
