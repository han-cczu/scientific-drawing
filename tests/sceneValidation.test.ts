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

  it("accepts hidden and locked node flags", () => {
    /*
     * ========================================================================
     * 步骤1：验证节点布尔标记
     * ========================================================================
     * 目标：
     *   1) hidden 可作为协议字段进入 scene
     *   2) locked 继续保持合法
     */

    // 1.1 添加图层面板相关标记
    const scene = validScene();
    scene.nodes[0].hidden = true;
    scene.nodes[1].locked = true;

    // 1.2 校验协议通过
    const result = validateScene(scene);
    assert.equal(result.ok, true);
  });

  it("accepts short hex colors and rejects malformed uppercase non-hex", () => {
    /*
     * ========================================================================
     * 步骤1：验证颜色校验边界
     * ========================================================================
     * 目标：
     *   1) 合法 3 位短色（如 #abc）应通过
     *   2) 全大写但非 hex（如 #GGGGGG）应被拒绝
     */

    // 1.1 合法短色通过
    const ok = validScene();
    ok.nodes[0].style.fill = "#abc";
    assert.equal(validateScene(ok).ok, true);

    // 1.2 畸形全大写色被拒绝
    const bad = validScene();
    bad.nodes[0].style.fill = "#GGGGGG";
    const result = validateScene(bad);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === "invalid_color"));

    // 1.3 裸 hex（无 # 前缀）被拒绝：校验只判不改值，放行会以非法 CSS 直达渲染端
    const bare = validScene();
    bare.nodes[0].style.fill = "AABBCC";
    const bareResult = validateScene(bare);
    assert.equal(bareResult.ok, false);
    assert.ok(bareResult.issues.some((issue) => issue.code === "invalid_color"));
  });

  it("bounds grid rows/cols to prevent oversized render loops", () => {
    /*
     * ========================================================================
     * 步骤1：验证网格维度上界
     * ========================================================================
     * 目标：
     *   1) 上界内（256）通过
     *   2) 超大 rows/cols 在校验层被拒，覆盖不经 repair 的导出/区域路径
     */

    // 1.1 上界内通过
    const ok = validScene();
    ok.nodes[0].type = "grid";
    ok.nodes[0].rows = 256;
    ok.nodes[0].cols = 1;
    assert.equal(validateScene(ok).ok, true);

    // 1.2 超界被拒绝
    const bad = validScene();
    bad.nodes[0].type = "grid";
    bad.nodes[0].rows = 100000;
    bad.nodes[0].cols = 100000;
    const result = validateScene(bad);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === "invalid_grid_rows"));
    assert.ok(result.issues.some((issue) => issue.code === "invalid_grid_cols"));
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
    scene.nodes[0].hidden = "yes" as unknown as boolean;
    scene.nodes[0].style.opacity = 1.5;
    scene.nodes[0].style.fill = "#12";
    scene.edges[0].type = "bad" as Scene["edges"][number]["type"];

    // 1.2 校验错误码
    const result = validateScene(scene);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === "invalid_page_width"));
    assert.ok(result.issues.some((issue) => issue.code === "invalid_color"));
    assert.ok(result.issues.some((issue) => issue.code === "invalid_node_width"));
    assert.ok(result.issues.some((issue) => issue.code === "invalid_node_hidden"));
    assert.ok(result.issues.some((issue) => issue.code === "invalid_opacity"));
    assert.ok(result.issues.some((issue) => issue.code === "invalid_edge_type"));
  });

  it("rejects null/non-object grid cells without throwing (no opaque exception)", () => {
    /*
     * ========================================================================
     * 步骤1：验证 cells 含 null 时不抛异常
     * ========================================================================
     * 目标：
     *   1) validateScene 契约：只返错误列表，绝不抛不透明异常
     *   2) 导出路径（validateSceneForExport→validateScene，不经 repair）从不可信输入可达
     */
    const scene = validScene();
    scene.nodes[0] = {
      id: "g", type: "grid", x: 0, y: 0, w: 100, h: 100, rows: 1, cols: 1,
      style: {}, cells: [null, { row: 0, col: 0 }]
    } as unknown as Scene["nodes"][number];

    let result: ReturnType<typeof validateScene> | undefined;
    assert.doesNotThrow(() => { result = validateScene(scene); });
    assert.equal(result?.ok, false);
    assert.ok(result?.issues.some((issue) => issue.code === "invalid_grid_cell"));
  });

  it("rejects non-string edge endpoints without throwing (no opaque exception)", () => {
    /*
     * ========================================================================
     * 步骤1：验证非字符串端点不抛异常
     * ========================================================================
     * 目标：
     *   1) from/to 为数字/对象等不可信值时只返错误列表，绝不抛 TypeError（与 cells 守卫同契约）
     *   2) 导出路径（validateSceneForExport→validateScene，不经 repair）从不可信 JSON 可达
     */
    const scene = validScene();
    (scene.edges[0] as unknown as { from: unknown }).from = 123;

    let result: ReturnType<typeof validateScene> | undefined;
    assert.doesNotThrow(() => { result = validateScene(scene); });
    assert.equal(result?.ok, false);
    assert.ok(result?.issues.some((issue) => issue.code === "missing_edge_source"));
  });

  it("rejects grid cells arrays exceeding the size cap", () => {
    /*
     * ========================================================================
     * 步骤1：验证 cells 长度上界
     * ========================================================================
     * 目标：
     *   1) 超长 cells 被拒，防解析/内存放大（渲染侧已 O(1) 查表）
     */
    const scene = validScene();
    const huge = Array.from({ length: 256 * 256 + 1 }, () => ({ row: 0, col: 0 }));
    scene.nodes[0] = {
      id: "g", type: "grid", x: 0, y: 0, w: 100, h: 100, rows: 1, cols: 1,
      style: {}, cells: huge
    } as unknown as Scene["nodes"][number];

    const result = validateScene(scene);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === "too_many_grid_cells"));
  });

  it("rejects invalid optional node fields used by renderers and exporters", () => {
    /*
     * ========================================================================
     * 步骤1：验证可选渲染字段的运行时协议
     * ========================================================================
     * 目标：
     *   1) source/tickPositions 等字段虽是可选项，但一旦存在必须符合协议
     *   2) 防止 validateSceneForExport 放行后在 SVG/PPTX 导出器内抛 TypeError
     */

    // 1.1 构造包含畸形可选字段的 scene
    const scene = validScene();
    scene.edges = [];
    scene.nodes = [
      {
        id: "img",
        type: "image",
        x: 0,
        y: 0,
        w: 20,
        h: 20,
        source: 123 as unknown as string,
        style: {}
      },
      {
        id: "g",
        type: "grid",
        x: 30,
        y: 0,
        w: 20,
        h: 20,
        rows: 1,
        cols: 1,
        rowColors: [123] as unknown as string[],
        columnShades: ["bad"] as unknown as number[],
        cells: [{ row: 0, col: 0, text: 123 as unknown as string }],
        style: {}
      },
      {
        id: "br",
        type: "bracket",
        x: 60,
        y: 0,
        w: 20,
        h: 20,
        orientation: "sideways" as Scene["nodes"][number]["orientation"],
        tickPositions: "bad" as unknown as number[],
        style: {}
      }
    ];

    // 1.2 校验必须返回结构化错误，而不是放行到导出器
    const result = validateScene(scene);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === "invalid_node_source"));
    assert.ok(result.issues.some((issue) => issue.code === "invalid_row_colors"));
    assert.ok(result.issues.some((issue) => issue.code === "invalid_column_shades"));
    assert.ok(result.issues.some((issue) => issue.code === "invalid_grid_cell_text"));
    assert.ok(result.issues.some((issue) => issue.code === "invalid_node_orientation"));
    assert.ok(result.issues.some((issue) => issue.code === "invalid_tick_positions"));
  });

  it("rejects non-string metadata sourceImage without throwing", () => {
    const scene = validScene();
    scene.metadata.sourceImage = 123 as unknown as string;

    let result: ReturnType<typeof validateScene> | undefined;
    assert.doesNotThrow(() => { result = validateScene(scene); });
    assert.equal(result?.ok, false);
    assert.ok(result?.issues.some((issue) => issue.code === "invalid_metadata_source_image"));
  });
});
