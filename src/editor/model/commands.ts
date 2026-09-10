import type { Scene, SceneNode, SceneStyle } from "../../shared/scene";
import {
  moveNodes,
  removeNode,
  resizeNodeFromHandle,
  setNodeHidden,
  setNodeLocked,
  updateNode,
  updateNodeStyle,
  type LayerMoveDirection,
  type ResizeHandle,
  type SceneBox,
} from "../sceneOps";
import type { AlignKind } from "./types";

export type EditCommand =
  | { type: "add"; nodes: SceneNode[] }
  | { type: "edge"; edge: Scene["edges"][number] }
  | { type: "delete"; ids: string[] }
  | { type: "lock"; ids: string[]; locked: boolean }
  | { type: "hidden"; id: string; hidden: boolean }
  | { type: "style"; ids: string[]; patch: SceneStyle }
  | { type: "node"; id: string; patch: Partial<SceneNode> }
  | { type: "move"; ids: string[]; dx: number; dy: number }
  | {
      type: "resize";
      id: string;
      handle: ResizeHandle;
      box: SceneBox;
      dx: number;
      dy: number;
    }
  | { type: "layer"; ids: string[]; direction: LayerMoveDirection }
  | { type: "align"; ids: string[]; kind: AlignKind };

const editableIds = (scene: Scene, ids: string[]) =>
  ids.filter((id) =>
    scene.nodes.some((node) => node.id === id && !node.locked && !node.hidden),
  );

export function applyEditCommand(scene: Scene, command: EditCommand): Scene {
  switch (command.type) {
    case "add":
      return command.nodes.length
        ? { ...scene, nodes: [...scene.nodes, ...command.nodes] }
        : scene;
    case "edge":
      return { ...scene, edges: [...scene.edges, command.edge] };
    case "delete":
      return editableIds(scene, command.ids).reduce(
        (next, id) => removeNode(next, id),
        scene,
      );
    case "lock":
      return command.ids.reduce(
        (next, id) => setNodeLocked(next, id, command.locked),
        scene,
      );
    case "hidden":
      return setNodeHidden(scene, command.id, command.hidden);
    case "style":
      return editableIds(scene, command.ids).reduce(
        (next, id) => updateNodeStyle(next, id, command.patch),
        scene,
      );
    case "node":
      return editableIds(scene, [command.id]).length
        ? updateNode(scene, command.id, command.patch)
        : scene;
    case "move":
      return command.dx || command.dy
        ? moveNodes(
            scene,
            editableIds(scene, command.ids),
            command.dx,
            command.dy,
          )
        : scene;
    case "resize":
      return editableIds(scene, [command.id]).length
        ? resizeNodeFromHandle(
            scene,
            command.id,
            command.handle,
            command.box,
            command.dx,
            command.dy,
          )
        : scene;
    case "layer":
      return moveSelectionLayers(scene, command.ids, command.direction);
    case "align":
      return alignNodes(scene, editableIds(scene, command.ids), command.kind);
  }
}

function moveSelectionLayers(
  scene: Scene,
  ids: string[],
  direction: LayerMoveDirection,
): Scene {
  const requested = new Set(ids);
  const selected = new Set(
    scene.nodes
      .filter(
        (node) =>
          requested.has(node.id) && !(node.type === "image" && node.locked),
      )
      .map((node) => node.id),
  );
  if (selected.size === 0) return scene;
  // The source-image prefix stays below editable content. Selection order is a
  // click history, so layer operations always use the scene's stacking order.
  const firstEditable = scene.nodes.findIndex(
    (node) => !(node.type === "image" && node.locked),
  );
  const prefix = scene.nodes.slice(0, firstEditable);
  let nodes = [...scene.nodes];
  if (direction === "front" || direction === "back") {
    const content = scene.nodes.slice(firstEditable);
    const moving = content.filter((node) => selected.has(node.id));
    const remaining = content.filter((node) => !selected.has(node.id));
    nodes = [
      ...prefix,
      ...(direction === "front"
        ? [...remaining, ...moving]
        : [...moving, ...remaining]),
    ];
  } else if (direction === "forward") {
    // A selected neighbour moves with the group; swapping it would reverse the
    // group when its last member is already at the edge.
    for (let i = nodes.length - 2; i >= firstEditable; i -= 1) {
      if (selected.has(nodes[i].id) && !selected.has(nodes[i + 1].id))
        [nodes[i], nodes[i + 1]] = [nodes[i + 1], nodes[i]];
    }
  } else {
    for (let i = firstEditable + 1; i < nodes.length; i += 1) {
      if (selected.has(nodes[i].id) && !selected.has(nodes[i - 1].id))
        [nodes[i], nodes[i - 1]] = [nodes[i - 1], nodes[i]];
    }
  }
  return nodes.every((node, index) => node === scene.nodes[index])
    ? scene
    : { ...scene, nodes };
}

function alignNodes(scene: Scene, ids: string[], kind: AlignKind): Scene {
  const nodes = scene.nodes.filter((node) => ids.includes(node.id));
  if (nodes.length < 2) return scene;
  const left = Math.min(...nodes.map((n) => n.x));
  const right = Math.max(...nodes.map((n) => n.x + n.w));
  const top = Math.min(...nodes.map((n) => n.y));
  const bottom = Math.max(...nodes.map((n) => n.y + n.h));
  return nodes.reduce((next, node) => {
    const x =
      kind === "left"
        ? left
        : kind === "right"
          ? right - node.w
          : kind === "h-center"
            ? (left + right - node.w) / 2
            : node.x;
    const y =
      kind === "top"
        ? top
        : kind === "bottom"
          ? bottom - node.h
          : kind === "v-center"
            ? (top + bottom - node.h) / 2
            : node.y;
    return moveNodes(next, [node.id], x - node.x, y - node.y);
  }, scene);
}
