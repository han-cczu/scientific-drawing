import type { Scene } from "../../shared/scene";

/** The first selection is the primary node shown and edited by the inspector. */
export function primarySelectedNode(scene: Scene, selectedIds: string[]) {
  return (
    scene.nodes.find(
      (node) => node.id === selectedIds[0] && !node.locked && !node.hidden,
    ) ?? null
  );
}
