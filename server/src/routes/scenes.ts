import express from "express";
import type { SceneStore } from "../storage/sceneStore";

export function createScenesRouter(store: SceneStore) {
  const router = express.Router();
  router.get("/scenes/:id", async (req, res) => res.json(await store.read(req.params.id)));
  return router;
}
