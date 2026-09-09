import type { AppConfig, ConfigSource, AnalyzeResponse, TestConfigResult } from "../../shared/apiContracts";
import { isTestConfigErrorCode } from "../../shared/apiContracts";
import { validateScene } from "../../shared/sceneValidation";
import type { Scene } from "../../shared/scene";
import { readValidatedJson } from "./transport";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isConfigSource(value: unknown): value is ConfigSource {
  return value === "env" || value === "file" || value === "none";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseAppConfig(value: unknown): AppConfig | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.aiReconstructionAvailable !== "boolean" ||
    value.provider !== "openai-compatible" ||
    typeof value.baseUrl !== "string" ||
    typeof value.reconstructModel !== "string" ||
    !isStringArray(value.reconstructModels) ||
    typeof value.modelListAvailable !== "boolean" ||
    !isNullableString(value.modelListError) ||
    typeof value.hasApiKey !== "boolean" ||
    !isConfigSource(value.source) ||
    !isNullableString(value.maskedTail)
  ) {
    return null;
  }
  return {
    aiReconstructionAvailable: value.aiReconstructionAvailable,
    provider: value.provider,
    baseUrl: value.baseUrl,
    reconstructModel: value.reconstructModel,
    reconstructModels: value.reconstructModels,
    modelListAvailable: value.modelListAvailable,
    modelListError: value.modelListError,
    hasApiKey: value.hasApiKey,
    source: value.source,
    maskedTail: value.maskedTail
  };
}
function parseAnalyzeResponse(value: unknown): AnalyzeResponse | null {
  if (!isRecord(value)) {
    return null;
  }
  const validation = validateScene(value.scene);
  if (!validation.ok || typeof value.sceneUrl !== "string" || typeof value.sourceUrl !== "string") {
    return null;
  }
  return {
    scene: value.scene as Scene,
    sceneUrl: value.sceneUrl,
    sourceUrl: value.sourceUrl
  };
}
export function parseTestConfigResult(value: unknown): TestConfigResult | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.ok === true) {
    const modelCount = value.modelCount;
    if (typeof modelCount !== "number" || !Number.isInteger(modelCount) || modelCount < 0 || !isStringArray(value.models)) {
      return null;
    }
    return {
      ok: true,
      modelCount,
      models: value.models
    };
  }
  if (value.ok === false) {
    if (!isTestConfigErrorCode(value.code) || typeof value.error !== "string" || !isStringArray(value.models)) {
      return null;
    }
    return {
      ok: false,
      code: value.code,
      error: value.error,
      models: value.models
    };
  }
  return null;
}

export function invalidTestConfigResponse(status: number, error: string): TestConfigResult {
  return {
    ok: false,
    code: "INVALID_RESPONSE",
    error: `${error}（HTTP ${status}）。`,
    models: []
  };
}

export const readAppConfigResponse = (response: Response, action: string) =>
  readValidatedJson(response, action, parseAppConfig);
export const readAnalyzeResponse = (response: Response, action: string) =>
  readValidatedJson(response, action, parseAnalyzeResponse);
