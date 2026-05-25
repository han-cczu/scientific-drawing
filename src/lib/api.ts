import { logger } from "./logger";
import type { AnalyzeResponse, Scene } from "../shared/scene";

export type ReconstructionMode = "color" | "mono";
export type RegionMergeMode = "replace" | "overlay";

export type ApiSceneBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

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

export type WritableAppConfig = {
  apiKey: string;
  baseUrl: string;
  reconstructModel: string;
};

export type TestConfigErrorCode =
  | "AUTH"
  | "NETWORK"
  | "INVALID_RESPONSE"
  | "VALIDATION"
  | "UNKNOWN";

export type TestConfigResult =
  | { ok: true; modelCount: number; models: string[] }
  | { ok: false; code: TestConfigErrorCode; error: string; models: string[] };

export async function loadAppConfig(): Promise<AppConfig> {
  /*
   * ========================================================================
   * 步骤1：读取应用配置
   * ========================================================================
   * 目标：
   *   1) 获取后端能力开关
   *   2) 控制前端是否允许 AI 重建
   */
  logger.info("开始读取应用配置...");

  // 1.1 请求配置接口
  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error(`Config failed: ${response.status}`);
  }

  // 1.2 解析配置
  const payload = await response.json() as AppConfig;
  logger.info("读取应用配置完成", payload);
  return payload;
}

export async function saveAppConfig(payload: WritableAppConfig): Promise<AppConfig> {
  /*
   * ========================================================================
   * 步骤1：保存 AI 配置到后端
   * ========================================================================
   * 目标：
   *   1) 把 UI 表单写入 data/config.json
   *   2) 返回新的安全配置以便前端刷新 state
   */
  logger.info("开始保存 AI 配置...", { baseUrl: payload.baseUrl, model: payload.reconstructModel });

  // 1.1 提交请求
  const response = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  // 1.2 解析响应
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Save config failed: ${response.status} ${text}`);
  }
  const config = await response.json() as AppConfig;
  logger.info("保存 AI 配置完成", { source: config.source });
  return config;
}

export async function deleteAppConfig(): Promise<AppConfig> {
  /*
   * ========================================================================
   * 步骤1：清空 UI 写入的 AI 配置
   * ========================================================================
   * 目标：
   *   1) 删除 data/config.json，让运行时 fallback env
   *   2) 返回清空后的新配置
   */
  logger.info("开始清空 AI 配置...");

  // 1.1 提交请求
  const response = await fetch("/api/config", { method: "DELETE" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Delete config failed: ${response.status} ${text}`);
  }

  // 1.2 返回新配置
  const config = await response.json() as AppConfig;
  logger.info("清空 AI 配置完成", { source: config.source });
  return config;
}

export async function testAppConfig(payload: WritableAppConfig): Promise<TestConfigResult> {
  /*
   * ========================================================================
   * 步骤1：测试 AI 配置但不落盘
   * ========================================================================
   * 目标：
   *   1) 让用户在保存前确认 key/baseUrl 有效
   *   2) 区分 AUTH / NETWORK / INVALID_RESPONSE / VALIDATION / UNKNOWN 错误码
   *   3) 后端在 apiKey 留空且已有 saved key 时会复用 saved
   */
  logger.info("开始测试 AI 配置...");

  // 1.1 提交请求
  const response = await fetch("/api/config/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  // 1.2 即便 400 也是受控响应；但网关 5xx 可能返回 HTML，需先确认是 JSON 再解析
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    logger.warn("测试 AI 配置响应非 JSON", { status: response.status });
    return { ok: false, code: "INVALID_RESPONSE", error: `服务返回异常（HTTP ${response.status}）。`, models: [] };
  }
  const data = await response.json() as TestConfigResult;
  logger.info("测试 AI 配置完成", { ok: data.ok });
  return data;
}

export async function analyzeImage(file: File): Promise<AnalyzeResponse> {
  /*
   * ========================================================================
   * 步骤1：上传图片并请求分析
   * ========================================================================
   * 目标：
   *   1) 把本地图片提交给后端
   *   2) 获取 scene.json 起始场景
   */
  logger.info("开始上传图片并请求分析...", { fileName: file.name });

  // 1.1 构造上传表单
  const form = new FormData();
  form.append("image", file);
  form.append("title", file.name);

  // 1.2 请求后端分析
  const response = await fetch("/api/analyze", {
    method: "POST",
    body: form
  });
  if (!response.ok) {
    throw new Error(`Analyze failed: ${response.status}`);
  }

  // 1.3 解析响应
  const payload = await response.json() as AnalyzeResponse;
  logger.info("上传图片并请求分析完成", { nodes: payload.scene.nodes.length });
  return payload;
}

export async function reconstructImage(file: File, mode: ReconstructionMode, model: string): Promise<AnalyzeResponse> {
  /*
   * ========================================================================
   * 步骤1：上传图片并请求 AI 重建
   * ========================================================================
   * 目标：
   *   1) 把论文图提交给后端多模态接口
   *   2) 获取可编辑 scene.json
   */
  logger.info("开始上传图片并请求 AI 重建...", { fileName: file.name, mode, model });

  // 1.1 构造上传表单
  const form = new FormData();
  form.append("image", file);
  form.append("title", file.name);
  form.append("mode", mode);
  form.append("model", model);

  // 1.2 请求 AI 重建接口
  const response = await fetch("/api/reconstruct", {
    method: "POST",
    body: form
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Reconstruct failed: ${response.status} ${text}`);
  }

  // 1.3 解析响应
  const payload = await response.json() as AnalyzeResponse;
  logger.info("上传图片并请求 AI 重建完成", { nodes: payload.scene.nodes.length });
  return payload;
}

export async function reconstructRegion(
  scene: Scene,
  region: ApiSceneBox,
  mode: ReconstructionMode,
  model: string,
  mergeMode: RegionMergeMode
): Promise<AnalyzeResponse> {
  /*
   * ========================================================================
   * 步骤1：请求 AI 局部重建
   * ========================================================================
   * 目标：
   *   1) 把当前 scene 和框选区域提交给后端
   *   2) 获取替换或叠加后的完整 scene
   */
  logger.info("开始请求 AI 局部重建...", { region, mode, model, mergeMode });

  // 1.1 请求局部重建接口
  const response = await fetch("/api/reconstruct-region", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ scene, region, mode, model, mergeMode })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Region reconstruct failed: ${response.status} ${text}`);
  }

  // 1.2 解析响应
  const payload = await response.json() as AnalyzeResponse;
  logger.info("请求 AI 局部重建完成", { nodes: payload.scene.nodes.length });
  return payload;
}

export async function exportScene(scene: Scene, kind: "svg" | "pptx" | "json"): Promise<string> {
  /*
   * ========================================================================
   * 步骤1：导出当前场景
   * ========================================================================
   * 目标：
   *   1) 把编辑后的 scene 发送给后端
   *   2) 获取导出文件地址
   */
  logger.info("开始导出当前场景...", { kind, nodes: scene.nodes.length });

  // 1.1 请求导出接口
  const response = await fetch(`/api/export/${kind}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ scene })
  });
  if (!response.ok) {
    throw new Error(`Export failed: ${response.status}`);
  }

  // 1.2 返回下载地址
  const payload = await response.json() as { url: string };
  logger.info("导出当前场景完成", { kind, url: payload.url });
  return payload.url;
}
