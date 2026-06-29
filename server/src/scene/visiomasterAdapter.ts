import { resolveEndpoint } from "@shared/geometry";
import { MAX_GRID_CELLS, MAX_GRID_DIMENSION, MAX_POLYLINE_POINTS, MAX_SCENE_EDGES, MAX_SCENE_NODES, MAX_TICK_POSITIONS } from "@shared/sceneValidation";
import type { Scene, SceneEdge, SceneNode, SceneStyle } from "./types";

type AnyRecord = Record<string, unknown>;

export function normalizeImportedScene(input: unknown): Scene {
  /*
   * ========================================================================
   * 步骤1：规范化导入场景
   * ========================================================================
   * 目标：
   *   1) 接收 Visiomaster 风格 scene
   *   2) 转换为项目内部 scene 协议
   */
  if (!isRecord(input)) {
    throw new Error("Scene JSON must be an object.");
  }
  if (hasScientificShape(input)) {
    const scene = input as unknown as Scene;
    return { ...scene, edges: Array.isArray(scene.edges) ? scene.edges : [] };
  }
  return normalizeVisiomasterScene(input);
}

function normalizeVisiomasterScene(input: AnyRecord): Scene {
  /*
   * ========================================================================
   * 步骤1：转换 Visiomaster 场景
   * ========================================================================
   * 目标：
   *   1) 映射页面和节点
   *   2) 映射边和端点
   */
  const page = asRecord(input.page);
  const metadata = asRecord(input.metadata);
  const rawNodes = Array.isArray(input.nodes) ? input.nodes.filter(isRecord).slice(0, MAX_SCENE_NODES) : [];
  const nodes = rawNodes.map(convertNode);
  const rawEdges = Array.isArray(input.edges) ? input.edges.filter(isRecord).slice(0, MAX_SCENE_EDGES) : [];
  const edges = rawEdges.map((edge) => convertEdge(edge, nodes));
  return {
    version: "0.1",
    page: {
      width: numberValue(page.width, 1280),
      height: numberValue(page.height, 720),
      background: stringValue(page.background, "#FFFFFF"),
      units: "px"
    },
    metadata: {
      id: randomId("scene"),
      title: stringValue(metadata.title, "AI Reconstruction"),
      createdAt: new Date().toISOString(),
      engine: "scientific-drawing.openai-reconstruction",
      notes: ["Generated from Visiomaster-style AI scene."]
    },
    nodes,
    edges
  };
}

function convertNode(node: AnyRecord): SceneNode {
  /*
   * ========================================================================
   * 步骤1：转换节点
   * ========================================================================
   * 目标：
   *   1) 保留几何信息
   *   2) 映射论文图组件
   */
  const type = stringValue(node.type, "process_box");
  const style = mapStyle(asRecord(node.style));
  const result: SceneNode = {
    id: stringValue(node.id, randomId("node")),
    type: mapNodeType(type),
    x: numberValue(node.x, 0),
    y: numberValue(node.y, 0),
    w: numberValue(node.w, 100),
    h: numberValue(node.h, 40),
    text: stringOptional(node.text),
    symbol: stringOptional(node.symbol),
    rows: intOptional(node.rows),
    cols: intOptional(node.cols ?? node.columns),
    rowColors: stringArray(node.row_colors, MAX_GRID_DIMENSION),
    columnShades: numberArray(node.column_shades, MAX_GRID_DIMENSION),
    cells: cellArray(node.colored_cells ?? node.cells, node.cell_labels ?? node.labels),
    orientation: orientationValue(node.orientation),
    tickPositions: numberArray(node.tick_positions, MAX_TICK_POSITIONS),
    style
  };
  if (result.type === "operator") {
    result.text = result.symbol || result.text || "";
  }
  if (type === "group_container" || type === "audit_region") {
    result.style.fill = result.style.fill ?? "none";
    result.style.stroke = result.style.stroke ?? "#111111";
  }
  return result;
}

function convertEdge(edge: AnyRecord, nodes: SceneNode[]): SceneEdge {
  /*
   * ========================================================================
   * 步骤1：转换边
   * ========================================================================
   * 目标：
   *   1) 保留连接关系
   *   2) 解析端点坐标
   */
  const from = stringOptional(edge.from);
  const to = stringOptional(edge.to);
  return {
    id: stringValue(edge.id, randomId("edge")),
    type: mapEdgeType(stringValue(edge.type, "arrow_connector")),
    from,
    to,
    fromPoint: pointValue(edge.from_point) ?? (from ? resolveEndpoint(from, nodes) : undefined),
    toPoint: pointValue(edge.to_point) ?? (to ? resolveEndpoint(to, nodes) : undefined),
    points: pointArray(edge.points),
    label: stringOptional(edge.label),
    style: mapStyle(asRecord(edge.style))
  };
}

function mapNodeType(type: string): SceneNode["type"] {
  if (type === "text_block") return "text";
  if (type === "ellipse_node") return "ellipse";
  if (type === "operator_node") return "operator";
  if (type === "grid_matrix") return "grid";
  if (type === "feature_map_grid" || type === "feature_map_banded") return "feature_grid";
  if (type === "bracket") return "bracket";
  if (type === "image_tile") return "image";
  if (["rounded_process", "terminator", "text_pill", "group_container"].includes(type)) return "rounded_rect";
  return "rect";
}

function mapEdgeType(type: string): SceneEdge["type"] {
  if (type === "line_segment" || type === "join_connector") return "line";
  if (type === "fork_connector") return "fork";
  return "arrow";
}

function mapStyle(style: AnyRecord): SceneStyle {
  return {
    fill: stringOptional(style.fill),
    stroke: stringOptional(style.line ?? style.stroke),
    strokeWidth: numberOptional(style.line_weight_pt ?? style.strokeWidth),
    fontFamily: stringOptional(style.font_family ?? style.fontFamily),
    fontSize: numberOptional(style.font_size_pt ?? style.fontSize),
    fontWeight: stringOptional(style.font_weight ?? style.fontWeight),
    color: stringOptional(style.text_color ?? style.color),
    opacity: numberOptional(style.opacity),
    dash: style.line_dash === "dash" ? "7 5" : undefined
  };
}

function hasScientificShape(input: AnyRecord) {
  const nodes = input.nodes;
  if (!Array.isArray(nodes)) return false;
  const first = nodes.find(isRecord);
  return Boolean(first && "style" in first && ["rect", "text", "image", "arrow", "line"].includes(String(first.type)));
}

function randomId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): AnyRecord {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function stringOptional(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" ? value : fallback;
}

function numberOptional(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function intOptional(value: unknown) {
  return typeof value === "number" ? Math.max(1, Math.round(value)) : undefined;
}

function stringArray(value: unknown, maxItems?: number) {
  const strings = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
  return maxItems === undefined ? strings : strings?.slice(0, maxItems);
}

function numberArray(value: unknown, maxItems?: number) {
  const numbers = Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : undefined;
  return maxItems === undefined ? numbers : numbers?.slice(0, maxItems);
}

function pointValue(value: unknown) {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  if (typeof value[0] !== "number" || typeof value[1] !== "number") return undefined;
  return { x: value[0], y: value[1] };
}

function pointArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value
    .map(pointValue)
    .filter((point): point is { x: number; y: number } => Boolean(point))
    .slice(0, MAX_POLYLINE_POINTS);
}

function cellArray(value: unknown, labels?: unknown) {
  if (!Array.isArray(value)) return undefined;
  const labelMap = cellLabelMap(labels);
  return value.flatMap((cell) => {
    if (Array.isArray(cell) && typeof cell[0] === "number" && typeof cell[1] === "number") {
      const label = labelMap.get(`${cell[0]}:${cell[1]}`);
      return [{
        row: cell[0],
        col: cell[1],
        fill: stringOptional(cell[2]),
        text: stringOptional(cell[3]) ?? label?.text,
        color: stringOptional(cell[4]) ?? label?.color
      }];
    }
    if (isRecord(cell) && typeof cell.row === "number" && typeof cell.col === "number") {
      const label = labelMap.get(`${cell.row}:${cell.col}`);
      return [{
        row: cell.row,
        col: cell.col,
        fill: stringOptional(cell.fill),
        text: stringOptional(cell.text ?? cell.label) ?? label?.text,
        color: stringOptional(cell.color ?? cell.text_color) ?? label?.color
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
    if (Array.isArray(item) && typeof item[0] === "number" && typeof item[1] === "number") {
      labels.set(`${item[0]}:${item[1]}`, {
        text: stringOptional(item[2]),
        color: stringOptional(item[3])
      });
    } else if (isRecord(item) && typeof item.row === "number" && typeof item.col === "number") {
      labels.set(`${item.row}:${item.col}`, {
        text: stringOptional(item.text ?? item.label),
        color: stringOptional(item.color ?? item.text_color)
      });
    }
  }

  return labels;
}

function orientationValue(value: unknown) {
  if (value === "left" || value === "right" || value === "up" || value === "down") return value;
  return undefined;
}
