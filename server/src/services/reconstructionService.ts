import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { SceneResponse } from "@shared/apiContracts";
import { repairScene } from "../scene/repairScene";
import { appendMetadataNotes, mergeRegionReconstruction, sceneRegionToImageExtract, sourceImageUrlFromScene } from "../scene/regionReconstruction";
import type { reconstructWithOpenAI } from "../scene/reconstructWithOpenAI";
import { normalizeImportedScene } from "../scene/visiomasterAdapter";
import { sanitizeFileBase } from "../storage/fileNames";
import { extensionFromMime } from "../storage/imageTypes";
import type { SceneStore } from "../storage/sceneStore";
import type { ImageUpload } from "./analyzeService";
import { reconstructionModeValue, reconstructModelValue, regionMergeModeValue, sceneBoxValue } from "./sceneInputs";
import { repairAndValidateSceneForPersistence, validateSceneForExport } from "./sceneValidation";
import { ServiceError } from "./serviceError";

type ReconstructionFields = { mode?: unknown; model?: unknown };
type RegionFields = ReconstructionFields & { scene?: unknown; region?: unknown; mergeMode?: unknown };
export type ReconstructionRunner = (input: Parameters<typeof reconstructWithOpenAI>[0]) => ReturnType<typeof reconstructWithOpenAI>;

function invalidGeneratedScene(issues: unknown[]) {
  return new ServiceError(500, {
    error: { code: "INVALID_SCENE", message: "Generated scene is invalid.", hint: "可重试或更换模型" },
    issues
  });
}

export function createReconstructionService(store: SceneStore, reconstruct: ReconstructionRunner) {
  return {
    async reconstruct(file: ImageUpload, fields: ReconstructionFields, signal?: AbortSignal): Promise<SceneResponse> {
      const id = randomUUID();
      const fileName = `${id}${extensionFromMime(file.mimetype)}`;
      const imagePath = store.uploadPath(fileName);
      try {
        signal?.throwIfAborted();
        await store.moveUpload(file.path, imagePath);
        await sharp(imagePath).metadata();
        const mode = reconstructionModeValue(fields.mode);
        const model = reconstructModelValue(fields.model);
        signal?.throwIfAborted();
        const rawScene = await reconstruct({ imagePath, mimeType: file.mimetype, mode, model, signal });
        // Even a runner that ignores abort cannot publish a late result.
        signal?.throwIfAborted();
        const sourceUrl = `/uploads/${fileName}`;
        const validation = repairAndValidateSceneForPersistence(normalizeImportedScene(rawScene), { id, sourceUrl });
        if (!validation.ok) throw invalidGeneratedScene(validation.issues);
        const scene = validation.scene;
        scene.metadata.notes = appendMetadataNotes(scene.metadata.notes, `Reconstruction mode: ${mode}.`, `Reconstruction model: ${model || "default"}.`);
        await store.save(id, scene, signal);
        return { scene, sourceUrl, sceneUrl: `/api/scenes/${id}` };
      } catch (error) {
        await store.cleanup(file.path, imagePath);
        throw error;
      }
    },
    async reconstructRegion(fields: RegionFields, signal?: AbortSignal): Promise<SceneResponse> {
      let regionImagePath: string | undefined;
      try {
        signal?.throwIfAborted();
        const current = validateSceneForExport(fields.scene);
        if (!current.ok) throw new ServiceError(400, { error: "Invalid scene.", issues: current.issues });
        const scene = current.scene;
        const region = sceneBoxValue(fields.region, scene.page);
        if (!region) throw new ServiceError(400, { error: "Invalid region." });
        const sourceUrl = sourceImageUrlFromScene(scene);
        if (!sourceUrl) throw new ServiceError(400, { error: "Scene does not contain a source image." });
        const sourcePath = store.sourcePath(sourceUrl);
        if (!sourcePath) throw new ServiceError(400, { error: "Source image must be a local upload." });
        if (!(await store.isFile(sourcePath))) throw new ServiceError(400, { error: "Source image was not found." });
        const metadata = await sharp(sourcePath).metadata();
        const extract = sceneRegionToImageExtract(region, scene.page, {
          width: metadata.width ?? scene.page.width,
          height: metadata.height ?? scene.page.height
        });
        const id = sanitizeFileBase(scene.metadata.id || randomUUID());
        regionImagePath = store.uploadPath(`${randomUUID()}.region.png`);
        await sharp(sourcePath).extract(extract).png().toFile(regionImagePath);
        const mode = reconstructionModeValue(fields.mode);
        const model = reconstructModelValue(fields.model);
        const mergeMode = regionMergeModeValue(fields.mergeMode);
        signal?.throwIfAborted();
        const rawScene = await reconstruct({ imagePath: regionImagePath, mimeType: "image/png", mode, model, signal });
        signal?.throwIfAborted();
        const regionScene = repairScene(normalizeImportedScene(rawScene));
        const merged = mergeRegionReconstruction(scene, regionScene, region, mergeMode);
        const validation = repairAndValidateSceneForPersistence(merged, { id, sourceUrl });
        if (!validation.ok) throw invalidGeneratedScene(validation.issues);
        const nextScene = validation.scene;
        nextScene.metadata.notes = appendMetadataNotes(nextScene.metadata.notes, `Region reconstruction mode: ${mode}.`, `Region reconstruction model: ${model || "default"}.`);
        await store.save(id, nextScene, signal);
        return { scene: nextScene, sourceUrl, sceneUrl: `/api/scenes/${id}` };
      } finally {
        await store.cleanup(regionImagePath);
      }
    }
  };
}
