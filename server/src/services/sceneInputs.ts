import type { Scene } from "../scene/types";
import type { ReconstructionMode } from "../scene/reconstructionPrompt";
import type { RegionMergeMode, SceneBox } from "../scene/regionReconstruction";
import { logger } from "../logger";

export function reconstructionModeValue(value: unknown): ReconstructionMode {
  if (value === "mono") {
    return "mono";
  }
  return "color";
}

export function reconstructModelValue(value: unknown) {
  logger.info("开始读取重建模型名...", { value });
  const model = typeof value === "string" && value.trim().length > 0 && value.length <= 120
    ? value.trim()
    : undefined;

  logger.info("读取重建模型名完成", { model });
  return model;
}

export function regionMergeModeValue(value: unknown): RegionMergeMode {
  logger.info("开始读取局部重建合并模式...", { value });
  const mode = value === "overlay" ? "overlay" : "replace";

  logger.info("读取局部重建合并模式完成", { mode });
  return mode;
}

export function sceneBoxValue(value: unknown, page?: Scene["page"]): SceneBox | null {
  logger.info("开始读取 scene 区域...", { value });
  if (!isRecord(value)) {
    logger.warn("读取 scene 区域失败，结构非法");
    return null;
  }
  const box = {
    x: value.x,
    y: value.y,
    w: value.w,
    h: value.h
  };
  if (!Object.values(box).every((item) => typeof item === "number" && Number.isFinite(item))) {
    logger.warn("读取 scene 区域失败，字段非法");
    return null;
  }
  const region = box as SceneBox;
  if (Math.abs(region.w) < 4 || Math.abs(region.h) < 4) {
    logger.warn("读取 scene 区域失败，区域过小");
    return null;
  }
  if (page) {
    const normalized = normalizeSceneBox(region);
    const left = Math.max(0, normalized.x);
    const top = Math.max(0, normalized.y);
    const right = Math.min(page.width, normalized.x + normalized.w);
    const bottom = Math.min(page.height, normalized.y + normalized.h);
    if (right - left < 4 || bottom - top < 4) {
      logger.warn("读取 scene 区域失败，与画布无有效交集");
      return null;
    }
  }

  logger.info("读取 scene 区域完成", region);
  return region;
}

function normalizeSceneBox(region: SceneBox): SceneBox {
  const x = region.w < 0 ? region.x + region.w : region.x;
  const y = region.h < 0 ? region.y + region.h : region.y;
  return {
    x,
    y,
    w: Math.abs(region.w),
    h: Math.abs(region.h)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
