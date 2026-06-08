import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, chmodSync, renameSync } from "node:fs";
import { logger } from "../logger";
import { configPath, dataDir } from "../paths";

export type ConfigSource = "env" | "file" | "none";

export type SafeAiProviderConfig = {
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

export type AiRuntimeConfig = {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  source: ConfigSource;
};

export type PersistedAiConfig = {
  provider: "openai-compatible";
  apiKey: string;
  baseUrl: string;
  reconstructModel: string;
  updatedAt: string;
};

export type WritableAiConfigInput = {
  apiKey: string;
  baseUrl: string;
  reconstructModel: string;
};

export const AI_CONFIG_LIMITS = {
  apiKey: 512,
  baseUrl: 256,
  reconstructModel: 120
} as const;

// 模型列表请求超时：GET /api/config（首屏、健康检查）等会 await 它，
// 无超时会被慢/挂起的 baseUrl 拖死，故封顶并归一化错误（绝不抛出/挂起）。
export const MODELS_FETCH_TIMEOUT_MS = 8000;

// 上游（用户自配 baseUrl，按设计可为不可信网关）响应体大小上界：
// 无封顶时 response.json() 会把任意大的 body 全量读入内存，单请求即可触发 OOM。
export const MAX_AI_RESPONSE_BYTES = 16 * 1024 * 1024;

export async function readJsonWithLimit(response: Response, maxBytes: number): Promise<unknown> {
  /*
   * ========================================================================
   * 步骤1：限长读取并解析 JSON 响应
   * ========================================================================
   * 目标：
   *   1) 先按 Content-Length 快速拒绝超限响应
   *   2) 流式累计字节，超过上限即中止读取，防止超大 body 撑爆内存
   */

  // 1.1 Content-Length 快速拒绝（缺失/畸形 → NaN，跳过快速判定，交给后续流式累计兜底）
  const declaredHeader = response.headers.get("content-length");
  const declared = declaredHeader == null ? Number.NaN : Number(declaredHeader);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Response body exceeds ${maxBytes} bytes (declared ${declared}).`);
  }

  // 1.2 无流式 body：退回 text()，按字节数（非 UTF-16 码元数）校验长度
  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf-8") > maxBytes) {
      throw new Error(`Response body exceeds ${maxBytes} bytes.`);
    }
    return text ? JSON.parse(text) : {};
  }

  // 1.3 流式读取并累计字节，超限即 cancel
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response body exceeds ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  return text ? JSON.parse(text) : {};
}

export function resolveOpenAiCompatibleUrls(baseUrl = "https://api.openai.com/v1") {
  /*
   * ========================================================================
   * 步骤1：解析 OpenAI 兼容接口地址
   * ========================================================================
   * 目标：
   *   1) 允许用户配置网关根地址
   *   2) 统一生成 responses 和 models 地址
   */
  logger.info("开始解析 OpenAI 兼容接口地址...", { baseUrl });

  // 1.1 清理尾部斜杠
  const trimmed = baseUrl.replace(/\/+$/, "");

  // 1.2 补齐 /v1
  const apiRoot = trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;

  // 1.3 生成端点地址
  const urls = {
    apiRoot,
    responsesUrl: `${apiRoot}/responses`,
    modelsUrl: `${apiRoot}/models`
  };

  logger.info("解析 OpenAI 兼容接口地址完成", urls);
  return urls;
}

export function readPersistedConfig(filePath: string = configPath): PersistedAiConfig | null {
  /*
   * ========================================================================
   * 步骤1：读取持久化 AI 配置
   * ========================================================================
   * 目标：
   *   1) 从 data/config.json 读取用户通过 UI 写入的配置
   *   2) 文件不存在或损坏时返回 null 并 warn，绝不抛出
   */
  logger.info("开始读取持久化 AI 配置...", { filePath });

  // 1.1 文件不存在直接返回
  if (!existsSync(filePath)) {
    logger.info("读取持久化 AI 配置完成", { exists: false });
    return null;
  }

  // 1.2 解析 JSON，损坏时安全 fallback
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
  /*
   * ========================================================================
   * 步骤1：写入持久化 AI 配置
   * ========================================================================
   * 目标：
   *   1) 校验字段长度上限和 baseUrl scheme
   *   2) 把白名单字段写入 data/config.json，文件权限 0o600
   */
  logger.info("开始写入持久化 AI 配置...");

  // 1.1 校验字段
  const validation = validateWritableConfig(input);
  if (!validation.ok) {
    logger.warn("写入持久化 AI 配置失败，字段非法", { error: validation.error });
    throw new ConfigValidationError(validation.error);
  }

  // 1.2 确保 data 目录存在
  mkdirSync(dataDir, { recursive: true });

  // 1.3 构造持久化对象并写入
  const persisted: PersistedAiConfig = {
    provider: "openai-compatible",
    apiKey: validation.value.apiKey,
    baseUrl: validation.value.baseUrl,
    reconstructModel: validation.value.reconstructModel,
    updatedAt: new Date().toISOString()
  };
  // 1.4 原子写：先写同目录临时文件（0o600），再 rename 覆盖目标（同卷 rename 原子），
  //   避免并发写或写中途崩溃留下截断/交错的 config.json。
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(persisted, null, 2), { encoding: "utf-8", mode: 0o600 });
  try {
    // 临时文件已存在时 mode 参数被忽略，显式 chmod 确保 0o600（Windows 上为 no-op）
    chmodSync(tmpPath, 0o600);
  } catch {
    /* Windows 等平台不支持 chmod，忽略 */
  }
  renameSync(tmpPath, filePath);

  logger.info("写入持久化 AI 配置完成", {
    filePath,
    baseUrl: persisted.baseUrl,
    reconstructModel: persisted.reconstructModel
  });
  return persisted;
}

export function deletePersistedConfig(filePath: string = configPath) {
  /*
   * ========================================================================
   * 步骤1：删除持久化 AI 配置
   * ========================================================================
   * 目标：
   *   1) 让 readAiRuntimeConfig 回退到 env
   *   2) 文件不存在视为已删除
   */
  logger.info("开始删除持久化 AI 配置...", { filePath });

  // 1.1 不存在直接 noop
  if (!existsSync(filePath)) {
    logger.info("删除持久化 AI 配置完成，文件不存在");
    return false;
  }

  // 1.2 删除文件
  unlinkSync(filePath);
  logger.info("删除持久化 AI 配置完成", { filePath });
  return true;
}

export function readAiRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  filePath: string = configPath
): AiRuntimeConfig {
  /*
   * ========================================================================
   * 步骤1：读取 AI 运行配置
   * ========================================================================
   * 目标：
   *   1) 优先读 data/config.json（UI 写入），fallback env
   *   2) 给重建接口和配置接口共用
   */
  logger.info("开始读取 AI 运行配置...");

  // 1.1 优先尝试持久化文件
  const persisted = readPersistedConfig(filePath);
  if (persisted) {
    const fileConfig: AiRuntimeConfig = {
      apiKey: persisted.apiKey,
      baseUrl: persisted.baseUrl,
      defaultModel: persisted.reconstructModel,
      source: "file"
    };
    logger.info("读取 AI 运行配置完成", {
      source: fileConfig.source,
      hasApiKey: Boolean(fileConfig.apiKey),
      baseUrl: fileConfig.baseUrl,
      defaultModel: fileConfig.defaultModel
    });
    return fileConfig;
  }

  // 1.2 fallback 到环境变量
  const apiKey = env.OPENAI_API_KEY ?? "";
  const envConfig: AiRuntimeConfig = {
    apiKey,
    baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    defaultModel: env.OPENAI_RECONSTRUCT_MODEL ?? "gpt-4o",
    source: apiKey ? "env" : "none"
  };
  logger.info("读取 AI 运行配置完成", {
    source: envConfig.source,
    hasApiKey: Boolean(envConfig.apiKey),
    baseUrl: envConfig.baseUrl,
    defaultModel: envConfig.defaultModel
  });
  return envConfig;
}

export function normalizeModelListPayload(payload: unknown) {
  /*
   * ========================================================================
   * 步骤1：归一化模型列表
   * ========================================================================
   * 目标：
   *   1) 读取 OpenAI 兼容 /v1/models 响应
   *   2) 输出前端可直接展示的模型 id 数组
   */
  logger.info("开始归一化模型列表...");

  // 1.1 读取 data 数组
  const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];

  // 1.2 提取模型 id
  const models = data
    .map((item) => (isRecord(item) && typeof item.id === "string" ? item.id : ""))
    .filter((id) => id.length > 0)
    .sort((left, right) => left.localeCompare(right));

  logger.info("归一化模型列表完成", { count: models.length });
  return models;
}

export type FetchModelsResult = {
  models: string[];
  error: string | null;
  status: number | null;
};

export async function fetchOpenAiCompatibleModels(config: { apiKey: string; baseUrl: string }): Promise<FetchModelsResult> {
  /*
   * ========================================================================
   * 步骤1：获取 OpenAI 兼容模型列表
   * ========================================================================
   * 目标：
   *   1) 从后端代理调用 /v1/models
   *   2) 不向前端暴露 API Key
   *   3) 返回 HTTP 状态码，便于上层区分 AUTH / NETWORK / UNKNOWN
   */
  logger.info("开始获取 OpenAI 兼容模型列表...");

  // 1.1 缺少 API Key 时返回空列表
  if (!config.apiKey) {
    logger.warn("获取模型列表失败，缺少 API Key");
    return { models: [], error: "OPENAI_API_KEY is not set.", status: null };
  }

  // 1.2 请求模型列表（带超时；网络/超时错误归一化为 status -1，绝不抛出，避免挂起 GET /config 等调用方）
  const { modelsUrl } = resolveOpenAiCompatibleUrls(config.baseUrl);
  let response: Response;
  try {
    response = await fetch(modelsUrl, {
      headers: {
        "Authorization": `Bearer ${config.apiKey}`
      },
      signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS)
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "TimeoutError";
    const message = isTimeout
      ? `模型列表请求超过 ${MODELS_FETCH_TIMEOUT_MS / 1000}s 未完成`
      : `无法连接模型服务：${String(error)}`;
    logger.warn("获取模型列表失败，网络或超时", { error: message });
    return { models: [], error: message, status: -1 };
  }

  // 1.3 校验响应 Content-Type，非 JSON 直接报协议错（避免 baseUrl 指错网关时拿到 HTML 还误判为 NETWORK）
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    const error = `Response was not JSON (Content-Type: ${contentType || "missing"})`;
    logger.warn("获取模型列表失败，响应不是 JSON", { status: response.status, contentType });
    return { models: [], error, status: -1 };
  }

  // 1.4 限长解析响应（解析失败/超限归一化为 status -1，保持本函数绝不抛出）
  let payload: unknown;
  try {
    payload = await readJsonWithLimit(response, MAX_AI_RESPONSE_BYTES);
  } catch (error) {
    logger.warn("解析模型列表响应失败", { error: String(error) });
    return { models: [], error: `模型列表响应解析失败：${String(error)}`, status: -1 };
  }
  if (!response.ok) {
    // 上游错误体完整内容只写服务端日志；对外仅暴露 HTTP 状态，
    // 避免网关内部信息（内部主机名/组织标识/栈信息）经首屏 /api/config 泄露到浏览器
    logger.warn("获取模型列表失败", { status: response.status, error: JSON.stringify(payload) });
    return { models: [], error: `模型列表请求失败（HTTP ${response.status}）`, status: response.status };
  }

  const models = normalizeModelListPayload(payload);
  logger.info("获取 OpenAI 兼容模型列表完成", { count: models.length });
  return { models, error: null, status: response.status };
}

export function buildSafeAiProviderConfig(input: {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  source: ConfigSource;
  modelListError?: string | null;
}): SafeAiProviderConfig {
  /*
   * ========================================================================
   * 步骤1：构建前端安全 AI 配置
   * ========================================================================
   * 目标：
   *   1) 返回模型选择所需信息
   *   2) 禁止返回 API Key 明文
   */
  logger.info("开始构建前端安全 AI 配置...");

  // 1.1 合并默认模型和远程模型
  const reconstructModels = [...new Set([input.defaultModel, ...input.models].filter(Boolean))];

  // 1.2 计算 masked 末四位
  const hasApiKey = Boolean(input.apiKey);
  const maskedTail = hasApiKey ? maskApiKeyTail(input.apiKey) : null;

  // 1.3 返回安全配置
  const config: SafeAiProviderConfig = {
    aiReconstructionAvailable: hasApiKey,
    provider: "openai-compatible",
    baseUrl: input.baseUrl,
    reconstructModel: input.defaultModel,
    reconstructModels,
    modelListAvailable: input.models.length > 0,
    modelListError: input.modelListError ?? null,
    hasApiKey,
    source: input.source,
    maskedTail
  };

  logger.info("构建前端安全 AI 配置完成", {
    aiReconstructionAvailable: config.aiReconstructionAvailable,
    source: config.source,
    modelCount: config.reconstructModels.length
  });
  return config;
}

export function maskApiKeyTail(apiKey: string) {
  /*
   * ========================================================================
   * 步骤1：生成 API Key 掩码末位
   * ========================================================================
   * 目标：
   *   1) 让用户能识别当前生效的 key 是不是自己填的那个
   *   2) 不泄露任何前缀或可重构信息
   */
  // 1.1 太短直接返回 ****
  if (apiKey.length < 4) {
    return "****";
  }
  // 1.2 取末四位
  return `****${apiKey.slice(-4)}`;
}

export class ConfigValidationError extends Error {
  /*
   * ========================================================================
   * 步骤1：定义配置字段校验异常
   * ========================================================================
   * 目标：
   *   1) 让路由层把字段错误映射为 400
   *   2) 与其它内部异常区分
   */
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
  /*
   * ========================================================================
   * 步骤1：校验 POST /api/config 请求体
   * ========================================================================
   * 目标：
   *   1) 白名单 apiKey/baseUrl/reconstructModel
   *   2) 字段长度上限和 baseUrl scheme 限制
   *   3) allowEmptyKey=true 时允许 apiKey 留空（路由层用 saved-key fallback）
   */
  if (!isRecord(input)) {
    return { ok: false, error: "Request body must be an object." };
  }

  // 1.1 apiKey
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

  // 1.2 baseUrl
  if (typeof input.baseUrl !== "string" || input.baseUrl.trim().length === 0) {
    return { ok: false, error: "baseUrl is required." };
  }
  if (input.baseUrl.length > AI_CONFIG_LIMITS.baseUrl) {
    return { ok: false, error: `baseUrl exceeds ${AI_CONFIG_LIMITS.baseUrl} characters.` };
  }
  const baseUrl = input.baseUrl.trim();
  if (!/^https?:\/\//i.test(baseUrl)) {
    return { ok: false, error: "baseUrl must start with http:// or https://." };
  }

  // 1.3 reconstructModel
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

function normalizePersistedConfig(value: unknown): PersistedAiConfig | null {
  /*
   * ========================================================================
   * 步骤1：归一化磁盘上的 config.json
   * ========================================================================
   * 目标：
   *   1) 容忍 schema 字段缺失（向后兼容未来 multi-provider）
   *   2) 拒绝完全不合法的对象
   */
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
  return {
    provider: "openai-compatible",
    apiKey,
    baseUrl,
    reconstructModel,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : ""
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
