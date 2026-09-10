import type { Scene } from "../../shared/scene";
import {
  commitHistoryPresent,
  createHistoryState,
  pushHistory,
  redoHistory,
  replaceHistoryPresent,
  undoHistory,
  type HistoryState,
} from "../history";
import type { SceneBox } from "../sceneOps";
import type { Viewport } from "../viewport";
import { applyEditCommand, type EditCommand } from "./commands";
import type { TaskToken, Tool, ViewMode } from "./types";

export type EditorState = {
  history: HistoryState<Scene>;
  revision: number;
  selectedIds: string[];
  tool: Tool;
  panMode: boolean;
  viewMode: ViewMode;
  viewport: Viewport;
  pendingEdgeFromId: string | null;
  pendingRegion: SceneBox | null;
  interactionBaseline: Scene | null;
  interactionEpoch: number;
  task: TaskToken | null;
};

export type EditorAction =
  | {
      type: "edit";
      command: EditCommand;
      preview?: boolean;
      interactionEpoch?: number;
    }
  | {
      type:
        | "commitInteraction"
        | "cancelInteraction"
        | "undo"
        | "redo"
        | "cancelTool";
    }
  | { type: "select"; ids: string[] }
  | { type: "tool"; tool: Tool; pan?: boolean }
  | { type: "view"; mode: ViewMode }
  | { type: "viewport"; viewport: Viewport }
  | { type: "region"; region: SceneBox | null }
  | { type: "edgeFrom"; id: string | null }
  | { type: "startTask"; token: TaskToken }
  | { type: "finishTask"; token: TaskToken }
  | { type: "taskResult"; token: TaskToken; scene: Scene; replace: boolean };

export function createEditorState(scene: Scene): EditorState {
  return {
    history: createHistoryState(scene),
    revision: 0,
    selectedIds: [],
    tool: "select",
    panMode: false,
    viewMode: "result",
    viewport: { scale: 1, offset: { x: 0, y: 0 } },
    pendingEdgeFromId: null,
    pendingRegion: null,
    interactionBaseline: null,
    interactionEpoch: 0,
    task: null,
  };
}

export function isCurrentTask(state: EditorState, token: TaskToken): boolean {
  return (
    state.task?.id === token.id &&
    state.revision === token.revision &&
    state.history.present.metadata.id === token.documentId
  );
}

function withHistory(
  state: EditorState,
  history: HistoryState<Scene>,
): EditorState {
  if (state.history === history) return state;
  return {
    ...state,
    history,
    revision: state.revision + 1,
    selectedIds: state.selectedIds.filter((id) =>
      history.present.nodes.some(
        (node) => node.id === id && !node.hidden && !node.locked,
      ),
    ),
  };
}

// Identity checks cover normal commands; structural equality prevents no-op edits from adding undo entries.
function sameScene(a: Scene, b: Scene): boolean {
  if (a === b) return true;
  if (
    a.page !== b.page ||
    a.metadata !== b.metadata ||
    a.nodes.length !== b.nodes.length ||
    a.edges.length !== b.edges.length
  )
    return false;
  // Unchanged nodes retain their references: dragging one object only compares that object's fields.
  return (
    a.nodes.every(
      (node, index) =>
        node === b.nodes[index] ||
        JSON.stringify(node) === JSON.stringify(b.nodes[index]),
    ) &&
    a.edges.every(
      (edge, index) =>
        edge === b.edges[index] ||
        JSON.stringify(edge) === JSON.stringify(b.edges[index]),
    )
  );
}

export function editorReducer(
  state: EditorState,
  action: EditorAction,
): EditorState {
  switch (action.type) {
    case "select":
      return {
        ...state,
        selectedIds: [...new Set(action.ids)].filter((id) =>
          state.history.present.nodes.some(
            (n) => n.id === id && !n.locked && !n.hidden,
          ),
        ),
      };
    case "viewport":
      return { ...state, viewport: action.viewport };
    case "view":
      return {
        ...state,
        viewMode: action.mode,
        selectedIds: [],
        pendingRegion: null,
        pendingEdgeFromId: null,
      };
    case "tool":
      return state.task
        ? action.tool === "select"
          ? { ...state, panMode: action.pan ?? false }
          : state
        : {
            ...state,
            tool: action.tool,
            panMode: action.pan ?? false,
            pendingRegion: null,
            pendingEdgeFromId: null,
          };
    case "region":
      return state.task && action.region
        ? state
        : { ...state, pendingRegion: action.region, selectedIds: [] };
    case "edgeFrom":
      return state.task ? state : { ...state, pendingEdgeFromId: action.id };
    case "cancelTool":
      return {
        ...state,
        tool: "select",
        panMode: false,
        pendingRegion: null,
        pendingEdgeFromId: null,
      };
    case "startTask":
      return state.task || !isTaskStampValid(state, action.token)
        ? state
        : { ...state, task: action.token };
    case "finishTask":
      return state.task?.id === action.token.id
        ? { ...state, task: null }
        : state;
    case "taskResult": {
      if (!isCurrentTask(state, action.token)) return state;
      const next = withHistory(
        state,
        action.replace
          ? createHistoryState(action.scene)
          : pushHistory(state.history, action.scene),
      );
      return {
        ...next,
        task: null,
        interactionBaseline: null,
        selectedIds: [],
        tool: "select",
        panMode: false,
        pendingRegion: null,
        pendingEdgeFromId: null,
        viewMode: "result",
        viewport: action.replace
          ? { scale: 1, offset: { x: 0, y: 0 } }
          : state.viewport,
      };
    }
    case "edit": {
      if (state.task || state.viewMode === "original") return state;
      if (
        action.preview &&
        action.interactionEpoch !== undefined &&
        action.interactionEpoch !== state.interactionEpoch
      )
        return state;
      const present = state.history.present;
      const next = applyEditCommand(present, action.command);
      if (sameScene(present, next)) return state;
      const base = action.preview
        ? state
        : editorReducer(state, { type: "commitInteraction" });
      return {
        ...withHistory(
          base,
          action.preview
            ? replaceHistoryPresent(base.history, next)
            : pushHistory(base.history, next),
        ),
        interactionBaseline: action.preview
          ? (state.interactionBaseline ?? present)
          : null,
      };
    }
    case "commitInteraction": {
      if (!state.interactionBaseline) return state;
      const baseline = state.interactionBaseline;
      const history = sameScene(baseline, state.history.present)
        ? replaceHistoryPresent(state.history, baseline)
        : commitHistoryPresent(state.history, baseline);
      return { ...state, history, interactionBaseline: null };
    }
    case "cancelInteraction":
      return state.interactionBaseline
        ? {
            ...withHistory(
              state,
              replaceHistoryPresent(state.history, state.interactionBaseline),
            ),
            interactionBaseline: null,
          }
        : state;
    case "undo":
    case "redo": {
      if (state.task) return state;
      const base = editorReducer(state, { type: "commitInteraction" });
      // History navigation terminates any pointer gesture that started from the
      // previous history state, including a pointer that has not been released.
      return {
        ...withHistory(
          base,
          action.type === "undo"
            ? undoHistory(base.history)
            : redoHistory(base.history),
        ),
        interactionEpoch: state.interactionEpoch + 1,
        pendingEdgeFromId: null,
      };
    }
  }
}

function isTaskStampValid(state: EditorState, token: TaskToken): boolean {
  return (
    state.revision === token.revision &&
    state.history.present.metadata.id === token.documentId
  );
}
