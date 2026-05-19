import { logger } from "../lib/logger";
import { createId } from "../lib/id";
import { endpointReferencesNode } from "../shared/geometry";
import type { Scene, SceneEdge, SceneNode, SceneNodeType } from "../shared/scene";

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

export function createBlankScene(): Scene {
  /*
   * ========================================================================
   * 步骤1：创建空白场景
   * ========================================================================
   * 目标：
   *   1) 提供无图片时的默认画布
   *   2) 保持 scene 协议和后端一致
   */
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
  /*
   * ========================================================================
   * 步骤1：创建编辑节点
   * ========================================================================
   * 目标：
   *   1) 根据工具类型生成默认节点
   *   2) 初始化可编辑样式
   */
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
  /*
   * ========================================================================
   * 步骤1：更新节点
   * ========================================================================
   * 目标：
   *   1) 找到目标节点
   *   2) 合并局部修改并返回新 scene
   */
  logger.info("开始更新节点...", { nodeId });

  // 1.1 替换目标节点
  const nodes = scene.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node);

  // 1.2 返回新场景
  const next = { ...scene, nodes };
  logger.info("更新节点完成", { nodeId });
  return next;
}

export function updateNodeStyle(scene: Scene, nodeId: string, patch: SceneNode["style"]): Scene {
  /*
   * ========================================================================
   * 步骤1：更新节点样式
   * ========================================================================
   * 目标：
   *   1) 保留节点原有样式
   *   2) 覆盖用户修改字段
   */
  logger.info("开始更新节点样式...", { nodeId });

  // 1.1 合并样式
  const nodes = scene.nodes.map((node) => node.id === nodeId
    ? { ...node, style: { ...node.style, ...patch } }
    : node);

  // 1.2 返回新场景
  const next = { ...scene, nodes };
  logger.info("更新节点样式完成", { nodeId });
  return next;
}

export function moveNodes(scene: Scene, nodeIds: string[], dx: number, dy: number): Scene {
  /*
   * ========================================================================
   * 步骤1：批量移动节点
   * ========================================================================
   * 目标：
   *   1) 支持多选节点一起移动
   *   2) 跳过锁定节点并同步移动 points
   */
  logger.info("开始批量移动节点...", { count: nodeIds.length, dx, dy });

  // 1.1 准备待移动节点集合
  const idSet = new Set(nodeIds);

  // 1.2 生成移动后的节点列表
  const nodes = scene.nodes.map((node) => {
    if (!idSet.has(node.id) || node.locked) {
      return node;
    }
    const moved: SceneNode = {
      ...node,
      x: node.x + dx,
      y: node.y + dy
    };
    if (node.points?.length) {
      moved.points = node.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
    }
    return moved;
  });

  logger.info("批量移动节点完成", { count: nodeIds.length });
  return { ...scene, nodes };
}

export function resizeNode(scene: Scene, nodeId: string, nextBox: SceneBox): Scene {
  /*
   * ========================================================================
   * 步骤1：调整节点尺寸
   * ========================================================================
   * 目标：
   *   1) 归一化拖拽产生的反向盒子
   *   2) 限制最小宽高，避免节点不可见
   */
  logger.info("开始调整节点尺寸...", { nodeId });

  // 1.1 归一化目标盒子
  const box = normalizeBox(nextBox);
  const clamped = {
    x: box.x,
    y: box.y,
    w: Math.max(MIN_NODE_SIZE, box.w),
    h: Math.max(MIN_NODE_SIZE, box.h)
  };

  // 1.2 更新目标节点
  const nodes = scene.nodes.map((node) => {
    if (node.id !== nodeId || node.locked) {
      return node;
    }
    return { ...node, ...clamped };
  });

  logger.info("调整节点尺寸完成", { nodeId, width: clamped.w, height: clamped.h });
  return { ...scene, nodes };
}

export function resizeNodeFromHandle(scene: Scene, nodeId: string, handle: ResizeHandle, startBox: SceneBox, dx: number, dy: number): Scene {
  /*
   * ========================================================================
   * 步骤1：按手柄调整节点
   * ========================================================================
   * 目标：
   *   1) 把手柄拖拽转换成目标盒子或端点坐标
   *   2) 支持形状节点和线条节点共用入口
   */
  logger.info("开始按手柄调整节点...", { nodeId, handle, dx, dy });

  // 1.1 查找目标节点
  const node = scene.nodes.find((item) => item.id === nodeId);
  if (!node || node.locked) {
    logger.warn("按手柄调整节点失败，节点不存在或已锁定", { nodeId });
    return scene;
  }

  // 1.2 处理线条端点手柄
  if ((node.type === "line" || node.type === "arrow") && (handle === "line-start" || handle === "line-end")) {
    const points = resizeLinePoints(node, handle, dx, dy);
    const box = boxFromPoints(points);
    const nodes = scene.nodes.map((item) => item.id === nodeId ? { ...item, ...box, points } : item);
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
  /*
   * ========================================================================
   * 步骤1：框选节点
   * ========================================================================
   * 目标：
   *   1) 选出与选择框相交的可编辑节点
   *   2) 默认忽略锁定底图等不可编辑对象
   */
  logger.info("开始框选节点...");

  // 1.1 归一化选择区域
  const selection = normalizeBox(rect);

  // 1.2 返回相交节点 id
  const ids = scene.nodes
    .filter((node) => !node.locked && boxesIntersect(selection, nodeBox(node)))
    .map((node) => node.id);

  logger.info("框选节点完成", { count: ids.length });
  return ids;
}

export function createEdgeBetweenNodes(scene: Scene, fromNodeId: string, toNodeId: string): Scene {
  /*
   * ========================================================================
   * 步骤1：创建语义连线
   * ========================================================================
   * 目标：
   *   1) 在两个节点之间创建 arrow edge
   *   2) 使用节点端点引用，保证移动节点后连线跟随
   */
  logger.info("开始创建语义连线...", { fromNodeId, toNodeId });

  // 1.1 校验起止节点
  const from = scene.nodes.find((node) => node.id === fromNodeId);
  const to = scene.nodes.find((node) => node.id === toNodeId);
  if (!from || !to || from.id === to.id) {
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
  /*
   * ========================================================================
   * 步骤1：归一化矩形盒子
   * ========================================================================
   * 目标：
   *   1) 把负向拖拽转换为正向坐标
   *   2) 供框选和尺寸调整共用
   */
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
  /*
   * ========================================================================
   * 步骤1：删除节点
   * ========================================================================
   * 目标：
   *   1) 移除指定节点
   *   2) 保留其他节点顺序
   */
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
  /*
   * ========================================================================
   * 步骤1：复制节点
   * ========================================================================
   * 目标：
   *   1) 找到源节点
   *   2) 生成带偏移的新节点
   */
  logger.info("开始复制节点...", { nodeId });

  // 1.1 查找源节点
  const source = scene.nodes.find((node) => node.id === nodeId);
  if (!source) {
    logger.warn("复制节点失败，节点不存在", { nodeId });
    return null;
  }

  // 1.2 创建副本
  const copy: SceneNode = {
    ...source,
    id: createId(source.type),
    x: source.x + 18,
    y: source.y + 18,
    locked: false,
    points: source.points?.map((point) => ({ x: point.x + 18, y: point.y + 18 }))
  };

  logger.info("复制节点完成", { nodeId, copyId: copy.id });
  return copy;
}

function nodeBox(node: SceneNode): SceneBox {
  /*
   * ========================================================================
   * 步骤1：读取节点包围盒
   * ========================================================================
   * 目标：
   *   1) 优先从 points 计算线条包围盒
   *   2) 普通节点使用 x/y/w/h
   */
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
  /*
   * ========================================================================
   * 步骤1：按方向手柄生成盒子
   * ========================================================================
   * 目标：
   *   1) 把八方向拖拽转换成 x/y/w/h
   *   2) 保留原始盒子作为拖拽快照
   */
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
  /*
   * ========================================================================
   * 步骤1：调整线条端点
   * ========================================================================
   * 目标：
   *   1) 移动起点或终点
   *   2) 保留中间折线点
   */
  logger.info("开始调整线条端点...", { nodeId: node.id, handle });

  // 1.1 读取线条点数组
  const points = node.points?.length ? node.points.map((point) => ({ ...point })) : [{ x: node.x, y: node.y }, { x: node.x + node.w, y: node.y + node.h }];
  const targetIndex = handle === "line-start" ? 0 : points.length - 1;

  // 1.2 移动目标端点
  points[targetIndex] = { x: points[targetIndex].x + dx, y: points[targetIndex].y + dy };

  logger.info("调整线条端点完成", { nodeId: node.id, handle });
  return points;
}

function boxFromPoints(points: Array<{ x: number; y: number }>): SceneBox {
  /*
   * ========================================================================
   * 步骤1：从点数组计算包围盒
   * ========================================================================
   * 目标：
   *   1) 同步线条节点 x/y/w/h
   *   2) 保持 points 为真实端点坐标
   */
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
  /*
   * ========================================================================
   * 步骤1：判断矩形相交
   * ========================================================================
   * 目标：
   *   1) 支持框选命中节点
   *   2) 允许边界接触视为选中
   */
  logger.info("开始判断矩形相交...");

  // 1.1 计算相交结果
  const result = a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;

  logger.info("判断矩形相交完成", { result });
  return result;
}
