import { normalizeHexColor } from "../../../src/shared/geometry";
import type { Scene, SceneEdge, SceneEdgeType, SceneNode, SceneNodeType, SceneStyle } from "./types";

const NODE_TYPES = new Set<SceneNodeType>([
  "text",
  "rect",
  "rounded_rect",
  "ellipse",
  "line",
  "arrow",
  "image",
  "grid",
  "feature_grid",
  "bracket",
  "operator"
]);

const EDGE_TYPES = new Set<SceneEdgeType>(["arrow", "line", "join", "fork"]);

export function repairScene(scene: Scene): Scene {
  /*
   * ========================================================================
   * 步骤1：修复 scene 结构
   * ========================================================================
   * 目标：
   *   1) 把 AI 和导入结果收敛到内部协议
   *   2) 删除无法可靠渲染的边和节点异常字段
   */

  // 1.1 修复页面和元数据
  const next: Scene = {
    version: "0.1",
    page: {
      width: positive(scene.page?.width, 1280),
      height: positive(scene.page?.height, 720),
      background: safeColor(scene.page?.background, "#FFFFFF"),
      units: "px"
    },
    metadata: {
      id: nonEmpty(scene.metadata?.id, "repaired-scene"),
      title: typeof scene.metadata?.title === "string" ? scene.metadata.title : "Scientific Figure",
      sourceImage: scene.metadata?.sourceImage,
      createdAt: nonEmpty(scene.metadata?.createdAt, new Date().toISOString()),
      engine: nonEmpty(scene.metadata?.engine, "scientific-drawing.repair"),
      notes: Array.isArray(scene.metadata?.notes) ? scene.metadata.notes.filter((item): item is string => typeof item === "string") : []
    },
    nodes: [],
    edges: []
  };

  // 1.2 修复节点和边
  const idMap = new Map<string, string>();
  next.nodes = Array.isArray(scene.nodes) ? scene.nodes.map((node, index) => repairNode(node, index, idMap)) : [];
  next.edges = Array.isArray(scene.edges)
    ? scene.edges
      .map((edge, index) => repairEdge(edge, index, idMap, next.nodes))
      .filter((edge): edge is SceneEdge => Boolean(edge))
    : [];

  return next;
}

function repairNode(node: SceneNode, index: number, idMap: Map<string, string>): SceneNode {
  /*
   * ========================================================================
   * 步骤1：修复节点
   * ========================================================================
   * 目标：
   *   1) 生成唯一 id 和合法类型
   *   2) 修复几何、样式和点数组
   */

  // 1.1 修复 id、类型和几何
  const originalId = nonEmpty(node.id, `node-${index + 1}`);
  const id = uniqueId(originalId, idMap);
  const type = NODE_TYPES.has(node.type) ? node.type : "rect";
  const repaired: SceneNode = {
    ...node,
    id,
    type,
    x: finite(node.x, 0),
    y: finite(node.y, 0),
    w: positive(Math.abs(finite(node.w, 100)), 1),
    h: nonNegative(Math.abs(finite(node.h, 40)), type === "line" || type === "arrow" ? 0 : 1),
    style: repairStyle(node.style)
  };

  // 1.2 修复附属字段
  if (node.points !== undefined) {
    repaired.points = node.points
      .filter((point) => typeof point?.x === "number" && typeof point?.y === "number")
      .map((point) => ({ x: finite(point.x, repaired.x), y: finite(point.y, repaired.y) }));
  }
  if (node.cells !== undefined) {
    repaired.cells = node.cells.flatMap((cell) => {
      if (!Number.isInteger(cell.row) || !Number.isInteger(cell.col) || cell.row < 0 || cell.col < 0) {
        return [];
      }
      return [{
        ...cell,
        fill: cell.fill === undefined ? undefined : safeColor(cell.fill, "#FFFFFF"),
        color: cell.color === undefined ? undefined : safeColor(cell.color, "#111111")
      }];
    });
  }
  return repaired;
}

function repairEdge(edge: SceneEdge, index: number, idMap: Map<string, string>, nodes: SceneNode[]): SceneEdge | undefined {
  /*
   * ========================================================================
   * 步骤1：修复连线
   * ========================================================================
   * 目标：
   *   1) 重写已修复节点 id 的端点引用
   *   2) 删除引用缺失节点的边
   */

  // 1.1 修复端点引用
  const nodeIds = new Set(nodes.map((node) => node.id));
  const from = repairEndpoint(edge.from, idMap);
  const to = repairEndpoint(edge.to, idMap);
  if ((edge.from && !from) || (edge.to && !to)) {
    return undefined;
  }
  if (from && !nodeIds.has(from.split(":")[0])) {
    return undefined;
  }
  if (to && !nodeIds.has(to.split(":")[0])) {
    return undefined;
  }

  // 1.2 返回修复后的边
  return {
    ...edge,
    id: nonEmpty(edge.id, `edge-${index + 1}`),
    type: EDGE_TYPES.has(edge.type) ? edge.type : "arrow",
    from,
    to,
    fromPoint: repairPoint(edge.fromPoint),
    toPoint: repairPoint(edge.toPoint),
    points: edge.points?.map(repairPoint).filter((point): point is { x: number; y: number } => Boolean(point)),
    style: repairStyle(edge.style)
  };
}

function repairStyle(style: SceneStyle | undefined): SceneStyle {
  /*
   * ========================================================================
   * 步骤1：修复样式
   * ========================================================================
   * 目标：
   *   1) 修复颜色、线宽、字号和透明度
   *   2) 保留字体和虚线等可用字段
   */

  // 1.1 读取原始样式
  const source = style ?? {};

  // 1.2 返回合法样式
  return {
    fill: source.fill === undefined ? undefined : safeColor(source.fill, "#FFFFFF"),
    stroke: source.stroke === undefined ? undefined : safeColor(source.stroke, "#111111"),
    strokeWidth: nonNegative(source.strokeWidth, 1),
    fontFamily: source.fontFamily,
    fontSize: positive(source.fontSize, 16),
    fontWeight: source.fontWeight,
    color: source.color === undefined ? undefined : safeColor(source.color, "#111111"),
    opacity: clamp01(source.opacity),
    dash: source.dash
  };
}

function repairEndpoint(endpoint: string | undefined, idMap: Map<string, string>) {
  if (!endpoint) {
    return endpoint;
  }
  const [id, rest] = endpoint.split(":");
  const mapped = idMap.get(id);
  if (!mapped) {
    return undefined;
  }
  return rest ? `${mapped}:${rest}` : mapped;
}

function repairPoint(point: { x: number; y: number } | undefined) {
  if (!point) {
    return undefined;
  }
  return { x: finite(point.x, 0), y: finite(point.y, 0) };
}

function uniqueId(originalId: string, idMap: Map<string, string>) {
  const used = new Set(idMap.values());
  let candidate = originalId;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${originalId}-${suffix}`;
    suffix += 1;
  }
  if (!idMap.has(originalId)) {
    idMap.set(originalId, candidate);
  }
  return candidate;
}

function safeColor(value: unknown, fallback: string) {
  if (value === "none") {
    return "none";
  }
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = normalizeHexColor(value);
  return normalized === value.toUpperCase() ? normalized : fallback;
}

function nonEmpty(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positive(value: unknown, fallback: number) {
  const numberValue = finite(value, fallback);
  return numberValue > 0 ? numberValue : fallback;
}

function nonNegative(value: unknown, fallback: number) {
  const numberValue = finite(value, fallback);
  return numberValue >= 0 ? numberValue : fallback;
}

function clamp01(value: unknown) {
  const numberValue = finite(value, 1);
  return Math.max(0, Math.min(1, numberValue));
}
