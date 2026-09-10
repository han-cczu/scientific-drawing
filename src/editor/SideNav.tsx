import {
  ArrowRight,
  Circle,
  MoreHorizontal,
  MousePointer2,
  Plus,
  Sigma,
  Spline,
  Square,
  Table,
  Type,
  Wand2,
  Minus as LineIcon,
  Image as ImageIcon
} from "lucide-react";
import { LayersPanel } from "./LayersPanel";
import { Logo } from "./Logo";
import type { Tool } from "./model/types";
import type { SceneNode } from "../shared/scene";

type SideNavProps = {
  disabled?: boolean;
  isSelectMode: boolean;
  isRegionMode: boolean;
  aiReconstructionAvailable: boolean;
  /** 当前激活工具：驱动创作工具项的 active 态 */
  tool: Tool;
  onActivateSelect: () => void;
  onActivateRegionReconstruct: () => void;
  /** 激活创作工具（text/rect/ellipse/line/arrow/connector） */
  onActivateTool: (tool: Tool) => void;
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
  disabled = false,
  isSelectMode,
  isRegionMode,
  aiReconstructionAvailable,
  tool,
  onActivateSelect,
  onActivateRegionReconstruct,
  onActivateTool,
  nodes,
  selectedIds,
  onSelectNodes,
  onToggleHidden,
  onToggleLocked,
  onMoveLayer
}: SideNavProps) {

  // 1.1 创作工具映射：SideNav 条目 → Tool 值（与 createNode/连线流程一一对应）
  const authoringTools: Array<{ id: string; label: string; icon: React.ComponentType<{ size?: number }>; tool: Tool; title: string }> = [
    { id: "text", label: "文本", icon: Type, tool: "text", title: "点击画布添加文本" },
    { id: "shape", label: "矩形", icon: Square, tool: "rect", title: "点击画布添加矩形" },
    { id: "ellipse", label: "椭圆", icon: Circle, tool: "ellipse", title: "点击画布添加椭圆" },
    { id: "line", label: "线条", icon: LineIcon, tool: "line", title: "点击画布添加线条" },
    { id: "arrow", label: "箭头", icon: ArrowRight, tool: "arrow", title: "点击画布添加箭头" },
    { id: "connector", label: "语义连线", icon: Spline, tool: "connector", title: "依次点击两个节点创建连线" }
  ];

  // 1.2 构造工具条目（顺序固定，禁用项灰色）
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
    ...authoringTools.map((entry) => ({
      id: entry.id,
      label: entry.label,
      icon: entry.icon,
      enabled: true,
      active: tool === entry.tool,
      onClick: () => onActivateTool(entry.tool),
      title: entry.title
    })),
    { id: "image", label: "图片", icon: ImageIcon, enabled: false, active: false, title: "功能开发中，暂未开放" },
    { id: "formula", label: "公式", icon: Sigma, enabled: false, active: false, title: "功能开发中，暂未开放" },
    { id: "table", label: "表格", icon: Table, enabled: false, active: false, title: "功能开发中，暂未开放" },
    { id: "more", label: "更多", icon: MoreHorizontal, enabled: false, active: false, title: "功能开发中，暂未开放" }
  ];

  // 1.2 输出侧栏
  return (
    <aside className="side-nav" aria-label="侧栏">
      <Logo />

      <div className="tools-group" role="group" aria-label="工具" data-tour="tools">
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
              disabled={disabled || !tool.enabled}
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
        <LayersPanel disabled={disabled}
          nodes={nodes}
          selectedIds={selectedIds}
          onSelect={onSelectNodes}
          onToggleHidden={onToggleHidden}
          onToggleLocked={onToggleLocked}
          onMoveLayer={onMoveLayer}
        />
      </div>

      <div className="side-nav-footer">
        <button type="button" className="new-layer-btn" disabled title="功能开发中，暂未开放">
          <Plus size={14} />
          <span>新建图层</span>
        </button>
      </div>
    </aside>
  );
}

