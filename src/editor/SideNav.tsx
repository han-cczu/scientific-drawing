import {
  ArrowRight,
  Circle,
  MoreHorizontal,
  MousePointer2,
  Plus,
  Sigma,
  Square,
  Table,
  Type,
  Wand2,
  Minus as LineIcon,
  Image as ImageIcon
} from "lucide-react";
import { logger } from "../lib/logger";
import { LayersPanel } from "./LayersPanel";
import { Logo } from "./Logo";
import type { SceneNode } from "../shared/scene";

type SideNavProps = {
  isSelectMode: boolean;
  isRegionMode: boolean;
  aiReconstructionAvailable: boolean;
  onActivateSelect: () => void;
  onActivateRegionReconstruct: () => void;
  nodes: SceneNode[];
  selectedIds: string[];
  onSelectNodes: (ids: string[]) => void;
  onToggleHidden: (nodeId: string) => void;
  onToggleLocked: (nodeId: string) => void;
  onMoveLayer: (nodeId: string, direction: "forward" | "backward") => void;
};

type ToolEntry = {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  enabled: boolean;
  active: boolean;
  onClick?: () => void;
  title?: string;
};

export function SideNav({
  isSelectMode,
  isRegionMode,
  aiReconstructionAvailable,
  onActivateSelect,
  onActivateRegionReconstruct,
  nodes,
  selectedIds,
  onSelectNodes,
  onToggleHidden,
  onToggleLocked,
  onMoveLayer
}: SideNavProps) {
  /*
   * ========================================================================
   * 步骤1：渲染左侧导航栏
   * ========================================================================
   * 目标：
   *   1) 展示 Logo、工具列表、图层区
   *   2) 仅"选择"与"局部 AI 重建"挂业务回调，其余工具为占位
   */
  logger.info("开始渲染侧栏...", { isSelectMode, isRegionMode, layers: nodes.length });

  // 1.1 构造工具条目（顺序固定，禁用项灰色）
  const tools: ToolEntry[] = [
    {
      id: "select",
      label: "选择",
      icon: MousePointer2,
      enabled: true,
      active: isSelectMode,
      onClick: onActivateSelect
    },
    {
      id: "region-ai",
      label: "局部 AI 重建",
      icon: Wand2,
      enabled: aiReconstructionAvailable,
      active: isRegionMode,
      onClick: onActivateRegionReconstruct,
      title: aiReconstructionAvailable ? "框选区域调用 AI 重建" : "需要 OPENAI_API_KEY"
    },
    { id: "canvas", label: "画布", icon: Square, enabled: false, active: false },
    { id: "text", label: "文本", icon: Type, enabled: false, active: false },
    { id: "shape", label: "形状", icon: Square, enabled: false, active: false },
    { id: "line", label: "线条", icon: LineIcon, enabled: false, active: false },
    { id: "arrow", label: "箭头", icon: ArrowRight, enabled: false, active: false },
    { id: "icon", label: "图标", icon: Circle, enabled: false, active: false },
    { id: "image", label: "图片", icon: ImageIcon, enabled: false, active: false },
    { id: "formula", label: "公式", icon: Sigma, enabled: false, active: false },
    { id: "table", label: "表格", icon: Table, enabled: false, active: false },
    { id: "more", label: "更多", icon: MoreHorizontal, enabled: false, active: false }
  ];

  // 1.2 输出侧栏
  logger.info("渲染侧栏完成");
  return (
    <aside className="side-nav" aria-label="侧栏">
      <Logo />

      <div className="tools-group" role="group" aria-label="工具">
        <div className="side-section-title">工具</div>
        {tools.map((tool) => {
          const Icon = tool.icon;
          const className = tool.active ? "tool-item active" : "tool-item";
          return (
            <button
              key={tool.id}
              type="button"
              className={className}
              onClick={tool.onClick}
              disabled={!tool.enabled}
              title={tool.title ?? tool.label}
            >
              <Icon size={16} />
              <span>{tool.label}</span>
            </button>
          );
        })}
      </div>

      <div className="layers-group">
        <div className="side-section-title">图层</div>
        <LayersPanel
          nodes={nodes}
          selectedIds={selectedIds}
          onSelect={onSelectNodes}
          onToggleHidden={onToggleHidden}
          onToggleLocked={onToggleLocked}
          onMoveLayer={onMoveLayer}
        />
      </div>

      <div className="side-nav-footer">
        <button type="button" className="new-layer-btn" disabled title="P2 阶段实装">
          <Plus size={14} />
          <span>新建图层</span>
        </button>
      </div>
    </aside>
  );
}

