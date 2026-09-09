import type { Scene } from "./scene";

/** Public wire contracts. Runtime/provider secrets remain in server configuration. */
export type ReconstructionMode = "color" | "mono";
export type RegionMergeMode = "replace" | "overlay";
export type SceneBox = { x: number; y: number; w: number; h: number };
export type ApiSceneBox = SceneBox;
export type ExportKind = "svg" | "pptx" | "json";
export type ConfigSource = "env" | "file" | "none";

export type AppConfig = {
  aiReconstructionAvailable: boolean;
  provider: "openai-compatible";
  baseUrl: string;
  reconstructModel: string;
  reconstructModels: string[];
  modelListAvailable: boolean;
  modelListError: string | null;
  hasApiKey: boolean;
  source: ConfigSource;
  maskedTail: string | null;
};

export type WritableAppConfig = { apiKey: string; baseUrl: string; reconstructModel: string };
export type SafeAiProviderConfig = AppConfig;
export type WritableAiConfigInput = WritableAppConfig;
export type SceneResponse = { scene: Scene; sceneUrl: string; sourceUrl: string };
export type AnalyzeResponse = SceneResponse;
export type ReconstructRegionRequest = {
  scene: Scene;
  region: SceneBox;
  mode: ReconstructionMode;
  model: string;
  mergeMode: RegionMergeMode;
};
export type ExportSceneRequest = { scene: Scene };

export const TEST_CONFIG_ERROR_CODES = ["AUTH", "NETWORK", "INVALID_RESPONSE", "VALIDATION", "UNKNOWN"] as const;
export type TestConfigErrorCode = typeof TEST_CONFIG_ERROR_CODES[number];
export type TestConfigResult =
  | { ok: true; modelCount: number; models: string[] }
  | { ok: false; code: TestConfigErrorCode; error: string; models: string[] };

export const RECONSTRUCT_ERROR_CODES = ["AUTH", "INVALID_IMAGE", "TIMEOUT", "BAD_MODEL_OUTPUT", "INVALID_SCENE", "NETWORK", "UPSTREAM", "UNKNOWN"] as const;
export type ReconstructErrorCode = typeof RECONSTRUCT_ERROR_CODES[number];
export type ReconstructErrorResponse = { error: { code: ReconstructErrorCode; message: string; hint?: string } };
/** During migration some HTTP failures still use a plain string envelope. */
export type LegacyErrorResponse = { error: string };

export function isReconstructErrorCode(value: unknown): value is ReconstructErrorCode {
  return typeof value === "string" && RECONSTRUCT_ERROR_CODES.some((code) => code === value);
}

export function isTestConfigErrorCode(value: unknown): value is TestConfigErrorCode {
  return typeof value === "string" && TEST_CONFIG_ERROR_CODES.some((code) => code === value);
}
