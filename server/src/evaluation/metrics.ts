import sharp from "sharp";
import { logger } from "../logger";
import type { Scene } from "../scene/types";
import type { SceneComplexity } from "./types";

const MAX_EVAL_WIDTH = 900;
export async function measureMeanDiff(imagePath: string, svgBytes: Buffer) {
  logger.info("开始计算平均像素差...", { imagePath });

  const metrics = await measureVisualMetrics(imagePath, svgBytes);

  logger.info("计算平均像素差完成", { result: metrics.meanDiff });
  return metrics.meanDiff;
}

export type VisualMetrics = {
  meanDiff: number | null;
  normalizedMeanDiff: number | null;
  psnr: number | null;
  ssim: number | null;
};

export async function measureVisualMetrics(imagePath: string, svgBytes: Buffer): Promise<VisualMetrics> {
  logger.info("开始计算视觉评估指标...", { imagePath });

  try {
    const metadata = await sharp(imagePath).metadata();
    const width = metadata.width ?? 1;
    const height = metadata.height ?? 1;
    const scale = width > MAX_EVAL_WIDTH ? MAX_EVAL_WIDTH / width : 1;
    const evalWidth = Math.max(1, Math.round(width * scale));
    const evalHeight = Math.max(1, Math.round(height * scale));

    const [source, rendered] = await Promise.all([
      sharp(imagePath)
        .resize(evalWidth, evalHeight, { fit: "fill" })
        .removeAlpha()
        .raw()
        .toBuffer(),
      sharp(svgBytes, { density: 96 })
        .resize(evalWidth, evalHeight, { fit: "fill" })
        .removeAlpha()
        .raw()
        .toBuffer()
    ]);

    let absoluteDiffTotal = 0;
    let squaredDiffTotal = 0;
    const length = Math.min(source.length, rendered.length);
    for (let index = 0; index < length; index += 1) {
      const diff = source[index] - rendered[index];
      absoluteDiffTotal += Math.abs(diff);
      squaredDiffTotal += diff * diff;
    }
    const safeLength = Math.max(1, length);
    const meanDiff = Math.round((absoluteDiffTotal / safeLength) * 100) / 100;
    const mse = squaredDiffTotal / safeLength;
    const result: VisualMetrics = {
      meanDiff,
      normalizedMeanDiff: normalizeMeanDiff(meanDiff),
      psnr: computePsnr(mse),
      ssim: computeSsimApprox(source, rendered)
    };

    logger.info("计算视觉评估指标完成", result);
    return result;
  } catch (error) {
    logger.warn("计算视觉评估指标失败", { imagePath, error: String(error) });
    return { meanDiff: null, normalizedMeanDiff: null, psnr: null, ssim: null };
  }
}

export function normalizeMeanDiff(meanDiff: number | null) {
  logger.info("开始归一化平均像素差...", { meanDiff });

  if (meanDiff === null) {
    logger.info("归一化平均像素差完成", { result: null });
    return null;
  }

  const result = Math.round((meanDiff / 255) * 10000) / 10000;
  logger.info("归一化平均像素差完成", { result });
  return result;
}

// PSNR 上界。8bit 像素的理论 PSNR 无上限，零误差时数学上为 Infinity；
// 但 JSON.stringify(Infinity) === "null" 会让指标静默丢失，
// 这里截到 99（对应 mse≈0.0066，远低于任何真实评估能区分的精度）。
export const PSNR_CAP = 99;

export function computePsnr(mse: number) {
  logger.info("开始计算 PSNR...", { mse });

  if (mse === 0) {
    logger.info("计算 PSNR 完成", { result: PSNR_CAP });
    return PSNR_CAP;
  }

  const raw = Math.round(10 * Math.log10((255 * 255) / mse) * 100) / 100;
  const result = Math.min(raw, PSNR_CAP);
  logger.info("计算 PSNR 完成", { result });
  return result;
}

export function computeSsimApprox(source: Buffer, rendered: Buffer) {
  logger.info("开始计算近似 SSIM...", { sourceLength: source.length, renderedLength: rendered.length });

  const length = Math.min(source.length, rendered.length);
  if (length === 0) {
    logger.info("计算近似 SSIM 完成", { result: 0 });
    return 0;
  }

  let meanX = 0;
  let meanY = 0;
  for (let index = 0; index < length; index += 1) {
    meanX += source[index];
    meanY += rendered[index];
  }
  meanX /= length;
  meanY /= length;

  let varianceX = 0;
  let varianceY = 0;
  let covariance = 0;
  for (let index = 0; index < length; index += 1) {
    const dx = source[index] - meanX;
    const dy = rendered[index] - meanY;
    varianceX += dx * dx;
    varianceY += dy * dy;
    covariance += dx * dy;
  }
  varianceX /= length;
  varianceY /= length;
  covariance /= length;

  const c1 = 6.5025;
  const c2 = 58.5225;
  const rawValue = ((2 * meanX * meanY + c1) * (2 * covariance + c2)) / ((meanX * meanX + meanY * meanY + c1) * (varianceX + varianceY + c2));
  const result = Math.max(-1, Math.min(1, Math.round(rawValue * 10000) / 10000));
  logger.info("计算近似 SSIM 完成", { result });
  return result;
}

export function summarizeTypes(scene: Scene) {
  logger.info("开始汇总节点类型...", { nodes: scene.nodes.length });

  const counts = new Map<string, number>();
  for (const node of scene.nodes) {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  }

  const result = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${type}=${count}`)
    .join(", ");
  logger.info("汇总节点类型完成", { result });
  return result;
}

export function countEditableNodes(scene: Scene) {

  return scene.nodes.filter((node) => !node.locked).length;
}

export function computeSceneComplexity(scene: Scene): SceneComplexity {

  const nodeIds = new Set(scene.nodes.map((node) => node.id));
  const lockedNodes = scene.nodes.filter((node) => node.locked).length;
  const imageNodes = scene.nodes.filter((node) => node.type === "image").length;
  const textNodes = scene.nodes.filter((node) => node.type === "text").length;
  const shapeNodes = scene.nodes.filter((node) => node.type !== "image" && node.type !== "text").length;

  const edgeEndpointIssues = scene.edges.reduce((count, edge) => {
    const fromIssue = edge.from ? Number(!nodeIds.has(edge.from.split(":")[0])) : 0;
    const toIssue = edge.to ? Number(!nodeIds.has(edge.to.split(":")[0])) : 0;
    return count + fromIssue + toIssue;
  }, 0);

  return { lockedNodes, imageNodes, textNodes, shapeNodes, edgeEndpointIssues };
}
