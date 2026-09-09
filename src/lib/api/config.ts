import { logger } from "../logger";
import type { AppConfig, WritableAppConfig, TestConfigResult } from "../../shared/apiContracts";
import { readAppConfigResponse, parseTestConfigResult, invalidTestConfigResponse } from "./responses";
import { hasJsonContentType, jsonRequest } from "./transport";

export async function loadAppConfig(): Promise<AppConfig> {
  logger.info("开始读取应用配置...");
  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error(`Config failed: ${response.status}`);
  }
  const payload = await readAppConfigResponse(response, "读取应用配置");
  logger.info("读取应用配置完成", payload);
  return payload;
}

export async function saveAppConfig(payload: WritableAppConfig): Promise<AppConfig> {
  logger.info("开始保存 AI 配置...", { baseUrl: payload.baseUrl, model: payload.reconstructModel });
  const response = await fetch("/api/config", jsonRequest("POST", payload));
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Save config failed: ${response.status} ${text}`);
  }
  const config = await readAppConfigResponse(response, "保存 AI 配置");
  logger.info("保存 AI 配置完成", { source: config.source });
  return config;
}

export async function deleteAppConfig(): Promise<AppConfig> {
  logger.info("开始清空 AI 配置...");
  const response = await fetch("/api/config", { method: "DELETE" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Delete config failed: ${response.status} ${text}`);
  }
  const config = await readAppConfigResponse(response, "清空 AI 配置");
  logger.info("清空 AI 配置完成", { source: config.source });
  return config;
}

export async function testAppConfig(payload: WritableAppConfig): Promise<TestConfigResult> {
  logger.info("开始测试 AI 配置...");
  const response = await fetch("/api/config/test", jsonRequest("POST", payload));
  if (!hasJsonContentType(response)) {
    logger.warn("测试 AI 配置响应非 JSON", { status: response.status });
    return invalidTestConfigResponse(response.status, "服务返回异常");
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    logger.warn("测试 AI 配置响应 JSON 解析失败", { status: response.status, error: String(error) });
    return invalidTestConfigResponse(response.status, "服务响应 JSON 解析失败");
  }
  const result = parseTestConfigResult(data);
  if (!result) {
    logger.warn("测试 AI 配置响应结构非法", { status: response.status });
    return invalidTestConfigResponse(response.status, "服务响应格式异常");
  }
  logger.info("测试 AI 配置完成", { ok: result.ok });
  return result;
}
