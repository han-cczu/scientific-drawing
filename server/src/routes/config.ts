import express from "express";
import { logger } from "../logger";
import { ConfigValidationError } from "../storage/configValidation";
import type { ConfigService } from "../services/configService";

export function createConfigRouter(service: ConfigService) {
  const router = express.Router();
  router.get("/config", async (_req, res) => res.json(await service.read()));
  router.post("/config", express.json({ limit: "16kb" }), async (req, res) => {
    try {
      res.json(await service.save(req.body));
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        res.status(400).json({ error: error.message });
      } else {
        logger.error("保存 AI 配置失败", { error: String(error) });
        res.status(500).json({ error: "Failed to persist config." });
      }
    }
  });
  router.delete("/config", async (_req, res) => {
    try {
      res.json(await service.remove());
    } catch (error) {
      logger.error("清空 AI 配置失败", { error: String(error) });
      res.status(500).json({ error: "Failed to delete config." });
    }
  });
  router.post("/config/test", express.json({ limit: "16kb" }), async (req, res) => {
    try {
      res.json(await service.test(req.body));
    } catch (error) {
      if (!(error instanceof ConfigValidationError)) throw error;
      res.status(400).json({ ok: false, code: "VALIDATION", error: error.message, models: [] });
    }
  });
  return router;
}
