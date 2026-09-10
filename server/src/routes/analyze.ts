import express from "express";
import type { createAnalyzeService } from "../services/analyzeService";
import { isClientAbort, isInvalidImageDataError } from "./reconstructErrors";
import { observeClientAbort } from "./clientAbort";

export function createAnalyzeRouter(service: ReturnType<typeof createAnalyzeService>, uploadImage: express.RequestHandler) {
  const router = express.Router();
  router.post("/analyze", uploadImage, async (req, res, next) => {
    if (!req.file) {
      res.status(400).json({ error: "Missing image file." });
      return;
    }
    const abort = observeClientAbort(res);
    try {
      res.json(await service(req.file, req.body?.title, abort.signal));
    } catch (error) {
      if (isClientAbort(error) || res.destroyed) return;
      if (isInvalidImageDataError(error)) {
        res.status(400).json({ error: "Invalid image data." });
      } else {
        next(error);
      }
    } finally {
      abort.dispose();
    }
  });
  return router;
}
