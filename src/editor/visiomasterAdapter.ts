import { createId } from "../lib/id";
import { logger } from "../lib/logger";
import { normalizeSceneImport } from "../shared/sceneImport";
import type { Scene } from "../shared/scene";

/** Browser entry keeps imported-file provenance while sharing conversion rules with AI imports. */
export function normalizeImportedScene(input: unknown): Scene {
  const scene = normalizeSceneImport(input, {
    createId,
    createdAt: new Date().toISOString(),
    source: {
      title: "Imported Visiomaster Scene",
      engine: "scientific-drawing.visiomaster-adapter",
      notes: ["Imported from Visiomaster-style scene.json."]
    }
  });
  logger.info("规范化导入场景完成", { nodes: scene.nodes.length, edges: scene.edges.length });
  return scene;
}
