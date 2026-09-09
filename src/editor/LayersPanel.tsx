import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, Unlock } from "lucide-react";
import { logger } from "../lib/logger";
import type { SceneNode } from "../shared/scene";

type LayersPanelProps = {
  disabled?: boolean;
  nodes: SceneNode[];
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onToggleHidden: (nodeId: string) => void;
  onToggleLocked: (nodeId: string) => void;
  onMoveLayer: (nodeId: string, direction: "forward" | "backward") => void;
};

export function LayersPanel({ disabled = false, nodes, selectedIds, onSelect, onToggleHidden, onToggleLocked, onMoveLayer }: LayersPanelProps) {
  logger.info("开始渲染图层面板...", { nodes: nodes.length, selected: selectedIds.length });

  // 1.1 反转为视觉上的顶部图层在上
  const orderedNodes = [...nodes].reverse();

  // 1.2 渲染图层列表
  logger.info("渲染图层面板完成", { nodes: orderedNodes.length });
  return (
    <section className="layers-panel" aria-label="图层">
      <div className="panel-title">图层</div>
      <div className="layers-list">
        {orderedNodes.map((node) => (
          <LayerRow disabled={disabled}
            key={node.id}
            node={node}
            selected={selectedIds.includes(node.id)}
            onSelect={() => onSelect(node.hidden ? [] : [node.id])}
            onToggleHidden={() => onToggleHidden(node.id)}
            onToggleLocked={() => onToggleLocked(node.id)}
            onMoveUp={() => onMoveLayer(node.id, "forward")}
            onMoveDown={() => onMoveLayer(node.id, "backward")}
          />
        ))}
      </div>
    </section>
  );
}

function LayerRow({ disabled, node, selected, onSelect, onToggleHidden, onToggleLocked, onMoveUp, onMoveDown }: {
  node: SceneNode;
  disabled: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggleHidden: () => void;
  onToggleLocked: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  logger.info("开始渲染单个图层行...", { nodeId: node.id });

  // 1.1 生成图层标题
  const label = node.text?.trim() || node.symbol || node.id;

  // 1.2 输出行
  logger.info("渲染单个图层行完成", { nodeId: node.id });
  return (
    <div className={selected ? "layer-row selected" : "layer-row"}>
      <button className="layer-main" type="button" onClick={onSelect} title={node.id}>
        <span className="layer-type">{node.type}</span>
        <span className="layer-name">{label}</span>
      </button>
      <fieldset disabled={disabled} className="layer-actions editor-controls">
        <button type="button" title={node.hidden ? "显示" : "隐藏"} onClick={onToggleHidden}>
          {node.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        <button type="button" title={node.locked ? "解锁" : "锁定"} onClick={onToggleLocked}>
          {node.locked ? <Lock size={15} /> : <Unlock size={15} />}
        </button>
        <button type="button" title="上移" onClick={onMoveUp}>
          <ArrowUp size={15} />
        </button>
        <button type="button" title="下移" onClick={onMoveDown}>
          <ArrowDown size={15} />
        </button>
      </fieldset>
    </div>
  );
}
