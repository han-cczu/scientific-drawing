import { repairScene } from "../scene/repairScene";
import { validateScene, type ValidationIssue } from "@shared/sceneValidation";
import type { Scene } from "../scene/types";
import { logger } from "../logger";

export function validateSceneForExport(value: unknown): { ok: true; scene: Scene; issues: [] } | { ok: false; scene?: undefined; issues: ValidationIssue[] } {
  logger.info("开始校验导出 scene 请求体...");
  const result = validateScene(value);
  if (!result.ok) {
    logger.warn("导出 scene 请求体无效", { issues: result.issues });
    return { ok: false, issues: result.issues };
  }
  const scene = value as Scene;
  logger.info("校验导出 scene 请求体完成", { nodes: scene.nodes.length });
  return { ok: true, scene, issues: [] };
}

export function repairAndValidateSceneForPersistence(scene: Scene, options: { id: string; sourceUrl: string }): { ok: true; scene: Scene; issues: [] } | { ok: false; scene?: undefined; issues: ValidationIssue[] } {
  logger.info("开始修复并校验待持久化 scene...", { id: options.id });
  const repaired = repairScene(scene);
  repaired.metadata.id = options.id;
  repaired.metadata.sourceImage = options.sourceUrl;
  ensureReplicaBaseLayer(repaired, options.sourceUrl);
  const validation = validateScene(repaired);
  if (!validation.ok) {
    logger.warn("待持久化 scene 校验失败", { issues: validation.issues });
    return { ok: false, issues: validation.issues };
  }

  logger.info("修复并校验待持久化 scene 完成", { nodes: repaired.nodes.length });
  return { ok: true, scene: repaired, issues: [] };
}

export function ensureReplicaBaseLayer(scene: Scene, sourceUrl: string) {
  logger.info("开始补充复刻底图...", { sourceUrl });
  const hasBaseLayer = scene.nodes.some((node) => node.type === "image" && node.source === sourceUrl);
  if (hasBaseLayer) {
    logger.info("补充复刻底图完成，已存在");
    return;
  }
  scene.nodes.unshift({
    id: uniqueReplicaBaseLayerId(scene),
    type: "image",
    x: 0,
    y: 0,
    w: scene.page.width,
    h: scene.page.height,
    source: sourceUrl,
    locked: true,
    style: {
      opacity: 1
    }
  });

  logger.info("补充复刻底图完成", { nodes: scene.nodes.length });
}

function uniqueReplicaBaseLayerId(scene: Scene) {
  const usedIds = new Set(scene.nodes.map((node) => node.id));
  let candidate = "source-image";
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `source-image-${suffix}`;
    suffix += 1;
  }
  return candidate;
}
