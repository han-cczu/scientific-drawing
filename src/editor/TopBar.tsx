import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Download,
  Hand,
  Maximize2,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Plus,
  Redo2,
  Settings as SettingsIcon,
  Undo2,
  Upload
} from "lucide-react";

type ExportKind = "svg" | "pptx" | "json";

type TopBarProps = {
  title: string;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoom: number;
  onZoomChange: (next: number) => void;
  isSelectMode: boolean;
  isPanMode: boolean;
  onActivateSelect: () => void;
  onActivatePan: () => void;
  onImportImage: (file: File) => void;
  onExport: (kind: ExportKind) => void;
  onResetView: () => void;
  /** 剩余高级动作：导入 scene.json + 提示词下载留在"更多"菜单 */
  onSceneImport: (file: File) => void;
  onPromptExport: () => void;
  /** AI 设置入口 */
  onOpenSettings: () => void;
  settingsAttention?: boolean;
};

export function TopBar({
  title,
  busy,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  onZoomChange,
  isSelectMode,
  isPanMode,
  onActivateSelect,
  onActivatePan,
  onImportImage,
  onExport,
  onResetView,
  onSceneImport,
  onPromptExport,
  onOpenSettings,
  settingsAttention = false
}: TopBarProps) {
  /*
   * ========================================================================
   * 步骤1：渲染顶栏
   * ========================================================================
   * 目标：
   *   1) 复用现有撤销/重做、缩放、导入、导出业务回调
   *   2) 提供标题、保存指示、平移工具、全屏入口
   *   3) "更多"菜单保留重置视图 / 导入 scene.json / 下载提示词
   */

  // 1.1 维护本地 UI 状态：导出菜单 / 更多菜单展开
  const [exportOpen, setExportOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const sceneImportInputRef = useRef<HTMLInputElement | null>(null);

  // 1.2 点击外部关闭浮层
  useEffect(() => {
    if (!exportOpen && !moreOpen) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setExportOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [exportOpen, moreOpen]);

  // 1.3 处理导入图片
  const handleImportChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onImportImage(file);
    }
    event.target.value = "";
  };

  // 1.4 处理缩放调整
  const handleZoomStep = (delta: number) => {
    onZoomChange(zoom + delta);
  };

  // 1.5 处理全屏切换
  const handleFullscreen = () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => undefined);
    } else {
      document.exitFullscreen?.().catch(() => undefined);
    }
  };

  // 1.6 处理导出选择
  const handleExportSelect = (kind: ExportKind) => {
    setExportOpen(false);
    onExport(kind);
  };

  // 1.7 处理 scene.json 导入（来自"更多"菜单）
  const handleSceneImportChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onSceneImport(file);
      setMoreOpen(false);
    }
    event.target.value = "";
  };

  const zoomLabel = `${Math.round(zoom * 100)}%`;

  // 1.8 输出顶栏
  return (
    <header className="top-bar" role="banner">
      <div className="title">
        <span className="title-main">{title}</span>
      </div>
      <div className="save-indicator" aria-label="保存状态">
        <span className="dot" />
        <span>本地编辑中</span>
      </div>

      <div className="spacer" />

      <div className="btn-group" role="group" aria-label="历史">
        <button
          type="button"
          className="icon-btn"
          title="撤销"
          onClick={onUndo}
          disabled={!canUndo || busy}
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="重做"
          onClick={onRedo}
          disabled={!canRedo || busy}
        >
          <Redo2 size={16} />
        </button>
      </div>

      <button
        type="button"
        className={isSelectMode ? "chip-btn active" : "chip-btn"}
        title="选择工具"
        onClick={onActivateSelect}
        disabled={busy}
      >
        <MousePointer2 size={14} />
        <span>选择</span>
      </button>

      <div className="zoom-control" role="group" aria-label="缩放">
        <button
          type="button"
          className="icon-btn"
          title="缩小"
          onClick={() => handleZoomStep(-0.1)}
          disabled={busy}
        >
          <Minus size={14} />
        </button>
        <span className="zoom-value">{zoomLabel}</span>
        <button
          type="button"
          className="icon-btn"
          title="放大"
          onClick={() => handleZoomStep(0.1)}
          disabled={busy}
        >
          <Plus size={14} />
        </button>
      </div>

      <button
        type="button"
        className={isPanMode ? "chip-btn active" : "chip-btn"}
        title="平移画布（拖拽空白处或按空格可平移）"
        onClick={onActivatePan}
        disabled={busy}
      >
        <Hand size={14} />
      </button>

      <button
        type="button"
        className="chip-btn"
        title="全屏"
        onClick={handleFullscreen}
      >
        <Maximize2 size={14} />
      </button>

      <label className="chip-btn upload-chip" title="导入图片">
        <Upload size={14} />
        <span>导入</span>
        <input type="file" accept="image/*" onChange={handleImportChange} disabled={busy} />
      </label>

      <div className="export-menu" ref={exportMenuRef}>
        <button
          type="button"
          className={exportOpen ? "chip-btn active" : "chip-btn"}
          title="导出"
          onClick={() => setExportOpen((open) => !open)}
          disabled={busy}
        >
          <Download size={14} />
          <span>导出</span>
          <ChevronDown size={14} />
        </button>
        {exportOpen ? (
          <div className="export-menu-list" role="menu">
            <button type="button" onClick={() => handleExportSelect("svg")} disabled={busy}>
              导出 SVG
            </button>
            <button type="button" onClick={() => handleExportSelect("pptx")} disabled={busy}>
              导出 PPTX
            </button>
            <button type="button" onClick={() => handleExportSelect("json")} disabled={busy}>
              导出 JSON
            </button>
          </div>
        ) : null}
      </div>

      <div className="export-menu" ref={moreMenuRef}>
        <button
          type="button"
          className={moreOpen ? "icon-btn active" : "icon-btn"}
          title="更多操作"
          aria-label="更多操作"
          onClick={() => setMoreOpen((open) => !open)}
          disabled={busy}
        >
          <MoreHorizontal size={16} />
        </button>
        {moreOpen ? (
          <div className="export-menu-list" role="menu">
            <button
              type="button"
              disabled={busy}
              onClick={() => sceneImportInputRef.current?.click()}
            >
              导入 scene.json
            </button>
            <button type="button" onClick={() => { onPromptExport(); setMoreOpen(false); }} disabled={busy}>
              下载重建提示词
            </button>
            <button type="button" onClick={() => { onResetView(); setMoreOpen(false); }} disabled={busy}>
              重置视图
            </button>
            <input
              ref={sceneImportInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleSceneImportChange}
              disabled={busy}
              hidden
            />
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className={settingsAttention ? "icon-btn settings-attention" : "icon-btn"}
        title="AI 设置"
        aria-label="AI 设置"
        onClick={onOpenSettings}
      >
        <SettingsIcon size={18} />
      </button>
    </header>
  );
}
