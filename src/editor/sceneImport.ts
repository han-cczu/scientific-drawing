import { normalizeImportedScene } from "./visiomasterAdapter";
import type { Scene } from "../shared/scene";
import { validateScene, type ValidationIssue } from "../shared/sceneValidation";

export const SCENE_IMPORT_MAX_BYTES = 20 * 1024 * 1024;

export type SceneImportErrorCode = "FILE_TOO_LARGE" | "INVALID_JSON" | "INVALID_SCENE";

export class SceneImportError extends Error {
  constructor(
    public readonly code: SceneImportErrorCode,
    message: string,
    public readonly issues: ValidationIssue[] = []
  ) {
    super(message);
    this.name = "SceneImportError";
  }
}

export async function parseSceneImportFile(file: Pick<File, "size" | "text">): Promise<Scene> {
  /*
   * ========================================================================
   * 步骤1：解析本地 scene.json 导入文件
   * ========================================================================
   * 目标：
   *   1) 读取前限制文件大小，避免浏览器主线程处理超大 JSON
   *   2) 兼容当前协议和 Visiomaster 风格 scene
   *   3) 返回前执行共享 schema 校验
   */
  if (file.size > SCENE_IMPORT_MAX_BYTES) {
    throw new SceneImportError("FILE_TOO_LARGE", "Scene file is too large.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new SceneImportError("INVALID_JSON", "Scene file is not valid JSON.");
  }

  const imported = normalizeImportedScene(parsed);
  const validation = validateScene(imported);
  if (!validation.ok) {
    throw new SceneImportError("INVALID_SCENE", "Scene schema is invalid.", validation.issues);
  }
  return imported;
}
