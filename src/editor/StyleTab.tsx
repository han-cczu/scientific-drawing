import { useCallback, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import type { SceneNode, SceneStyle } from "../shared/scene";
import { QUICK_STYLE_PRESETS } from "./quickStyles";
import {
  CUSTOM_PRESET_LIMIT,
  deleteCustomPreset,
  loadCustomPresets,
  saveCustomPreset
} from "../lib/customStyles";

type StyleTabProps = {
  node: SceneNode | null;
  onStyleChange: (patch: SceneStyle) => void;
};

type DashKind = "solid" | "dash" | "dot" | "double-dash";

const DASH_VALUES: Record<DashKind, string> = {
  solid: "",
  dash: "4 4",
  dot: "2 2",
  "double-dash": "8 3 2 3"
};

const DASH_LABEL: Record<DashKind, string> = {
  solid: "实线",
  dash: "虚线",
  dot: "点线",
  "double-dash": "双虚线"
};

function dashToKind(dash: string | undefined): DashKind {
  if (!dash) return "solid";
  if (dash === "4 4") return "dash";
  if (dash === "2 2") return "dot";
  if (dash === "8 3 2 3") return "double-dash";
  // 未识别的自定义 dash 当作虚线
  return "dash";
}

function clampHex(value: string | undefined, fallback: string): string {
  if (!value || value === "none") return fallback;
  return value;
}

export function StyleTab({ node, onStyleChange }: StyleTabProps) {
  const fillInputRef = useRef<HTMLInputElement | null>(null);
  const strokeInputRef = useRef<HTMLInputElement | null>(null);
  const shadowToggleId = useId();
  const [customPresets, setCustomPresets] = useState(() => loadCustomPresets());

  const handleSaveCustomPreset = useCallback(() => {
    if (!node) return;
    const fillValue = node.style.fill ?? "none";
    const strokeValue = node.style.stroke ?? "none";
    const result = saveCustomPreset(fillValue, strokeValue);
    if (result) {
      setCustomPresets((prev) => [...prev, result]);
    }
  }, [node]);

  const handleDeleteCustomPreset = useCallback((id: string) => {
    deleteCustomPreset(id);
    setCustomPresets((prev) => prev.filter((p) => p.id !== id));
  }, []);

  if (!node) {
    return (
      <div className="style-tab">
        <div className="panel-title">样式</div>
        <div className="empty-state">请先选中节点</div>
      </div>
    );
  }

  const fill = node.style.fill ?? "none";
  const stroke = node.style.stroke ?? "none";
  const strokeWidth = node.style.strokeWidth ?? 1;
  const opacity = node.style.opacity ?? 1;
  const dashKind = dashToKind(node.style.dash);

  const opacityPercent = Math.round(opacity * 100);

  const onChangeOpacityPercent = (next: number) => {
    const clamped = Math.max(0, Math.min(100, next));
    onStyleChange({ opacity: clamped / 100 });
  };

  const onChangeDashKind = (kind: DashKind) => {
    onStyleChange({ dash: DASH_VALUES[kind] || undefined });
  };

  return (
    <div className="style-tab">
      <div className="panel-title">样式</div>

      {/* 填充行 */}
      <div className="style-section">
        <div className="style-section-title">填充</div>
        <div className="style-row">
          <button
            type="button"
            className="color-swatch"
            style={{ background: fill === "none" ? "transparent" : fill }}
            onClick={() => fillInputRef.current?.click()}
            aria-label="选择填充颜色"
            title={fill}
          >
            {fill === "none" ? <span className="color-swatch-none">/</span> : null}
          </button>
          <input
            ref={fillInputRef}
            type="color"
            className="color-input-hidden"
            value={clampHex(fill, "#ffffff")}
            onChange={(event) => onStyleChange({ fill: event.target.value })}
          />
          <span className="style-hex">{fill}</span>
          <div className="style-row-end">
            <input
              type="number"
              min={0}
              max={100}
              value={opacityPercent}
              onChange={(event) => onChangeOpacityPercent(Number(event.target.value || 0))}
              className="style-number-input"
              aria-label="填充不透明度"
            />
            <span className="style-unit">%</span>
            <button type="button" className="style-add-btn" disabled title="添加新填充（P4）">+</button>
          </div>
        </div>
      </div>

      {/* 描边行 */}
      <div className="style-section">
        <div className="style-section-title">描边</div>
        <div className="style-row">
          <button
            type="button"
            className="color-swatch"
            style={{ background: stroke === "none" ? "transparent" : stroke }}
            onClick={() => strokeInputRef.current?.click()}
            aria-label="选择描边颜色"
            title={stroke}
          >
            {stroke === "none" ? <span className="color-swatch-none">/</span> : null}
          </button>
          <input
            ref={strokeInputRef}
            type="color"
            className="color-input-hidden"
            value={clampHex(stroke, "#111111")}
            onChange={(event) => onStyleChange({ stroke: event.target.value })}
          />
          <span className="style-hex">{stroke}</span>
          <div className="style-row-end">
            <input
              type="number"
              min={0}
              step={0.5}
              value={strokeWidth}
              onChange={(event) => onStyleChange({ strokeWidth: Number(event.target.value || 0) })}
              className="style-number-input"
              aria-label="描边线宽"
            />
            <select
              className="style-dash-select"
              value={dashKind}
              onChange={(event) => onChangeDashKind(event.target.value as DashKind)}
              aria-label="线型"
            >
              <option value="solid">{DASH_LABEL.solid}</option>
              <option value="dash">{DASH_LABEL.dash}</option>
              <option value="dot">{DASH_LABEL.dot}</option>
              <option value="double-dash">{DASH_LABEL["double-dash"]}</option>
            </select>
          </div>
        </div>
      </div>

      {/* 线型 chip 行 */}
      <div className="style-section">
        <div className="style-section-title">线型</div>
        <div className="line-style-chips" role="radiogroup" aria-label="线型选择">
          {(Object.keys(DASH_VALUES) as DashKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={dashKind === kind}
              className={dashKind === kind ? "line-style-chip active" : "line-style-chip"}
              onClick={() => onChangeDashKind(kind)}
              title={DASH_LABEL[kind]}
            >
              <svg width="42" height="14" viewBox="0 0 42 14" aria-hidden>
                <line
                  x1="2"
                  y1="7"
                  x2="40"
                  y2="7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray={DASH_VALUES[kind] || undefined}
                />
              </svg>
            </button>
          ))}
        </div>
      </div>

      {/* 透明度行 */}
      <div className="style-section">
        <div className="style-section-title">透明度</div>
        <div className="style-row">
          <input
            type="range"
            min={0}
            max={100}
            value={opacityPercent}
            onChange={(event) => onChangeOpacityPercent(Number(event.target.value || 0))}
            className="style-range"
            aria-label="透明度滑块"
          />
          <span className="style-unit-end">{opacityPercent}%</span>
        </div>
      </div>

      {/* 阴影行（占位 disabled） */}
      <div className="style-section">
        <div className="style-section-title">阴影</div>
        <div className="style-row">
          <label className="style-toggle" htmlFor={shadowToggleId}>
            <input id={shadowToggleId} type="checkbox" disabled aria-label="启用阴影（P4 占位）" />
            <span className="style-toggle-track">
              <span className="style-toggle-thumb" />
            </span>
            <span className="style-toggle-label">关闭</span>
          </label>
          <span className="style-hint">P4</span>
        </div>
      </div>

      {/* 快速样式九宫格 */}
      <div className="style-section">
        <div className="style-section-title">快速样式</div>
        <div className="quick-styles-grid">
          {QUICK_STYLE_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className="quick-style-swatch"
              onClick={() => onStyleChange({ fill: preset.fill, stroke: preset.stroke })}
              title={preset.name}
              aria-label={`应用快速样式 ${preset.name}`}
            >
              <span
                className="quick-style-swatch-inner"
                style={{ background: preset.fill, borderColor: preset.stroke }}
              />
            </button>
          ))}
          {customPresets.map((preset, index) => (
            <div key={preset.id ?? `custom-${index}`} className="quick-style-swatch-wrapper">
              <button
                type="button"
                className="quick-style-swatch custom"
                onClick={() => onStyleChange({ fill: preset.fill, stroke: preset.stroke })}
                title={`自定义 ${index + 1}`}
                aria-label={`应用自定义样式 ${index + 1}`}
              >
                <span
                  className="quick-style-swatch-inner"
                  style={{ background: preset.fill, borderColor: preset.stroke }}
                />
              </button>
              <button
                type="button"
                className="quick-style-delete"
                onClick={(event) => {
                  event.stopPropagation();
                  if (preset.id) {
                    handleDeleteCustomPreset(preset.id);
                  }
                }}
                aria-label={`删除自定义样式 ${index + 1}`}
                title="删除"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
        {(() => {
          const fillHasValue = node.style.fill !== undefined && node.style.fill !== null && node.style.fill !== "none";
          const strokeHasValue =
            node.style.stroke !== undefined && node.style.stroke !== null && node.style.stroke !== "none";
          const hasStyleValue = fillHasValue || strokeHasValue;
          const reachedLimit = customPresets.length >= CUSTOM_PRESET_LIMIT;
          const saveDisabled = !hasStyleValue || reachedLimit;
          const label = reachedLimit
            ? `已达上限 (${CUSTOM_PRESET_LIMIT}/${CUSTOM_PRESET_LIMIT})`
            : "保存为样式";
          return (
            <button
              type="button"
              className="style-save-btn"
              onClick={handleSaveCustomPreset}
              disabled={saveDisabled}
              title={reachedLimit ? "自定义预设已达上限，删除后再保存" : "保存当前 fill/stroke 为自定义样式"}
            >
              {label}
            </button>
          );
        })()}
      </div>
    </div>
  );
}
