import { logger } from "./logger";
import type { AnalyzeResponse, Scene } from "../shared/scene";
import { validateScene } from "../shared/sceneValidation";

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

export type ReconstructErrorCode =
  | "AUTH"
  | "INVALID_IMAGE"
  | "TIMEOUT"
  | "BAD_MODEL_OUTPUT"
  | "INVALID_SCENE"
  | "NETWORK"
  | "UPSTREAM"
  | "UNKNOWN";

export class ReconstructApiError extends Error {
  /*
   * ========================================================================
   * 步骤1：重建接口结构化错误
   * ========================================================================
   * 目标：
   *   1) 透传服务端错误信封 {error:{code,message,hint}}
   *   2) UI 据 code 给出中文恢复建议（复刻 describeTestError 模式）
   */
  constructor(
    public readonly code: ReconstructErrorCode,
    message: string,
    public readonly hint?: string
  ) {
    super(message);
    this.name = "ReconstructApiError";
  }
}

function isReconstructErrorCode(value: unknown): value is ReconstructErrorCode {
  return (
    value === "AUTH" ||
    value === "INVALID_IMAGE" ||
    value === "TIMEOUT" ||
    value === "BAD_MODEL_OUTPUT" ||
    value === "INVALID_SCENE" ||
    value === "NETWORK" ||
    value === "UPSTREAM" ||
    value === "UNKNOWN"
  );
}

async function parseReconstructError(response: Response): Promise<ReconstructApiError> {
  /*
   * ========================================================================
   * 步骤1：解析重建错误响应
   * ========================================================================
   * 目标：
   *   1) 新式对象信封与旧式 { error: string } 都能解析
   *   2) 网关 HTML（非 JSON）归为 NETWORK
   */
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return new ReconstructApiError("NETWORK", `服务返回异常（HTTP ${response.status}）。`);
  }
  try {
    const body = await response.json() as { error?: unknown };
    const raw = body?.error;
    if (raw && typeof raw === "object") {
      const envelope = raw as { code?: unknown; message?: unknown; hint?: unknown };
      return new ReconstructApiError(
        isReconstructErrorCode(envelope.code) ? envelope.code : "UNKNOWN",
        typeof envelope.message === "string" ? envelope.message : `HTTP ${response.status}`,
        typeof envelope.hint === "string" ? envelope.hint : undefined
      );
    }
    return new ReconstructApiError("UNKNOWN", typeof raw === "string" ? raw : `HTTP ${response.status}`);
  } catch {
    return new ReconstructApiError("UNKNOWN", `HTTP ${response.status}`);
  }
}

export type TestConfigResult =
  | { ok: true; modelCount: number; models: string[] }
  | { ok: false; code: TestConfigErrorCode; error: string; models: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
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

async function readAppConfigResponse(response: Response, action: string): Promise<AppConfig> {
  ensureJsonResponse(response, action);
  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    logger.warn(`${action}响应 JSON 解析失败`, { status: response.status, error: String(error) });
    throw new Error(`${action}响应 JSON 解析失败（HTTP ${response.status}）。`);
  }
  const config = parseAppConfig(data);
  if (!config) {
    logger.warn(`${action}响应结构非法`, { status: response.status });
    throw new Error(`${action}响应格式异常（HTTP ${response.status}）。`);
  }
  return config;
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

async function readAnalyzeResponse(response: Response, action: string): Promise<AnalyzeResponse> {
  ensureJsonResponse(response, action);
  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    logger.warn(`${action}响应 JSON 解析失败`, { status: response.status, error: String(error) });
    throw new Error(`${action}响应 JSON 解析失败（HTTP ${response.status}）。`);
  }
  const payload = parseAnalyzeResponse(data);
  if (!payload) {
    logger.warn(`${action}响应结构非法`, { status: response.status });
    throw new Error(`${action}响应格式异常（HTTP ${response.status}）。`);
  }
  return payload;
}

function ensureJsonResponse(response: Response, action: string): void {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    logger.warn(`${action}响应非 JSON`, { status: response.status, contentType });
    throw new Error(`${action}响应格式异常（HTTP ${response.status}）。`);
  }
}

function isTestConfigErrorCode(value: unknown): value is TestConfigErrorCode {
  return (
    value === "AUTH" ||
    value === "NETWORK" ||
    value === "INVALID_RESPONSE" ||
    value === "VALIDATION" ||
    value === "UNKNOWN"
  );
}

function parseTestConfigResult(value: unknown): TestConfigResult | null {
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

function invalidTestConfigResponse(status: number, error: string): TestConfigResult {
  return {
    ok: false,
    code: "INVALID_RESPONSE",
    error: `${error}（HTTP ${status}）。`,
    models: []
  };
}

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
  const payload = await readAppConfigResponse(response, "读取应用配置");
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
  const config = await readAppConfigResponse(response, "保存 AI 配置");
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
  const config = await readAppConfigResponse(response, "清空 AI 配置");
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
  const payload = await readAnalyzeResponse(response, "图片分析");
  logger.info("上传图片并请求分析完成", { nodes: payload.scene.nodes.length });
  return payload;
}

export async function reconstructImage(file: File, mode: ReconstructionMode, model: string, signal?: AbortSignal): Promise<AnalyzeResponse> {
  /*
   * ========================================================================
   * 步骤1：上传图片并请求 AI 重建
   * ========================================================================
   * 目标：
   *   1) 把论文图提交给后端多模态接口
   *   2) 获取可编辑 scene.json；失败时抛结构化 ReconstructApiError
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
    body: form,
    signal
  });
  if (!response.ok) {
    throw await parseReconstructError(response);
  }

  // 1.3 解析响应
  const payload = await readAnalyzeResponse(response, "AI 重建");
  logger.info("上传图片并请求 AI 重建完成", { nodes: payload.scene.nodes.length });
  return payload;
}

export async function reconstructRegion(
  scene: Scene,
  region: ApiSceneBox,
  mode: ReconstructionMode,
  model: string,
  mergeMode: RegionMergeMode,
  signal?: AbortSignal
): Promise<AnalyzeResponse> {
  /*
   * ========================================================================
   * 步骤1：请求 AI 局部重建
   * ========================================================================
   * 目标：
   *   1) 把当前 scene 和框选区域提交给后端
   *   2) 获取替换或叠加后的完整 scene；失败时抛结构化 ReconstructApiError
   */
  logger.info("开始请求 AI 局部重建...", { region, mode, model, mergeMode });

  // 1.1 请求局部重建接口
  const response = await fetch("/api/reconstruct-region", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ scene, region, mode, model, mergeMode }),
    signal
  });
  if (!response.ok) {
    throw await parseReconstructError(response);
  }

  // 1.2 解析响应
  const payload = await readAnalyzeResponse(response, "AI 局部重建");
  logger.info("请求 AI 局部重建完成", { nodes: payload.scene.nodes.length });
  return payload;
}

export type ExportDownload = {
  blob: Blob;
  filename: string;
};

export async function exportScene(scene: Scene, kind: "svg" | "pptx" | "json"): Promise<ExportDownload> {
  /*
   * ========================================================================
   * 步骤1：导出当前场景
   * ========================================================================
   * 目标：
   *   1) 把编辑后的 scene 发送给后端，拿回文件字节流
   *   2) 从 Content-Disposition 解析下载文件名（优先 RFC 5987 filename*）
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

  // 1.2 取回字节流与文件名（header 缺失时按 kind 回退默认名）
  const blob = await response.blob();
  const fallbackName = kind === "json" ? "scene.scene.json" : `scene.${kind}`;
  const filename = filenameFromContentDisposition(response.headers.get("content-disposition")) ?? fallbackName;
  logger.info("导出当前场景完成", { kind, filename, bytes: blob.size });
  return { blob, filename };
}

function filenameFromContentDisposition(header: string | null): string | null {
  /*
   * ========================================================================
   * 步骤1：解析下载文件名
   * ========================================================================
   * 目标：
   *   1) 优先 filename*=UTF-8''（中文标题）
   *   2) 回退普通 filename="..."
   */
  if (!header) {
    return null;
  }
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      const filename = sanitizeDownloadFilename(decodeURIComponent(star[1].trim()));
      if (filename) {
        return filename;
      }
    } catch {
      // 编码异常时回退普通 filename
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header);
  return plain ? sanitizeDownloadFilename(plain[1]) : null;
}

function sanitizeDownloadFilename(value: string): string | null {
  /*
   * ========================================================================
   * 步骤1：清洗浏览器下载文件名
   * ========================================================================
   * 目标：
   *   1) 不信任 Content-Disposition 中的路径片段
   *   2) 保留中文等可读文件名字符
   */
  const filename = value
    .normalize("NFC")
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("-")
    .replace(/[:*?"<>|\x00-\x1F\x7F]+/g, "-")
    .replace(/[-.]+$/g, "")
    .replace(/^[.-]+/g, "")
    .replace(/-+\./g, ".")
    .replace(/^-+|-+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return filename || null;
}
