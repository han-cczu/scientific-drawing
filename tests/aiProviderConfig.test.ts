import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSafeAiProviderConfig,
  normalizeModelListPayload,
  resolveOpenAiCompatibleUrls
} from "../server/src/scene/aiProviderConfig";

describe("OpenAI-compatible AI provider config", () => {
  it("resolves base, responses, and models URLs", () => {
    /*
     * ========================================================================
     * 步骤1：验证 OpenAI 兼容地址解析
     * ========================================================================
     * 目标：
     *   1) baseUrl 允许写根地址或 /v1 地址
     *   2) responses 和 models 路径保持稳定
     */

    // 1.1 校验根地址
    assert.deepEqual(resolveOpenAiCompatibleUrls("https://gateway.example.com"), {
      apiRoot: "https://gateway.example.com/v1",
      responsesUrl: "https://gateway.example.com/v1/responses",
      modelsUrl: "https://gateway.example.com/v1/models"
    });

    // 1.2 校验 /v1 地址
    assert.deepEqual(resolveOpenAiCompatibleUrls("https://gateway.example.com/v1/"), {
      apiRoot: "https://gateway.example.com/v1",
      responsesUrl: "https://gateway.example.com/v1/responses",
      modelsUrl: "https://gateway.example.com/v1/models"
    });
  });

  it("normalizes /v1/models payloads", () => {
    /*
     * ========================================================================
     * 步骤1：验证模型列表归一化
     * ========================================================================
     * 目标：
     *   1) 兼容 OpenAI 标准 data 数组
     *   2) 丢弃没有 id 的异常项
     */

    // 1.1 归一化模型列表
    const models = normalizeModelListPayload({
      data: [
        { id: "gpt-4o" },
        { id: "gpt-4o-mini" },
        { name: "bad" }
      ]
    });

    // 1.2 校验模型名称
    assert.deepEqual(models, ["gpt-4o", "gpt-4o-mini"]);
  });

  it("returns safe config without exposing api key", () => {
    /*
     * ========================================================================
     * 步骤1：验证前端安全配置
     * ========================================================================
     * 目标：
     *   1) 前端只知道能力、baseUrl 和模型名
     *   2) API Key 不进入响应体
     */

    // 1.1 构建安全配置
    const config = buildSafeAiProviderConfig({
      apiKey: "secret",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o",
      models: ["gpt-4o", "gpt-4o-mini"]
    });

    // 1.2 校验安全字段
    assert.equal(config.aiReconstructionAvailable, true);
    assert.equal(config.reconstructModel, "gpt-4o");
    assert.deepEqual(config.reconstructModels, ["gpt-4o", "gpt-4o-mini"]);
    assert.equal(Object.hasOwn(config, "apiKey"), false);
  });
});
