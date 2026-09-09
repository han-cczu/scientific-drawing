import { useEffect, useState } from "react";
import {
  clearStoredScene,
  isSceneWorthPersisting,
  saveStoredScene,
} from "../../lib/sceneStore";
import type { Scene } from "../../shared/scene";
import type { SaveStatus } from "../TopBar";

export function useScenePersistence(
  scene: Scene,
  busy: boolean,
  restored: boolean,
): SaveStatus {
  const [persisted, setPersisted] = useState({ scene, restored });
  const dirty = persisted.scene !== scene;
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      const result = isSceneWorthPersisting(scene)
        ? saveStoredScene(scene)
        : clearStoredScene();
      if (result === "ok") setPersisted({ scene, restored: false });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [dirty, scene]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      // Clearing an empty document can fail too; its old persisted version must not be called saved.
      if (busy || dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [busy, dirty]);
  return dirty ? "editing" : persisted.restored ? "restored" : "saved";
}
