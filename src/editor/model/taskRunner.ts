import type { Scene } from "../../shared/scene";
import type { EditorSession } from "./session";
import type { TaskKind, TaskToken } from "./types";

export function createSceneTaskRunner(session: EditorSession) {
  let active: { token: TaskToken; controller: AbortController } | null = null;
  return {
    cancel() {
      const previous = active;
      active = null;
      if (previous) {
        previous.controller.abort();
        session.dispatch({ type: "finishTask", token: previous.token });
      }
    },
    async run<T>(
      kind: TaskKind,
      execute: (scene: Scene, signal: AbortSignal) => Promise<T>,
      success: (value: T, token: TaskToken) => void,
      failure: (error: unknown) => void,
    ) {
      const token = session.beginTask(kind);
      if (!token) return;
      const controller = new AbortController();
      active = { token, controller };
      try {
        const result = await execute(
          session.getSnapshot().history.present,
          controller.signal,
        );
        if (!controller.signal.aborted && session.isCurrent(token))
          success(result, token);
      } catch (error) {
        if (!controller.signal.aborted && session.isCurrent(token))
          failure(error);
      } finally {
        if (active?.token.id === token.id) active = null;
        session.dispatch({ type: "finishTask", token });
      }
    },
  };
}
