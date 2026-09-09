import { randomUUID } from "node:crypto";
import { normalizeSceneImport } from "@shared/sceneImport";
import type { Scene } from "./types";

/** Server entry supplies AI provenance; geometry/style conversion is platform independent. */
export function normalizeImportedScene(input: unknown): Scene {
  return normalizeSceneImport(input, {
    createId: (prefix) => `${prefix}-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    source: {
      title: "AI Reconstruction",
      engine: "scientific-drawing.openai-reconstruction",
      notes: ["Generated from Visiomaster-style AI scene."]
    }
  });
}
