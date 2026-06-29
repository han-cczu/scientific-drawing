import { clampNumber, isNormalizedHexColor, normalizeHexColor } from "@shared/geometry";
import { MAX_GRID_CELLS, MAX_GRID_DIMENSION } from "@shared/sceneValidation";
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
  //   idMap：原始 id → 首个分配 id（供边端点重写）；usedIds：所有已分配 id（保证唯一）
  const idMap = new Map<string, string>();
  const usedIds = new Set<string>();
  const edgeUsedIds = new Set<string>();
  next.nodes = Array.isArray(scene.nodes) ? scene.nodes.map((node, index) => repairNode(node, index, idMap, usedIds)) : [];
  next.edges = Array.isArray(scene.edges)
    ? scene.edges
      .map((edge, index) => repairEdge(edge, index, idMap, next.nodes, edgeUsedIds))
      .filter((edge): edge is SceneEdge => Boolean(edge))
    : [];

  return next;
}

function repairNode(node: SceneNode, index: number, idMap: Map<string, string>, usedIds: Set<string>): SceneNode {
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
  const id = uniqueId(originalId, idMap, usedIds);
  const type = NODE_TYPES.has(node.type) ? node.type : "rect";
  const repaired: SceneNode = {
    ...node,
    id,
    type,
    x: finite(node.x, 0),
    y: finite(node.y, 0),
    w: positive(Math.abs(finite(node.w, 100)), 1),
    h: nonNegative(Math.abs(finite(node.h, 40)), type === "line" || type === "arrow" ? 0 : 1),
    style: repairStyle(node.style),
    text: optionalString(node.text),
    source: optionalString(node.source),
    symbol: optionalString(node.symbol),
    orientation: repairOrientation(node.orientation),
    locked: typeof node.locked === "boolean" ? node.locked : undefined,
    hidden: typeof node.hidden === "boolean" ? node.hidden : undefined
  };

  // 1.2 修复附属字段
  //   非数组的 points/cells（畸形 AI 输出）一律清空，避免经 ...node 展开后残留导致下游渲染崩溃
  repaired.points = Array.isArray(node.points)
    ? node.points
      .filter((point) => typeof point?.x === "number" && typeof point?.y === "number")
      .map((point) => ({ x: finite(point.x, repaired.x), y: finite(point.y, repaired.y) }))
    : undefined;
  //   cells 长度同样钳到 MAX_GRID_CELLS：否则超长（仍合法的）cells 经 repair 后
  //   会被 validateScene 的 too_many_grid_cells 拒绝，把可恢复输入变成 500
  repaired.cells = Array.isArray(node.cells)
    ? node.cells.flatMap((cell) => {
      if (!cell || !Number.isInteger(cell.row) || !Number.isInteger(cell.col) || cell.row < 0 || cell.col < 0) {
        return [];
      }
      return [{
        ...cell,
        fill: cell.fill === undefined ? undefined : safeColor(cell.fill, "#FFFFFF"),
        text: optionalString(cell.text),
        color: cell.color === undefined ? undefined : safeColor(cell.color, "#111111")
      }];
    }).slice(0, MAX_GRID_CELLS)
    : undefined;
  repaired.rowColors = Array.isArray(node.rowColors)
    ? node.rowColors.flatMap((color) => typeof color === "string" ? [safeColor(color, "#FFFFFF")] : [])
    : undefined;
  repaired.columnShades = Array.isArray(node.columnShades)
    ? node.columnShades.filter((shade): shade is number => typeof shade === "number" && Number.isFinite(shade))
    : undefined;
  repaired.tickPositions = Array.isArray(node.tickPositions)
    ? node.tickPositions.filter((tick): tick is number => typeof tick === "number" && Number.isFinite(tick))
    : undefined;

  // 1.3 钳制网格维度，避免畸形 AI 输出（如 rows=100000）生成海量单元格
  //   只要字段存在就钳制（含字符串/null 等非数字形态），否则畸形值会经
  //   ...node 展开原样保留，导致 repair 后反被 validateScene 拒绝返回 500
  if (node.rows !== undefined) {
    repaired.rows = clampGridDimension(node.rows);
  }
  if (node.cols !== undefined) {
    repaired.cols = clampGridDimension(node.cols);
  }
  return repaired;
}

function repairEdge(edge: SceneEdge, index: number, idMap: Map<string, string>, nodes: SceneNode[], usedIds: Set<string>): SceneEdge | undefined {
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
  const originalId = nonEmpty(edge.id, `edge-${index + 1}`);
  return {
    ...edge,
    id: uniqueStandaloneId(originalId, usedIds),
    type: EDGE_TYPES.has(edge.type) ? edge.type : "arrow",
    from,
    to,
    fromPoint: repairPoint(edge.fromPoint),
    toPoint: repairPoint(edge.toPoint),
    points: Array.isArray(edge.points)
      ? edge.points.map(repairPoint).filter((point): point is { x: number; y: number } => Boolean(point))
      : undefined,
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
    fontFamily: optionalString(source.fontFamily),
    fontSize: positive(source.fontSize, 16),
    fontWeight: optionalString(source.fontWeight),
    color: source.color === undefined ? undefined : safeColor(source.color, "#111111"),
    opacity: clamp01(source.opacity),
    dash: optionalString(source.dash)
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

function repairPoint(point: unknown) {
  if (!point || typeof point !== "object") {
    return undefined;
  }
  const candidate = point as { x?: unknown; y?: unknown };
  if (typeof candidate.x !== "number" || typeof candidate.y !== "number") {
    return undefined;
  }
  return { x: finite(candidate.x, 0), y: finite(candidate.y, 0) };
}

function uniqueId(originalId: string, idMap: Map<string, string>, usedIds: Set<string>) {
  // usedIds 累积所有已分配 id（含重复原始 id 的后缀变体），保证 ≥3 次碰撞也能产出唯一 id；
  // 旧实现每次从 idMap.values() 重建集合，既漏记后缀变体（导致重复 id）又是 O(n²)。
  let candidate = originalId;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${originalId}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  // idMap 仅保留每个原始 id 的首个映射，供边端点重写复用首个落点
  if (!idMap.has(originalId)) {
    idMap.set(originalId, candidate);
  }
  return candidate;
}

function uniqueStandaloneId(originalId: string, usedIds: Set<string>) {
  let candidate = originalId;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${originalId}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
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
  return isNormalizedHexColor(normalized) ? normalized : fallback;
}

function nonEmpty(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function repairOrientation(value: unknown) {
  return value === "left" || value === "right" || value === "up" || value === "down" ? value : undefined;
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

function clampGridDimension(value: unknown) {
  // 数字字符串（如 "6"）先转数保留原意，其余非数字回退 1
  const numeric = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return clampNumber(Math.round(finite(numeric, 1)), 1, MAX_GRID_DIMENSION);
}
