import { logger } from "../lib/logger";
import { createId } from "../lib/id";
import { clampNumber, isNormalizedHexColor, normalizeHexColor, resolveEndpoint } from "../shared/geometry";
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
  MAX_TEXT_LENGTH,
  MAX_TICK_POSITIONS
} from "../shared/sceneValidation";
import type { Scene, SceneEdge, SceneNode, SceneStyle } from "../shared/scene";

type AnyRecord = Record<string, unknown>;

export function normalizeImportedScene(input: unknown): Scene {
  /*
   * ========================================================================
   * 步骤1：规范化导入场景
   * ========================================================================
   * 目标：
   *   1) 接收当前协议或 Visiomaster 风格 scene.json
   *   2) 转换为编辑器内部 scene 协议
   */
  logger.info("开始规范化导入场景...");

  // 1.1 校验基础对象
  if (!isRecord(input)) {
    throw new Error("Scene JSON must be an object.");
  }

  // 1.2 识别并转换 scene
  const scene = hasScientificShape(input)
    ? normalizeScientificScene(input)
    : normalizeVisiomasterScene(input);

  logger.info("规范化导入场景完成", {
    nodes: scene.nodes.length,
    edges: scene.edges.length
  });
  return scene;
}

function normalizeScientificScene(input: AnyRecord): Scene {
  /*
   * ========================================================================
   * 步骤1：规范化当前协议
   * ========================================================================
   * 目标：
   *   1) 补齐 edges 字段
   *   2) 保留已有节点结构
   */
  logger.info("开始规范化当前协议...");

  // 1.1 读取基础字段
  const scene = input as unknown as Scene;

  // 1.2 补齐缺省字段
  const normalized = {
    ...scene,
    edges: Array.isArray(scene.edges) ? scene.edges : []
  };
  logger.info("规范化当前协议完成", { nodes: normalized.nodes.length });
  return normalized;
}

function normalizeVisiomasterScene(input: AnyRecord): Scene {
  /*
   * ========================================================================
   * 步骤1：转换 Visiomaster 场景
   * ========================================================================
   * 目标：
   *   1) 映射 page、metadata、nodes
   *   2) 映射 edges 和端点坐标
   */
  logger.info("开始转换 Visiomaster 场景...");

  // 1.1 转换页面和元数据
  const page = asRecord(input.page);
  const metadata = asRecord(input.metadata);
  const width = pageDimension(page.width, 1280);
  const height = pageDimension(page.height, 720);

  // 1.2 转换节点和边
  const rawNodes = Array.isArray(input.nodes) ? input.nodes.filter(isRecord).slice(0, MAX_SCENE_NODES) : [];
  const idMap = new Map<string, string>();
  const usedIds = new Set<string>();
  const nodes = rawNodes.map((node, index) => {
    const rawId = stringValue(node.id, createId("node"), MAX_PROTOCOL_STRING_LENGTH);
    const id = uniqueId(stringValue(node.id, createId("node"), MAX_SCENE_ID_LENGTH), usedIds);
    idMap.set(rawId, id);
    return convertVisiomasterNode(node, id);
  });
  const rawEdges = Array.isArray(input.edges) ? input.edges.filter(isRecord).slice(0, MAX_SCENE_EDGES) : [];
  const edges = rawEdges.map((edge) => convertVisiomasterEdge(edge, nodes, idMap));

  const scene: Scene = {
    version: "0.1",
    page: {
      width,
      height,
      background: safeColor(page.background, "#FFFFFF"),
      units: "px"
    },
    metadata: {
      id: createId("scene"),
      title: stringValue(metadata.title, "Imported Visiomaster Scene", MAX_PROTOCOL_STRING_LENGTH),
      createdAt: new Date().toISOString(),
      engine: "scientific-drawing.visiomaster-adapter",
      notes: ["Imported from Visiomaster-style scene.json."]
    },
    nodes,
    edges
  };

  logger.info("转换 Visiomaster 场景完成", { nodes: nodes.length, edges: edges.length });
  return scene;
}

function convertVisiomasterNode(node: AnyRecord, id?: string): SceneNode {
  /*
   * ========================================================================
   * 步骤1：转换 Visiomaster 节点
   * ========================================================================
   * 目标：
   *   1) 把语义类型映射到编辑器图元
   *   2) 保留论文图常用参数
   */
  logger.info("开始转换 Visiomaster 节点...", { id: node.id, type: node.type });

  // 1.1 读取基础几何和样式
  const type = stringValue(node.type, "process_box");
  const style = mapStyle(asRecord(node.style));
  const base: SceneNode = {
    id: id ?? stringValue(node.id, createId("node"), MAX_SCENE_ID_LENGTH),
    type: mapNodeType(type),
    x: coordinate(node.x, 0),
    y: coordinate(node.y, 0),
    w: positiveSize(node.w, 100),
    h: nonNegativeSize(node.h, 40),
    text: stringOptional(node.text, MAX_TEXT_LENGTH),
    symbol: stringOptional(node.symbol, MAX_TEXT_LENGTH),
    rows: intOptional(node.rows),
    cols: intOptional(node.cols ?? node.columns),
    rowColors: stringArray(node.row_colors, MAX_GRID_DIMENSION),
    columnShades: numberArray(node.column_shades, MAX_GRID_DIMENSION),
    cells: cellArray(node.colored_cells ?? node.cells, node.cell_labels ?? node.labels),
    orientation: orientationValue(node.orientation),
    tickPositions: numberArray(node.tick_positions, MAX_TICK_POSITIONS),
    style
  };
  base.source = stringOptional(node.source, MAX_PROTOCOL_STRING_LENGTH);

  // 1.2 按类型补充样式
  if (base.type === "operator") {
    base.text = base.symbol || base.text || "";
  }
  if (type === "group_container" || type === "audit_region") {
    base.style.fill = base.style.fill ?? "none";
    base.style.stroke = base.style.stroke ?? "#111111";
  }

  logger.info("转换 Visiomaster 节点完成", { id: base.id, type: base.type });
  return base;
}

function convertVisiomasterEdge(edge: AnyRecord, nodes: SceneNode[], idMap: Map<string, string>): SceneEdge {
  /*
   * ========================================================================
   * 步骤1：转换 Visiomaster 连线
   * ========================================================================
   * 目标：
   *   1) 保留 from/to/points
   *   2) 把端点引用解析为坐标，方便当前 SVG 渲染
   */
  logger.info("开始转换 Visiomaster 连线...", { id: edge.id, type: edge.type });

  // 1.1 映射连线样式
  const from = endpointValue(edge.from, idMap);
  const to = endpointValue(edge.to, idMap);
  const explicitPoints = pointArray(edge.points);
  const fromPoint = pointValue(edge.from_point) ?? (from ? resolveEndpoint(from, nodes) : undefined);
  const toPoint = pointValue(edge.to_point) ?? (to ? resolveEndpoint(to, nodes) : undefined);

  // 1.2 组装连线
  const result: SceneEdge = {
    id: stringValue(edge.id, createId("edge"), MAX_SCENE_ID_LENGTH),
    type: mapEdgeType(stringValue(edge.type, "arrow_connector")),
    from,
    to,
    fromPoint,
    toPoint,
    points: explicitPoints,
    label: stringOptional(edge.label, MAX_TEXT_LENGTH),
    style: mapStyle(asRecord(edge.style))
  };

  logger.info("转换 Visiomaster 连线完成", { id: result.id, type: result.type });
  return result;
}

function mapNodeType(type: string): SceneNode["type"] {
  if (type === "text_block") {
    return "text";
  }
  if (type === "ellipse_node") {
    return "ellipse";
  }
  if (type === "operator_node") {
    return "operator";
  }
  if (type === "grid_matrix") {
    return "grid";
  }
  if (type === "feature_map_grid" || type === "feature_map_banded") {
    return "feature_grid";
  }
  if (type === "bracket") {
    return "bracket";
  }
  if (type === "image_tile") {
    return "image";
  }
  if (type === "rounded_process" || type === "terminator" || type === "text_pill" || type === "group_container") {
    return "rounded_rect";
  }
  return "rect";
}

function mapEdgeType(type: string): SceneEdge["type"] {
  if (type === "line_segment" || type === "join_connector") {
    return "line";
  }
  if (type === "fork_connector") {
    return "fork";
  }
  return "arrow";
}

function mapStyle(style: AnyRecord): SceneStyle {
  return {
    fill: optionalColor(style.fill, "#FFFFFF"),
    stroke: optionalColor(style.line ?? style.stroke, "#111111"),
    strokeWidth: numberOptional(style.line_weight_pt ?? style.strokeWidth),
    fontFamily: stringOptional(style.font_family ?? style.fontFamily, MAX_PROTOCOL_STRING_LENGTH),
    fontSize: numberOptional(style.font_size_pt ?? style.fontSize),
    fontWeight: stringOptional(style.font_weight ?? style.fontWeight, MAX_PROTOCOL_STRING_LENGTH),
    color: optionalColor(style.text_color ?? style.color, "#111111"),
    opacity: numberOptional(style.opacity),
    dash: style.line_dash === "dash" ? "7 5" : undefined
  };
}

function hasScientificShape(input: AnyRecord) {
  const nodes = input.nodes;
  if (!Array.isArray(nodes)) {
    return false;
  }
  const first = nodes.find(isRecord);
  return Boolean(first && ("style" in first) && ["rect", "text", "image", "arrow", "line"].includes(String(first.type)));
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): AnyRecord {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown, fallback: string, maxLength = MAX_PROTOCOL_STRING_LENGTH) {
  return (typeof value === "string" ? value : fallback).slice(0, maxLength);
}

function stringOptional(value: unknown, maxLength?: number) {
  if (typeof value !== "string") {
    return undefined;
  }
  return maxLength === undefined ? value : value.slice(0, maxLength);
}

function endpointValue(value: unknown, idMap: Map<string, string>) {
  if (typeof value !== "string") {
    return undefined;
  }
  const [rawId, rest] = value.split(":");
  const id = idMap.get(rawId) ?? rawId;
  return (rest ? `${id}:${rest}` : id).slice(0, MAX_PROTOCOL_STRING_LENGTH);
}

function uniqueId(baseId: string, usedIds: Set<string>) {
  let candidate = baseId;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    const suffixText = `-${suffix}`;
    const prefixLength = Math.max(1, MAX_SCENE_ID_LENGTH - suffixText.length);
    candidate = `${baseId.slice(0, prefixLength)}${suffixText}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function coordinate(value: unknown, fallback: number) {
  return clampNumber(numberValue(value, fallback), -MAX_GEOMETRY_COORDINATE, MAX_GEOMETRY_COORDINATE);
}

function positiveSize(value: unknown, fallback: number) {
  const numeric = numberValue(value, fallback);
  if (numeric <= 0) {
    return fallback;
  }
  return clampNumber(numeric, 1, MAX_NODE_SIZE);
}

function nonNegativeSize(value: unknown, fallback: number) {
  const numeric = numberValue(value, fallback);
  if (numeric < 0) {
    return fallback;
  }
  return clampNumber(numeric, 0, MAX_NODE_SIZE);
}

function pageDimension(value: unknown, fallback: number) {
  const numeric = numberValue(value, fallback);
  if (numeric <= 0) {
    return fallback;
  }
  return Math.min(MAX_PAGE_DIMENSION, Math.max(1, Math.round(numeric)));
}

function numberOptional(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function intOptional(value: unknown) {
  // 钳到 [1, MAX_GRID_DIMENSION]（与服务端 repairScene.clampGridDimension 一致）：
  // 否则前端导入(无 repair)的大网格会被 validateScene 拒绝，而服务端导入(有 repair)却接受，行为分叉。
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(MAX_GRID_DIMENSION, Math.max(1, Math.round(value)));
}

function stringArray(value: unknown, maxItems?: number) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const colors = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => safeColor(item, "#FFFFFF"));
  const result = maxItems === undefined ? colors : colors.slice(0, maxItems);
  return result.length > 0 ? result : undefined;
}

function numberArray(value: unknown, maxItems?: number) {
  const numbers = Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : undefined;
  return maxItems === undefined ? numbers : numbers?.slice(0, maxItems);
}

function pointValue(value: unknown) {
  if (!Array.isArray(value) || value.length < 2) {
    return undefined;
  }
  if (typeof value[0] !== "number" || !Number.isFinite(value[0]) || typeof value[1] !== "number" || !Number.isFinite(value[1])) {
    return undefined;
  }
  return { x: coordinate(value[0], 0), y: coordinate(value[1], 0) };
}

function pointArray(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map(pointValue)
    .filter((point): point is { x: number; y: number } => Boolean(point))
    .slice(0, MAX_POLYLINE_POINTS);
}

function cellArray(value: unknown, labels?: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const labelMap = cellLabelMap(labels);
  return value.flatMap((cell) => {
    if (Array.isArray(cell) && typeof cell[0] === "number" && Number.isFinite(cell[0]) && typeof cell[1] === "number" && Number.isFinite(cell[1])) {
      const label = labelMap.get(`${cell[0]}:${cell[1]}`);
      return [{
        row: cell[0],
        col: cell[1],
        fill: optionalColor(cell[2], "#FFFFFF"),
        text: stringOptional(cell[3], MAX_TEXT_LENGTH) ?? label?.text,
        color: optionalColor(cell[4], "#111111") ?? label?.color
      }];
    }
    if (isRecord(cell) && typeof cell.row === "number" && Number.isFinite(cell.row) && typeof cell.col === "number" && Number.isFinite(cell.col)) {
      const label = labelMap.get(`${cell.row}:${cell.col}`);
      return [{
        row: cell.row,
        col: cell.col,
        fill: optionalColor(cell.fill, "#FFFFFF"),
        text: stringOptional(cell.text ?? cell.label, MAX_TEXT_LENGTH) ?? label?.text,
        color: optionalColor(cell.color ?? cell.text_color, "#111111") ?? label?.color
      }];
    }
    return [];
  }).slice(0, MAX_GRID_CELLS);
}

function cellLabelMap(value: unknown) {
  /*
   * ========================================================================
   * 步骤1：读取单元格文字映射
   * ========================================================================
   * 目标：
   *   1) 兼容 cell_labels/labels 数组
   *   2) 给 colored_cells 补充数字和文字颜色
   */

  // 1.1 初始化映射表
  const labels = new Map<string, { text?: string; color?: string }>();
  if (!Array.isArray(value)) {
    return labels;
  }

  // 1.2 解析标签数组
  for (const item of value.slice(0, MAX_GRID_CELLS)) {
    if (Array.isArray(item) && typeof item[0] === "number" && Number.isFinite(item[0]) && typeof item[1] === "number" && Number.isFinite(item[1])) {
      labels.set(`${item[0]}:${item[1]}`, {
        text: stringOptional(item[2], MAX_TEXT_LENGTH),
        color: optionalColor(item[3], "#111111")
      });
    } else if (isRecord(item) && typeof item.row === "number" && Number.isFinite(item.row) && typeof item.col === "number" && Number.isFinite(item.col)) {
      labels.set(`${item.row}:${item.col}`, {
        text: stringOptional(item.text ?? item.label, MAX_TEXT_LENGTH),
        color: optionalColor(item.color ?? item.text_color, "#111111")
      });
    }
  }

  return labels;
}

function orientationValue(value: unknown) {
  if (value === "left" || value === "right" || value === "up" || value === "down") {
    return value;
  }
  return undefined;
}

function optionalColor(value: unknown, fallback: string) {
  if (value === undefined) {
    return undefined;
  }
  return safeColor(value, fallback);
}

function safeColor(value: unknown, fallback: string) {
  if (value === "none") {
    return "none";
  }
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = normalizeHexColor(value);
  return isNormalizedHexColor(normalized) ? normalized : fallback;
}
