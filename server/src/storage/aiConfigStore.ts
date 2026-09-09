import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, chmodSync, renameSync } from "node:fs";
import path from "node:path";
import { logger } from "../logger";
import { configPath } from "../paths";
import type { WritableAiConfigInput } from "@shared/apiContracts";
import { ConfigValidationError, normalizePersistedConfig, validateWritableConfig } from "./configValidation";

export type PersistedAiConfig = { provider: "openai-compatible"; apiKey: string; baseUrl: string; reconstructModel: string; updatedAt: string };

export function readPersistedConfig(filePath: string = configPath): PersistedAiConfig | null {
  logger.info("开始读取持久化 AI 配置...", { filePath });
  if (!existsSync(filePath)) {
    logger.info("读取持久化 AI 配置完成", { exists: false });
    return null;
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizePersistedConfig(parsed);
    if (!normalized) {
      logger.warn("读取持久化 AI 配置失败，字段非法，安全 fallback env");
      return null;
    }
    logger.info("读取持久化 AI 配置完成", {
      hasApiKey: Boolean(normalized.apiKey),
      baseUrl: normalized.baseUrl
    });
    return normalized;
  } catch (error) {
    logger.warn("读取持久化 AI 配置失败，文件损坏，安全 fallback env", { error: String(error) });
    return null;
  }
}

export function writePersistedConfig(input: WritableAiConfigInput, filePath: string = configPath) {
  const validation = validateWritableConfig(input);
  if (!validation.ok) throw new ConfigValidationError(validation.error);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const persisted: PersistedAiConfig = {
    provider: "openai-compatible",
    ...validation.value,
    updatedAt: new Date().toISOString()
  };
  const tmpPath = `${filePath}.tmp`;
  try {
    writeFileSync(tmpPath, JSON.stringify(persisted, null, 2), { encoding: "utf-8", mode: 0o600 });
    try {
      chmodSync(tmpPath, 0o600);
    } catch { /* Windows may not support POSIX permissions. */ }
    renameSync(tmpPath, filePath);
  } finally {
    try { unlinkSync(tmpPath); } catch { /* Already renamed or never created. */ }
  }
  return persisted;
}

export function deletePersistedConfig(filePath: string = configPath) {
  if (!existsSync(filePath)) return false;
  unlinkSync(filePath);
  return true;
}
