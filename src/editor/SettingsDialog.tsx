import { useEffect, useRef, useState } from "react";
import {
  Settings as SettingsIcon,
  X,
  KeyRound,
  Link2,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Plug,
  RefreshCw
} from "lucide-react";
import type { AppConfig, TestConfigErrorCode, TestConfigResult, WritableAppConfig } from "../lib/api";

type SettingsDialogProps = {
  open: boolean;
  busy: boolean;
  config: AppConfig | null;
  onClose: () => void;
  onSave: (payload: WritableAppConfig) => Promise<AppConfig>;
  onClear: () => Promise<AppConfig>;
  onTest: (payload: WritableAppConfig) => Promise<TestConfigResult>;
  /** 首跑自动弹出时提供：「跳过，先用基础分析」逃生通道 */
  onSkip?: () => void;
};

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; modelCount: number }
  | { kind: "fail"; code: TestConfigErrorCode; error: string };

type RefreshState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; modelCount: number }
  | { kind: "fail"; code: TestConfigErrorCode; error: string };

const PLACEHOLDER_KEY = "已配置（输入新值可覆盖，留空保持原值）";
const MODEL_DATALIST_ID = "ai-model-options";

export function SettingsDialog({
  open,
  busy,
  config,
  onClose,
  onSave,
  onClear,
  onTest,
  onSkip
}: SettingsDialogProps) {
  /*
   * ========================================================================
   * 步骤1：渲染 AI 配置对话框
   * ========================================================================
   * 目标：
   *   1) 表单字段：apiKey/baseUrl/reconstructModel
   *   2) 操作：测试连接、保存、清空回退 env、刷新模型列表
   *   3) 已配置时 apiKey 字段允许"留空保持原值"——saved-key fallback 由后端处理
   *   4) 模型字段用 datalist，复用现有 reconstructModels 并支持手填
   */

  // 1.1 维护表单状态
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [reconstructModel, setReconstructModel] = useState("");
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [refresh, setRefresh] = useState<RefreshState>({ kind: "idle" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dataListModels, setDataListModels] = useState<string[]>([]);

  // 1.2 打开/外部 config 变化时同步表单（保留 apiKey 输入框为空）
  useEffect(() => {
    if (!open) {
      return;
    }
    setApiKey("");
    setBaseUrl(config?.baseUrl ?? "https://api.openai.com/v1");
    setReconstructModel(config?.reconstructModel ?? "gpt-4o");
    setTest({ kind: "idle" });
    setRefresh({ kind: "idle" });
    setSaveError(null);
    // 1.2.1 用 GET /api/config 已经拉到的模型列表作为下拉初值（零额外请求）
    setDataListModels(config?.reconstructModels ?? []);
  }, [open, config?.baseUrl, config?.reconstructModel, config?.reconstructModels]);

  // 1.3 焦点管理：打开时聚焦首字段并支持 Escape 关闭，关闭后还原焦点
  //   App 的全局快捷键被 isEditableKeyboardTarget 屏蔽（输入框聚焦时不触发），
  //   故对话框需要自己的 Escape 监听。
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) {
      return;
    }
    const restoreTarget = document.activeElement;
    firstFieldRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (restoreTarget instanceof HTMLElement) {
        restoreTarget.focus?.();
      }
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const hasExistingKey = Boolean(config?.hasApiKey);
  const effectiveApiKey = apiKey.trim();

  // 1.3 校验：拼出可发到后端的 writable payload
  //     当 hasExistingKey=true 且表单 apiKey 留空时，apiKey 用空字符串提交，
  //     后端会用 data/config.json 里的 saved key 复用。
  const buildPayload = (): WritableAppConfig | { error: string } => {
    if (!effectiveApiKey && !hasExistingKey) {
      return { error: "请填写 API Key。" };
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
        // 1.4.1 测试成功后把最新模型列表写入 datalist
        if (result.models.length > 0) {
          setDataListModels(result.models);
        }
      } else {
        setTest({ kind: "fail", code: result.code, error: result.error });
      }
    } catch (error) {
      setTest({ kind: "fail", code: "UNKNOWN", error: String(error) });
    }
  };

  // 1.5 刷新模型列表（独立 loading state，复用 /api/config/test 端点）
  const handleRefreshModels = async () => {
    const payload = buildPayload();
    if ("error" in payload) {
      setRefresh({ kind: "fail", code: "VALIDATION", error: payload.error });
      return;
    }
    setRefresh({ kind: "running" });
    try {
      const result = await onTest(payload);
      if (result.ok) {
        setRefresh({ kind: "ok", modelCount: result.modelCount });
        if (result.models.length > 0) {
          // 1.5.1 拉取成功才覆盖；失败时按 D7 保留上次结果
          setDataListModels(result.models);
        }
      } else {
        setRefresh({ kind: "fail", code: result.code, error: result.error });
      }
    } catch (error) {
      setRefresh({ kind: "fail", code: "UNKNOWN", error: String(error) });
    }
  };

  // 1.6 保存配置
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

  // 1.7 清空配置
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
              ref={firstFieldRef}
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={hasExistingKey ? PLACEHOLDER_KEY : "sk-..."}
              disabled={busy}
            />
            <span className="settings-hint">
              密钥仅在服务端保存为 data/config.json（权限 0o600），前端永不缓存。
              {hasExistingKey ? "已配置时此处可留空，保存或测试时后端会复用已保存的 key。" : null}
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

          <div className="settings-field">
            <span className="settings-label"><Cpu size={14} /> 默认模型</span>
            <div className="settings-field-with-action">
              <input
                type="text"
                list={MODEL_DATALIST_ID}
                value={reconstructModel}
                onChange={(event) => setReconstructModel(event.target.value)}
                placeholder="gpt-4o"
                disabled={busy}
              />
              <button
                type="button"
                className="icon-btn"
                onClick={handleRefreshModels}
                disabled={busy || refresh.kind === "running"}
                aria-label="刷新模型列表"
                title="拉取最新模型列表（使用当前表单的 Base URL 和 Key）"
              >
                <RefreshCw size={14} className={refresh.kind === "running" ? "settings-refresh-spin" : undefined} />
              </button>
            </div>
            <datalist id={MODEL_DATALIST_ID}>
              {dataListModels.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            <RefreshBanner state={refresh} />
          </div>

          <TestBanner state={test} />
          {saveError ? (
            <div className="settings-banner settings-banner-error" role="alert">
              <AlertTriangle size={14} />
              <span>{saveError}</span>
            </div>
          ) : null}
        </div>

        <footer className="settings-footer">
          {onSkip && config?.source === "none" ? (
            <button
              type="button"
              className="chip-btn"
              onClick={onSkip}
              disabled={busy}
              title="不配置 AI，先使用启发式分析与编辑导出"
            >
              跳过，先用基础分析
            </button>
          ) : (
            <button
              type="button"
              className="chip-btn"
              onClick={handleClear}
              disabled={busy || config?.source !== "file"}
              title={config?.source === "file" ? "删除 data/config.json，回退到环境变量" : "当前未使用 UI 配置"}
            >
              <Trash2 size={14} /> 清空 / 回退 env
            </button>
          )}
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
   *   1) 区分 AUTH / NETWORK / INVALID_RESPONSE / VALIDATION / UNKNOWN
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

function RefreshBanner({ state }: { state: RefreshState }) {
  /*
   * ========================================================================
   * 步骤1：渲染模型列表刷新结果
   * ========================================================================
   * 目标：
   *   1) 仅在出错或成功时显示，避免占用列表空间
   *   2) 与测试连接的 banner 复用错误码映射
   */
  if (state.kind === "idle" || state.kind === "running") {
    return null;
  }
  if (state.kind === "ok") {
    return (
      <div className="settings-banner settings-banner-success" role="status">
        <CheckCircle2 size={14} />
        <span>已刷新模型列表，共 {state.modelCount} 个。</span>
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

function describeTestError(code: TestConfigErrorCode, error: string) {
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
    case "INVALID_RESPONSE":
      return "响应不是 JSON（可能 Base URL 路径不对，不是 OpenAI 兼容端点）。";
    case "VALIDATION":
      return error;
    default:
      return `连接失败：${error}`;
  }
}
