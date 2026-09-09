import express from "express";
import type { Services } from "../services";
import { createAnalyzeRouter } from "./analyze";
import { createConfigRouter } from "./config";
import { createExportRouter } from "./export";
import { createReconstructRouter } from "./reconstruct";
import { createScenesRouter } from "./scenes";
import { csrfGuard } from "./originGuard";
import { createUploadImage } from "./upload";

export function createApiRouter(services: Services) {
  const router = express.Router();
  const uploadImage = createUploadImage(services.paths.uploadDir);
  router.use(csrfGuard);
  // Liveness never depends on storage reads or a model service.
  router.get("/health", (_req, res) => res.json({ ok: true }));
  router.use(createAnalyzeRouter(services.analyze, uploadImage));
  router.use(createReconstructRouter(services.reconstruction, uploadImage));
  router.use(createConfigRouter(services.config));
  router.use(createScenesRouter(services.store));
  router.use(createExportRouter(services.exportScene));
  return router;
}
