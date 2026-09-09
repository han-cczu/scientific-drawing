import { useMemo, type MouseEvent } from "react";
import type { SceneNode, SceneStyle } from "../../shared/scene";
import {
  createEdgeBetweenNodes,
  createNode,
  duplicateNode,
  selectNodesInRect,
  type LayerMoveDirection,
  type ResizeHandle,
  type SceneBox,
} from "../sceneOps";
import {
  clampViewportScale,
  clientPointToScene,
  type Viewport,
} from "../viewport";
import type { EditorSession } from "../model/session";
import { primarySelectedNode } from "../model/selection";
import type { AlignKind, Notify, Tool } from "../model/types";

export function useEditorActions(
  session: EditorSession,
  aiAvailable: boolean,
  notify: Notify,
) {
  return useMemo(() => {
    const { dispatch, getSnapshot } = session;
    const editable = () =>
      !getSnapshot().task && getSnapshot().viewMode === "result";
    const select = (ids: string[]) => dispatch({ type: "select", ids });
    return {
      select,
      tool: (tool: Tool, pan = false) => dispatch({ type: "tool", tool, pan }),
      viewport: (next: Viewport | ((previous: Viewport) => Viewport)) =>
        dispatch({
          type: "viewport",
          viewport:
            typeof next === "function" ? next(getSnapshot().viewport) : next,
        }),
      zoom: (scale: number) =>
        dispatch({
          type: "viewport",
          viewport: {
            ...getSnapshot().viewport,
            scale: clampViewportScale(scale),
          },
        }),
      resetView: () =>
        dispatch({
          type: "viewport",
          viewport: { scale: 1, offset: { x: 0, y: 0 } },
        }),
      move: (ids: string[], dx: number, dy: number, interactionEpoch: number) =>
        dispatch({
          type: "edit",
          preview: true,
          interactionEpoch,
          command: { type: "move", ids, dx, dy },
        }),
      resize: (
        id: string,
        handle: ResizeHandle,
        box: SceneBox,
        dx: number,
        dy: number,
        interactionEpoch: number,
      ) =>
        dispatch({
          type: "edit",
          preview: true,
          interactionEpoch,
          command: { type: "resize", id, handle, box, dx, dy },
        }),
      commit: () => dispatch({ type: "commitInteraction" }),
      cancelInteraction: () => dispatch({ type: "cancelInteraction" }),
      undo: () => dispatch({ type: "undo" }),
      redo: () => dispatch({ type: "redo" }),
      delete: () =>
        dispatch({
          type: "edit",
          command: { type: "delete", ids: getSnapshot().selectedIds },
        }),
      duplicate: () => {
        if (!editable()) return;
        const state = getSnapshot();
        const nodes = state.selectedIds
          .map((id) => duplicateNode(state.history.present, id))
          .filter((node): node is SceneNode => node !== null);
        dispatch({ type: "edit", command: { type: "add", nodes } });
        select(nodes.map((n) => n.id));
      },
      lockSelection: () =>
        dispatch({
          type: "edit",
          command: {
            type: "lock",
            ids: getSnapshot().selectedIds,
            locked: true,
          },
        }),
      toggleLocked: (id: string) => {
        const node = getSnapshot().history.present.nodes.find(
          (n) => n.id === id,
        );
        if (node)
          dispatch({
            type: "edit",
            command: { type: "lock", ids: [id], locked: !node.locked },
          });
      },
      toggleHidden: (id: string) => {
        const node = getSnapshot().history.present.nodes.find(
          (n) => n.id === id,
        );
        if (node)
          dispatch({
            type: "edit",
            command: { type: "hidden", id, hidden: !node.hidden },
          });
      },
      moveLayer: (id: string, direction: LayerMoveDirection) =>
        dispatch({
          type: "edit",
          command: { type: "layer", ids: [id], direction },
        }),
      arrangeLayer: (direction: LayerMoveDirection) =>
        dispatch({
          type: "edit",
          command: { type: "layer", ids: getSnapshot().selectedIds, direction },
        }),
      align: (kind: AlignKind) =>
        dispatch({
          type: "edit",
          command: { type: "align", ids: getSnapshot().selectedIds, kind },
        }),
      nodeChange: (patch: Partial<SceneNode>) => {
        const state = getSnapshot();
        const id = primarySelectedNode(
          state.history.present,
          state.selectedIds,
        )?.id;
        if (id)
          dispatch({ type: "edit", command: { type: "node", id, patch } });
      },
      styleChange: (patch: SceneStyle) =>
        dispatch({
          type: "edit",
          command: { type: "style", ids: getSnapshot().selectedIds, patch },
        }),
      boxSelect: (box: SceneBox) => {
        const state = getSnapshot();
        if (state.tool !== "region-reconstruct") {
          select(selectNodesInRect(state.history.present, box));
          return;
        }
        if (!editable() || !aiAvailable) return;
        if (Math.abs(box.w) < 4 || Math.abs(box.h) < 4) {
          notify("局部重建区域太小。", "error");
          return;
        }
        dispatch({ type: "region", region: box });
        notify("选择局部重建方式。");
      },
      activateNode: (id: string) => {
        if (!editable()) return;
        const state = getSnapshot();
        if (state.tool !== "connector") return;
        if (!state.pendingEdgeFromId) {
          dispatch({ type: "edgeFrom", id });
          select([id]);
          notify("请选择连线目标节点。");
          return;
        }
        if (state.pendingEdgeFromId !== id) {
          const scene = state.history.present;
          const next = createEdgeBetweenNodes(
            scene,
            state.pendingEdgeFromId,
            id,
          );
          if (next.edges.length > scene.edges.length)
            dispatch({
              type: "edit",
              command: {
                type: "edge",
                edge: next.edges[next.edges.length - 1],
              },
            });
        }
        dispatch({ type: "tool", tool: "select" });
        select([id]);
      },
      canvasClick: (event: MouseEvent<HTMLDivElement>) => {
        if (!editable()) return;
        const state = getSnapshot();
        if (
          state.tool === "select" ||
          state.tool === "connector" ||
          state.tool === "region-reconstruct"
        )
          return;
        if (
          event.target !== event.currentTarget &&
          !(event.target instanceof SVGSVGElement)
        )
          return;
        const svg = event.currentTarget.querySelector("svg");
        if (!svg) return;
        const point = clientPointToScene({
          clientX: event.clientX,
          clientY: event.clientY,
          rect: svg.getBoundingClientRect(),
          page: state.history.present.page,
          viewport: state.viewport,
        });
        const node = createNode(state.tool, point.x, point.y);
        dispatch({ type: "edit", command: { type: "add", nodes: [node] } });
        select([node.id]);
        dispatch({ type: "tool", tool: "select" });
      },
    };
  }, [session, aiAvailable, notify]);
}
