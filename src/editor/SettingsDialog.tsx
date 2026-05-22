import { useEffect, useState } from "react";
import { Settings as SettingsIcon, X, KeyRound, Link2, Cpu, CheckCircle2, AlertTriangle, Trash2, Plug } from "lucide-react";
import type { AppConfig, TestConfigResult, WritableAppConfig } from "../lib/api";

type SettingsDialogProps = {
  open: boolean;
  busy: boolean;
  config: AppConfig | null;
  onClose: () => void;
  onSave: (payload: WritableAppConfig) => Promise<AppConfig>;
  onClear: () => Promise<AppConfig>;
  onTest: (payload: WritableAppConfig) => Promise<TestConfigResult>;
};

type TestErrorCode = "AUTH" | "NETWORK" | "VALIDATION" | "UNKNOWN";

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; modelCount: number }
  | { kind: "fail"; code: TestErrorCode; error: string };

const PLACEHOLDER_KEY = "已配置（输入新值可覆盖）";

export function SettingsDialog({
  open,
  busy,
  config,
  onClose,
  onSave,
  onClear,
  onTest
}: SettingsDialogProps) {
  /*
   * ========================================================================
   * 步骤1：渲染 AI 配置对话框
   * ========================================================================
   * 目标：
   *   1) 表单字段：apiKey/baseUrl/reconstructModel
   *   2) 操作：测试连接、保存、清空回退 env
   *   3) 已配置时 apiKey 字段允许"留空保持原值"，避免用户重复贴 key
   */

  // 1.1 维护表单状态
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [reconstructModel, setReconstructModel] = useState("");
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [saveError, setSaveError] = useState<string | null>(null);

  // 1.2 打开/外部 config 变化时同步表单（保留 apiKey 输入框为空）
  useEffect(() => {
    if (!open) {
      return;
    }
    setApiKey("");
    setBaseUrl(config?.baseUrl ?? "https://api.openai.com/v1");
    setReconstructModel(config?.reconstructModel ?? "gpt-4o");
    setTest({ kind: "idle" });
    setSaveError(null);
  }, [open, config?.baseUrl, config?.reconstructModel]);

  if (!open) {
    return null;
  }

  const hasExistingKey = Boolean(config?.hasApiKey);
  const effectiveApiKey = apiKey.trim();

  // 1.3 校验：必须能拼出完整 writable payload
  const buildPayload = (): WritableAppConfig | { error: string } => {
    if (!effectiveApiKey && !hasExistingKey) {
      return { error: "请填写 API Key。" };
    }
    if (!effectiveApiKey && hasExistingKey) {
      return { error: "保存前需要重新填写 API Key（出于安全考虑前端不缓存原始 key）。" };
    }
    if (!baseUrl.trim()) {
      return { error: "请填写 Base URL。" };
    }
    if (!/^https?:\/\//i.test(baseUrl.trim())) {
      return { error: "Base URL 必须以 http:// 或 https:// 开头。" };
    }
    if (!reconstructModel.trim()) {
      return { error: "请填写模型名称。" };
    }
    return {
      apiKey: effectiveApiKey,
      baseUrl: baseUrl.trim(),
      reconstructModel: reconstructModel.trim()
    };
  };

  // 1.4 测试连接
  const handleTest = async () => {
    const payload = buildPayload();
    if ("error" in payload) {
      setTest({ kind: "fail", code: "VALIDATION", error: payload.error });
      return;
    }
    setTest({ kind: "running" });
    try {
      const result = await onTest(payload);
      if (result.ok) {
        setTest({ kind: "ok", modelCount: result.modelCount });
      } else {
        setTest({ kind: "fail", code: result.code, error: result.error });
      }
    } catch (error) {
      setTest({ kind: "fail", code: "UNKNOWN", error: String(error) });
    }
  };

  // 1.5 保存配置
  const handleSave = async () => {
    setSaveError(null);
    const payload = buildPayload();
    if ("error" in payload) {
      setSaveError(payload.error);
      return;
    }
    try {
      await onSave(payload);
      onClose();
    } catch (error) {
      setSaveError(String(error));
    }
  };

  // 1.6 清空配置
  const handleClear = async () => {
    setSaveError(null);
    if (!confirm("清空 UI 写入的配置后将回退到环境变量。继续？")) {
      return;
    }
    try {
      await onClear();
      onClose();
    } catch (error) {
      setSaveError(String(error));
    }
  };

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="settings-dialog">
        <header className="settings-header">
          <div className="settings-title" id="settings-title">
            <SettingsIcon size={16} />
            <span>AI 配置</span>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose} disabled={busy}>
            <X size={16} />
          </button>
        </header>

        <div className="settings-body">
          <SourceBadge source={config?.source ?? "none"} maskedTail={config?.maskedTail ?? null} />

          <label className="settings-field">
            <span className="settings-label"><KeyRound size={14} /> API Key</span>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={hasExistingKey ? PLACEHOLDER_KEY : "sk-..."}
              disabled={busy}
            />
            <span className="settings-hint">
              密钥仅在服务端保存为 data/config.json（权限 0o600），前端永不缓存。
            </span>
          </label>

          <label className="settings-field">
            <span className="settings-label"><Link2 size={14} /> Base URL</span>
            <input
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.openai.com/v1"
              disabled={busy}
            />
          </label>

          <label className="settings-field">
            <span className="settings-label"><Cpu size={14} /> 默认模型</span>
            <input
              type="text"
              value={reconstructModel}
              onChange={(event) => setReconstructModel(event.target.value)}
              placeholder="gpt-4o"
              disabled={busy}
            />
          </label>

          <TestBanner state={test} />
          {saveError ? (
            <div className="settings-banner settings-banner-error" role="alert">
              <AlertTriangle size={14} />
              <span>{saveError}</span>
            </div>
          ) : null}
        </div>

        <footer className="settings-footer">
          <button
            type="button"
            className="chip-btn"
            onClick={handleClear}
            disabled={busy || config?.source !== "file"}
            title={config?.source === "file" ? "删除 data/config.json，回退到环境变量" : "当前未使用 UI 配置"}
          >
            <Trash2 size={14} /> 清空 / 回退 env
          </button>
          <div className="settings-footer-right">
            <button type="button" className="chip-btn" onClick={handleTest} disabled={busy || test.kind === "running"}>
              <Plug size={14} /> {test.kind === "running" ? "测试中..." : "测试连接"}
            </button>
            <button type="button" className="chip-btn settings-save" onClick={handleSave} disabled={busy}>
              保存
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function SourceBadge({ source, maskedTail }: { source: "env" | "file" | "none"; maskedTail: string | null }) {
  /*
   * ========================================================================
   * 步骤1：显示当前配置来源
   * ========================================================================
   * 目标：
   *   1) 用户能一眼看出当前生效的是 env 还是 UI 写入的
   *   2) 暗示密钥是否已配置（末四位）
   */
  if (source === "none") {
    return (
      <div className="settings-banner settings-banner-warn">
        <AlertTriangle size={14} />
        <span>当前未配置 AI 凭据。填写下方表单后保存即可启用 AI 重建。</span>
      </div>
    );
  }
  const label = source === "file" ? "通过 UI 配置（data/config.json）" : "通过环境变量（OPENAI_API_KEY）";
  return (
    <div className="settings-banner settings-banner-info">
      <CheckCircle2 size={14} />
      <span>
        当前来源：<strong>{label}</strong>
        {maskedTail ? <> · Key 末位 <code>{maskedTail}</code></> : null}
      </span>
    </div>
  );
}

function TestBanner({ state }: { state: TestState }) {
  /*
   * ========================================================================
   * 步骤1：渲染测试连接结果
   * ========================================================================
   * 目标：
   *   1) 区分 AUTH / NETWORK / VALIDATION / UNKNOWN
   *   2) 不同错误给用户不同行动指引
   */
  if (state.kind === "idle" || state.kind === "running") {
    return null;
  }
  if (state.kind === "ok") {
    return (
      <div className="settings-banner settings-banner-success" role="status">
        <CheckCircle2 size={14} />
        <span>连接成功，可用模型 {state.modelCount} 个。</span>
      </div>
    );
  }
  const hint = describeTestError(state.code, state.error);
  return (
    <div className="settings-banner settings-banner-error" role="alert">
      <AlertTriangle size={14} />
      <span>{hint}</span>
    </div>
  );
}

function describeTestError(code: string, error: string) {
  /*
   * ========================================================================
   * 步骤1：把后端错误码映射为人类提示
   * ========================================================================
   */
  switch (code) {
    case "AUTH":
      return "认证失败：请检查 API Key 是否正确，以及是否对所选 Base URL 有效。";
    case "NETWORK":
      return `无法连接到 Base URL：请检查地址或网络。原因：${error}`;
    case "VALIDATION":
      return error;
    default:
      return `连接失败：${error}`;
  }
}
