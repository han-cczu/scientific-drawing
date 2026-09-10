import { randomUUID } from "node:crypto";
import type { ExportKind } from "@shared/apiContracts";
import type { Scene } from "../scene/types";
import { sceneToSvg } from "../scene/svg";
import { sceneToPptx } from "../scene/pptx";
import { resolveLocalAssetPath } from "../paths";
import { sanitizeFileBase, sanitizeUnicodeFileBase } from "../storage/fileNames";
import { validateSceneForExport } from "./sceneValidation";
import { ServiceError } from "./serviceError";

export function createExportKindConfig(resolveAssetPath: (source: unknown) => string | null = resolveLocalAssetPath): Record<ExportKind, {
  ext: string;
  contentType: string;
  render: (scene: Scene) => Promise<string | Buffer>;
}> {
  return {
    svg: { ext: "svg", contentType: "image/svg+xml; charset=utf-8", render: (scene) => sceneToSvg(scene, resolveAssetPath) },
    pptx: { ext: "pptx", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", render: (scene) => sceneToPptx(scene, resolveAssetPath) },
    json: { ext: "scene.json", contentType: "application/json; charset=utf-8", render: async (scene) => JSON.stringify(scene, null, 2) }
  };
}
export const exportKindConfig = createExportKindConfig();

export function createExportService(resolveAssetPath: (source: unknown) => string | null) {
  const exporters = createExportKindConfig(resolveAssetPath);
  return async (kind: string, value: unknown) => {
    const config = Object.hasOwn(exporters, kind) ? exporters[kind as ExportKind] : undefined;
    if (!config) throw new ServiceError(404, { error: "Unsupported export kind." });
    const validation = validateSceneForExport(value);
    if (!validation.ok) throw new ServiceError(400, { error: "Invalid scene.", issues: validation.issues });
    const scene = validation.scene;
    const asciiName = `${sanitizeFileBase(scene.metadata.title || scene.metadata.id || randomUUID())}.${config.ext}`;
    const unicodeBase = sanitizeUnicodeFileBase(scene.metadata.title);
    const downloadName = unicodeBase ? `${unicodeBase}.${config.ext}` : asciiName;
    return {
      content: await config.render(scene),
      contentType: config.contentType,
      contentDisposition: `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
    };
  };
}
