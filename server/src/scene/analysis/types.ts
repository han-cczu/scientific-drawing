import type { SceneNode } from "../types";

export type ComponentBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
};

export type ColorSample = {
  r: number;
  g: number;
  b: number;
};

export type Segment = {
  orientation: "horizontal" | "vertical";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type AnalysisElement = {
  type: SceneNode["type"];
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  points?: Array<{ x: number; y: number }>;
  style: SceneNode["style"];
};
