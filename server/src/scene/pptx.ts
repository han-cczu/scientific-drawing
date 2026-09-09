import fs from "node:fs";
import pptxgenjs from "pptxgenjs";
import { logger } from "../logger";
import { resolveLocalAssetPath } from "../paths";
import { indexGridCells, isNormalizedHexColor, normalizeHexColor, resolveEndpoint, shadeColor } from "@shared/geometry";
import { visibleSceneEdges, visibleSceneNodes } from "@shared/sceneVisibility";
import type { Scene, SceneEdge, SceneNode } from "./types";

const TARGET_WIDTH_IN = 13.333;
type SlideLike = ReturnType<pptxgenjs["addSlide"]>;
const ShapeType = {
  ellipse: "ellipse" as pptxgenjs.ShapeType,
  roundRect: "roundRect" as pptxgenjs.ShapeType,
  rect: "rect" as pptxgenjs.ShapeType,
  line: "line" as pptxgenjs.ShapeType
};

export async function sceneToPptx(scene: Scene, resolveAssetPath: (source: unknown) => string | null = resolveLocalAssetPath): Promise<Buffer> {
  /*
   * ========================================================================
   * 步骤1：初始化 PPTX 文档
   * ========================================================================
   * 目标：
   *   1) 根据 scene 宽高定义页面比例
   *   2) 创建一页可编辑幻灯片
   */
  logger.info("开始初始化 PPTX 文档...", {
    width: scene.page.width,
    height: scene.page.height
  });

  // 1.1 计算像素到英寸比例
  const scale = TARGET_WIDTH_IN / scene.page.width;
  const widthIn = TARGET_WIDTH_IN;
  const heightIn = scene.page.height * scale;

  // 1.2 创建 PPTX 页面
  const PptxGen = resolvePptxConstructor();
  const pptx = new PptxGen();
  pptx.defineLayout({ name: "SCENE", width: widthIn, height: heightIn });
  pptx.layout = "SCENE";
  pptx.author = "scientific-drawing";
  pptx.subject = scene.metadata.title;
  pptx.title = scene.metadata.title;
  const slide = pptx.addSlide();
  slide.background = { color: normalizeColor(scene.page.background) };
  logger.info("初始化 PPTX 文档完成", { widthIn, heightIn });

  /*
   * ========================================================================
   * 步骤2：写入可编辑节点
   * ========================================================================
   * 目标：
   *   1) 图片节点作为参考底图
   *   2) 文本、矩形、椭圆和线条转为 PPT 可编辑对象
   */
  const visibleNodes = visibleSceneNodes(scene.nodes);
  const visibleEdges = visibleSceneEdges(scene.edges ?? [], scene.nodes);
  logger.info("开始写入可编辑节点...", { nodes: visibleNodes.length });

  // 2.1 按顺序写入节点
  for (const node of visibleNodes) {
    addNode(slide, node, scale, resolveAssetPath);
  }
  for (const edge of visibleEdges) {
    addEdge(slide, edge, visibleNodes, scale);
  }

  // 2.2 输出 PPTX 字节流（由导出路由直接下发附件，不再写盘）
  const output = await pptx.write({ outputType: "nodebuffer" });
  const buffer = Buffer.from(output as Uint8Array);
  logger.info("写入可编辑节点完成", { bytes: buffer.byteLength });
  return buffer;
}

function addNode(slide: SlideLike, node: SceneNode, scale: number, resolveAssetPath: (source: unknown) => string | null) {
  /*
   * ========================================================================
   * 步骤1：添加单个 PPT 节点
   * ========================================================================
   * 目标：
   *   1) 把像素坐标换算为英寸
   *   2) 根据节点类型调用 PPTXGenJS API
   */
  logger.info("开始添加单个 PPT 节点...", { id: node.id, type: node.type });

  // 1.1 计算位置
  const x = node.x * scale;
  const y = node.y * scale;
  const w = Math.max(0.01, node.w * scale);
  const h = Math.max(0.01, node.h * scale);

  // 1.2 添加元素
  if (node.type === "image" && node.source) {
    addImageNode(slide, node.source, { x, y, w, h, transparency: opacityToTransparency(node.style.opacity ?? 1) }, resolveAssetPath);
  } else if (node.type === "text") {
    slide.addText(node.text ?? "", {
      x,
      y,
      w,
      h,
      fontFace: node.style.fontFamily ?? "Times New Roman",
      fontSize: Math.max(6, (node.style.fontSize ?? 16) * 0.75),
      color: normalizeColor(node.style.color ?? "#111111"),
      bold: isBoldWeight(node.style.fontWeight),
      margin: 0
    });
  } else if (node.type === "ellipse" || node.type === "operator") {
    if (node.type === "operator") {
      // 与 Canvas/SVG 一致：算子画 min(w,h) 的居中正圆，而非占满包围盒的拉伸椭圆
      const size = Math.min(node.w, node.h);
      const circleSize = Math.max(0.01, size * scale);
      const cx = (node.x + (node.w - size) / 2) * scale;
      const cy = (node.y + (node.h - size) / 2) * scale;
      slide.addShape(ShapeType.ellipse, { x: cx, y: cy, w: circleSize, h: circleSize, ...shapeStyle(node) });
    } else {
      slide.addShape(ShapeType.ellipse, { x, y, w, h, ...shapeStyle(node) });
    }
    if (node.type === "operator" && (node.symbol || node.text)) {
      slide.addText(node.symbol || node.text || "", {
        x,
        y,
        w,
        h,
        fontFace: node.style.fontFamily ?? "Cambria Math",
        fontSize: Math.max(6, (node.style.fontSize ?? 16) * 0.75),
        color: normalizeColor(node.style.color ?? "#111111"),
        bold: isBoldWeight(node.style.fontWeight),
        margin: 0,
        align: "center",
        valign: "middle"
      });
    }
  } else if (node.type === "line" || node.type === "arrow") {
    addLineNode(slide, node, scale);
  } else if (node.type === "grid" || node.type === "feature_grid") {
    addGridNode(slide, node, scale);
  } else if (node.type === "bracket") {
    addBracketNode(slide, node, scale);
  } else {
    slide.addShape(node.type === "rounded_rect" ? ShapeType.roundRect : ShapeType.rect, { x, y, w, h, ...shapeStyle(node) });
    if (node.text) {
      slide.addText(node.text, {
        x,
        y,
        w,
        h,
        fontFace: node.style.fontFamily ?? "Times New Roman",
        fontSize: Math.max(6, (node.style.fontSize ?? 14) * 0.75),
        color: normalizeColor(node.style.color ?? "#111111"),
        bold: isBoldWeight(node.style.fontWeight),
        margin: 0.04,
        align: "center",
        valign: "middle"
      });
    }
  }

  logger.info("添加单个 PPT 节点完成", { id: node.id });
}

function addEdge(slide: SlideLike, edge: SceneEdge, nodes: SceneNode[], scale: number) {
  /*
   * ========================================================================
   * 步骤1：添加语义连线
   * ========================================================================
   * 目标：
   *   1) 解析 from/to 端点
   *   2) 将首尾点导出为 PPT 线条
   */
  logger.info("开始添加语义连线...", { id: edge.id });

  // 1.1 解析端点
  const start = edge.fromPoint ?? (edge.from ? resolveEndpoint(edge.from, nodes) : undefined);
  const end = edge.toPoint ?? (edge.to ? resolveEndpoint(edge.to, nodes) : undefined);
  if (!start || !end) {
    logger.warn("添加语义连线跳过，端点缺失", { id: edge.id });
    return;
  }

  // 1.2 写入线条
  const points = [start, ...(edge.points ?? []), end];
  addSegmentedLine(slide, points, scale, edge.style.stroke ?? "#111111", edge.style.strokeWidth ?? 1, edge.type === "arrow" || edge.type === "fork", edge.style.dash, edge.style.opacity ?? 1);

  logger.info("添加语义连线完成", { id: edge.id });
}

function addLineNode(slide: SlideLike, node: SceneNode, scale: number) {
  /*
   * ========================================================================
   * 步骤1：添加线条节点
   * ========================================================================
   * 目标：
   *   1) 读取首尾点生成 PPT 线条
   *   2) 保留箭头样式
   */
  logger.info("开始添加线条节点...", { id: node.id });

  // 1.1 读取折线点
  const points = node.points?.length ? node.points : [{ x: node.x, y: node.y }, { x: node.x + node.w, y: node.y + node.h }];

  // 1.2 写入线条
  addSegmentedLine(slide, points, scale, node.style.stroke ?? "#111111", node.style.strokeWidth ?? 1, node.type === "arrow", node.style.dash, node.style.opacity ?? 1);

  logger.info("添加线条节点完成", { id: node.id });
}

function addSegmentedLine(
  slide: SlideLike,
  points: Array<{ x: number; y: number }>,
  scale: number,
  color: string,
  width: number,
  arrowEnd: boolean,
  dash?: string,
  opacity: number = 1
) {
  /*
   * ========================================================================
   * 步骤1：添加分段线条
   * ========================================================================
   * 目标：
   *   1) 支持多段折线导出
   *   2) 只在最后一段保留箭头
   *   3) dash 由调用方按节点/边样式传入（括号显式传 undefined 保持实线）
   */
  logger.info("开始添加分段线条...", { points: points.length, arrowEnd });

  // 1.1 跳过无效折线
  if (points.length < 2) {
    logger.warn("添加分段线条跳过，点数量不足", { points: points.length });
    return;
  }

  // 1.2 逐段写入线条
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    slide.addShape(ShapeType.line, {
      x: start.x * scale,
      y: start.y * scale,
      w: (end.x - start.x) * scale,
      h: (end.y - start.y) * scale,
      line: {
        color: normalizeColor(color),
        width,
        transparency: opacityToTransparency(opacity),
        dashType: dashToPptx(dash),
        beginArrowType: "none",
        endArrowType: arrowEnd && index === points.length - 2 ? "triangle" : "none"
      }
    });
  }

  logger.info("添加分段线条完成", { segments: points.length - 1 });
}

function addGridNode(slide: SlideLike, node: SceneNode, scale: number) {
  /*
   * ========================================================================
   * 步骤1：添加网格节点
   * ========================================================================
   * 目标：
   *   1) 把 grid/feature_grid 拆成 PPT 可编辑矩形
   *   2) 保留行色、列阴影和单元格颜色
   */
  logger.info("开始添加网格节点...", { id: node.id });

  // 1.1 计算网格尺寸
  const rows = node.rows ?? 1;
  const cols = node.cols ?? 1;
  const cellW = node.w / cols;
  const cellH = node.h / rows;
  const cellIndex = indexGridCells(node.cells);

  // 1.2 写入每个单元格
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const explicit = cellIndex.get(`${row}:${col}`);
      const base = explicit?.fill ?? node.rowColors?.[row % Math.max(1, node.rowColors.length)] ?? node.style.fill ?? "#FFFFFF";
      const fill = shadeColor(base, node.columnShades?.[col] ?? 0);
      slide.addShape(ShapeType.rect, {
        x: (node.x + col * cellW) * scale,
        y: (node.y + row * cellH) * scale,
        w: Math.max(0.01, cellW * scale),
        h: Math.max(0.01, cellH * scale),
        fill: { color: normalizeColor(fill), transparency: opacityToTransparency(node.style.opacity ?? 1) },
        line: {
          color: normalizeColor(node.style.stroke ?? "#111111"),
          width: node.style.strokeWidth ?? 0.8
        }
      });
      if (explicit?.text) {
        slide.addText(explicit.text, {
          x: (node.x + col * cellW) * scale,
          y: (node.y + row * cellH) * scale,
          w: Math.max(0.01, cellW * scale),
          h: Math.max(0.01, cellH * scale),
          fontFace: node.style.fontFamily ?? "Times New Roman",
          fontSize: Math.max(6, (node.style.fontSize ?? Math.max(10, Math.min(28, cellH * 0.62))) * 0.75),
          color: normalizeColor(explicit.color ?? node.style.color ?? "#111111"),
          bold: isBoldWeight(node.style.fontWeight),
          margin: 0,
          align: "center",
          valign: "middle"
        });
      }
    }
  }

  logger.info("添加网格节点完成", { id: node.id, rows, cols });
}

function addBracketNode(slide: SlideLike, node: SceneNode, scale: number) {
  /*
   * ========================================================================
   * 步骤1：添加括号节点
   * ========================================================================
   * 目标：
   *   1) 用 PPT 线条表达分组括号
   *   2) 支持 left/right/up/down 方向
   */
  logger.info("开始添加括号节点...", { id: node.id, orientation: node.orientation });

  // 1.1 计算括号线段
  const ticks = node.tickPositions?.length ? node.tickPositions : [0, 1];
  const segments: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];
  if (node.orientation === "up" || node.orientation === "down") {
    const y = node.orientation === "up" ? node.y : node.y + node.h;
    segments.push([{ x: node.x, y }, { x: node.x + node.w, y }]);
    ticks.forEach((tick) => segments.push([{ x: node.x + node.w * tick, y: node.y }, { x: node.x + node.w * tick, y }]));
  } else {
    const x = node.orientation === "left" ? node.x : node.x + node.w;
    segments.push([{ x, y: node.y }, { x, y: node.y + node.h }]);
    ticks.forEach((tick) => segments.push([{ x: node.x, y: node.y + node.h * tick }, { x, y: node.y + node.h * tick }]));
  }

  // 1.2 写入线段（括号臂保持实线，显式不传 dash）
  for (const [start, end] of segments) {
    addSegmentedLine(slide, [start, end], scale, node.style.stroke ?? "#111111", node.style.strokeWidth ?? 1, false, undefined, node.style.opacity ?? 1);
  }

  logger.info("添加括号节点完成", { id: node.id, segments: segments.length });
}

function shapeStyle(node: SceneNode) {
  /*
   * ========================================================================
   * 步骤1：生成 PPT 形状样式
   * ========================================================================
   * 目标：
   *   1) 转换填充色
   *   2) 转换边框色和线宽
   */
  logger.info("开始生成 PPT 形状样式...", { id: node.id });

  // 1.1 生成填充配置
  const fill = node.style.fill && node.style.fill !== "none"
    ? { color: normalizeColor(node.style.fill), transparency: opacityToTransparency(node.style.opacity ?? 1) }
    : { color: "FFFFFF", transparency: 100 };

  // 1.2 生成线条配置（dash 仅对真实描边有意义；描边同样应用 opacity，与 fill/SVG 一致）
  const line = node.style.stroke && node.style.stroke !== "none"
    ? { color: normalizeColor(node.style.stroke), width: node.style.strokeWidth ?? 1, transparency: opacityToTransparency(node.style.opacity ?? 1), dashType: dashToPptx(node.style.dash) }
    : { color: "FFFFFF", transparency: 100 };

  const result = { fill, line };
  logger.info("生成 PPT 形状样式完成", { id: node.id });
  return result;
}

export function isBoldWeight(fontWeight: string | undefined): boolean {
  /*
   * ========================================================================
   * 步骤1：判断字重是否加粗
   * ========================================================================
   * 目标：
   *   1) 兼容字面量 "bold" 与数字字重（如 "600"/"700"）
   *   2) 与 SVG/Canvas 的任意 CSS 字重渲染对齐，避免数字字重在 PPTX 丢失加粗
   */
  if (!fontWeight) {
    return false;
  }
  if (fontWeight === "bold") {
    return true;
  }
  const numeric = Number(fontWeight);
  return Number.isFinite(numeric) && numeric >= 600;
}

export function dashToPptx(dash: string | undefined): "solid" | "dash" | "sysDot" | "lgDash" {
  /*
   * ========================================================================
   * 步骤1：映射 dash 预设到 PPT dashType
   * ========================================================================
   * 目标：
   *   1) 与 StyleTab 预设一一对应：'4 4'→dash / '2 2'→sysDot / '8 3 2 3'→lgDash
   *   2) PowerPoint 无逐像素 dash 控制，双虚线取最接近的 lgDash 近似
   *   3) 未识别的自定义 dash 与 StyleTab.dashToKind 同规则回落 dash
   */
  if (!dash) {
    return "solid";
  }
  if (dash === "2 2") {
    return "sysDot";
  }
  if (dash === "8 3 2 3") {
    return "lgDash";
  }
  return "dash";
}

function normalizeColor(value: string) {
  /*
   * ========================================================================
   * 步骤1：规范化 PPT 颜色
   * ========================================================================
   * 目标：
   *   1) 把 #RRGGBB 转成 PPTXGenJS 颜色
   *   2) 对 none 或非法颜色使用白色兜底
   */
  logger.info("开始规范化 PPT 颜色...", { value });

  // 1.1 清理颜色字符串（共用 normalizeHexColor，#RGB 短色展开为 RRGGBB）
  const normalized = normalizeHexColor(value);

  // 1.2 返回合法十六进制颜色（PPTXGenJS 颜色不带 # 前缀）
  const result = isNormalizedHexColor(normalized) ? normalized.slice(1) : "FFFFFF";
  logger.info("规范化 PPT 颜色完成", { result });
  return result;
}

function opacityToTransparency(opacity: number) {
  return Math.round((1 - Math.max(0, Math.min(1, opacity))) * 100);
}

function addImageNode(
  slide: SlideLike,
  source: string,
  box: { x: number; y: number; w: number; h: number; transparency: number },
  resolveAssetPath: (source: unknown) => string | null
) {
  /*
   * ========================================================================
   * 步骤1：安全地把图片节点写入 PPTX
   * ========================================================================
   * 目标：
   *   1) data: URL 走 data 字段（pptxgenjs 把 path 当文件路径 readFileSync，data URL 会整体导出失败）
   *   2) 仅受控目录（/uploads、/eval-suite）内的本地资源走 path（防任意文件读取/LFI）
   *   3) 非受控来源（外部 URL、穿越路径）跳过内嵌，既不读盘也不让导出失败
   */
  if (source.startsWith("data:")) {
    slide.addImage({ data: source, ...box });
    return;
  }
  const filePath = resolveAssetPath(source);
  if (filePath && fs.existsSync(filePath)) {
    slide.addImage({ path: filePath, ...box });
    return;
  }
  logger.warn("跳过非受控或不可读取图片来源，PPTX 不内嵌", { source });
}

function resolvePptxConstructor() {
  const candidate = pptxgenjs as unknown as {
    default?: unknown;
  };
  if (typeof candidate.default === "function") {
    return candidate.default as new () => pptxgenjs;
  }
  return pptxgenjs as unknown as new () => pptxgenjs;
}
