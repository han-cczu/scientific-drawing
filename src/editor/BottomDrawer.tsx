import { useRef, useState, type DragEvent } from "react";
import { Sparkles, Sliders, Wand2, Upload } from "lucide-react";
import type { ReconstructionMode } from "../lib/api";

type PrecisionLevel = "low" | "medium" | "high" | "ultra";
type ColorModeUi = "auto" | "color" | "mono";

type BottomDrawerProps = {
  busy: boolean;
  aiReconstructionAvailable: boolean;
  reconstructionMode: ReconstructionMode;
  onReconstructionModeChange: (mode: ReconstructionMode) => void;
  onReconstructImage: (file: File) => void;
};

const PRECISION_OPTIONS: Array<{ key: PrecisionLevel; label: string }> = [
  { key: "low", label: "低" },
  { key: "medium", label: "中" },
  { key: "high", label: "高" },
  { key: "ultra", label: "超高" }
];

export function BottomDrawer({
  busy,
  aiReconstructionAvailable,
  reconstructionMode,
  onReconstructionModeChange,
  onReconstructImage
}: BottomDrawerProps) {
  /*
   * ========================================================================
   * 步骤1：渲染底部 AI 矢量化抽屉
   * ========================================================================
   * 目标：
   *   1) 卡片 1 提供 AI 矢量化 drop zone + 点击上传
   *   2) 卡片 2 提供精度 / 颜色模式（仅"单色"接 reconstructionMode）
   *   3) 卡片 3 提供占位优化选项
   */

  // 1.1 维护本地 UI state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [precision, setPrecision] = useState<PrecisionLevel>("high");
  const [colorMode, setColorMode] = useState<ColorModeUi>(reconstructionMode === "mono" ? "mono" : "color");
  const [dragOver, setDragOver] = useState(false);
  const [optMerge, setOptMerge] = useState(true);
  const [optRemove, setOptRemove] = useState(false);
  const [optCurve, setOptCurve] = useState(false);

  const disabled = busy || !aiReconstructionAvailable;

  // 1.2 处理拖入与点击上传
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (disabled) {
      return;
    }
    const file = event.dataTransfer.files?.[0];
    if (file) {
      onReconstructImage(file);
    }
  };

  const handleFilePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onReconstructImage(file);
    }
    event.target.value = "";
  };

  // 1.3 处理颜色模式切换
  const handleColorModeChange = (next: ColorModeUi) => {
    setColorMode(next);
    if (next === "mono") {
      onReconstructionModeChange("mono");
    } else {
      onReconstructionModeChange("color");
    }
  };

  return (
    <section className="bottom-drawer" aria-label="AI 矢量化抽屉">
      <div
        className={
          dragOver
            ? "drawer-card drawer-card-drop drawer-card-drop-active"
            : disabled
              ? "drawer-card drawer-card-drop drawer-card-drop-disabled"
              : "drawer-card drawer-card-drop"
        }
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) {
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => {
          if (!disabled) {
            fileInputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="drawer-card-title">
          <Sparkles size={14} />
          <span>AI 矢量化</span>
        </div>
        <div className="drop-zone">
          <Upload size={22} />
          <div className="drop-zone-primary">点击或拖拽图片到此处</div>
          <div className="drop-zone-secondary">支持 JPG、PNG、TIFF 格式</div>
          {!aiReconstructionAvailable ? (
            <div className="drop-zone-hint">需要配置 OPENAI_API_KEY</div>
          ) : null}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFilePick}
          disabled={disabled}
          hidden
        />
      </div>

      <div className="drawer-card">
        <div className="drawer-card-title">
          <Sliders size={14} />
          <span>矢量化设置</span>
        </div>
        <div className="drawer-row">
          <span className="drawer-row-label">精度</span>
          <div className="chip-row">
            {PRECISION_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={precision === option.key ? "chip-select chip-select-active" : "chip-select"}
                onClick={() => setPrecision(option.key)}
                disabled={busy}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="drawer-row">
          <span className="drawer-row-label">颜色模式</span>
          <select
            className="drawer-select"
            value={colorMode}
            onChange={(event) => handleColorModeChange(event.target.value as ColorModeUi)}
            disabled={busy}
          >
            <option value="auto">自动识别</option>
            <option value="color">彩色</option>
            <option value="mono">单色</option>
          </select>
        </div>
        <button
          type="button"
          className="drawer-primary-btn"
          disabled
          title="P4 接入"
        >
          重新矢量化
        </button>
      </div>

      <div className="drawer-card">
        <div className="drawer-card-title">
          <Wand2 size={14} />
          <span>优化选项</span>
        </div>
        <label className="drawer-check">
          <input type="checkbox" checked={optMerge} onChange={(event) => setOptMerge(event.target.checked)} />
          <span>合并相似路径</span>
        </label>
        <label className="drawer-check">
          <input type="checkbox" checked={optRemove} onChange={(event) => setOptRemove(event.target.checked)} />
          <span>移除冗余节点</span>
        </label>
        <label className="drawer-check">
          <input type="checkbox" checked={optCurve} onChange={(event) => setOptCurve(event.target.checked)} />
          <span>优化曲线</span>
        </label>
        <button
          type="button"
          className="drawer-primary-btn"
          disabled
          title="P4 接入"
        >
          应用优化
        </button>
      </div>
    </section>
  );
}
