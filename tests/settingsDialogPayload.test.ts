import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSettingsPayload } from "../src/editor/SettingsDialog";
import type { AppConfig, ConfigSource } from "../src/lib/api";

function appConfig(source: ConfigSource, hasApiKey: boolean): AppConfig {
  return {
    aiReconstructionAvailable: hasApiKey,
    provider: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    reconstructModel: "gpt-4o",
    reconstructModels: ["gpt-4o"],
    modelListAvailable: true,
    modelListError: null,
    hasApiKey,
    source,
    maskedTail: hasApiKey ? "****test" : null
  };
}

describe("settings dialog payload builder", () => {
  it("requires an explicit API key when the current key comes from env", () => {
    /*
     * ========================================================================
     * 步骤1：验证 env 来源不能被前端当成 saved-key fallback
     * ========================================================================
     * 目标：
     *   1) 后端 /config 与 /config/test 只复用 data/config.json 中的 saved key
     *   2) source=env 且 apiKey 留空时，前端应在提交前给出本地校验错误
     */

    // 1.1 构造当前配置来自环境变量、但表单 key 留空的输入
    const result = buildSettingsPayload({
      apiKey: "",
      baseUrl: "https://api.example.com/v1",
      reconstructModel: "gpt-4o",
      config: appConfig("env", true)
    });

    // 1.2 前端应要求用户显式填写 key，而不是发空 key 给后端再失败
    assert.deepEqual(result, { error: "请填写 API Key。" });
  });

  it("allows a blank API key only when a persisted file key can be reused", () => {
    /*
     * ========================================================================
     * 步骤1：验证 file 来源保留 saved-key fallback
     * ========================================================================
     * 目标：
     *   1) UI 写入过 data/config.json 时，空 key 表示复用 saved key
     *   2) 该语义与后端 readPersistedConfig fallback 一致
     */

    // 1.1 构造当前配置来自持久化文件的输入
    const result = buildSettingsPayload({
      apiKey: "",
      baseUrl: " https://api.example.com/v1 ",
      reconstructModel: " gpt-4o ",
      config: appConfig("file", true)
    });

    // 1.2 空 key 被保留给后端复用 saved key，其它字段被 trim
    assert.deepEqual(result, {
      apiKey: "",
      baseUrl: "https://api.example.com/v1",
      reconstructModel: "gpt-4o"
    });
  });

  it("accepts an explicit API key when the current config comes from env", () => {
    /*
     * ========================================================================
     * 步骤1：验证 env 来源显式填 key 后可保存/测试
     * ========================================================================
     * 目标：
     *   1) 修复不应阻止用户从环境变量配置迁移到 UI 配置
     *   2) 显式填写的新 key 正常进入 payload
     */

    // 1.1 构造 env 来源但显式填写 key 的输入
    const result = buildSettingsPayload({
      apiKey: " sk-user ",
      baseUrl: "https://api.example.com/v1",
      reconstructModel: "gpt-4o",
      config: appConfig("env", true)
    });

    // 1.2 payload 正常通过并清理空白
    assert.deepEqual(result, {
      apiKey: "sk-user",
      baseUrl: "https://api.example.com/v1",
      reconstructModel: "gpt-4o"
    });
  });
});
