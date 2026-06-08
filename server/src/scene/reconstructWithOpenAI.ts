import { promises as fs } from "node:fs";
import sharp from "sharp";
import { logger } from "../logger";
import { MAX_AI_RESPONSE_BYTES, readAiRuntimeConfig, readJsonWithLimit, resolveOpenAiCompatibleUrls } from "./aiProviderConfig";
import { buildServerReconstructionPrompt, type ReconstructionMode } from "./reconstructionPrompt";

type ReconstructInput = {
  imagePath: string;
  mimeType: string;
  mode: ReconstructionMode;
  model?: string;
  /** 客户端取消信号（经路由 req close 事件传入），与内部超时合流 */
  signal?: AbortSignal;
};

//   vision 重建大图实测可达 60-120s；120s 封顶在网关挂起时止损。
export const RECONSTRUCT_TIMEOUT_MS = 120_000;

export type ReconstructErrorCode =
  | "AUTH"
  | "TIMEOUT"
  | "BAD_MODEL_OUTPUT"
  | "INVALID_SCENE"
  | "NETWORK"
  | "UPSTREAM";

export class ReconstructError extends Error {
  /*
   * ========================================================================
   * 步骤1：类型化重建错误
   * ========================================================================
   * 目标：
   *   1) 路由层据 code 映射 HTTP 状态与错误信封
   *   2) hint 为面向用户的中文恢复建议
   */
  constructor(
    public readonly code: ReconstructErrorCode,
    message: string,
    public readonly hint?: string
  ) {
    super(message);
    this.name = "ReconstructError";
  }
}

export async function reconstructWithOpenAI(input: ReconstructInput): Promise<Record<string, unknown>> {
  /*
   * ========================================================================
   * 步骤1：准备多模态请求
   * ========================================================================
   * 目标：
   *   1) 读取 OPENAI_API_KEY
   *   2) 把图片转换为 base64 data URL
   *   3) 生成重建提示词
   */
  logger.info("开始准备多模态重建请求...", { imagePath: input.imagePath });

  // 1.1 检查 API Key
  const runtimeConfig = readAiRuntimeConfig();
  if (!runtimeConfig.apiKey) {
    throw new ReconstructError("AUTH", "OPENAI_API_KEY is not set.", "请在右上角 AI 设置中配置 API Key");
  }

  // 1.2 解析 API 地址
  const { responsesUrl } = resolveOpenAiCompatibleUrls(runtimeConfig.baseUrl);
  const model = input.model || runtimeConfig.defaultModel;

  // 1.3 读取图片尺寸和 base64
  const metadata = await sharp(input.imagePath).metadata();
  const width = metadata.width ?? 1280;
  const height = metadata.height ?? 720;
  const imageBytes = await fs.readFile(input.imagePath);
  const dataUrl = `data:${normalizeMimeType(input.mimeType)};base64,${imageBytes.toString("base64")}`;
  const prompt = buildServerReconstructionPrompt(width, height, input.mode);
  logger.info("准备多模态重建请求完成", { width, height, mode: input.mode, model });

  /*
   * ========================================================================
   * 步骤2：调用 Responses API
   * ========================================================================
   * 目标：
   *   1) 发送图片和提示词
   *   2) 要求模型返回 JSON 文本
   */
  logger.info("开始调用多模态模型...");

  // 2.1 发送 API 请求（超时与客户端取消两个信号合流；取消原样上抛由路由静默处理）
  const timeoutSignal = AbortSignal.timeout(RECONSTRUCT_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal;
  let response: Response;
  try {
    response = await fetch(responsesUrl, {
      method: "POST",
      signal,
      headers: {
        "Authorization": `Bearer ${runtimeConfig.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              { type: "input_image", image_url: dataUrl }
            ]
          }
        ],
        text: {
          format: {
            type: "json_object"
          }
        }
      })
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ReconstructError(
        "TIMEOUT",
        `AI 重建超过 ${RECONSTRUCT_TIMEOUT_MS / 1000}s 未完成。`,
        "可更换更快的模型，或缩小图片后重试"
      );
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    throw new ReconstructError("NETWORK", `无法连接模型服务：${String(error)}`, "请检查 Base URL 或网络");
  }

  // 2.2 处理错误响应（网关 5xx 可能返回 HTML，非 JSON 一律 UPSTREAM）
  let payload: Record<string, unknown>;
  try {
    payload = await readJsonWithLimit(response, MAX_AI_RESPONSE_BYTES) as Record<string, unknown>;
  } catch {
    throw new ReconstructError("UPSTREAM", `模型服务返回非 JSON 响应或响应过大（HTTP ${response.status}）。`);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ReconstructError("AUTH", `OpenAI reconstruct failed: ${JSON.stringify(payload)}`, "请检查 API Key 是否对所选 Base URL 有效");
    }
    throw new ReconstructError("UPSTREAM", `OpenAI reconstruct failed: ${JSON.stringify(payload)}`);
  }
  logger.info("调用多模态模型完成");

  /*
   * ========================================================================
   * 步骤3：解析模型输出
   * ========================================================================
   * 目标：
   *   1) 从 Responses API 中提取文本
   *   2) 解析为 scene JSON
   */
  logger.info("开始解析模型输出...");

  // 3.1 提取输出文本
  const text = extractOutputText(payload);
  if (!text) {
    throw new ReconstructError(
      "BAD_MODEL_OUTPUT",
      "OpenAI response did not contain output text.",
      "建议更换支持图像输入的模型"
    );
  }

  // 3.2 解析 JSON（弱模型常返回非 JSON 文本，归为 BAD_MODEL_OUTPUT 并给出换模型建议）
  let scene: Record<string, unknown>;
  try {
    scene = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ReconstructError("BAD_MODEL_OUTPUT", "模型输出无法解析为 scene JSON。", "建议更换模型后重试");
  }
  logger.info("解析模型输出完成");
  return scene;
}

function extractOutputText(payload: Record<string, unknown>) {
  /*
   * ========================================================================
   * 步骤1：提取 Responses 文本
   * ========================================================================
   * 目标：
   *   1) 优先使用 output_text
   *   2) 兼容 output 数组结构
   */
  logger.info("开始提取 Responses 文本...");

  // 1.1 直接读取 output_text
  if (typeof payload.output_text === "string") {
    logger.info("提取 Responses 文本完成", { source: "output_text" });
    return payload.output_text;
  }

  // 1.2 兼容 output/content 结构
  const output = payload.output;
  if (!Array.isArray(output)) {
    logger.warn("提取 Responses 文本失败，缺少 output");
    return "";
  }
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (isRecord(content) && typeof content.text === "string") {
        logger.info("提取 Responses 文本完成", { source: "output.content.text" });
        return content.text;
      }
    }
  }

  logger.warn("提取 Responses 文本失败");
  return "";
}

function normalizeMimeType(mimeType: string) {
  if (mimeType.startsWith("image/")) {
    return mimeType;
  }
  return "image/png";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
