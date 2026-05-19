import { logger } from "../logger";
import { endpointReferencesNode } from "@shared/geometry";
import type { Scene, SceneEdge, SceneNode } from "./types";

export type RegionMergeMode = "replace" | "overlay";

export type SceneBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ImageSize = {
  width: number;
  height: number;
};

export type ImageExtractBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function sceneRegionToImageExtract(region: SceneBox, page: ImageSize, image: ImageSize): ImageExtractBox {
  /*
   * ========================================================================
   * 步骤1：转换局部裁剪坐标
   * ========================================================================
   * 目标：
   *   1) 把 scene 框选区域归一化
   *   2) 按原图像素尺寸生成 sharp extract 参数
   */
  logger.info("开始转换局部裁剪坐标...", { region, page, image });

  // 1.1 归一化并夹紧 scene 区域
  const normalized = clampRegion(normalizeRegion(region), page);

  // 1.2 映射到原图像素坐标
  const scaleX = image.width / page.width;
  const scaleY = image.height / page.height;
  const left = Math.max(0, Math.min(image.width - 1, Math.floor(normalized.x * scaleX)));
  const top = Math.max(0, Math.min(image.height - 1, Math.floor(normalized.y * scaleY)));
  const right = Math.max(left + 1, Math.min(image.width, Math.ceil((normalized.x + normalized.w) * scaleX)));
  const bottom = Math.max(top + 1, Math.min(image.height, Math.ceil((normalized.y + normalized.h) * scaleY)));
  const extract = {
    left,
    top,
    width: right - left,
    height: bottom - top
  };

  logger.info("转换局部裁剪坐标完成", extract);
  return extract;
}

export function sourceImageUrlFromScene(scene: Scene) {
  /*
   * ========================================================================
   * 步骤1：解析 scene 原图地址
   * ========================================================================
   * 目标：
   *   1) 优先使用 metadata.sourceImage
   *   2) 缺失时回退到锁定图片节点或首个图片节点
   */
  logger.info("开始解析 scene 原图地址...");

  // 1.1 读取 metadata 来源
  if (scene.metadata.sourceImage) {
    logger.info("解析 scene 原图地址完成", { source: scene.metadata.sourceImage });
    return scene.metadata.sourceImage;
  }

  // 1.2 回退到图片节点
  const imageNode = scene.nodes.find((node) => node.type === "image" && node.locked && node.source)
    ?? scene.nodes.find((node) => node.type === "image" && node.source);
  const source = imageNode?.source ?? "";

  logger.info("解析 scene 原图地址完成", { source });
  return source;
}

export function mergeRegionReconstruction(
  baseScene: Scene,
  regionScene: Scene,
  region: SceneBox,
  mode: RegionMergeMode
): Scene {
  /*
   * ========================================================================
   * 步骤1：合并局部 AI 重建结果
   * ========================================================================
   * 目标：
   *   1) 替换或叠加框选区域内容
   *   2) 把局部坐标平移为全局 scene 坐标
   */
  logger.info("开始合并局部 AI 重建结果...", { mode, region });

  // 1.1 准备区域和旧内容
  const normalized = clampRegion(normalizeRegion(region), baseScene.page);
  const removedNodeIds = mode === "replace"
    ? new Set(baseScene.nodes.filter((node) => !node.locked && boxesIntersect(normalized, nodeBox(node))).map((node) => node.id))
    : new Set<string>();

  // 1.2 平移并去重新节点
  const idMap = new Map<string, string>();
  const usedIds = new Set(baseScene.nodes.map((node) => node.id));
  const translatedNodes = regionScene.nodes
    .filter((node) => !node.locked && node.type !== "image")
    .map((node) => translateNode(node, normalized.x, normalized.y, usedIds, idMap));

  // 1.3 平移局部边
  const translatedEdges = regionScene.edges
    .map((edge) => translateEdge(edge, normalized.x, normalized.y, usedIds, idMap))
    .filter((edge): edge is SceneEdge => Boolean(edge));

  // 1.4 组装合并后的 scene
  const nextNodes = [
    ...baseScene.nodes.filter((node) => !removedNodeIds.has(node.id)),
    ...translatedNodes
  ];
  const nextEdges = [
    ...baseScene.edges.filter((edge) => !edgeTouchesAny(edge, removedNodeIds)),
    ...translatedEdges
  ];
  const next = {
    ...baseScene,
    metadata: {
      ...baseScene.metadata,
      notes: [...baseScene.metadata.notes, `Region reconstruction: ${mode}.`]
    },
    nodes: nextNodes,
    edges: nextEdges
  };

  logger.info("合并局部 AI 重建结果完成", { nodes: next.nodes.length, edges: next.edges.length });
  return next;
}

function translateNode(node: SceneNode, offsetX: number, offsetY: number, usedIds: Set<string>, idMap: Map<string, string>): SceneNode {
  /*
   * ========================================================================
   * 步骤1：平移局部节点
   * ========================================================================
   * 目标：
   *   1) 把裁剪图坐标转回全局坐标
   *   2) 避免和现有节点 id 冲突
   */
  logger.info("开始平移局部节点...", { id: node.id });

  // 1.1 生成唯一 id
  const id = uniqueId(node.id, usedIds);
  idMap.set(node.id, id);

  // 1.2 平移节点坐标
  const translated = {
    ...node,
    id,
    x: node.x + offsetX,
    y: node.y + offsetY,
    points: node.points?.map((point) => ({ x: point.x + offsetX, y: point.y + offsetY })),
    locked: false
  };

  logger.info("平移局部节点完成", { id });
  return translated;
}

function translateEdge(edge: SceneEdge, offsetX: number, offsetY: number, usedIds: Set<string>, idMap: Map<string, string>): SceneEdge | null {
  /*
   * ========================================================================
   * 步骤1：平移局部边
   * ========================================================================
   * 目标：
   *   1) 重写局部端点 id
   *   2) 平移显式端点和折线点
   */
  logger.info("开始平移局部边...", { id: edge.id });

  // 1.1 重写端点引用
  const from = rewriteEndpoint(edge.from, idMap);
  const to = rewriteEndpoint(edge.to, idMap);
  if ((edge.from && !from) || (edge.to && !to)) {
    logger.warn("平移局部边跳过，端点缺失", { id: edge.id });
    return null;
  }

  // 1.2 生成唯一 edge id
  const id = uniqueId(edge.id, usedIds);

  // 1.3 平移显式坐标
  const translated = {
    ...edge,
    id,
    from,
    to,
    fromPoint: edge.fromPoint ? { x: edge.fromPoint.x + offsetX, y: edge.fromPoint.y + offsetY } : undefined,
    toPoint: edge.toPoint ? { x: edge.toPoint.x + offsetX, y: edge.toPoint.y + offsetY } : undefined,
    points: edge.points?.map((point) => ({ x: point.x + offsetX, y: point.y + offsetY }))
  };

  logger.info("平移局部边完成", { id });
  return translated;
}

function rewriteEndpoint(endpoint: string | undefined, idMap: Map<string, string>) {
  if (!endpoint) {
    return endpoint;
  }
  const [id, rest] = endpoint.split(":");
  const mapped = idMap.get(id);
  if (!mapped) {
    return "";
  }
  return rest ? `${mapped}:${rest}` : mapped;
}

function edgeTouchesAny(edge: SceneEdge, nodeIds: Set<string>) {
  for (const nodeId of nodeIds) {
    if (endpointReferencesNode(edge.from, nodeId) || endpointReferencesNode(edge.to, nodeId)) {
      return true;
    }
  }
  return false;
}

function uniqueId(originalId: string, usedIds: Set<string>) {
  const base = originalId || "region-node";
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function normalizeRegion(region: SceneBox): SceneBox {
  const x = region.w < 0 ? region.x + region.w : region.x;
  const y = region.h < 0 ? region.y + region.h : region.y;
  return {
    x,
    y,
    w: Math.abs(region.w),
    h: Math.abs(region.h)
  };
}

function clampRegion(region: SceneBox, bounds: ImageSize): SceneBox {
  const x = Math.max(0, Math.min(bounds.width, region.x));
  const y = Math.max(0, Math.min(bounds.height, region.y));
  const right = Math.max(x, Math.min(bounds.width, region.x + region.w));
  const bottom = Math.max(y, Math.min(bounds.height, region.y + region.h));
  return {
    x,
    y,
    w: right - x,
    h: bottom - y
  };
}

function nodeBox(node: SceneNode): SceneBox {
  if (node.points?.length) {
    const xs = node.points.map((point) => point.x);
    const ys = node.points.map((point) => point.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return { x: node.x, y: node.y, w: node.w, h: node.h };
}

function boxesIntersect(a: SceneBox, b: SceneBox) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}
