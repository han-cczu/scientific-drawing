import express from "express";
import { logger } from "../logger";
import type { createReconstructionService } from "../services/reconstructionService";
import { ServiceError } from "../services/serviceError";
import { isClientAbort, isInvalidImageDataError, toReconstructEnvelope } from "./reconstructErrors";
import { observeClientAbort } from "./clientAbort";

export function createReconstructRouter(service: ReturnType<typeof createReconstructionService>, uploadImage: express.RequestHandler) {
  const router = express.Router();
  function handler(region: boolean): express.RequestHandler {
    return async (req, res) => {
      if (!region && !req.file) {
        res.status(400).json({ error: "Missing image file." });
        return;
      }
      const abort = observeClientAbort(res);
      try {
        const result = region
          ? await service.reconstructRegion(req.body ?? {}, abort.signal)
          : await service.reconstruct(req.file!, req.body ?? {}, abort.signal);
        res.json(result);
      } catch (error) {
        if (isClientAbort(error) || res.writableEnded || res.destroyed) return;
        if (error instanceof ServiceError) {
          res.status(error.status).json(error.body);
        } else if (isInvalidImageDataError(error)) {
          res.status(400).json({ error: { code: "INVALID_IMAGE", message: "Invalid image data.", hint: "请上传有效的 PNG、JPEG 或 WebP 图片" } });
        } else {
          const envelope = toReconstructEnvelope(error);
          logger.error("AI 重建失败", { error: String(error), code: envelope.code });
          res.status(envelope.status).json({ error: { code: envelope.code, message: envelope.message, hint: envelope.hint } });
        }
      } finally {
        abort.dispose();
      }
    };
  }
  router.post("/reconstruct", uploadImage, handler(false));
  router.post("/reconstruct-region", express.json({ limit: "20mb" }), handler(true));
  return router;
}
