import pptxgenjs from "pptxgenjs";
import { logger } from "../logger";
import { resolveEndpoint, shadeColor } from "@shared/geometry";
import type { Scene, SceneEdge, SceneNode } from "./types";

const TARGET_WIDTH_IN = 13.333;
type SlideLike = ReturnType<pptxgenjs["addSlide"]>;
const ShapeType = {
  ellipse: "ellipse" as pptxgenjs.ShapeType,
  roundRect: "roundRect" as pptxgenjs.ShapeType,
  rect: "rect" as pptxgenjs.ShapeType,
  line: "line" as pptxgenjs.ShapeType
};

export async function sceneToPptx(scene: Scene, outputPath: string) {
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
  logger.info("开始写入可编辑节点...", { nodes: scene.nodes.length });

  // 2.1 按顺序写入节点
  for (const node of scene.nodes) {
    addNode(slide, node, scale);
  }
  for (const edge of scene.edges ?? []) {
    addEdge(slide, edge, scene.nodes, scale);
  }

  // 2.2 输出 PPTX 文件
  await pptx.writeFile({ fileName: outputPath });
  logger.info("写入可编辑节点完成", { outputPath });
}

function addNode(slide: SlideLike, node: SceneNode, scale: number) {
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
    slide.addImage({ path: localPathFromUrl(node.source), x, y, w, h, transparency: opacityToTransparency(node.style.opacity ?? 1) });
  } else if (node.type === "text") {
    slide.addText(node.text ?? "", {
      x,
      y,
      w,
      h,
      fontFace: node.style.fontFamily ?? "Times New Roman",
      fontSize: Math.max(6, (node.style.fontSize ?? 16) * 0.75),
      color: normalizeColor(node.style.color ?? "#111111"),
      bold: node.style.fontWeight === "bold",
      margin: 0
    });
  } else if (node.type === "ellipse" || node.type === "operator") {
    slide.addShape(ShapeType.ellipse, { x, y, w, h, ...shapeStyle(node) });
    if (node.type === "operator" && (node.symbol || node.text)) {
      slide.addText(node.symbol || node.text || "", {
        x,
        y,
        w,
        h,
        fontFace: node.style.fontFamily ?? "Cambria Math",
        fontSize: Math.max(6, (node.style.fontSize ?? 16) * 0.75),
        color: normalizeColor(node.style.color ?? "#111111"),
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
  addSegmentedLine(slide, points, scale, edge.style.stroke ?? "#111111", edge.style.strokeWidth ?? 1, edge.type === "arrow" || edge.type === "fork");

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

  // 1.1 读取首尾点
  const points = node.points?.length ? node.points : [{ x: node.x, y: node.y }, { x: node.x + node.w, y: node.y + node.h }];
  const start = points[0];
  const end = points[points.length - 1];

  // 1.2 写入线条
  addSegmentedLine(slide, points, scale, node.style.stroke ?? "#111111", node.style.strokeWidth ?? 1, node.type === "arrow");

  logger.info("添加线条节点完成", { id: node.id });
}

function addSegmentedLine(
  slide: SlideLike,
  points: Array<{ x: number; y: number }>,
  scale: number,
  color: string,
  width: number,
  arrowEnd: boolean
) {
  /*
   * ========================================================================
   * 步骤1：添加分段线条
   * ========================================================================
   * 目标：
   *   1) 支持多段折线导出
   *   2) 只在最后一段保留箭头
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

  // 1.2 写入每个单元格
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const explicit = node.cells?.find((cell) => cell.row === row && cell.col === col);
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

  // 1.2 写入线段
  for (const [start, end] of segments) {
    addSegmentedLine(slide, [start, end], scale, node.style.stroke ?? "#111111", node.style.strokeWidth ?? 1, false);
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

  // 1.2 生成线条配置
  const line = node.style.stroke && node.style.stroke !== "none"
    ? { color: normalizeColor(node.style.stroke), width: node.style.strokeWidth ?? 1 }
    : { color: "FFFFFF", transparency: 100 };

  const result = { fill, line };
  logger.info("生成 PPT 形状样式完成", { id: node.id });
  return result;
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

  // 1.1 清理颜色字符串
  const normalized = value.replace("#", "").trim().toUpperCase();

  // 1.2 返回合法十六进制颜色
  const result = /^[0-9A-F]{6}$/.test(normalized) ? normalized : "FFFFFF";
  logger.info("规范化 PPT 颜色完成", { result });
  return result;
}

function opacityToTransparency(opacity: number) {
  return Math.round((1 - Math.max(0, Math.min(1, opacity))) * 100);
}

function localPathFromUrl(url: string) {
  const normalized = url.replaceAll("\\", "/");
  const marker = "/uploads/";
  const index = normalized.indexOf(marker);
  if (index < 0) {
    return url;
  }
  return `data/uploads/${normalized.slice(index + marker.length)}`;
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
