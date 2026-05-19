import type { ResizeHandle, SceneBox } from "./sceneOps";

export type DragState = {
  nodeIds: string[];
  startX: number;
  startY: number;
};

export type ResizeState = {
  nodeId: string;
  handle: ResizeHandle;
  startBox: SceneBox;
  startX: number;
  startY: number;
};

export type BoxSelectState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

export type PanState = {
  clientX: number;
  clientY: number;
};
