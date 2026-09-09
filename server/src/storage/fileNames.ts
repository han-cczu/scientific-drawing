import { randomUUID } from "node:crypto";
import { logger } from "../logger";
export const SAFE_FILE_BASE_MAX_LENGTH = 80;

export function sanitizeUnicodeFileBase(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  const cleaned = raw
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const truncated = Array.from(cleaned)
    .filter((char) => !isUnpairedSurrogate(char))
    .slice(0, SAFE_FILE_BASE_MAX_LENGTH)
    .join("")
    .replace(/^-+|-+$/g, "");
  return truncated;
}

function isUnpairedSurrogate(char: string) {
  if (char.length !== 1) {
    return false;
  }
  const code = char.charCodeAt(0);
  return code >= 0xd800 && code <= 0xdfff;
}

export function sanitizeFileBase(value: unknown) {
  logger.info("开始清洗导出文件名...", { value });
  const raw = typeof value === "string" ? value.trim() : "";
  const sanitized = raw
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SAFE_FILE_BASE_MAX_LENGTH);
  const result = sanitized || randomUUID();
  logger.info("清洗导出文件名完成", { result });
  return result;
}

export function safeSceneId(value: unknown) {
  logger.info("开始校验 scene id...", { value });
  const result =
    typeof value === "string" &&
    value.length <= SAFE_FILE_BASE_MAX_LENGTH &&
    /^[a-zA-Z0-9_-]+$/.test(value)
      ? value
      : "";
  logger.info("校验 scene id 完成", { valid: Boolean(result) });
  return result;
}
