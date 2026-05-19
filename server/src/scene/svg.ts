import { logger } from "../logger";
import type { Scene, SceneEdge, SceneNode } from "./types";

export async function sceneToSvg(scene: Scene): Promise<string> {
  /*
   * ========================================================================
   * 步骤1：生成 SVG 文档
   * ========================================================================
   * 目标：
   *   1) 写入页面尺寸和 marker 定义
   *   2) 把 scene 节点转换成 SVG 元素
   */
  logger.info("开始生成 SVG 文档...", {
    width: scene.page.width,
    height: scene.page.height,
    nodes: scene.nodes.length
  });

  // 1.1 生成节点元素
  const edgeElements = (scene.edges ?? []).map((edge) => edgeToSvg(edge, scene.nodes)).join("\n");
  const elements = (await Promise.all(scene.nodes.map((node) => nodeToSvg(node)))).join("\n");

  // 1.2 组装完整 SVG
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.page.width}" height="${scene.page.height}" viewBox="0 0 ${scene.page.width} ${scene.page.height}">`,
    "<defs>",
    '<marker id="arrow-head" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">',
    '<path d="M0,0 L0,6 L9,3 z" fill="context-stroke" />',
    "</marker>",
    "</defs>",
    `<rect x="0" y="0" width="${scene.page.width}" height="${scene.page.height}" fill="${escapeAttr(scene.page.background)}" />`,
    edgeElements,
    elements,
    "</svg>"
  ].join("\n");

  logger.info("生成 SVG 文档完成", { bytes: svg.length });
  return svg;
}

async function nodeToSvg(node: SceneNode): Promise<string> {
  /*
   * ========================================================================
   * 步骤1：转换单个节点
   * ========================================================================
   * 目标：
   *   1) 根据节点类型选择 SVG 标签
   *   2) 保留可编辑元素的样式和文本
   */
  logger.info("开始转换单个节点...", { id: node.id, type: node.type });

  // 1.1 计算通用样式
  const style = styleToSvg(node, { includeFill: node.type !== "line" && node.type !== "arrow" });

  // 1.2 按类型输出标签
  let result: string;
  if (node.type === "image") {
    const href = await imageHref(node.source ?? "");
    result = `<image id="${escapeAttr(node.id)}" href="${escapeAttr(href)}" x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" opacity="${node.style.opacity ?? 1}" />`;
  } else if (node.type === "text") {
    result = `<text id="${escapeAttr(node.id)}" x="${node.x}" y="${node.y + node.h * 0.78}" ${style}>${escapeText(node.text ?? "")}</text>`;
  } else if (node.type === "ellipse") {
    result = `<ellipse id="${escapeAttr(node.id)}" cx="${node.x + node.w / 2}" cy="${node.y + node.h / 2}" rx="${node.w / 2}" ry="${node.h / 2}" ${style} />`;
  } else if (node.type === "line" || node.type === "arrow") {
    const points = node.points?.length ? node.points : [{ x: node.x, y: node.y }, { x: node.x + node.w, y: node.y + node.h }];
    result = polylineToSvg(node, points, style);
  } else if (node.type === "operator") {
    result = operatorToSvg(node, style);
  } else if (node.type === "grid" || node.type === "feature_grid") {
    result = gridToSvg(node);
  } else if (node.type === "bracket") {
    result = bracketToSvg(node);
  } else {
    result = `<rect id="${escapeAttr(node.id)}" x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="${node.type === "rounded_rect" ? 12 : 3}" ${style} />`;
  }

  logger.info("转换单个节点完成", { id: node.id });
  return result;
}

async function imageHref(source: string) {
  /*
   * ========================================================================
   * 步骤1：生成 SVG 图片引用
   * ========================================================================
   * 目标：
   *   1) 优先把本地上传图片内嵌为 data URL
   *   2) 外部路径无法读取时保留原始引用
   */
  logger.info("开始生成 SVG 图片引用...", { source });

  // 1.1 跳过已经是 data URL 的图片
  if (!source || source.startsWith("data:")) {
    logger.info("生成 SVG 图片引用完成", { mode: "inline-or-empty" });
    return source;
  }

  // 1.2 读取本地上传图片
  try {
    const { promises: fs } = await import("node:fs");
    const path = await import("node:path");
    const filePath = localPathFromUrl(source);
    const bytes = await fs.readFile(filePath);
    const mime = mimeFromPath(filePath);
    const href = `data:${mime};base64,${bytes.toString("base64")}`;
    logger.info("生成 SVG 图片引用完成", { mode: "embedded", bytes: bytes.length });
    return href;
  } catch (error) {
    logger.warn("生成 SVG 图片引用失败，保留原始路径", { source, error: String(error) });
    return source;
  }
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

function mimeFromPath(filePath: string) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/png";
}

function edgeToSvg(edge: SceneEdge, nodes: SceneNode[]): string {
  /*
   * ========================================================================
   * 步骤1：转换语义连线
   * ========================================================================
   * 目标：
   *   1) 解析 from/to 端点
   *   2) 输出可编辑 SVG polyline
   */
  logger.info("开始转换语义连线...", { id: edge.id });

  // 1.1 解析端点和折线点
  const start = edge.fromPoint ?? (edge.from ? resolveEndpoint(edge.from, nodes) : undefined);
  const end = edge.toPoint ?? (edge.to ? resolveEndpoint(edge.to, nodes) : undefined);
  if (!start || !end) {
    logger.warn("转换语义连线跳过，端点缺失", { id: edge.id });
    return "";
  }

  // 1.2 输出 polyline
  const points = [start, ...(edge.points ?? []), end];
  const pointText = points.map((point) => `${point.x},${point.y}`).join(" ");
  const marker = edge.type === "arrow" || edge.type === "fork" ? ' marker-end="url(#arrow-head)"' : "";
  const result = `<polyline id="${escapeAttr(edge.id)}" points="${pointText}" ${edgeStyleToSvg(edge)}${marker} fill="none" />`;
  logger.info("转换语义连线完成", { id: edge.id });
  return result;
}

function polylineToSvg(node: SceneNode, points: Array<{ x: number; y: number }>, style: string) {
  /*
   * ========================================================================
   * 步骤1：转换折线节点
   * ========================================================================
   * 目标：
   *   1) 把点数组转换为 SVG polyline
   *   2) 根据类型决定是否追加箭头
   */
  logger.info("开始转换折线节点...", { id: node.id, points: points.length });

  // 1.1 拼接折线点
  const pointText = points.map((point) => `${point.x},${point.y}`).join(" ");

  // 1.2 追加箭头标记
  const marker = node.type === "arrow" ? ' marker-end="url(#arrow-head)"' : "";
  const result = `<polyline id="${escapeAttr(node.id)}" points="${pointText}" ${style}${marker} fill="none" />`;
  logger.info("转换折线节点完成", { id: node.id });
  return result;
}

function styleToSvg(node: SceneNode, options: { includeFill?: boolean } = {}): string {
  /*
   * ========================================================================
   * 步骤1：转换样式
   * ========================================================================
   * 目标：
   *   1) 把 scene 样式映射为 SVG 属性
   *   2) 保持文字、填充、描边可编辑
   */
  logger.info("开始转换样式...", { id: node.id });

  // 1.1 读取样式默认值
  const includeFill = options.includeFill ?? true;
  const fill = node.style.fill ?? "none";
  const stroke = node.style.stroke ?? "none";
  const strokeWidth = node.style.strokeWidth ?? 1;
  const opacity = node.style.opacity ?? 1;
  const color = node.style.color ?? "#111111";
  const fontFamily = node.style.fontFamily ?? "Times New Roman";
  const fontSize = node.style.fontSize ?? 16;
  const fontWeight = node.style.fontWeight ?? "400";

  // 1.2 生成属性字符串
  const result = [
    includeFill ? `fill="${escapeAttr(fill)}"` : "",
    `stroke="${escapeAttr(stroke)}"`,
    `stroke-width="${strokeWidth}"`,
    `opacity="${opacity}"`,
    `color="${escapeAttr(color)}"`,
    `font-family="${escapeAttr(fontFamily)}"`,
    `font-size="${fontSize}"`,
    `font-weight="${escapeAttr(fontWeight)}"`
  ].filter(Boolean).join(" ");

  logger.info("转换样式完成", { id: node.id });
  return result;
}

function edgeStyleToSvg(edge: SceneEdge): string {
  return [
    `stroke="${escapeAttr(edge.style.stroke ?? "#111111")}"`,
    `stroke-width="${edge.style.strokeWidth ?? 1.25}"`,
    `opacity="${edge.style.opacity ?? 1}"`,
    edge.style.dash ? `stroke-dasharray="${escapeAttr(edge.style.dash)}"` : ""
  ].filter(Boolean).join(" ");
}

function operatorToSvg(node: SceneNode, style: string): string {
  const size = Math.min(node.w, node.h);
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  return [
    `<ellipse id="${escapeAttr(node.id)}" cx="${cx}" cy="${cy}" rx="${size / 2}" ry="${size / 2}" ${style} />`,
    `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" fill="${escapeAttr(node.style.color ?? "#111111")}" font-family="${escapeAttr(node.style.fontFamily ?? "Cambria Math")}" font-size="${node.style.fontSize ?? 16}">${escapeText(node.symbol || node.text || "")}</text>`
  ].join("\n");
}

function gridToSvg(node: SceneNode): string {
  const rows = node.rows ?? 1;
  const cols = node.cols ?? 1;
  const cellW = node.w / cols;
  const cellH = node.h / rows;
  const cells: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const explicit = node.cells?.find((cell) => cell.row === row && cell.col === col);
      const base = explicit?.fill ?? node.rowColors?.[row % Math.max(1, node.rowColors.length)] ?? node.style.fill ?? "#FFFFFF";
      const fill = shadeColor(base, node.columnShades?.[col] ?? 0);
      cells.push(`<rect x="${node.x + col * cellW}" y="${node.y + row * cellH}" width="${cellW}" height="${cellH}" fill="${escapeAttr(fill)}" stroke="${escapeAttr(node.style.stroke ?? "#111111")}" stroke-width="${node.style.strokeWidth ?? 0.8}" />`);
      if (explicit?.text) {
        cells.push(`<text x="${node.x + col * cellW + cellW / 2}" y="${node.y + row * cellH + cellH / 2}" text-anchor="middle" dominant-baseline="middle" fill="${escapeAttr(explicit.color ?? node.style.color ?? "#111111")}" font-family="${escapeAttr(node.style.fontFamily ?? "Times New Roman")}" font-size="${node.style.fontSize ?? Math.max(10, Math.min(28, cellH * 0.62))}">${escapeText(explicit.text)}</text>`);
      }
    }
  }
  return cells.join("\n");
}

function bracketToSvg(node: SceneNode): string {
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
  return segments.map(([start, end], index) => `<line id="${escapeAttr(node.id)}-${index}" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${escapeAttr(node.style.stroke ?? "#111111")}" stroke-width="${node.style.strokeWidth ?? 1}" />`).join("\n");
}

function resolveEndpoint(endpoint: string, nodes: SceneNode[]) {
  const [id, rawSide] = endpoint.split(":");
  const node = nodes.find((item) => item.id === id);
  if (!node) {
    return undefined;
  }
  const [side, rawRatio] = (rawSide ?? "center").split("@");
  const ratio = rawRatio === undefined ? 0.5 : Number(rawRatio);
  if (side === "left") {
    return { x: node.x, y: node.y + node.h * ratio };
  }
  if (side === "right") {
    return { x: node.x + node.w, y: node.y + node.h * ratio };
  }
  if (side === "top") {
    return { x: node.x + node.w * ratio, y: node.y };
  }
  if (side === "bottom") {
    return { x: node.x + node.w * ratio, y: node.y + node.h };
  }
  return { x: node.x + node.w / 2, y: node.y + node.h / 2 };
}

function shadeColor(color: string, amount: number) {
  /*
   * ========================================================================
   * 步骤1：计算 SVG 网格阴影色
   * ========================================================================
   * 目标：
   *   1) 把基础颜色按比例混合到黑色
   *   2) 统一输出大写十六进制颜色
   */
  logger.info("开始计算 SVG 网格阴影色...", { color, amount });

  // 1.1 校验颜色格式
  const normalized = color.startsWith("#") ? color.slice(1) : color;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    logger.warn("计算 SVG 网格阴影色跳过，颜色格式非法", { color });
    return color;
  }

  // 1.2 计算阴影颜色
  const factor = Math.max(0, Math.min(1, amount));
  const red = Math.round(parseInt(normalized.slice(0, 2), 16) * (1 - factor));
  const green = Math.round(parseInt(normalized.slice(2, 4), 16) * (1 - factor));
  const blue = Math.round(parseInt(normalized.slice(4, 6), 16) * (1 - factor));
  const result = `#${toHex(red)}${toHex(green)}${toHex(blue)}`;

  logger.info("计算 SVG 网格阴影色完成", { result });
  return result;
}

function toHex(value: number) {
  /*
   * ========================================================================
   * 步骤1：转换十六进制通道
   * ========================================================================
   * 目标：
   *   1) 限制颜色通道范围
   *   2) 输出两位大写十六进制
   */

  // 1.1 限制通道值
  const channel = Math.max(0, Math.min(255, value));

  // 1.2 返回十六进制文本
  return channel.toString(16).padStart(2, "0").toUpperCase();
}

function escapeAttr(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function escapeText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
