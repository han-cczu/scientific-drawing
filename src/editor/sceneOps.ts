import { logger } from "../lib/logger";
import { createId } from "../lib/id";
import type { Scene, SceneNode, SceneNodeType } from "../shared/scene";

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
  const edges = scene.edges.filter((edge) => !edgeReferencesNode(edge.from, nodeId) && !edgeReferencesNode(edge.to, nodeId));

  // 1.3 返回新场景
  const next = { ...scene, nodes, edges };
  logger.info("删除节点完成", { nodeId, removedEdges: scene.edges.length - edges.length });
  return next;
}

function edgeReferencesNode(endpoint: string | undefined, nodeId: string) {
  /*
   * ========================================================================
   * 步骤1：判断连线端点归属
   * ========================================================================
   * 目标：
   *   1) 支持 node:right@0.5 端点写法
   *   2) 删除节点时同步清理依赖它的边
   */
  logger.info("开始判断连线端点归属...", { endpoint, nodeId });

  // 1.1 拆解端点节点 id
  const result = endpoint?.split(":")[0] === nodeId;

  // 1.2 返回判断结果
  logger.info("判断连线端点归属完成", { result });
  return result;
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
