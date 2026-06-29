import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensureReplicaBaseLayer, exportKindConfig, isAllowedImageMime, sanitizeFileBase, sanitizeUnicodeFileBase, validateSceneForExport } from "../server/src/routes/api";
import { dashToPptx, sceneToPptx } from "../server/src/scene/pptx";
import { sceneToSvg } from "../server/src/scene/svg";
import { normalizeImportedScene } from "../server/src/scene/visiomasterAdapter";
import { shadeColor } from "../src/shared/geometry";
import type { Scene } from "../src/shared/scene";
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

function sampleScene(): Scene {
  /*
   * ========================================================================
   * 步骤1：创建测试场景
   * ========================================================================
   * 目标：
   *   1) 覆盖文本、矩形、网格、括号和折线
   *   2) 给 SVG/PPTX 导出测试提供稳定输入
   */

  // 1.1 返回最小可导出 scene
  return {
    version: "0.1",
    page: {
      width: 320,
      height: 180,
      background: "#FFFFFF",
      units: "px"
    },
    metadata: {
      id: "test-scene",
      title: "Test Scene",
      createdAt: "2026-05-16T00:00:00.000Z",
      engine: "test",
      notes: []
    },
    nodes: [
      {
        id: "label",
        type: "text",
        x: 10,
        y: 12,
        w: 120,
        h: 24,
        text: "A < B & C",
        style: {
          color: "#111111",
          fontSize: 16
        }
      },
      {
        id: "box",
        type: "rect",
        x: 12,
        y: 52,
        w: 86,
        h: 42,
        style: {
          fill: "#F3F4F6",
          stroke: "#111111",
          strokeWidth: 1,
          dash: "4 4"
        }
      },
      {
        id: "grid",
        type: "grid",
        x: 132,
        y: 48,
        w: 80,
        h: 48,
        rows: 2,
        cols: 2,
        rowColors: ["#FCA5A5", "#93C5FD"],
        columnShades: [0, 0.25],
        cells: [
          { row: 0, col: 0, fill: "#FCA5A5", text: "1", color: "#111111" },
          { row: 1, col: 1, fill: "#93C5FD", text: "4", color: "#111111" }
        ],
        style: {
          fill: "#FFFFFF",
          stroke: "#111111",
          strokeWidth: 0.8
        }
      },
      {
        id: "bracket",
        type: "bracket",
        x: 224,
        y: 40,
        w: 42,
        h: 72,
        orientation: "right",
        tickPositions: [0, 1],
        style: {
          stroke: "#111111",
          strokeWidth: 1
        }
      },
      {
        id: "arrow",
        type: "arrow",
        x: 40,
        y: 126,
        w: 180,
        h: 20,
        points: [
          { x: 40, y: 126 },
          { x: 140, y: 126 },
          { x: 220, y: 146 }
        ],
        style: {
          stroke: "#111111",
          strokeWidth: 1.5,
          dash: "2 2"
        }
      }
    ],
    edges: []
  };
}

describe("upload helpers", () => {
  it("accepts only supported image MIME types", () => {
    /*
     * ========================================================================
     * 步骤1：验证图片 MIME 白名单
     * ========================================================================
     * 目标：
     *   1) 确认支持格式可上传
     *   2) 确认 SVG/二进制流会被拒绝
     */

    // 1.1 校验支持格式
    assert.equal(isAllowedImageMime("image/png"), true);
    assert.equal(isAllowedImageMime("image/jpeg"), true);
    assert.equal(isAllowedImageMime("image/webp"), true);

    // 1.2 校验拒绝格式
    assert.equal(isAllowedImageMime("image/svg+xml"), false);
    assert.equal(isAllowedImageMime("application/octet-stream"), false);
  });

  it("sanitizes export file names", () => {
    /*
     * ========================================================================
     * 步骤1：验证导出文件名前缀
     * ========================================================================
     * 目标：
     *   1) 删除路径穿越字符
     *   2) 保留可读安全片段
     */

    // 1.1 清洗危险输入
    const result = sanitizeFileBase("../bad/path:name?.scene");

    // 1.2 判断输出结果
    assert.equal(result, "bad-path-name-scene");
    assert.match(sanitizeFileBase(""), /^[a-f0-9-]{36}$/);
  });

  it("rejects invalid export scenes before exporters run", () => {
    /*
     * ========================================================================
     * 步骤1：验证导出 scene 校验
     * ========================================================================
     * 目标：
     *   1) 缺少 page 的请求不能进入导出器
     *   2) 坏端点引用不能进入导出器
     */

    // 1.1 校验缺少 page 的请求
    const missingPage = validateSceneForExport({ nodes: [] });
    assert.equal(missingPage.ok, false);
    assert.equal(missingPage.scene, undefined);

    // 1.2 校验坏端点引用
    const scene = sampleScene();
    scene.edges = [{ id: "bad-edge", type: "arrow", from: "missing:right@0.5", to: "box:left@0.5", style: { stroke: "#111111" } }];
    const badEndpoint = validateSceneForExport(scene);
    assert.equal(badEndpoint.ok, false);
    assert.equal(badEndpoint.scene, undefined);

    // 1.3 校验合法 scene
    scene.edges = [];
    const valid = validateSceneForExport(scene);
    assert.equal(valid.ok, true);
    assert.equal(valid.scene?.metadata.id, "test-scene");
  });

  it("defines all supported export kinds in one table", async () => {
    /*
     * ========================================================================
     * 步骤1：验证导出类型配置
     * ========================================================================
     * 目标：
     *   1) svg/pptx/json 由同一张表驱动
     *   2) 文件后缀稳定
     */

    // 1.1 校验导出配置
    assert.deepEqual(Object.keys(exportKindConfig).sort(), ["json", "pptx", "svg"]);

    // 1.2 校验后缀
    assert.equal(exportKindConfig.svg.ext, "svg");
    assert.equal(exportKindConfig.pptx.ext, "pptx");
    assert.equal(exportKindConfig.json.ext, "scene.json");

    // 1.3 校验 MIME 与内存渲染输出
    assert.match(exportKindConfig.svg.contentType, /^image\/svg\+xml/);
    assert.match(exportKindConfig.json.contentType, /^application\/json/);
    assert.match(exportKindConfig.pptx.contentType, /presentationml/);
    const svgOut = await exportKindConfig.svg.render(sampleScene());
    assert.equal(typeof svgOut, "string");
    assert.match(svgOut as string, /^<svg/);
    const jsonOut = await exportKindConfig.json.render(sampleScene());
    assert.doesNotThrow(() => JSON.parse(jsonOut as string));
  });

  it("keeps unicode download names safe while preserving CJK characters", () => {
    /*
     * ========================================================================
     * 步骤1：验证 Unicode 文件名清洗
     * ========================================================================
     * 目标：
     *   1) 中文标题保留，路径/引号/控制字符被剥除
     *   2) 空输入返回空串（由调用方回退 ASCII 名）
     */

    // 1.1 中文保留 + 危险字符剥除
    assert.equal(sanitizeUnicodeFileBase("神经网络架构图"), "神经网络架构图");
    assert.equal(sanitizeUnicodeFileBase('bad\\path:"图"?<>|'), "bad-path-图");

    // 1.2 空输入回退
    assert.equal(sanitizeUnicodeFileBase(""), "");
    assert.equal(sanitizeUnicodeFileBase(undefined), "");
  });
});

describe("scene export", () => {
  it("escapes SVG text and exports advanced nodes", async () => {
    /*
     * ========================================================================
     * 步骤1：验证 SVG 导出
     * ========================================================================
     * 目标：
     *   1) 防止文本破坏 SVG/XML
     *   2) 确认网格、括号、折线有输出
     */

    // 1.1 生成 SVG
    const svg = await sceneToSvg(sampleScene());

    // 1.2 检查关键输出
    assert.match(svg, /A &lt; B &amp; C/);
    assert.match(svg, /marker-end="url\(#arrow-head\)"/);
    assert.match(svg, /id="bracket-0"/);
    assert.match(svg, /fill="#FCA5A5"/);
    assert.match(svg, />1<\/text>/);
    assert.match(svg, />4<\/text>/);

    // 1.3 节点级 dash 进入导出（矩形与折线节点）
    assert.match(svg, /stroke-dasharray="4 4"/);
    assert.match(svg, /stroke-dasharray="2 2"/);
  });

  it("survives non-string unvalidated fields in SVG export without throwing", async () => {
    /*
     * ========================================================================
     * 步骤1：验证导出路径对脏字段的兜底
     * ========================================================================
     * 目标：
     *   1) 导出路径不经 repair，未校验的 rowColors/text/fontWeight 等非字符串值不应让导出 500
     *   2) 渲染器对脏数据降级而非抛 TypeError
     */

    // 1.1 构造含非字符串脏字段的 scene（绕过类型）
    const scene = sampleScene();
    const grid = scene.nodes.find((node) => node.id === "grid") as unknown as { rowColors: unknown[] };
    grid.rowColors = [123, 456];
    const label = scene.nodes.find((node) => node.id === "label") as unknown as { text: unknown; style: { fontWeight: unknown } };
    label.text = 789;
    label.style.fontWeight = 700;

    // 1.2 导出不抛异常且产出 SVG
    let svg = "";
    await assert.doesNotReject(async () => { svg = await sceneToSvg(scene); });
    assert.match(svg, /^<svg/);
  });

  it("maps dash presets to PPTX dashType", () => {
    /*
     * ========================================================================
     * 步骤1：验证 PPT dash 映射
     * ========================================================================
     * 目标：
     *   1) 三个 StyleTab 预设各映射到最近的 prstDash
     *   2) 缺省实线，未识别自定义值回落 dash
     */

    // 1.1 预设映射
    assert.equal(dashToPptx(undefined), "solid");
    assert.equal(dashToPptx("4 4"), "dash");
    assert.equal(dashToPptx("2 2"), "sysDot");
    assert.equal(dashToPptx("8 3 2 3"), "lgDash");
    assert.equal(dashToPptx("9 9"), "dash");
  });

  it("uses shared endpoint and color rules in SVG export", async () => {
    /*
     * ========================================================================
     * 步骤1：验证 SVG 导出共享规则
     * ========================================================================
     * 目标：
     *   1) 端点坐标和共享几何规则一致
     *   2) 网格阴影色和共享颜色规则一致
     */

    // 1.1 准备带端点连线的 scene
    const scene = sampleScene();
    scene.edges = [
      { id: "semantic-edge", type: "arrow", from: "box:right@0.5", to: "grid:left@0.5", style: { stroke: "#111111", strokeWidth: 1 } }
    ];

    // 1.2 导出并校验坐标和颜色
    const svg = await sceneToSvg(scene);
    assert.match(svg, /id="semantic-edge" points="98,73 132,72"/);
    assert.match(svg, new RegExp(`fill="${shadeColor("#FCA5A5", 0.25)}"`));
  });

  it("omits hidden nodes and dependent edges from SVG export", async () => {
    /*
     * ========================================================================
     * 步骤1：验证隐藏图层不导出
     * ========================================================================
     * 目标：
     *   1) hidden 节点不出现在 SVG
     *   2) 引用 hidden 节点的 edge 不出现在 SVG
     */

    // 1.1 准备隐藏节点和依赖边
    const scene = sampleScene();
    scene.nodes.push({
      id: "hidden-node",
      type: "rect",
      x: 20,
      y: 20,
      w: 40,
      h: 20,
      hidden: true,
      style: { fill: "#FFFFFF", stroke: "#111111" }
    });
    scene.edges.push({ id: "hidden-edge", type: "arrow", from: "box:right@0.5", to: "hidden-node:left@0.5", style: { stroke: "#111111" } });

    // 1.2 导出并校验
    const svg = await sceneToSvg(scene);
    assert.doesNotMatch(svg, /hidden-node/);
    assert.doesNotMatch(svg, /hidden-edge/);
  });

  it("writes a PPTX file for grid, bracket, and segmented lines", async () => {
    /*
     * ========================================================================
     * 步骤1：验证 PPTX 导出
     * ========================================================================
     * 目标：
     *   1) 覆盖新增网格和括号导出路径
     *   2) 确认生成文件非空
     */

    // 1.1 内存渲染 PPTX 并校验大小
    const output = await sceneToPptx(sampleScene());
    assert.ok(output.byteLength > 0);

    // 1.2 粗略确认 ZIP 文件头
    assert.equal(output.subarray(0, 2).toString("utf8"), "PK");
  });
});

describe("visiomaster adapter", () => {
  it("repairs current-protocol scenes before returning them from the server adapter", () => {
    /*
     * ========================================================================
     * 步骤1：验证服务端当前协议导入修复
     * ========================================================================
     * 目标：
     *   1) 当前协议 scene 也可能来自旧版本或手写 JSON，需要复用 repairScene
     *   2) normalizeImportedScene 自身返回值应符合共享 schema
     */

    // 1.1 构造当前协议但包含可修复非法字段的 scene
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

    // 1.2 适配结果应已收敛到合法 scene
    assert.equal(scene.page.width, MAX_PAGE_DIMENSION);
    assert.equal(scene.page.background, "#FFFFFF");
    assert.equal(scene.nodes[0].style.fill, "#FFFFFF");
    assert.equal(scene.nodes[0].style.strokeWidth, MAX_STYLE_STROKE_WIDTH);
    assert.equal(scene.nodes[0].style.fontSize, MAX_STYLE_FONT_SIZE);
    assert.equal(validateScene(scene).ok, true);
  });

  it("keeps solid containers and grid cell labels", () => {
    /*
     * ========================================================================
     * 步骤1：验证 AI 场景适配
     * ========================================================================
     * 目标：
     *   1) 容器不再被默认改成虚线
     *   2) 彩色格子保留单元格文字
     */

    // 1.1 转换 Visiomaster 风格输入
    const scene = normalizeImportedScene({
      page: { width: 200, height: 120, background: "#FFFFFF" },
      nodes: [
        {
          id: "container",
          type: "group_container",
          x: 10,
          y: 10,
          w: 180,
          h: 90,
          style: { fill: "#FFFFFF", stroke: "#111111" }
        },
        {
          id: "blocks",
          type: "grid_matrix",
          x: 20,
          y: 30,
          w: 80,
          h: 40,
          rows: 1,
          cols: 2,
          colored_cells: [
            [0, 0, "#60A5FA"],
            [0, 1, "#FACC15"]
          ],
          cell_labels: [
            [0, 0, "1", "#111111"],
            [0, 1, "4", "#111111"]
          ],
          style: { stroke: "#111111" }
        }
      ],
      edges: []
    });

    // 1.2 校验转换结果
    const container = scene.nodes.find((node) => node.id === "container");
    const blocks = scene.nodes.find((node) => node.id === "blocks");
    assert.equal(container?.style.dash, undefined);
    assert.equal(blocks?.cells?.[0]?.text, "1");
    assert.equal(blocks?.cells?.[1]?.text, "4");
  });

  it("clamps grid rows and cols before repair", () => {
    /*
     * ========================================================================
     * 步骤1：验证服务端 Visiomaster 网格维度规模边界
     * ========================================================================
     * 目标：
     *   1) normalizeImportedScene 自身把 rows/cols 钳到共享上界
     *   2) 行为与前端导入适配器保持一致
     */

    // 1.1 构造超界 Visiomaster 网格维度
    const scene = normalizeImportedScene({
      page: { width: 320, height: 180, background: "#FFFFFF" },
      metadata: { title: "v" },
      nodes: [
        { id: "grid", type: "grid_matrix", x: 0, y: 0, w: 100, h: 100, rows: 1000, cols: 5, style: {} }
      ],
      edges: []
    });

    // 1.2 适配结果已符合共享校验上界
    assert.equal(scene.nodes[0].rows, MAX_GRID_DIMENSION);
    assert.equal(scene.nodes[0].cols, 5);
    assert.equal(validateScene(scene).ok, true);
  });

  it("clamps top-level arrays and edge points before repair", () => {
    /*
     * ========================================================================
     * 步骤1：验证服务端 Visiomaster 适配层规模边界
     * ========================================================================
     * 目标：
     *   1) normalizeImportedScene 自身不完整展开超长 nodes/edges
     *   2) edge.points 在进入 repairScene 前已钳到共享上界
     */

    // 1.1 构造超长 Visiomaster 场景
    const points = Array.from({ length: MAX_POLYLINE_POINTS + 10 }, (_, index) => [index, index]);
    const scene = normalizeImportedScene({
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
    });

    // 1.2 适配结果已符合共享校验上界
    assert.equal(scene.nodes.length, MAX_SCENE_NODES);
    assert.equal(scene.edges.length, MAX_SCENE_EDGES);
    assert.equal(scene.edges[0].points?.length, MAX_POLYLINE_POINTS);
    assert.equal(validateScene(scene).ok, true);
  });

  it("clamps grid cells and cell labels before repair", () => {
    /*
     * ========================================================================
     * 步骤1：验证服务端 Visiomaster 网格辅助数组规模边界
     * ========================================================================
     * 目标：
     *   1) normalizeImportedScene 自身裁剪超长 colored_cells，避免 repair 前放大
     *   2) cell_labels/labels 同步按 MAX_GRID_CELLS 限幅，越界标签不应覆盖单元格
     */

    // 1.1 构造超长 cells 和 labels，末尾越界标签与首个单元格同坐标
    const coloredCells = Array.from({ length: MAX_GRID_CELLS + 10 }, () => [0, 0, "#ABC"]);
    const labels = Array.from({ length: MAX_GRID_CELLS }, (_, index) => [index + 1, 0, "ignored", "#111111"]);
    labels.push([0, 0, "late", "#111111"]);
    const scene = normalizeImportedScene({
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
          colored_cells: coloredCells,
          cell_labels: labels,
          style: {}
        }
      ],
      edges: []
    });

    // 1.2 适配结果已符合共享校验上界，越界标签被忽略
    const grid = scene.nodes[0];
    assert.equal(grid.cells?.length, MAX_GRID_CELLS);
    assert.equal(grid.cells?.[0]?.text, undefined);
    assert.equal(validateScene(scene).ok, true);
  });

  it("clamps grid row colors and column shades before repair", () => {
    /*
     * ========================================================================
     * 步骤1：验证服务端 Visiomaster 网格行/列辅助数组规模边界
     * ========================================================================
     * 目标：
     *   1) normalizeImportedScene 自身裁剪超长 row_colors
     *   2) normalizeImportedScene 自身裁剪超长 column_shades
     */

    // 1.1 构造超长行颜色和列阴影数组
    const scene = normalizeImportedScene({
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
    });

    // 1.2 适配结果已符合共享校验上界
    const grid = scene.nodes[0];
    assert.equal(grid.rowColors?.length, MAX_GRID_DIMENSION);
    assert.equal(grid.columnShades?.length, MAX_GRID_DIMENSION);
    assert.equal(validateScene(scene).ok, true);
  });

  it("drops non-finite numbers before repair", () => {
    /*
     * ========================================================================
     * 步骤1：验证服务端 Visiomaster 数值字段有限性
     * ========================================================================
     * 目标：
     *   1) normalizeImportedScene 不保留 Infinity/NaN 到 page/node/style
     *   2) edge points 中的非有限坐标在适配层丢弃
     */

    // 1.1 构造包含非有限数值的 Visiomaster 输入
    const scene = normalizeImportedScene({
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
    });

    // 1.2 适配结果已符合共享校验上界
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

  it("clamps page dimensions before repair", () => {
    /*
     * ========================================================================
     * 步骤1：验证服务端 Visiomaster 页面尺寸规模边界
     * ========================================================================
     * 目标：
     *   1) normalizeImportedScene 自身钳制超大 page.width/page.height
     *   2) 小于 1px 的正数不能进入后续 SVG/PPTX/evaluate 链路
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

    // 1.2 适配结果已符合共享校验上界
    assert.equal(scene.page.width, MAX_PAGE_DIMENSION);
    assert.equal(scene.page.height, 1);
    assert.equal(validateScene(scene).ok, true);
  });

  it("clamps node and point geometry before repair", () => {
    /*
     * ========================================================================
     * 步骤1：验证服务端 Visiomaster 几何数值规模边界
     * ========================================================================
     * 目标：
     *   1) normalizeImportedScene 自身钳制 node.x/y/w/h
     *   2) normalizeImportedScene 自身钳制 edge points/from_point/to_point
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

    // 1.2 适配结果几何字段在共享合法范围内
    assert.equal(scene.nodes[0].x, MAX_GEOMETRY_COORDINATE);
    assert.equal(scene.nodes[0].y, -MAX_GEOMETRY_COORDINATE);
    assert.equal(scene.nodes[0].w, MAX_NODE_SIZE);
    assert.equal(scene.nodes[0].h, MAX_NODE_SIZE);
    assert.deepEqual(scene.edges[0].fromPoint, { x: MAX_GEOMETRY_COORDINATE, y: 0 });
    assert.deepEqual(scene.edges[0].toPoint, { x: 0, y: -MAX_GEOMETRY_COORDINATE });
    assert.deepEqual(scene.edges[0].points, [{ x: MAX_GEOMETRY_COORDINATE, y: -MAX_GEOMETRY_COORDINATE }]);
    assert.equal(validateScene(scene).ok, true);
  });

  it("clamps style numbers before repair", () => {
    /*
     * ========================================================================
     * 步骤1：验证服务端 Visiomaster 样式数值规模边界
     * ========================================================================
     * 目标：
     *   1) normalizeImportedScene 自身钳制 node style 线宽和字号
     *   2) normalizeImportedScene 自身钳制 edge style 线宽和字号
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

    // 1.2 适配结果样式数值在共享合法范围内
    assert.equal(scene.nodes[0].style.strokeWidth, MAX_STYLE_STROKE_WIDTH);
    assert.equal(scene.nodes[0].style.fontSize, MAX_STYLE_FONT_SIZE);
    assert.equal(scene.edges[0].style.strokeWidth, MAX_STYLE_STROKE_WIDTH);
    assert.equal(scene.edges[0].style.fontSize, MAX_STYLE_FONT_SIZE);
    assert.equal(validateScene(scene).ok, true);
  });

  it("clamps bracket tick positions before repair", () => {
    /*
     * ========================================================================
     * 步骤1：验证服务端 Visiomaster tick_positions 规模边界
     * ========================================================================
     * 目标：
     *   1) normalizeImportedScene 自身不完整保留超长 tick_positions
     *   2) bracket tickPositions 在进入导出/repair 链路前已钳到共享上界
     */

    // 1.1 构造超长 Visiomaster tick_positions
    const scene = normalizeImportedScene({
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
    });

    // 1.2 适配结果已符合共享校验上界
    assert.equal(scene.nodes[0].tickPositions?.length, MAX_TICK_POSITIONS);
    assert.equal(validateScene(scene).ok, true);
  });

  it("clamps text fields before repair", () => {
    /*
     * ========================================================================
     * 步骤1：验证服务端 Visiomaster 文本字段规模边界
     * ========================================================================
     * 目标：
     *   1) normalizeImportedScene 自身裁剪 node.text/symbol 和 cell label
     *   2) normalizeImportedScene 自身裁剪 edge.label
     */

    // 1.1 构造超长文本字段
    const longText = "x".repeat(MAX_TEXT_LENGTH + 10);
    const scene = normalizeImportedScene({
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
    });

    // 1.2 适配结果已符合共享校验上界
    assert.equal(scene.nodes[0].text?.length, MAX_TEXT_LENGTH);
    assert.equal(scene.nodes[0].symbol?.length, MAX_TEXT_LENGTH);
    assert.equal(scene.nodes[0].cells?.[0]?.text?.length, MAX_TEXT_LENGTH);
    assert.equal(scene.edges[0].label?.length, MAX_TEXT_LENGTH);
    assert.equal(validateScene(scene).ok, true);
  });

  it("clamps protocol strings before repair", () => {
    /*
     * ========================================================================
     * 步骤1：验证服务端 Visiomaster 协议字符串规模边界
     * ========================================================================
     * 目标：
     *   1) normalizeImportedScene 自身裁剪 id/from/to 等引用字符串
     *   2) normalizeImportedScene 自身裁剪 metadata/source/style 字符串
     */

    // 1.1 构造超长结构字符串
    const longId = "n".repeat(MAX_SCENE_ID_LENGTH + 10);
    const longString = "x".repeat(MAX_PROTOCOL_STRING_LENGTH + 10);
    const scene = normalizeImportedScene({
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
    });

    // 1.2 适配结果已符合共享校验上界
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

  it("deduplicates Visiomaster ids that collide after clamping", () => {
    /*
     * ========================================================================
     * 步骤1：验证服务端 Visiomaster id 裁剪碰撞处理
     * ========================================================================
     * 目标：
     *   1) 两个超长 id 共享前缀时，裁剪后仍保持节点 id 唯一
     *   2) 边端点分别重写到对应的唯一化 id
     */

    // 1.1 构造两个裁剪后会碰撞的 id
    const prefix = "n".repeat(MAX_SCENE_ID_LENGTH);
    const firstId = `${prefix}-a`;
    const secondId = `${prefix}-b`;
    const scene = normalizeImportedScene({
      page: { width: 320, height: 180, background: "#FFFFFF" },
      metadata: { title: "v" },
      nodes: [
        { id: firstId, type: "process_box", x: 0, y: 0, w: 100, h: 80, style: {} },
        { id: secondId, type: "process_box", x: 140, y: 0, w: 100, h: 80, style: {} }
      ],
      edges: [
        { id: "edge", type: "arrow_connector", from: firstId, to: `${secondId}:left@0.5`, style: {} }
      ]
    });

    // 1.2 适配结果 id 唯一且端点映射不串线
    assert.notEqual(scene.nodes[0].id, scene.nodes[1].id);
    assert.equal(scene.nodes[0].id.length, MAX_SCENE_ID_LENGTH);
    assert.equal(scene.nodes[1].id.length, MAX_SCENE_ID_LENGTH);
    assert.equal(scene.edges[0].from, scene.nodes[0].id);
    assert.equal(scene.edges[0].to, `${scene.nodes[1].id}:left@0.5`);
    assert.equal(validateScene(scene).ok, true);
  });
});

describe("AI reconstruction replica layer", () => {
  it("adds a locked source image under editable nodes", () => {
    /*
     * ========================================================================
     * 步骤1：验证 AI 重建保真底图
     * ========================================================================
     * 目标：
     *   1) 在语义节点下方插入锁定原图
     *   2) 避免重建漏字漏色时视觉偏离原图
     */

    // 1.1 准备无底图场景
    const scene = sampleScene();
    scene.nodes = scene.nodes.filter((node) => node.type !== "image");

    // 1.2 插入底图并校验顺序
    ensureReplicaBaseLayer(scene, "/uploads/sample.png");
    assert.equal(scene.nodes[0].id, "source-image");
    assert.equal(scene.nodes[0].type, "image");
    assert.equal(scene.nodes[0].locked, true);
    assert.equal(scene.nodes[0].source, "/uploads/sample.png");
  });
});
