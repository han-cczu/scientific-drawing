import type { AlignKind } from "./model/types";
import type { LayerMoveDirection } from "./sceneOps";

type ArrangeTabProps = {
  selectedIds: string[];
  onAlign: (kind: AlignKind) => void;
  onMoveLayer: (direction: LayerMoveDirection) => void;
};

export function ArrangeTab({
  selectedIds,
  onAlign: align,
  onMoveLayer: moveLayer,
}: ArrangeTabProps) {
  const hasSelection = selectedIds.length > 0;
  const isMulti = selectedIds.length > 1;

  return (
    <div className="arrange-tab">
      <div className="panel-title">排列</div>

      {/* 层级 */}
      <div className="arrange-section">
        <div className="arrange-section-title">层级</div>
        <div className="arrange-grid">
          <button
            type="button"
            className="arrange-btn"
            disabled={!hasSelection}
            onClick={() => moveLayer("front")}
          >
            置顶
          </button>
          <button
            type="button"
            className="arrange-btn"
            disabled={!hasSelection}
            onClick={() => moveLayer("forward")}
          >
            上移
          </button>
          <button
            type="button"
            className="arrange-btn"
            disabled={!hasSelection}
            onClick={() => moveLayer("backward")}
          >
            下移
          </button>
          <button
            type="button"
            className="arrange-btn"
            disabled={!hasSelection}
            onClick={() => moveLayer("back")}
          >
            置底
          </button>
        </div>
      </div>

      {/* 对齐 */}
      <div className="arrange-section">
        <div className="arrange-section-title">对齐</div>
        <div className="arrange-grid-3">
          <button
            type="button"
            className="arrange-btn"
            disabled={!isMulti}
            onClick={() => align("left")}
            title="左对齐"
          >
            左
          </button>
          <button
            type="button"
            className="arrange-btn"
            disabled={!isMulti}
            onClick={() => align("h-center")}
            title="水平居中"
          >
            中
          </button>
          <button
            type="button"
            className="arrange-btn"
            disabled={!isMulti}
            onClick={() => align("right")}
            title="右对齐"
          >
            右
          </button>
          <button
            type="button"
            className="arrange-btn"
            disabled={!isMulti}
            onClick={() => align("top")}
            title="顶对齐"
          >
            上
          </button>
          <button
            type="button"
            className="arrange-btn"
            disabled={!isMulti}
            onClick={() => align("v-center")}
            title="垂直居中"
          >
            中
          </button>
          <button
            type="button"
            className="arrange-btn"
            disabled={!isMulti}
            onClick={() => align("bottom")}
            title="底对齐"
          >
            下
          </button>
        </div>
        {!isMulti ? (
          <div className="arrange-hint">选中两个或以上对象启用对齐</div>
        ) : null}
      </div>

      {/* 分布（占位 disabled） */}
      <div className="arrange-section">
        <div className="arrange-section-title">分布</div>
        <div className="arrange-grid">
          <button
            type="button"
            className="arrange-btn"
            disabled
            title="功能开发中，暂未开放"
          >
            水平等距
          </button>
          <button
            type="button"
            className="arrange-btn"
            disabled
            title="功能开发中，暂未开放"
          >
            垂直等距
          </button>
        </div>
      </div>
    </div>
  );
}
