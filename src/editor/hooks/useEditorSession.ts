import { useState, useSyncExternalStore } from "react";
import { isSceneWorthPersisting, loadStoredScene } from "../../lib/sceneStore";
import { createBlankScene } from "../sceneOps";
import { createEditorSession } from "../model/session";

export function useEditorSession() {
  const [initial] = useState(() => {
    const stored = loadStoredScene();
    const restored = Boolean(stored && isSceneWorthPersisting(stored));
    return {
      restored,
      session: createEditorSession(
        restored && stored ? stored : createBlankScene(),
      ),
    };
  });
  const state = useSyncExternalStore(
    initial.session.subscribe,
    initial.session.getSnapshot,
  );
  return { session: initial.session, state, restored: initial.restored };
}
