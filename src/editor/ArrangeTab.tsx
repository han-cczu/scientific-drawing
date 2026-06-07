import type { Scene, SceneNode } from "../shared/scene";
import { moveNodeLayer, updateNode } from "./sceneOps";

type ArrangeTabProps = {
  scene: Scene;
  selectedIds: string[];
  applySceneChange: (updater: (current: Scene) => Scene) => void;
};

type AlignKind = "left" | "h-center" | "right" | "top" | "v-center" | "bottom";

/**
 * 把节点列表对齐：
 * - left/right: 按整体 bounding box 的最左/最右对齐（保持节点宽度）
 * - h-center: 按整体 bounding box 水平中线对齐
 * - top/bottom/v-center: 垂直方向同理
 */
function computeAlignedX(node: SceneNode, kind: AlignKind, group: { minX: number; maxX: number }): number {
  if (kind === "left") return group.minX;
  if (kind === "right") return group.maxX - node.w;
  if (kind === "h-center") return (group.minX + group.maxX) / 2 - node.w / 2;
  return node.x;
}

function computeAlignedY(node: SceneNode, kind: AlignKind, group: { minY: number; maxY: number }): number {
  if (kind === "top") return group.minY;
  if (kind === "bottom") return group.maxY - node.h;
  if (kind === "v-center") return (group.minY + group.maxY) / 2 - node.h / 2;
  return node.y;
}

export function ArrangeTab({ scene, selectedIds, applySceneChange }: ArrangeTabProps) {
  const hasSelection = selectedIds.length > 0;
  const isMulti = selectedIds.length > 1;

  // 层级动作：对每个选中节点循环调用 moveNodeLayer
  const moveLayer = (direction: "front" | "back" | "forward" | "backward") => {
    if (!hasSelection) return;
    applySceneChange((current) => {
      return selectedIds.reduce((next, id) => moveNodeLayer(next, id, direction), current);
    });
  };

  // 对齐动作：以选中节点整体包围盒为基准
  const align = (kind: AlignKind) => {
    if (!isMulti) return;
    const selectedNodes = scene.nodes.filter((node) => selectedIds.includes(node.id));
    if (selectedNodes.length < 2) return;

    const minX = Math.min(...selectedNodes.map((n) => n.x));
    const maxX = Math.max(...selectedNodes.map((n) => n.x + n.w));
    const minY = Math.min(...selectedNodes.map((n) => n.y));
    const maxY = Math.max(...selectedNodes.map((n) => n.y + n.h));
    const groupX = { minX, maxX };
    const groupY = { minY, maxY };

    applySceneChange((current) => {
      return selectedNodes.reduce((next, node) => {
        const patch: Partial<SceneNode> = {};
        if (kind === "left" || kind === "right" || kind === "h-center") {
          const nextX = computeAlignedX(node, kind, groupX);
          patch.x = nextX;
          if (node.points?.length) {
            const dx = nextX - node.x;
            patch.points = node.points.map((p) => ({ x: p.x + dx, y: p.y }));
          }
        } else {
          const nextY = computeAlignedY(node, kind, groupY);
          patch.y = nextY;
          if (node.points?.length) {
            const dy = nextY - node.y;
            patch.points = node.points.map((p) => ({ x: p.x, y: p.y + dy }));
          }
        }
        return updateNode(next, node.id, patch);
      }, current);
    });
  };

  return (
    <div className="arrange-tab">
      <div className="panel-title">排列</div>

      {/* 层级 */}
      <div className="arrange-section">
        <div className="arrange-section-title">层级</div>
        <div className="arrange-grid">
          <button type="button" className="arrange-btn" disabled={!hasSelection} onClick={() => moveLayer("front")}>
            置顶
          </button>
          <button type="button" className="arrange-btn" disabled={!hasSelection} onClick={() => moveLayer("forward")}>
            上移
          </button>
          <button type="button" className="arrange-btn" disabled={!hasSelection} onClick={() => moveLayer("backward")}>
            下移
          </button>
          <button type="button" className="arrange-btn" disabled={!hasSelection} onClick={() => moveLayer("back")}>
            置底
          </button>
        </div>
      </div>

      {/* 对齐 */}
      <div className="arrange-section">
        <div className="arrange-section-title">对齐</div>
        <div className="arrange-grid-3">
          <button type="button" className="arrange-btn" disabled={!isMulti} onClick={() => align("left")} title="左对齐">
            左
          </button>
          <button type="button" className="arrange-btn" disabled={!isMulti} onClick={() => align("h-center")} title="水平居中">
            中
          </button>
          <button type="button" className="arrange-btn" disabled={!isMulti} onClick={() => align("right")} title="右对齐">
            右
          </button>
          <button type="button" className="arrange-btn" disabled={!isMulti} onClick={() => align("top")} title="顶对齐">
            上
          </button>
          <button type="button" className="arrange-btn" disabled={!isMulti} onClick={() => align("v-center")} title="垂直居中">
            中
          </button>
          <button type="button" className="arrange-btn" disabled={!isMulti} onClick={() => align("bottom")} title="底对齐">
            下
          </button>
        </div>
        {!isMulti ? <div className="arrange-hint">选中两个或以上对象启用对齐</div> : null}
      </div>

      {/* 分布（占位 disabled） */}
      <div className="arrange-section">
        <div className="arrange-section-title">分布</div>
        <div className="arrange-grid">
          <button type="button" className="arrange-btn" disabled title="功能开发中，暂未开放">
            水平等距
          </button>
          <button type="button" className="arrange-btn" disabled title="功能开发中，暂未开放">
            垂直等距
          </button>
        </div>
      </div>
    </div>
  );
}
