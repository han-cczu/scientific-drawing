import { useRef, useState, type DragEvent } from "react";
import { Sparkles, Sliders, Upload } from "lucide-react";
import type { ReconstructionMode } from "../lib/api";

type BottomDrawerProps = {
  busy: boolean;
  aiReconstructionAvailable: boolean;
  reconstructionMode: ReconstructionMode;
  onReconstructionModeChange: (mode: ReconstructionMode) => void;
  onReconstructImage: (file: File) => void;
};

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
   *   2) 卡片 2 提供颜色模式（color/mono 与后端 ReconstructionMode 一一对应）
   *   3) 不渲染任何无后端能力支撑的占位控件
   */

  // 1.1 维护本地 UI state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

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

  return (
    <section className="bottom-drawer" aria-label="AI 矢量化抽屉">
      <div
        className={[
          "drawer-card drawer-card-drop",
          dragOver ? "drawer-card-drop-active" : "",
          !dragOver && disabled ? "drawer-card-drop-disabled" : "",
          busy ? "is-busy" : ""
        ].filter(Boolean).join(" ")}
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
          <div className="drop-zone-primary">{busy ? "正在重建…" : "点击或拖拽图片到此处"}</div>
          <div className="drop-zone-secondary">支持 PNG、JPEG、WebP 格式</div>
          {!aiReconstructionAvailable ? (
            <div className="drop-zone-hint">需要配置 OPENAI_API_KEY</div>
          ) : null}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
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
          <span className="drawer-row-label">颜色模式</span>
          <select
            className="drawer-select"
            value={reconstructionMode}
            onChange={(event) => onReconstructionModeChange(event.target.value as ReconstructionMode)}
            disabled={busy}
          >
            <option value="color">彩色</option>
            <option value="mono">单色</option>
          </select>
        </div>
      </div>
    </section>
  );
}
