import { logger } from "../lib/logger";
import { createId } from "../lib/id";
import { clampNumber, endpointReferencesNode, isNormalizedHexColor, normalizeHexColor } from "../shared/geometry";
import type { Scene, SceneEdge, SceneNode, SceneNodeType, SceneStyle } from "../shared/scene";
import {
  MAX_GEOMETRY_COORDINATE,
  MAX_NODE_SIZE,
  MAX_PROTOCOL_STRING_LENGTH,
  MAX_STYLE_FONT_SIZE,
  MAX_STYLE_STROKE_WIDTH,
  MAX_TEXT_LENGTH
} from "../shared/sceneValidation";

export type SceneBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ResizeHandle =
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw"
  | "line-start"
  | "line-end";

const MIN_NODE_SIZE = 8;
export type LayerMoveDirection = "front" | "back" | "forward" | "backward";

export function createBlankScene(): Scene {
  logger.info("开始创建空白场景...");

  // 1.1 创建 scene 对象
  const scene: Scene = {
    version: "0.1",
    page: {
      width: 1280,
      height: 720,
      background: "#FFFFFF",
      units: "px"
    },
    metadata: {
      id: createId("scene"),
      title: "Scientific Figure",
      createdAt: new Date().toISOString(),
      engine: "scientific-drawing.editor",
      notes: []
    },
    nodes: [],
    edges: []
  };

  logger.info("创建空白场景完成", { id: scene.metadata.id });
  return scene;
}

export function createNode(type: SceneNodeType, x: number, y: number): SceneNode {
  logger.info("开始创建编辑节点...", { type, x, y });

  // 1.1 创建节点基础字段
  const base: SceneNode = {
    id: createId(type),
    type,
    x,
    y,
    w: type === "text" ? 140 : 160,
    h: type === "text" ? 34 : 86,
    style: {
      fill: type === "text" || type === "line" || type === "arrow" ? "none" : "#FFFFFF",
      stroke: type === "text" ? "none" : "#111111",
      strokeWidth: 1.4,
      color: "#111111",
      fontFamily: "Times New Roman",
      fontSize: 16,
      opacity: 1
    }
  };

  // 1.2 补充类型专属字段
  if (type === "text") {
    base.text = "Text";
  }
  if (type === "line" || type === "arrow") {
    base.w = 180;
    base.h = 0;
    base.points = [
      { x, y },
      { x: x + 180, y }
    ];
  }

  logger.info("创建编辑节点完成", { id: base.id });
  return base;
}

export function updateNode(scene: Scene, nodeId: string, patch: Partial<SceneNode>): Scene {
  logger.info("开始更新节点...", { nodeId });

  // 1.1 替换目标节点
  const nodes = scene.nodes.map((node) => node.id === nodeId ? sanitizeNode({ ...node, ...patch }) : node);

  // 1.2 返回新场景
  const next = { ...scene, nodes };
  logger.info("更新节点完成", { nodeId });
  return next;
}

export function updateNodeStyle(scene: Scene, nodeId: string, patch: SceneNode["style"]): Scene {
  logger.info("开始更新节点样式...", { nodeId });

  // 1.1 合并样式
  const nodes = scene.nodes.map((node) => node.id === nodeId
    ? sanitizeNode({ ...node, style: sanitizeStyle({ ...node.style, ...patch }) })
    : node);

  // 1.2 返回新场景
  const next = { ...scene, nodes };
  logger.info("更新节点样式完成", { nodeId });
  return next;
}

export function moveNodes(scene: Scene, nodeIds: string[], dx: number, dy: number): Scene {
  logger.info("开始批量移动节点...", { count: nodeIds.length, dx, dy });

  // 1.1 准备待移动节点集合
  const idSet = new Set(nodeIds);

  // 1.2 生成移动后的节点列表
  const nodes = scene.nodes.map((node) => {
    if (!idSet.has(node.id) || node.locked || node.hidden) {
      return node;
    }
    const moved: SceneNode = {
      ...node,
      x: coordinate(node.x + dx),
      y: coordinate(node.y + dy)
    };
    if (node.points?.length) {
      moved.points = node.points.map((point) => ({ x: coordinate(point.x + dx), y: coordinate(point.y + dy) }));
    }
    return sanitizeNode(moved);
  });

  logger.info("批量移动节点完成", { count: nodeIds.length });
  return { ...scene, nodes };
}

export function resizeNode(scene: Scene, nodeId: string, nextBox: SceneBox): Scene {
  logger.info("开始调整节点尺寸...", { nodeId });

  // 1.1 归一化目标盒子
  const box = normalizeBox(nextBox);
  const clamped = {
    x: coordinate(box.x),
    y: coordinate(box.y),
    w: positiveSize(Math.max(MIN_NODE_SIZE, box.w)),
    h: nonNegativeSize(Math.max(MIN_NODE_SIZE, box.h))
  };

  // 1.2 更新目标节点
  const nodes = scene.nodes.map((node) => {
    if (node.id !== nodeId || node.locked || node.hidden) {
      return node;
    }
    return sanitizeNode({ ...node, ...clamped });
  });

  logger.info("调整节点尺寸完成", { nodeId, width: clamped.w, height: clamped.h });
  return { ...scene, nodes };
}

export function resizeNodeFromHandle(scene: Scene, nodeId: string, handle: ResizeHandle, startBox: SceneBox, dx: number, dy: number): Scene {
  logger.info("开始按手柄调整节点...", { nodeId, handle, dx, dy });

  // 1.1 查找目标节点
  const node = scene.nodes.find((item) => item.id === nodeId);
  if (!node || node.locked || node.hidden) {
    logger.warn("按手柄调整节点失败，节点不存在或已锁定", { nodeId });
    return scene;
  }

  // 1.2 处理线条端点手柄
  if ((node.type === "line" || node.type === "arrow") && (handle === "line-start" || handle === "line-end")) {
    const points = resizeLinePoints(node, handle, dx, dy);
    const box = boxFromPoints(points);
    const nodes = scene.nodes.map((item) => item.id === nodeId ? sanitizeNode({ ...item, ...box, points }) : item);
    logger.info("按手柄调整节点完成", { nodeId, handle });
    return { ...scene, nodes };
  }

  // 1.3 处理形状方向手柄
  const nextBox = boxFromHandle(startBox, handle, dx, dy);
  const next = resizeNode(scene, nodeId, nextBox);
  logger.info("按手柄调整节点完成", { nodeId, handle });
  return next;
}

export function selectNodesInRect(scene: Scene, rect: SceneBox): string[] {
  logger.info("开始框选节点...");

  // 1.1 归一化选择区域
  const selection = normalizeBox(rect);

  // 1.2 返回相交节点 id
  const ids = scene.nodes
    .filter((node) => !node.locked && !node.hidden && boxesIntersect(selection, nodeBox(node)))
    .map((node) => node.id);

  logger.info("框选节点完成", { count: ids.length });
  return ids;
}

export function createEdgeBetweenNodes(scene: Scene, fromNodeId: string, toNodeId: string): Scene {
  logger.info("开始创建语义连线...", { fromNodeId, toNodeId });

  // 1.1 校验起止节点
  const from = scene.nodes.find((node) => node.id === fromNodeId);
  const to = scene.nodes.find((node) => node.id === toNodeId);
  if (!from || !to || from.id === to.id || from.hidden || to.hidden) {
    logger.warn("创建语义连线失败，节点无效", { fromNodeId, toNodeId });
    return scene;
  }

  // 1.2 追加语义连线
  const edge: SceneEdge = {
    id: createId("edge"),
    type: "arrow",
    from: `${from.id}:right@0.5`,
    to: `${to.id}:left@0.5`,
    style: {
      stroke: "#111111",
      strokeWidth: 1.4,
      opacity: 1
    }
  };

  logger.info("创建语义连线完成", { edgeId: edge.id });
  return { ...scene, edges: [...scene.edges, edge] };
}

export function normalizeBox(box: SceneBox): SceneBox {
  logger.info("开始归一化矩形盒子...", box);

  // 1.1 计算正向坐标
  const x = box.w < 0 ? box.x + box.w : box.x;
  const y = box.h < 0 ? box.y + box.h : box.y;
  const normalized = {
    x,
    y,
    w: Math.abs(box.w),
    h: Math.abs(box.h)
  };

  logger.info("归一化矩形盒子完成", normalized);
  return normalized;
}

export function removeNode(scene: Scene, nodeId: string): Scene {
  logger.info("开始删除节点...", { nodeId });

  // 1.1 过滤节点
  const nodes = scene.nodes.filter((node) => node.id !== nodeId);

  // 1.2 清理悬空连线
  const edges = scene.edges.filter((edge) => !endpointReferencesNode(edge.from, nodeId) && !endpointReferencesNode(edge.to, nodeId));

  // 1.3 返回新场景
  const next = { ...scene, nodes, edges };
  logger.info("删除节点完成", { nodeId, removedEdges: scene.edges.length - edges.length });
  return next;
}

export function duplicateNode(scene: Scene, nodeId: string): SceneNode | null {
  logger.info("开始复制节点...", { nodeId });

  // 1.1 查找源节点
  const source = scene.nodes.find((node) => node.id === nodeId);
  if (!source || source.hidden) {
    logger.warn("复制节点失败，节点不存在", { nodeId });
    return null;
  }

  // 1.2 创建副本
  //   深拷贝所有可变嵌套字段：否则副本与源节点共享 style/cells 等引用，
  //   后续任一处就地修改会污染另一个（其余 ...source 透传的是不可变原始值）
  const copy: SceneNode = {
    ...source,
    id: createId(source.type),
    x: source.x + 18,
    y: source.y + 18,
    locked: false,
    style: { ...source.style },
    points: source.points?.map((point) => ({ x: coordinate(point.x + 18), y: coordinate(point.y + 18) })),
    cells: source.cells?.map((cell) => ({ ...cell })),
    rowColors: source.rowColors ? [...source.rowColors] : undefined,
    columnShades: source.columnShades ? [...source.columnShades] : undefined,
    tickPositions: source.tickPositions ? [...source.tickPositions] : undefined
  };

  logger.info("复制节点完成", { nodeId, copyId: copy.id });
  return sanitizeNode(copy);
}

export function setNodeHidden(scene: Scene, nodeId: string, hidden: boolean): Scene {
  logger.info("开始设置节点可见性...", { nodeId, hidden });

  // 1.1 更新节点 hidden 字段
  const nodes = scene.nodes.map((node) => node.id === nodeId ? { ...node, hidden } : node);

  // 1.2 返回新场景
  const next = { ...scene, nodes };
  logger.info("设置节点可见性完成", { nodeId, hidden });
  return next;
}

export function setNodeLocked(scene: Scene, nodeId: string, locked: boolean): Scene {
  logger.info("开始设置节点锁定状态...", { nodeId, locked });

  // 1.1 更新节点 locked 字段
  const nodes = scene.nodes.map((node) => node.id === nodeId ? { ...node, locked } : node);

  // 1.2 返回新场景
  const next = { ...scene, nodes };
  logger.info("设置节点锁定状态完成", { nodeId, locked });
  return next;
}

export function moveNodeLayer(scene: Scene, nodeId: string, direction: LayerMoveDirection): Scene {
  logger.info("开始调整节点图层顺序...", { nodeId, direction });

  // 1.1 查找节点位置
  const index = scene.nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) {
    logger.warn("调整节点图层顺序失败，节点不存在", { nodeId });
    return scene;
  }
  const targetNode = scene.nodes[index];
  if (isLockedImageLayer(targetNode)) {
    logger.info("调整节点图层顺序完成，锁定底图保持最底层", { nodeId });
    return scene;
  }

  // 1.2 计算目标位置
  const target = targetLayerIndex(index, scene.nodes.length, direction, firstEditableLayerIndex(scene.nodes));
  if (target === index) {
    logger.info("调整节点图层顺序完成，顺序未变化", { nodeId });
    return scene;
  }

  // 1.3 移动节点
  const nodes = [...scene.nodes];
  const [movedNode] = nodes.splice(index, 1);
  nodes.splice(target, 0, movedNode);

  logger.info("调整节点图层顺序完成", { nodeId, target });
  return { ...scene, nodes };
}

function targetLayerIndex(index: number, length: number, direction: LayerMoveDirection, minIndex = 0) {
  logger.info("开始计算目标图层位置...", { index, length, direction });

  // 1.1 根据方向计算索引
  const target = direction === "front"
    ? length - 1
    : direction === "back"
      ? minIndex
      : direction === "forward"
        ? index + 1
        : index - 1;

  // 1.2 夹紧索引
  const result = Math.max(minIndex, Math.min(length - 1, target));
  logger.info("计算目标图层位置完成", { result });
  return result;
}

function firstEditableLayerIndex(nodes: SceneNode[]) {
  const index = nodes.findIndex((node) => !isLockedImageLayer(node));
  return index >= 0 ? index : nodes.length - 1;
}

function isLockedImageLayer(node: SceneNode) {
  return node.locked === true && node.type === "image";
}

function nodeBox(node: SceneNode): SceneBox {
  logger.info("开始读取节点包围盒...", { nodeId: node.id });

  // 1.1 处理线条点数组
  if (node.points?.length) {
    const xs = node.points.map((point) => point.x);
    const ys = node.points.map((point) => point.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const box = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    logger.info("读取节点包围盒完成", { nodeId: node.id, box });
    return box;
  }

  // 1.2 返回普通节点盒子
  const box = { x: node.x, y: node.y, w: node.w, h: node.h };
  logger.info("读取节点包围盒完成", { nodeId: node.id, box });
  return box;
}

function boxFromHandle(box: SceneBox, handle: ResizeHandle, dx: number, dy: number): SceneBox {
  logger.info("开始按方向手柄生成盒子...", { handle, dx, dy });

  // 1.1 初始化目标盒子
  const next = { ...box };

  // 1.2 应用横向和纵向手柄
  if (handle.includes("e")) {
    next.w = Math.max(MIN_NODE_SIZE, box.w + dx);
  }
  if (handle.includes("s")) {
    next.h = Math.max(MIN_NODE_SIZE, box.h + dy);
  }
  if (handle.includes("w")) {
    next.w = Math.max(MIN_NODE_SIZE, box.w - dx);
    next.x = box.x + box.w - next.w;
  }
  if (handle.includes("n")) {
    next.h = Math.max(MIN_NODE_SIZE, box.h - dy);
    next.y = box.y + box.h - next.h;
  }

  logger.info("按方向手柄生成盒子完成", next);
  return next;
}

function resizeLinePoints(node: SceneNode, handle: ResizeHandle, dx: number, dy: number) {
  logger.info("开始调整线条端点...", { nodeId: node.id, handle });

  // 1.1 读取线条点数组
  const points = node.points?.length ? node.points.map((point) => ({ ...point })) : [{ x: node.x, y: node.y }, { x: node.x + node.w, y: node.y + node.h }];
  const targetIndex = handle === "line-start" ? 0 : points.length - 1;

  // 1.2 移动目标端点
  points[targetIndex] = { x: coordinate(points[targetIndex].x + dx), y: coordinate(points[targetIndex].y + dy) };

  logger.info("调整线条端点完成", { nodeId: node.id, handle });
  return points;
}

function boxFromPoints(points: Array<{ x: number; y: number }>): SceneBox {
  logger.info("开始从点数组计算包围盒...", { count: points.length });

  // 1.1 计算坐标边界
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  // 1.2 返回包围盒
  const box = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  logger.info("从点数组计算包围盒完成", box);
  return box;
}

function boxesIntersect(a: SceneBox, b: SceneBox) {
  logger.info("开始判断矩形相交...");

  // 1.1 计算相交结果
  const result = a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;

  logger.info("判断矩形相交完成", { result });
  return result;
}

function sanitizeNode(node: SceneNode): SceneNode {
  const next: SceneNode = {
    ...node,
    x: coordinate(node.x),
    y: coordinate(node.y),
    w: positiveSize(node.w),
    h: nonNegativeSize(node.h),
    style: sanitizeStyle(node.style)
  };
  if (node.text !== undefined) {
    next.text = truncateText(node.text);
  }
  if (node.symbol !== undefined) {
    next.symbol = truncateText(node.symbol);
  }
  if (node.points !== undefined) {
    next.points = node.points.map((point) => ({ x: coordinate(point.x), y: coordinate(point.y) }));
  }
  return next;
}

function sanitizeStyle(style: SceneStyle): SceneStyle {
  const next = { ...style };
  if (style.fill !== undefined) {
    next.fill = paint(style.fill, "#FFFFFF");
  }
  if (style.stroke !== undefined) {
    next.stroke = paint(style.stroke, "none");
  }
  if (style.color !== undefined) {
    next.color = paint(style.color, "#111111");
  }
  if (style.fontFamily !== undefined) {
    next.fontFamily = truncateProtocolString(style.fontFamily);
  }
  if (style.fontWeight !== undefined) {
    next.fontWeight = truncateProtocolString(style.fontWeight);
  }
  if (style.dash !== undefined) {
    next.dash = truncateProtocolString(style.dash);
  }
  if (style.strokeWidth !== undefined) {
    next.strokeWidth = strokeWidth(style.strokeWidth);
  }
  if (style.fontSize !== undefined) {
    next.fontSize = fontSize(style.fontSize);
  }
  return next;
}

function paint(value: string, fallback: string) {
  if (value === "none") {
    return "none";
  }
  const normalized = normalizeHexColor(value);
  return isNormalizedHexColor(normalized) ? normalized : fallback;
}

function coordinate(value: number) {
  return clampNumber(finite(value, 0), -MAX_GEOMETRY_COORDINATE, MAX_GEOMETRY_COORDINATE);
}

function positiveSize(value: number) {
  const numeric = finite(value, MIN_NODE_SIZE);
  return clampNumber(numeric > 0 ? numeric : MIN_NODE_SIZE, 1, MAX_NODE_SIZE);
}

function nonNegativeSize(value: number) {
  const numeric = finite(value, 0);
  return clampNumber(numeric >= 0 ? numeric : 0, 0, MAX_NODE_SIZE);
}

function strokeWidth(value: number) {
  return clampNumber(finite(value, 0), 0, MAX_STYLE_STROKE_WIDTH);
}

function fontSize(value: number) {
  const numeric = finite(value, 16);
  return clampNumber(numeric > 0 ? numeric : 16, 1, MAX_STYLE_FONT_SIZE);
}

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function truncateText(value: string | undefined) {
  return typeof value === "string" ? value.slice(0, MAX_TEXT_LENGTH) : undefined;
}

function truncateProtocolString(value: string | undefined) {
  return typeof value === "string" ? value.slice(0, MAX_PROTOCOL_STRING_LENGTH) : undefined;
}
