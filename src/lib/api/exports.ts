import { logger } from "../logger";
import type { Scene } from "../../shared/scene";
import type { ExportKind, ExportSceneRequest } from "../../shared/apiContracts";
import { jsonRequest } from "./transport";

export type ExportDownload = {
  blob: Blob;
  filename: string;
};

export async function exportScene(scene: Scene, kind: ExportKind, signal?: AbortSignal): Promise<ExportDownload> {
  logger.info("开始导出当前场景...", { kind, nodes: scene.nodes.length });
  const response = await fetch(`/api/export/${kind}`, jsonRequest(
    "POST", { scene } satisfies ExportSceneRequest, signal
  ));
  if (!response.ok) {
    throw new Error(`Export failed: ${response.status}`);
  }
  const blob = await response.blob();
  const fallbackName = kind === "json" ? "scene.scene.json" : `scene.${kind}`;
  const filename = filenameFromContentDisposition(response.headers.get("content-disposition")) ?? fallbackName;
  logger.info("导出当前场景完成", { kind, filename, bytes: blob.size });
  return { blob, filename };
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      const filename = sanitizeDownloadFilename(decodeURIComponent(star[1].trim()));
      if (filename) {
        return filename;
      }
    } catch {
      // 编码异常时回退普通 filename
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header);
  return plain ? sanitizeDownloadFilename(plain[1]) : null;
}

function sanitizeDownloadFilename(value: string): string | null {
  const filename = value
    .normalize("NFC")
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("-")
    .replace(/[:*?"<>|\x00-\x1F\x7F]+/g, "-")
    .replace(/[-.]+$/g, "")
    .replace(/^[.-]+/g, "")
    .replace(/-+\./g, ".")
    .replace(/^-+|-+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return filename || null;
}
