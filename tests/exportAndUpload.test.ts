import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensureReplicaBaseLayer, exportKindConfig, isAllowedImageMime, sanitizeFileBase, validateSceneForExport } from "../server/src/routes/api";
import { sceneToPptx } from "../server/src/scene/pptx";
import { sceneToSvg } from "../server/src/scene/svg";
import { normalizeImportedScene } from "../server/src/scene/visiomasterAdapter";
import { shadeColor } from "../src/shared/geometry";
import type { Scene } from "../src/shared/scene";

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
          strokeWidth: 1
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
          strokeWidth: 1.5
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

  it("defines all supported export kinds in one table", () => {
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

  it("writes a PPTX file for grid, bracket, and segmented lines", async () => {
    /*
     * ========================================================================
     * 步骤1：验证 PPTX 导出
     * ========================================================================
     * 目标：
     *   1) 覆盖新增网格和括号导出路径
     *   2) 确认生成文件非空
     */

    // 1.1 准备临时输出路径
    const tempDir = path.join(os.tmpdir(), `scientific-drawing-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const outputPath = path.join(tempDir, "scene.pptx");

    try {
      // 1.2 写入 PPTX 并校验大小
      await sceneToPptx(sampleScene(), outputPath);
      const outputStat = await stat(outputPath);
      assert.ok(outputStat.size > 0);

      // 1.3 粗略确认 ZIP 文件头
      const header = await readFile(outputPath);
      assert.equal(header.subarray(0, 2).toString("utf8"), "PK");
    } finally {
      // 1.4 清理临时目录
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("visiomaster adapter", () => {
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
