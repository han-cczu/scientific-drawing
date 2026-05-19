import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, Unlock } from "lucide-react";
import { logger } from "../lib/logger";
import type { SceneNode } from "../shared/scene";

type LayersPanelProps = {
  nodes: SceneNode[];
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onToggleHidden: (nodeId: string) => void;
  onToggleLocked: (nodeId: string) => void;
  onMoveLayer: (nodeId: string, direction: "forward" | "backward") => void;
};

export function LayersPanel({ nodes, selectedIds, onSelect, onToggleHidden, onToggleLocked, onMoveLayer }: LayersPanelProps) {
  /*
   * ========================================================================
   * 步骤1：渲染图层面板
   * ========================================================================
   * 目标：
   *   1) 按渲染顺序展示 scene 节点
   *   2) 提供显隐、锁定和层级调整控制
   */
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
          <LayerRow
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

function LayerRow({ node, selected, onSelect, onToggleHidden, onToggleLocked, onMoveUp, onMoveDown }: {
  node: SceneNode;
  selected: boolean;
  onSelect: () => void;
  onToggleHidden: () => void;
  onToggleLocked: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  /*
   * ========================================================================
   * 步骤1：渲染单个图层行
   * ========================================================================
   * 目标：
   *   1) 展示节点类型和 id
   *   2) 提供单行图层操作按钮
   */
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
      <div className="layer-actions">
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
      </div>
    </div>
  );
}
