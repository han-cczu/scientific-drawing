import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensureReplicaBaseLayer } from "../server/src/routes/api";
import { repairScene } from "../server/src/scene/repairScene";
import type { Scene } from "../src/shared/scene";
import { MAX_GEOMETRY_COORDINATE, MAX_GRID_DIMENSION, MAX_METADATA_NOTE_LENGTH, MAX_METADATA_NOTES, MAX_NODE_SIZE, MAX_PAGE_DIMENSION, MAX_POLYLINE_POINTS, MAX_PROTOCOL_STRING_LENGTH, MAX_SCENE_EDGES, MAX_SCENE_ID_LENGTH, MAX_SCENE_NODES, MAX_TEXT_LENGTH, MAX_TICK_POSITIONS, validateScene } from "../src/shared/sceneValidation";

function damagedScene(): Scene {
  /*
   * ========================================================================
   * 步骤1：创建待修复场景
   * ========================================================================
   * 目标：
   *   1) 覆盖 AI 输出常见坏字段
   *   2) 给修复器提供稳定输入
   */

  // 1.1 返回包含坏字段的 scene
  return {
    version: "0.1",
    page: { width: -10, height: 0, background: "white", units: "px" },
    metadata: { id: "", title: "", createdAt: "", engine: "", notes: [] },
    nodes: [
      { id: "dup", type: "rect", x: 0, y: 0, w: -80, h: -40, style: { fill: "red", stroke: "#111111", opacity: 2 } },
      { id: "dup", type: "bad" as Scene["nodes"][number]["type"], x: Number.NaN, y: 10, w: 0, h: 20, style: { fill: "#FFFFFF", stroke: "black" } },
      { id: "target", type: "text", x: 120, y: 20, w: 90, h: 24, text: "Label", style: { color: "blue", fontSize: -1 } }
    ],
    edges: [
      { id: "keep", type: "arrow", from: "dup:right@0.5", to: "target:left@0.5", style: { stroke: "#111111" } },
      { id: "drop", type: "arrow", from: "missing:right@0.5", to: "target:left@0.5", style: { stroke: "#111111" } }
    ]
  };
}

describe("scene repair", () => {
  it("repairs malformed AI scenes into valid internal scenes", () => {
    /*
     * ========================================================================
     * 步骤1：验证 scene 修复
     * ========================================================================
     * 目标：
     *   1) 修复重复 id、尺寸、颜色和元数据
     *   2) 删除引用缺失节点的边
     */

    // 1.1 执行修复
    const repaired = repairScene(damagedScene());

    // 1.2 校验修复结果
    assert.equal(repaired.page.width, 1280);
    assert.equal(repaired.page.height, 720);
    assert.equal(repaired.page.background, "#FFFFFF");
    assert.notEqual(repaired.nodes[0].id, repaired.nodes[1].id);
    assert.equal(repaired.nodes[0].w, 80);
    assert.equal(repaired.nodes[0].h, 40);
    assert.equal(repaired.nodes[1].type, "rect");
    assert.equal(repaired.nodes[1].x, 0);
    assert.equal(repaired.nodes[1].w, 1);
    assert.equal(repaired.nodes[0].style.fill, "#FFFFFF");
    assert.equal(repaired.nodes[0].style.opacity, 1);
    assert.equal(repaired.nodes[2].style.color, "#111111");
    assert.equal(repaired.edges.length, 1);
    assert.equal(repaired.edges[0].id, "keep");
    assert.equal(repaired.edges[0].from, `${repaired.nodes[0].id}:right@0.5`);
    assert.equal(validateScene(repaired).ok, true);
  });

  it("clamps oversized metadata notes so repaired scenes still validate", () => {
    /*
     * ========================================================================
     * 步骤1：验证 metadata.notes 修复规模上界
     * ========================================================================
     * 目标：
     *   1) repairScene 需要限制 notes 数量
     *   2) repairScene 需要限制单条 note 长度
     */

    // 1.1 构造超量 notes 和超长首项
    const scene = damagedScene();
    scene.metadata.notes = Array.from({ length: MAX_METADATA_NOTES + 10 }, (_, index) =>
      index === 0 ? "x".repeat(MAX_METADATA_NOTE_LENGTH + 10) : `note-${index}`
    );

    // 1.2 修复后 notes 被钳制且 scene 合法
    const repaired = repairScene(scene);
    assert.equal(repaired.metadata.notes.length, MAX_METADATA_NOTES);
    assert.equal(repaired.metadata.notes[0].length, MAX_METADATA_NOTE_LENGTH);
    assert.equal(validateScene(repaired).ok, true);
  });

  it("clamps page dimensions so repaired scenes stay within render bounds", () => {
    /*
     * ========================================================================
     * 步骤1：验证页面尺寸修复规模上界
     * ========================================================================
     * 目标：
     *   1) repairScene 需要把超大页面钳到导出/渲染上界
     *   2) 小于 1px 的正数不能绕过 positive 修复后继续进入 PPTX scale
     */

    // 1.1 构造超界页面尺寸
    const scene = damagedScene();
    scene.page.width = MAX_PAGE_DIMENSION + 100;
    scene.page.height = 0.5;

    // 1.2 修复后页面尺寸在共享合法范围内
    const repaired = repairScene(scene);
    assert.equal(repaired.page.width, MAX_PAGE_DIMENSION);
    assert.equal(repaired.page.height, 1);
    assert.equal(validateScene(repaired).ok, true);
  });

  it("clamps oversized node and point geometry so repaired scenes still validate", () => {
    /*
     * ========================================================================
     * 步骤1：验证节点和点几何修复规模上界
     * ========================================================================
     * 目标：
     *   1) repairScene 需要限制 node.x/y/w/h 的绝对规模
     *   2) node.points、edge from/to points 和 edge.points 同步限制
     */

    // 1.1 构造超界几何字段
    const scene = {
      version: "0.1",
      page: { width: 100, height: 100, background: "#FFFFFF", units: "px" },
      metadata: { id: "s", title: "", createdAt: "", engine: "", notes: [] },
      nodes: [
        {
          id: "a",
          type: "line",
          x: MAX_GEOMETRY_COORDINATE + 100,
          y: -MAX_GEOMETRY_COORDINATE - 100,
          w: MAX_NODE_SIZE + 100,
          h: MAX_NODE_SIZE + 100,
          points: [{ x: MAX_GEOMETRY_COORDINATE + 100, y: -MAX_GEOMETRY_COORDINATE - 100 }],
          style: {}
        },
        { id: "b", type: "rect", x: 20, y: 0, w: 10, h: 10, style: {} }
      ],
      edges: [
        {
          id: "e",
          type: "arrow",
          from: "a",
          to: "b",
          fromPoint: { x: MAX_GEOMETRY_COORDINATE + 100, y: 0 },
          toPoint: { x: 0, y: -MAX_GEOMETRY_COORDINATE - 100 },
          points: [{ x: MAX_GEOMETRY_COORDINATE + 100, y: 0 }],
          style: {}
        }
      ]
    } as unknown as Scene;

    // 1.2 修复后几何字段在共享合法范围内
    const repaired = repairScene(scene);
    assert.equal(repaired.nodes[0].x, MAX_GEOMETRY_COORDINATE);
    assert.equal(repaired.nodes[0].y, -MAX_GEOMETRY_COORDINATE);
    assert.equal(repaired.nodes[0].w, MAX_NODE_SIZE);
    assert.equal(repaired.nodes[0].h, MAX_NODE_SIZE);
    assert.deepEqual(repaired.nodes[0].points, [{ x: MAX_GEOMETRY_COORDINATE, y: -MAX_GEOMETRY_COORDINATE }]);
    assert.deepEqual(repaired.edges[0].fromPoint, { x: MAX_GEOMETRY_COORDINATE, y: 0 });
    assert.deepEqual(repaired.edges[0].toPoint, { x: 0, y: -MAX_GEOMETRY_COORDINATE });
    assert.deepEqual(repaired.edges[0].points, [{ x: MAX_GEOMETRY_COORDINATE, y: 0 }]);
    assert.equal(validateScene(repaired).ok, true);
  });

  it("survives malformed array fields, clamps oversized grids, and normalizes short colors", () => {
    /*
     * ========================================================================
     * 步骤1：验证畸形附属字段的兜底
     * ========================================================================
     * 目标：
     *   1) 非数组 points/cells 不抛错且被清空
     *   2) 超大 rows/cols 被钳制，3 位短色被规范化
     */

    // 1.1 构造畸形附属字段
    const scene = {
      version: "0.1",
      page: { width: 320, height: 180, background: "#FFFFFF", units: "px" },
      metadata: { id: "s", title: "", createdAt: "", engine: "", notes: [] },
      nodes: [
        {
          id: "g1",
          type: "grid",
          x: 0,
          y: 0,
          w: 100,
          h: 100,
          rows: 100000,
          cols: 5,
          style: {},
          points: "not-an-array",
          cells: [null, { row: 0, col: 0, fill: "#abc" }]
        }
      ],
      edges: []
    } as unknown as Scene;

    // 1.2 执行修复并校验兜底
    const repaired = repairScene(scene);
    assert.equal(repaired.nodes[0].points, undefined);
    assert.equal(repaired.nodes[0].cells?.length, 1);
    assert.equal(repaired.nodes[0].cells?.[0].fill, "#AABBCC");
    assert.equal(repaired.nodes[0].rows, 256);
    assert.equal(repaired.nodes[0].cols, 5);
    assert.equal(validateScene(repaired).ok, true);
  });

  it("repairs non-number grid dimensions instead of leaking them to validation", () => {
    /*
     * ========================================================================
     * 步骤1：验证非数字网格维度的修复
     * ========================================================================
     * 目标：
     *   1) 数字字符串 rows 被转数后钳制（不修复会被 validateScene 拒绝返回 500）
     *   2) 完全非法的 cols（null）回退为 1
     */

    // 1.1 构造字符串/null 维度
    const scene = {
      version: "0.1",
      page: { width: 320, height: 180, background: "#FFFFFF", units: "px" },
      metadata: { id: "s", title: "", createdAt: "", engine: "", notes: [] },
      nodes: [
        { id: "g1", type: "grid", x: 0, y: 0, w: 100, h: 100, rows: "100000", cols: null, style: {} }
      ],
      edges: []
    } as unknown as Scene;

    // 1.2 字符串转数钳制、null 回退 1，修复结果可通过校验
    const repaired = repairScene(scene);
    assert.equal(repaired.nodes[0].rows, 256);
    assert.equal(repaired.nodes[0].cols, 1);
    assert.equal(validateScene(repaired).ok, true);
  });

  it("clamps oversized cells arrays so repaired scenes still validate", () => {
    /*
     * ========================================================================
     * 步骤1：验证超长 cells 钳制
     * ========================================================================
     * 目标：
     *   1) 超过 MAX_GRID_CELLS 的（仍合法的）cells 经 repair 被钳制，
     *      而非透传后被 validateScene 的 too_many_grid_cells 拒绝返回 500
     *   2) 钳制后修复结果仍可通过校验
     */

    // 1.1 构造超长 cells（全部合法位置）
    const cells = Array.from({ length: 256 * 256 + 50 }, () => ({ row: 0, col: 0 }));
    const scene = {
      version: "0.1",
      page: { width: 320, height: 180, background: "#FFFFFF", units: "px" },
      metadata: { id: "s", title: "", createdAt: "", engine: "", notes: [] },
      nodes: [
        { id: "g1", type: "grid", x: 0, y: 0, w: 100, h: 100, rows: 1, cols: 1, style: {}, cells }
      ],
      edges: []
    } as unknown as Scene;

    // 1.2 钳到上界且修复结果可通过校验
    const repaired = repairScene(scene);
    assert.equal(repaired.nodes[0].cells?.length, 256 * 256);
    assert.equal(validateScene(repaired).ok, true);
  });

  it("keeps replica base layer compatible with repaired scenes", () => {
    /*
     * ========================================================================
     * 步骤1：验证底图补充兼容性
     * ========================================================================
     * 目标：
     *   1) 修复后仍可插入锁定底图
     *   2) 底图位于语义节点下方
     */

    // 1.1 修复并插入底图
    const repaired = repairScene(damagedScene());
    ensureReplicaBaseLayer(repaired, "/uploads/sample.png");

    // 1.2 校验底图节点
    assert.equal(repaired.nodes[0].id, "source-image");
    assert.equal(repaired.nodes[0].type, "image");
    assert.equal(repaired.nodes[0].locked, true);
    assert.equal(repaired.nodes[0].source, "/uploads/sample.png");
    assert.equal(validateScene(repaired).ok, true);
  });

  it("deduplicates three or more nodes sharing one id into unique ids", () => {
    /*
     * ========================================================================
     * 步骤1：验证 ≥3 次 id 碰撞的去重
     * ========================================================================
     * 目标：
     *   1) 旧实现对 ≥3 个同 id 节点会产出重复 id（如 x-2,x-2），被 validateScene 拒绝返回 500
     *   2) 修复后全部 id 唯一且通过校验
     */

    // 1.1 四个同 id 节点
    const scene = {
      version: "0.1",
      page: { width: 100, height: 100, background: "#FFFFFF", units: "px" },
      metadata: { id: "s", title: "", createdAt: "", engine: "", notes: [] },
      nodes: [
        { id: "x", type: "rect", x: 0, y: 0, w: 10, h: 10, style: {} },
        { id: "x", type: "rect", x: 0, y: 0, w: 10, h: 10, style: {} },
        { id: "x", type: "rect", x: 0, y: 0, w: 10, h: 10, style: {} },
        { id: "x", type: "rect", x: 0, y: 0, w: 10, h: 10, style: {} }
      ],
      edges: []
    } as unknown as Scene;

    // 1.2 去重后全部唯一且校验通过
    const repaired = repairScene(scene);
    const ids = repaired.nodes.map((node) => node.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(validateScene(repaired).ok, true);
  });

  it("deduplicates repeated edge ids before validation", () => {
    /*
     * ========================================================================
     * 步骤1：验证重复 edge id 的修复
     * ========================================================================
     * 目标：
     *   1) AI 输出重复 edge id 时，repairScene 应生成唯一 id
     *   2) 修复后的 scene 不应再被 validateScene 的 duplicate_edge_id 拒绝
     */

    // 1.1 构造重复 edge id 和空 edge id
    const scene = {
      version: "0.1",
      page: { width: 100, height: 100, background: "#FFFFFF", units: "px" },
      metadata: { id: "s", title: "", createdAt: "", engine: "", notes: [] },
      nodes: [
        { id: "a", type: "rect", x: 0, y: 0, w: 10, h: 10, style: {} },
        { id: "b", type: "rect", x: 20, y: 0, w: 10, h: 10, style: {} }
      ],
      edges: [
        { id: "same", type: "arrow", from: "a", to: "b", style: {} },
        { id: "same", type: "line", from: "b", to: "a", style: {} },
        { id: "", type: "join", from: "a", to: "b", style: {} },
        { id: "", type: "fork", from: "b", to: "a", style: {} }
      ]
    } as unknown as Scene;

    // 1.2 去重后全部唯一且校验通过
    const repaired = repairScene(scene);
    const ids = repaired.edges.map((edge) => edge.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(validateScene(repaired).ok, true);
  });

  it("cleans malformed edge geometry fields without throwing", () => {
    /*
     * ========================================================================
     * 步骤1：验证连线几何字段清洗
     * ========================================================================
     * 目标：
     *   1) AI/导入数据给 edge.points 非数组时 repairScene 不应抛 TypeError
     *   2) 畸形 fromPoint/toPoint 被清理，修复后仍可通过 validateScene
     */

    // 1.1 构造畸形连线几何字段
    const scene = {
      version: "0.1",
      page: { width: 100, height: 100, background: "#FFFFFF", units: "px" },
      metadata: { id: "s", title: "", createdAt: "", engine: "", notes: [] },
      nodes: [
        { id: "a", type: "rect", x: 0, y: 0, w: 10, h: 10, style: {} },
        { id: "b", type: "rect", x: 20, y: 0, w: 10, h: 10, style: {} }
      ],
      edges: [
        {
          id: "e",
          type: "arrow",
          from: "a",
          to: "b",
          fromPoint: { x: "bad", y: 0 },
          toPoint: null,
          points: "not-an-array",
          style: {}
        }
      ]
    } as unknown as Scene;

    // 1.2 修复不应抛错，且坏几何字段被清掉
    let repaired: Scene | undefined;
    assert.doesNotThrow(() => {
      repaired = repairScene(scene);
    });
    assert.equal(repaired?.edges[0].fromPoint, undefined);
    assert.equal(repaired?.edges[0].toPoint, undefined);
    assert.equal(repaired?.edges[0].points, undefined);
    assert.equal(validateScene(repaired).ok, true);
  });

  it("clamps oversized polyline point arrays so repaired scenes still validate", () => {
    /*
     * ========================================================================
     * 步骤1：验证超长折线点数组钳制
     * ========================================================================
     * 目标：
     *   1) AI 输出超长 node.points/edge.points 时 repairScene 钳到校验上界
     *   2) 钳制后修复结果仍可通过 validateScene
     */

    // 1.1 构造超长点数组
    const points = Array.from({ length: MAX_POLYLINE_POINTS + 10 }, (_, index) => ({ x: index, y: index }));
    const scene = {
      version: "0.1",
      page: { width: 100, height: 100, background: "#FFFFFF", units: "px" },
      metadata: { id: "s", title: "", createdAt: "", engine: "", notes: [] },
      nodes: [
        { id: "a", type: "line", x: 0, y: 0, w: 10, h: 0, points, style: {} },
        { id: "b", type: "rect", x: 20, y: 0, w: 10, h: 10, style: {} }
      ],
      edges: [
        { id: "e", type: "arrow", from: "a", to: "b", points, style: {} }
      ]
    } as unknown as Scene;

    // 1.2 修复后点数组钳到上界且 scene 合法
    const repaired = repairScene(scene);
    assert.equal(repaired.nodes[0].points?.length, MAX_POLYLINE_POINTS);
    assert.equal(repaired.edges[0].points?.length, MAX_POLYLINE_POINTS);
    assert.equal(validateScene(repaired).ok, true);
  });

  it("clamps oversized top-level node and edge arrays so repaired scenes still validate", () => {
    /*
     * ========================================================================
     * 步骤1：验证顶层数组钳制
     * ========================================================================
     * 目标：
     *   1) AI 输出超长 nodes/edges 时 repairScene 钳到校验上界
     *   2) 钳制后修复结果仍可通过 validateScene
     */

    // 1.1 构造超长节点和边数组
    const scene = {
      version: "0.1",
      page: { width: 100, height: 100, background: "#FFFFFF", units: "px" },
      metadata: { id: "s", title: "", createdAt: "", engine: "", notes: [] },
      nodes: Array.from({ length: MAX_SCENE_NODES + 10 }, (_, index) => ({
        id: `n-${index}`,
        type: "rect",
        x: index,
        y: 0,
        w: 1,
        h: 1,
        style: {}
      })),
      edges: Array.from({ length: MAX_SCENE_EDGES + 10 }, (_, index) => ({
        id: `e-${index}`,
        type: "line",
        from: "n-0",
        to: "n-1",
        style: {}
      }))
    } as unknown as Scene;

    // 1.2 修复后顶层数组钳到上界且 scene 合法
    const repaired = repairScene(scene);
    assert.equal(repaired.nodes.length, MAX_SCENE_NODES);
    assert.equal(repaired.edges.length, MAX_SCENE_EDGES);
    assert.equal(validateScene(repaired).ok, true);
  });

  it("clamps oversized tick position arrays so repaired scenes still validate", () => {
    /*
     * ========================================================================
     * 步骤1：验证 tickPositions 修复规模上界
     * ========================================================================
     * 目标：
     *   1) repairScene 需要把 AI 输出的超长 tickPositions 钳到可渲染规模
     *   2) 修复后的 scene 仍应通过 validateScene
     */

    // 1.1 构造包含超长 tickPositions 的 bracket 节点
    const scene = {
      version: "0.1",
      page: { width: 100, height: 100, background: "#FFFFFF", units: "px" },
      metadata: { id: "s", title: "", createdAt: "", engine: "", notes: [] },
      nodes: [
        {
          id: "br",
          type: "bracket",
          x: 0,
          y: 0,
          w: 50,
          h: 20,
          orientation: "right",
          tickPositions: Array.from({ length: MAX_TICK_POSITIONS + 10 }, (_, index) => index / MAX_TICK_POSITIONS),
          style: {}
        }
      ],
      edges: []
    } as unknown as Scene;

    // 1.2 修复后 tickPositions 被钳制且 scene 合法
    const repaired = repairScene(scene);
    assert.equal(repaired.nodes[0].tickPositions?.length, MAX_TICK_POSITIONS);
    assert.equal(validateScene(repaired).ok, true);
  });

  it("clamps oversized row color and column shade arrays so repaired scenes still validate", () => {
    /*
     * ========================================================================
     * 步骤1：验证网格行/列辅助数组修复规模上界
     * ========================================================================
     * 目标：
     *   1) repairScene 需要把 AI 输出的超长 rowColors/columnShades 钳到网格维度上界
     *   2) 修复后的 scene 仍应通过 validateScene
     */

    // 1.1 构造包含超长 rowColors/columnShades 的 grid 节点
    const scene = {
      version: "0.1",
      page: { width: 100, height: 100, background: "#FFFFFF", units: "px" },
      metadata: { id: "s", title: "", createdAt: "", engine: "", notes: [] },
      nodes: [
        {
          id: "g",
          type: "grid",
          x: 0,
          y: 0,
          w: 50,
          h: 50,
          rows: 1,
          cols: 1,
          rowColors: Array.from({ length: MAX_GRID_DIMENSION + 10 }, () => "#abc"),
          columnShades: Array.from({ length: MAX_GRID_DIMENSION + 10 }, () => 0.25),
          style: {}
        }
      ],
      edges: []
    } as unknown as Scene;

    // 1.2 修复后辅助数组被钳制且 scene 合法
    const repaired = repairScene(scene);
    assert.equal(repaired.nodes[0].rowColors?.length, MAX_GRID_DIMENSION);
    assert.equal(repaired.nodes[0].columnShades?.length, MAX_GRID_DIMENSION);
    assert.equal(validateScene(repaired).ok, true);
  });

  it("cleans optional renderer fields that would otherwise leak invalid data", () => {
    /*
     * ========================================================================
     * 步骤1：验证可选渲染字段清洗
     * ========================================================================
     * 目标：
     *   1) AI 输出畸形 source/rowColors/columnShades/tickPositions 不应透传
     *   2) cell.text 等可选字段也必须清洗到 validateScene 可接受的协议
     */

    // 1.1 构造畸形可选字段
    const scene = {
      version: "0.1",
      page: { width: 100, height: 100, background: "#FFFFFF", units: "px" },
      metadata: { id: "s", title: "", createdAt: "", engine: "", notes: [] },
      nodes: [
        { id: "img", type: "image", x: 0, y: 0, w: 10, h: 10, source: 123, style: {} },
        {
          id: "g",
          type: "grid",
          x: 20,
          y: 0,
          w: 10,
          h: 10,
          rows: 1,
          cols: 1,
          rowColors: [123, "#abc"],
          columnShades: ["bad", 0.5],
          cells: [{ row: 0, col: 0, text: 123, color: "#abc" }],
          style: {}
        },
        {
          id: "br",
          type: "bracket",
          x: 40,
          y: 0,
          w: 10,
          h: 10,
          orientation: "sideways",
          tickPositions: ["bad", 0.5],
          style: {}
        }
      ],
      edges: []
    } as unknown as Scene;

    // 1.2 清洗后合法字段保留、非法字段移除
    const repaired = repairScene(scene);
    const image = repaired.nodes.find((node) => node.id === "img");
    const grid = repaired.nodes.find((node) => node.id === "g");
    const bracket = repaired.nodes.find((node) => node.id === "br");
    assert.equal(image?.source, undefined);
    assert.deepEqual(grid?.rowColors, ["#AABBCC"]);
    assert.deepEqual(grid?.columnShades, [0.5]);
    assert.equal(grid?.cells?.[0].text, undefined);
    assert.equal(grid?.cells?.[0].color, "#AABBCC");
    assert.equal(bracket?.orientation, undefined);
    assert.deepEqual(bracket?.tickPositions, [0.5]);
    assert.equal(validateScene(repaired).ok, true);
  });

  it("clamps oversized text fields so repaired scenes still validate", () => {
    /*
     * ========================================================================
     * 步骤1：验证文本字段修复规模上界
     * ========================================================================
     * 目标：
     *   1) repairScene 需要裁剪 node.text/symbol
     *   2) repairScene 需要裁剪 grid cell text 和 edge label
     */

    // 1.1 构造包含超长文本字段的 scene
    const longText = "x".repeat(MAX_TEXT_LENGTH + 10);
    const scene = {
      version: "0.1",
      page: { width: 100, height: 100, background: "#FFFFFF", units: "px" },
      metadata: { id: "s", title: "", createdAt: "", engine: "", notes: [] },
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, w: 50, h: 20, text: longText, symbol: longText, style: {} },
        {
          id: "b",
          type: "grid",
          x: 0,
          y: 30,
          w: 50,
          h: 50,
          rows: 1,
          cols: 1,
          cells: [{ row: 0, col: 0, text: longText }],
          style: {}
        }
      ],
      edges: [
        { id: "e", type: "arrow", from: "a", to: "b", label: longText, style: {} }
      ]
    } as unknown as Scene;

    // 1.2 修复后文本被裁剪且 scene 合法
    const repaired = repairScene(scene);
    assert.equal(repaired.nodes[0].text?.length, MAX_TEXT_LENGTH);
    assert.equal(repaired.nodes[0].symbol?.length, MAX_TEXT_LENGTH);
    assert.equal(repaired.nodes[1].cells?.[0]?.text?.length, MAX_TEXT_LENGTH);
    assert.equal(repaired.edges[0].label?.length, MAX_TEXT_LENGTH);
    assert.equal(validateScene(repaired).ok, true);
  });

  it("clamps oversized protocol string fields so repaired scenes still validate", () => {
    /*
     * ========================================================================
     * 步骤1：验证协议字符串修复规模上界
     * ========================================================================
     * 目标：
     *   1) 修复 metadata、node、edge 和 style 中的结构字符串
     *   2) 保留超长原始 id 到修复后短 id 的端点映射
     */

    // 1.1 构造包含超长结构字符串的 scene
    const longString = "x".repeat(MAX_PROTOCOL_STRING_LENGTH + 10);
    const scene = {
      version: "0.1",
      page: { width: 100, height: 100, background: "#FFFFFF", units: "px" },
      metadata: {
        id: longString,
        title: longString,
        sourceImage: longString,
        createdAt: longString,
        engine: longString,
        notes: []
      },
      nodes: [
        {
          id: longString,
          type: "image",
          x: 0,
          y: 0,
          w: 50,
          h: 50,
          source: longString,
          style: { fontFamily: longString, fontWeight: longString, dash: longString }
        },
        { id: "target", type: "rect", x: 60, y: 0, w: 30, h: 30, style: {} }
      ],
      edges: [
        { id: longString, type: "arrow", from: `${longString}:right@0.5`, to: "target:left@0.5", style: {} }
      ]
    } as unknown as Scene;

    // 1.2 修复后结构字符串被裁剪，端点仍指向修复后的节点 id
    const repaired = repairScene(scene);
    assert.ok(repaired.metadata.id.length <= MAX_SCENE_ID_LENGTH);
    assert.ok(repaired.metadata.title.length <= MAX_PROTOCOL_STRING_LENGTH);
    assert.ok(repaired.metadata.sourceImage && repaired.metadata.sourceImage.length <= MAX_PROTOCOL_STRING_LENGTH);
    assert.ok(repaired.metadata.createdAt.length <= MAX_PROTOCOL_STRING_LENGTH);
    assert.ok(repaired.metadata.engine.length <= MAX_PROTOCOL_STRING_LENGTH);
    assert.ok(repaired.nodes[0].id.length <= MAX_SCENE_ID_LENGTH);
    assert.ok(repaired.nodes[0].source && repaired.nodes[0].source.length <= MAX_PROTOCOL_STRING_LENGTH);
    assert.ok(repaired.nodes[0].style.fontFamily && repaired.nodes[0].style.fontFamily.length <= MAX_PROTOCOL_STRING_LENGTH);
    assert.ok(repaired.nodes[0].style.fontWeight && repaired.nodes[0].style.fontWeight.length <= MAX_PROTOCOL_STRING_LENGTH);
    assert.ok(repaired.nodes[0].style.dash && repaired.nodes[0].style.dash.length <= MAX_PROTOCOL_STRING_LENGTH);
    assert.ok(repaired.edges[0].id.length <= MAX_SCENE_ID_LENGTH);
    assert.equal(repaired.edges[0].from, `${repaired.nodes[0].id}:right@0.5`);
    assert.equal(validateScene(repaired).ok, true);
  });
});
