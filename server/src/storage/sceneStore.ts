import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Scene } from "../scene/types";
import { validateScene } from "@shared/sceneValidation";
import { type DataPaths, defaultDataPaths, resolveUploadedAssetPath } from "../paths";
import { safeSceneId } from "./fileNames";
import { ServiceError } from "../services/serviceError";

export const MAX_SCENE_FILE_BYTES = 20 * 1024 * 1024;
export type SceneFileSystem = Pick<typeof fs, "rename" | "writeFile" | "readFile" | "stat" | "unlink">;

/** All resource paths are bound to this store, so separate apps never share mutable globals. */
export function createSceneStore(paths: DataPaths = defaultDataPaths, files: SceneFileSystem = fs) {
  async function cleanup(...candidates: Array<string | undefined>) {
    for (const file of new Set(candidates.filter((value): value is string => Boolean(value)))) {
      await files.unlink(file).catch(() => undefined);
    }
  }

  function scenePath(id: string) {
    if (!safeSceneId(id)) throw new ServiceError(400, { error: "Invalid scene id." });
    return path.join(paths.sceneDir, `${id}.scene.json`);
  }

  return {
    paths,
    cleanup,
    uploadPath: (name: string) => path.join(paths.uploadDir, name),
    sourcePath: (source: unknown) => resolveUploadedAssetPath(source, paths),
    async isFile(file: string) {
      const stat = await files.stat(file).catch(() => undefined);
      return Boolean(stat?.isFile());
    },
    async moveUpload(temporaryPath: string, savedPath: string) {
      await files.rename(temporaryPath, savedPath);
    },
    async save(id: string, scene: Scene, signal?: AbortSignal) {
      const target = scenePath(id);
      // A unique sibling avoids truncated scenes, concurrent writers sharing one temp file,
      // and region failures destroying a previously persisted document.
      const temporaryPath = `${target}.${randomUUID()}.tmp`;
      try {
        signal?.throwIfAborted();
        await files.writeFile(temporaryPath, JSON.stringify(scene, null, 2), "utf-8");
        signal?.throwIfAborted();
        await files.rename(temporaryPath, target);
      } finally {
        await cleanup(temporaryPath);
      }
    },
    async read(id: string): Promise<Scene> {
      const target = scenePath(id);
      try {
        const stat = await files.stat(target);
        if (stat.size > MAX_SCENE_FILE_BYTES) throw new ServiceError(413, { error: "Stored scene is too large." });
        const content = await files.readFile(target, "utf-8");
        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch {
          throw new ServiceError(409, { error: "Stored scene is invalid." });
        }
        const validation = validateScene(parsed);
        if (!validation.ok) throw new ServiceError(409, { error: "Stored scene is invalid.", issues: validation.issues });
        return parsed as Scene;
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") throw new ServiceError(404, { error: "Scene not found." });
        throw error;
      }
    }
  };
}

export type SceneStore = ReturnType<typeof createSceneStore>;
