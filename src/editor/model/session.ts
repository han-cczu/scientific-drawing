import type { Scene } from "../../shared/scene";
import {
  createEditorState,
  editorReducer,
  isCurrentTask,
  type EditorAction,
} from "./reducer";
import type { TaskKind, TaskToken } from "./types";

export function createEditorSession(scene: Scene) {
  let state = createEditorState(scene);
  let sequence = 0;
  const listeners = new Set<() => void>();
  const dispatch = (action: EditorAction) => {
    const next = editorReducer(state, action);
    if (next !== state) {
      state = next;
      for (const listener of listeners) listener();
    }
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch,
    beginTask(kind: TaskKind): TaskToken | null {
      if (state.task) return null;
      dispatch({ type: "commitInteraction" });
      const token = {
        id: ++sequence,
        kind,
        documentId: state.history.present.metadata.id,
        revision: state.revision,
      };
      dispatch({ type: "startTask", token });
      return token;
    },
    isCurrent: (token: TaskToken) => isCurrentTask(state, token),
  };
}
export type EditorSession = ReturnType<typeof createEditorSession>;
