import { logger } from "../lib/logger";
import { createId } from "../lib/id";
import { resolveEndpoint } from "../shared/geometry";
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
  const width = numberValue(page.width, 1280);
  const height = numberValue(page.height, 720);

  // 1.2 转换节点和边
  const rawNodes = Array.isArray(input.nodes) ? input.nodes.filter(isRecord) : [];
  const nodes = rawNodes.map(convertVisiomasterNode);
  const rawEdges = Array.isArray(input.edges) ? input.edges.filter(isRecord) : [];
  const edges = rawEdges.map((edge) => convertVisiomasterEdge(edge, nodes));

  const scene: Scene = {
    version: "0.1",
    page: {
      width,
      height,
      background: stringValue(page.background, "#FFFFFF"),
      units: "px"
    },
    metadata: {
      id: createId("scene"),
      title: stringValue(metadata.title, "Imported Visiomaster Scene"),
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

function convertVisiomasterNode(node: AnyRecord): SceneNode {
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
    id: stringValue(node.id, createId("node")),
    type: mapNodeType(type),
    x: numberValue(node.x, 0),
    y: numberValue(node.y, 0),
    w: numberValue(node.w, 100),
    h: numberValue(node.h, 40),
    text: stringOptional(node.text),
    symbol: stringOptional(node.symbol),
    rows: intOptional(node.rows),
    cols: intOptional(node.cols ?? node.columns),
    rowColors: stringArray(node.row_colors),
    columnShades: numberArray(node.column_shades),
    cells: cellArray(node.colored_cells ?? node.cells, node.cell_labels ?? node.labels),
    orientation: orientationValue(node.orientation),
    tickPositions: numberArray(node.tick_positions),
    style
  };

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

function convertVisiomasterEdge(edge: AnyRecord, nodes: SceneNode[]): SceneEdge {
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
  const from = stringOptional(edge.from);
  const to = stringOptional(edge.to);
  const explicitPoints = pointArray(edge.points);
  const fromPoint = pointValue(edge.from_point) ?? (from ? resolveEndpoint(from, nodes) : undefined);
  const toPoint = pointValue(edge.to_point) ?? (to ? resolveEndpoint(to, nodes) : undefined);

  // 1.2 组装连线
  const result: SceneEdge = {
    id: stringValue(edge.id, createId("edge")),
    type: mapEdgeType(stringValue(edge.type, "arrow_connector")),
    from,
    to,
    fromPoint,
    toPoint,
    points: explicitPoints,
    label: stringOptional(edge.label),
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

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function numberArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : undefined;
}

function pointValue(value: unknown) {
  if (!Array.isArray(value) || value.length < 2) {
    return undefined;
  }
  if (typeof value[0] !== "number" || typeof value[1] !== "number") {
    return undefined;
  }
  return { x: value[0], y: value[1] };
}

function pointArray(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map(pointValue)
    .filter((point): point is { x: number; y: number } => Boolean(point));
}

function cellArray(value: unknown, labels?: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
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
  });
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
  for (const item of value) {
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
  if (value === "left" || value === "right" || value === "up" || value === "down") {
    return value;
  }
  return undefined;
}
