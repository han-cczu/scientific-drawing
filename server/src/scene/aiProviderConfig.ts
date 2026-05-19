import { logger } from "../logger";

export type SafeAiProviderConfig = {
  aiReconstructionAvailable: boolean;
  provider: "openai-compatible";
  baseUrl: string;
  reconstructModel: string;
  reconstructModels: string[];
  modelListAvailable: boolean;
  modelListError: string | null;
};

export type AiRuntimeConfig = {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
};

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

export function readAiRuntimeConfig(env: NodeJS.ProcessEnv = process.env): AiRuntimeConfig {
  /*
   * ========================================================================
   * 步骤1：读取 AI 运行配置
   * ========================================================================
   * 目标：
   *   1) 从环境变量读取 API Key、baseUrl 和默认模型
   *   2) 给重建接口和配置接口共用
   */
  logger.info("开始读取 AI 运行配置...");

  // 1.1 读取环境变量
  const config = {
    apiKey: env.OPENAI_API_KEY ?? "",
    baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    defaultModel: env.OPENAI_RECONSTRUCT_MODEL ?? "gpt-4o"
  };

  logger.info("读取 AI 运行配置完成", {
    hasApiKey: Boolean(config.apiKey),
    baseUrl: config.baseUrl,
    defaultModel: config.defaultModel
  });
  return config;
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

export async function fetchOpenAiCompatibleModels(config = readAiRuntimeConfig()) {
  /*
   * ========================================================================
   * 步骤1：获取 OpenAI 兼容模型列表
   * ========================================================================
   * 目标：
   *   1) 从后端代理调用 /v1/models
   *   2) 不向前端暴露 API Key
   */
  logger.info("开始获取 OpenAI 兼容模型列表...");

  // 1.1 缺少 API Key 时返回空列表
  if (!config.apiKey) {
    logger.warn("获取模型列表失败，缺少 API Key");
    return { models: [] as string[], error: "OPENAI_API_KEY is not set." };
  }

  // 1.2 请求模型列表
  const { modelsUrl } = resolveOpenAiCompatibleUrls(config.baseUrl);
  const response = await fetch(modelsUrl, {
    headers: {
      "Authorization": `Bearer ${config.apiKey}`
    }
  });

  // 1.3 解析响应
  const payload = await response.json() as unknown;
  if (!response.ok) {
    const error = JSON.stringify(payload);
    logger.warn("获取模型列表失败", { error });
    return { models: [] as string[], error };
  }

  const models = normalizeModelListPayload(payload);
  logger.info("获取 OpenAI 兼容模型列表完成", { count: models.length });
  return { models, error: null };
}

export function buildSafeAiProviderConfig(input: {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  modelListError?: string | null;
}): SafeAiProviderConfig {
  /*
   * ========================================================================
   * 步骤1：构建前端安全 AI 配置
   * ========================================================================
   * 目标：
   *   1) 返回模型选择所需信息
   *   2) 禁止返回 API Key
   */
  logger.info("开始构建前端安全 AI 配置...");

  // 1.1 合并默认模型和远程模型
  const reconstructModels = [...new Set([input.defaultModel, ...input.models].filter(Boolean))];

  // 1.2 返回安全配置
  const config: SafeAiProviderConfig = {
    aiReconstructionAvailable: Boolean(input.apiKey),
    provider: "openai-compatible",
    baseUrl: input.baseUrl,
    reconstructModel: input.defaultModel,
    reconstructModels,
    modelListAvailable: input.models.length > 0,
    modelListError: input.modelListError ?? null
  };

  logger.info("构建前端安全 AI 配置完成", {
    aiReconstructionAvailable: config.aiReconstructionAvailable,
    modelCount: config.reconstructModels.length
  });
  return config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
