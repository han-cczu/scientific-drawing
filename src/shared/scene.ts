export type SceneNodeType =
  | "text"
  | "rect"
  | "rounded_rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "image"
  | "grid"
  | "feature_grid"
  | "bracket"
  | "operator";

export type SceneStyle = {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  color?: string;
  opacity?: number;
  dash?: string;
};

export type SceneNode = {
  id: string;
  type: SceneNodeType;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  text?: string;
  points?: Array<{ x: number; y: number }>;
  source?: string;
  symbol?: string;
  rows?: number;
  cols?: number;
  rowColors?: string[];
  columnShades?: number[];
  cells?: Array<{ row: number; col: number; fill?: string; text?: string; color?: string }>;
  orientation?: "left" | "right" | "up" | "down";
  tickPositions?: number[];
  style: SceneStyle;
  locked?: boolean;
};

export type SceneEdgeType = "arrow" | "line" | "join" | "fork";

export type SceneEdge = {
  id: string;
  type: SceneEdgeType;
  from?: string;
  to?: string;
  fromPoint?: { x: number; y: number };
  toPoint?: { x: number; y: number };
  points?: Array<{ x: number; y: number }>;
  label?: string;
  style: SceneStyle;
};

export type Scene = {
  version: "0.1";
  page: {
    width: number;
    height: number;
    background: string;
    units: "px";
  };
  metadata: {
    id: string;
    title: string;
    sourceImage?: string;
    createdAt: string;
    engine: string;
    notes: string[];
  };
  nodes: SceneNode[];
  edges: SceneEdge[];
};

export type AnalyzeResponse = {
  scene: Scene;
  sceneUrl: string;
  sourceUrl: string;
};
