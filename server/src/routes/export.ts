import express from "express";
import type { createExportService } from "../services/exportService";

export function createExportRouter(service: ReturnType<typeof createExportService>) {
  const router = express.Router();
  router.post("/export/:kind", express.json({ limit: "20mb" }), async (req, res) => {
    const result = await service(req.params.kind, req.body?.scene);
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Content-Disposition", result.contentDisposition);
    res.send(result.content);
  });
  return router;
}
