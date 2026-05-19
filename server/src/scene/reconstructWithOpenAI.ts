import { promises as fs } from "node:fs";
import sharp from "sharp";
import { logger } from "../logger";
import { readAiRuntimeConfig, resolveOpenAiCompatibleUrls } from "./aiProviderConfig";
import { buildServerReconstructionPrompt, type ReconstructionMode } from "./reconstructionPrompt";

type ReconstructInput = {
  imagePath: string;
  mimeType: string;
  mode: ReconstructionMode;
  model?: string;
};

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
    throw new Error("OPENAI_API_KEY is not set.");
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

  // 2.1 发送 API 请求
  const response = await fetch(responsesUrl, {
    method: "POST",
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

  // 2.2 处理错误响应
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`OpenAI reconstruct failed: ${JSON.stringify(payload)}`);
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
    throw new Error("OpenAI response did not contain output text.");
  }

  // 3.2 解析 JSON
  const scene = JSON.parse(text) as Record<string, unknown>;
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
