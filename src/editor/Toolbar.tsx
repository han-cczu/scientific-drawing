import { Download, FileJson, FileType2, ImageUp, MousePointer2, Square, Circle, Type, Minus, MoveRight, Trash2, Copy, Upload, WandSparkles, BrainCircuit, Palette, Contrast, RotateCcw } from "lucide-react";
import { logger } from "../lib/logger";
import type { SceneNodeType } from "../shared/scene";
import type { ReconstructionMode } from "../lib/api";

export type Tool = "select" | SceneNodeType;

type ToolbarProps = {
  tool: Tool;
  busy: boolean;
  hasSelection: boolean;
  aiReconstructionAvailable: boolean;
  reconstructionMode: ReconstructionMode;
  onToolChange: (tool: Tool) => void;
  onFileChange: (file: File) => void;
  onModeChange: (mode: ReconstructionMode) => void;
  onReconstruct: (file: File) => void;
  onSceneImport: (file: File) => void;
  onPromptExport: () => void;
  onExport: (kind: "svg" | "pptx" | "json") => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onResetView: () => void;
};

const tools: Array<{ id: Tool; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "select", label: "选择", icon: MousePointer2 },
  { id: "rect", label: "矩形", icon: Square },
  { id: "ellipse", label: "椭圆", icon: Circle },
  { id: "text", label: "文本", icon: Type },
  { id: "line", label: "线条", icon: Minus },
  { id: "arrow", label: "箭头", icon: MoveRight }
];

export function Toolbar({
  tool,
  busy,
  hasSelection,
  aiReconstructionAvailable,
  reconstructionMode,
  onToolChange,
  onFileChange,
  onModeChange,
  onReconstruct,
  onSceneImport,
  onPromptExport,
  onExport,
  onDelete,
  onDuplicate,
  onResetView
}: ToolbarProps) {
  /*
   * ========================================================================
   * 步骤1：渲染编辑工具栏
   * ========================================================================
   * 目标：
   *   1) 提供上传、选择和绘制工具
   *   2) 提供删除、复制和导出命令
   */
  logger.info("开始渲染编辑工具栏...", { tool, busy, hasSelection, aiReconstructionAvailable });

  // 1.1 处理文件选择
  const handleInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onFileChange(file);
    }
    event.target.value = "";
  };

  // 1.2 处理 scene 文件选择
  const handleSceneInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onSceneImport(file);
    }
    event.target.value = "";
  };

  // 1.3 处理 AI 重建文件选择
  const handleReconstructInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onReconstruct(file);
    }
    event.target.value = "";
  };

  // 1.4 渲染工具栏
  logger.info("渲染编辑工具栏完成", { tool });
  return (
    <aside className="toolbar" aria-label="工具栏">
      <label className="icon-button upload-button" title="上传图片">
        <ImageUp size={18} />
        <input type="file" accept="image/*" onChange={handleInput} disabled={busy} />
      </label>
      <div className="mode-switch" role="group" aria-label="重建模式">
        <button
          className={reconstructionMode === "color" ? "icon-button active" : "icon-button"}
          title="彩色重建"
          type="button"
          onClick={() => onModeChange("color")}
          disabled={busy}
        >
          <Palette size={18} />
        </button>
        <button
          className={reconstructionMode === "mono" ? "icon-button active" : "icon-button"}
          title="黑白重建"
          type="button"
          onClick={() => onModeChange("mono")}
          disabled={busy}
        >
          <Contrast size={18} />
        </button>
      </div>

      <label className={aiReconstructionAvailable ? "icon-button upload-button" : "icon-button upload-button disabled"} title={aiReconstructionAvailable ? `AI重建 · ${reconstructionMode === "color" ? "彩色" : "黑白"}` : "AI重建需要 OPENAI_API_KEY"}>
        <BrainCircuit size={18} />
        <input type="file" accept="image/*" onChange={handleReconstructInput} disabled={busy || !aiReconstructionAvailable} />
      </label>
      <label className="icon-button upload-button" title="导入 scene.json">
        <Upload size={18} />
        <input type="file" accept="application/json,.json" onChange={handleSceneInput} disabled={busy} />
      </label>
      <button className="icon-button" title="下载重建提示词" type="button" onClick={onPromptExport} disabled={busy}>
        <WandSparkles size={18} />
      </button>

      <div className="tool-group">
        {tools.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={tool === item.id ? "icon-button active" : "icon-button"}
              title={item.label}
              type="button"
              onClick={() => onToolChange(item.id)}
              disabled={busy}
            >
              <Icon size={18} />
            </button>
          );
        })}
      </div>

      <div className="tool-group">
        <button className="icon-button" title="重置视图" type="button" onClick={onResetView} disabled={busy}>
          <RotateCcw size={18} />
        </button>
        <button className="icon-button" title="复制" type="button" onClick={onDuplicate} disabled={!hasSelection || busy}>
          <Copy size={18} />
        </button>
        <button className="icon-button danger" title="删除" type="button" onClick={onDelete} disabled={!hasSelection || busy}>
          <Trash2 size={18} />
        </button>
      </div>

      <div className="tool-group bottom">
        <button className="icon-button" title="导出 JSON" type="button" onClick={() => onExport("json")} disabled={busy}>
          <FileJson size={18} />
        </button>
        <button className="icon-button" title="导出 SVG" type="button" onClick={() => onExport("svg")} disabled={busy}>
          <Download size={18} />
        </button>
        <button className="icon-button" title="导出 PPTX" type="button" onClick={() => onExport("pptx")} disabled={busy}>
          <FileType2 size={18} />
        </button>
      </div>
    </aside>
  );
}
