import { Copy, Lock, MoreHorizontal, Trash2 } from "lucide-react";

type SelectionFloatingBarProps = {
  visible: boolean;
  onDuplicate: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
};

export function SelectionFloatingBar({ visible, onDuplicate, onToggleLock, onDelete }: SelectionFloatingBarProps) {
  /*
   * ========================================================================
   * 步骤1：渲染选中浮动操作条
   * ========================================================================
   * 目标：
   *   1) 选中节点时显示复制 / 锁定 / 删除 / 更多
   *   2) 没有选中时返回 null
   */

  if (!visible) {
    return null;
  }

  // 1.1 占位"更多"按钮
  const handleMore = () => {
    /* P4 实装：选中节点更多操作菜单 */
  };

  return (
    <div className="selection-floating-bar" role="toolbar" aria-label="选中节点操作">
      <button
        type="button"
        className="icon-btn"
        title="复制"
        aria-label="复制"
        onClick={onDuplicate}
      >
        <Copy size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="锁定 / 解锁"
        aria-label="锁定"
        onClick={onToggleLock}
      >
        <Lock size={16} />
      </button>
      <button
        type="button"
        className="icon-btn danger"
        title="删除"
        aria-label="删除"
        onClick={onDelete}
      >
        <Trash2 size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="更多（P3 实装）"
        aria-label="更多"
        onClick={handleMore}
      >
        <MoreHorizontal size={16} />
      </button>
    </div>
  );
}
