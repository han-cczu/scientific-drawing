import type { SceneNodeType } from "../../shared/scene";

export type Tool =
  | "select"
  | "connector"
  | "region-reconstruct"
  | SceneNodeType;
export type AlignKind =
  | "left"
  | "h-center"
  | "right"
  | "top"
  | "v-center"
  | "bottom";
export type ViewMode = "original" | "result";
export type TaskKind =
  | "analyze"
  | "import"
  | "reconstruct"
  | "region"
  | "export";
export type TaskToken = {
  id: number;
  kind: TaskKind;
  documentId: string;
  revision: number;
};
export type Notice = { text: string; tone: "info" | "success" | "error" };
export type Notify = (text: string, tone?: Notice["tone"]) => void;
