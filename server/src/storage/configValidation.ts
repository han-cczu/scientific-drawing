import type { WritableAiConfigInput } from "@shared/apiContracts";
import type { PersistedAiConfig } from "./aiConfigStore";
export const AI_CONFIG_LIMITS = { apiKey: 512, baseUrl: 256, reconstructModel: 120 } as const;

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export function validateWritableConfig(
  input: unknown,
  options?: { allowEmptyKey?: boolean }
):
  | { ok: true; value: WritableAiConfigInput }
  | { ok: false; error: string } {
  if (!isRecord(input)) {
    return { ok: false, error: "Request body must be an object." };
  }
  const allowEmptyKey = options?.allowEmptyKey === true;
  if (typeof input.apiKey !== "string") {
    return { ok: false, error: "apiKey is required." };
  }
  if (!allowEmptyKey && input.apiKey.trim().length === 0) {
    return { ok: false, error: "apiKey is required." };
  }
  if (input.apiKey.length > AI_CONFIG_LIMITS.apiKey) {
    return { ok: false, error: `apiKey exceeds ${AI_CONFIG_LIMITS.apiKey} characters.` };
  }
  if (typeof input.baseUrl !== "string" || input.baseUrl.trim().length === 0) {
    return { ok: false, error: "baseUrl is required." };
  }
  if (input.baseUrl.length > AI_CONFIG_LIMITS.baseUrl) {
    return { ok: false, error: `baseUrl exceeds ${AI_CONFIG_LIMITS.baseUrl} characters.` };
  }
  const baseUrl = input.baseUrl.trim();
  if (!isHttpUrl(baseUrl)) {
    return { ok: false, error: "baseUrl must start with http:// or https://." };
  }
  if (typeof input.reconstructModel !== "string" || input.reconstructModel.trim().length === 0) {
    return { ok: false, error: "reconstructModel is required." };
  }
  if (input.reconstructModel.length > AI_CONFIG_LIMITS.reconstructModel) {
    return { ok: false, error: `reconstructModel exceeds ${AI_CONFIG_LIMITS.reconstructModel} characters.` };
  }

  return {
    ok: true,
    value: {
      apiKey: input.apiKey.trim(),
      baseUrl,
      reconstructModel: input.reconstructModel.trim()
    }
  };
}

export function normalizePersistedConfig(value: unknown): PersistedAiConfig | null {
  if (!isRecord(value)) {
    return null;
  }
  const apiKey = typeof value.apiKey === "string" ? value.apiKey : "";
  const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl : "";
  const reconstructModel = typeof value.reconstructModel === "string" ? value.reconstructModel : "";
  // 任一关键字段缺失视为损坏
  if (!apiKey || !baseUrl || !reconstructModel) {
    return null;
  }
  const validation = validateWritableConfig({ apiKey, baseUrl, reconstructModel });
  if (!validation.ok) {
    return null;
  }
  return {
    provider: "openai-compatible",
    apiKey: validation.value.apiKey,
    baseUrl: validation.value.baseUrl,
    reconstructModel: validation.value.reconstructModel,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : ""
  };
}

function isHttpUrl(value: string) {
  if (/[\s\u0000-\u001f\u007f]/.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
