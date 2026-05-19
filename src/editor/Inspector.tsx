import { Lock, Unlock } from "lucide-react";
import { logger } from "../lib/logger";
import type { SceneNode } from "../shared/scene";

type InspectorProps = {
  node: SceneNode | null;
  onChange: (patch: Partial<SceneNode>) => void;
  onStyleChange: (patch: SceneNode["style"]) => void;
};

export function Inspector({ node, onChange, onStyleChange }: InspectorProps) {
  /*
   * ========================================================================
   * 步骤1：渲染属性面板
   * ========================================================================
   * 目标：
   *   1) 显示当前选中节点的几何和样式
   *   2) 允许用户编辑文本、颜色、尺寸和锁定状态
   */
  logger.info("开始渲染属性面板...", { nodeId: node?.id });

  // 1.1 无选择时显示空状态
  if (!node) {
    logger.info("渲染属性面板完成", { empty: true });
    return (
      <aside className="inspector">
        <div className="panel-title">属性</div>
        <div className="empty-state">未选择对象</div>
      </aside>
    );
  }

  // 1.2 渲染节点属性
  logger.info("渲染属性面板完成", { nodeId: node.id });
  return (
    <aside className="inspector">
      <div className="panel-title">属性</div>
      <div className="node-id">{node.type} · {node.id}</div>

      <button className="lock-toggle" type="button" onClick={() => onChange({ locked: !node.locked })}>
        {node.locked ? <Lock size={16} /> : <Unlock size={16} />}
        <span>{node.locked ? "已锁定" : "可编辑"}</span>
      </button>

      {node.type === "text" || node.text !== undefined ? (
        <label className="field">
          <span>文本</span>
          <textarea value={node.text ?? ""} onChange={(event) => onChange({ text: event.target.value })} />
        </label>
      ) : null}

      <div className="grid-fields">
        <NumberField label="X" value={node.x} onChange={(value) => onChange({ x: value })} />
        <NumberField label="Y" value={node.y} onChange={(value) => onChange({ y: value })} />
        <NumberField label="W" value={node.w} onChange={(value) => onChange({ w: value })} />
        <NumberField label="H" value={node.h} onChange={(value) => onChange({ h: value })} />
      </div>

      <label className="field">
        <span>填充</span>
        <input value={node.style.fill ?? "none"} onChange={(event) => onStyleChange({ fill: event.target.value })} />
      </label>
      <label className="field">
        <span>描边</span>
        <input value={node.style.stroke ?? "none"} onChange={(event) => onStyleChange({ stroke: event.target.value })} />
      </label>
      <NumberField label="线宽" value={node.style.strokeWidth ?? 1} onChange={(value) => onStyleChange({ strokeWidth: value })} />
      <NumberField label="字号" value={node.style.fontSize ?? 16} onChange={(value) => onStyleChange({ fontSize: value })} />
      <label className="field">
        <span>文字色</span>
        <input value={node.style.color ?? "#111111"} onChange={(event) => onStyleChange({ color: event.target.value })} />
      </label>
      <label className="field">
        <span>透明度</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={node.style.opacity ?? 1}
          onChange={(event) => onStyleChange({ opacity: Number(event.target.value) })}
        />
      </label>
    </aside>
  );
}

function NumberField({ label, value, onChange }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  /*
   * ========================================================================
   * 步骤1：渲染数字字段
   * ========================================================================
   * 目标：
   *   1) 统一数字输入样式
   *   2) 把空值保护为 0
   */
  logger.info("开始渲染数字字段...", { label, value });

  // 1.1 处理数字变化
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange(Number(event.target.value || 0));
  };

  // 1.2 渲染输入框
  logger.info("渲染数字字段完成", { label });
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={Math.round(value * 10) / 10} onChange={handleChange} />
    </label>
  );
}
