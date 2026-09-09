import { randomUUID } from "node:crypto";
import { analyzeImage } from "../scene/analyzeImage";
import type { SceneResponse } from "@shared/apiContracts";
import { extensionFromMime } from "../storage/imageTypes";
import type { SceneStore } from "../storage/sceneStore";
import { repairAndValidateSceneForPersistence } from "./sceneValidation";
import { ServiceError } from "./serviceError";

export type ImageUpload = { path: string; mimetype: string; originalname: string };

export function createAnalyzeService(store: SceneStore, analyze: typeof analyzeImage = analyzeImage) {
  return async (file: ImageUpload, title?: string, signal?: AbortSignal): Promise<SceneResponse> => {
    const id = randomUUID();
    const fileName = `${id}${extensionFromMime(file.mimetype)}`;
    const imagePath = store.uploadPath(fileName);
    try {
      signal?.throwIfAborted();
      await store.moveUpload(file.path, imagePath);
      const sourceUrl = `/uploads/${fileName}`;
      const rawScene = await analyze({ id, imagePath, sourceUrl, title: title || file.originalname || "Scientific Figure" });
      signal?.throwIfAborted();
      const validation = repairAndValidateSceneForPersistence(rawScene, { id, sourceUrl });
      if (!validation.ok) throw new ServiceError(500, { error: "Generated scene is invalid.", issues: validation.issues });
      await store.save(id, validation.scene, signal);
      return { scene: validation.scene, sourceUrl, sceneUrl: `/api/scenes/${id}` };
    } catch (error) {
      await store.cleanup(file.path, imagePath);
      throw error;
    }
  };
}
