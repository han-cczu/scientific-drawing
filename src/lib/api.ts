import { logger } from "./logger";
import type { AnalyzeResponse, Scene } from "../shared/scene";

export type ReconstructionMode = "color" | "mono";

export type AppConfig = {
  aiReconstructionAvailable: boolean;
  provider: "openai-compatible";
  baseUrl: string;
  reconstructModel: string;
  reconstructModels: string[];
  modelListAvailable: boolean;
  modelListError: string | null;
};

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
