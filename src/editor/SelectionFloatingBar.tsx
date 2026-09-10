import { Copy, Lock, Trash2 } from "lucide-react";

type SelectionFloatingBarProps = {
  visible: boolean;
  disabled?: boolean;
  onDuplicate: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
};

export function SelectionFloatingBar({ visible, disabled = false, onDuplicate, onToggleLock, onDelete }: SelectionFloatingBarProps) {
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

  return (
    <div className="selection-floating-bar" role="toolbar" aria-label="选中节点操作">
      <button
        type="button"
        className="icon-btn"
        title="复制"
        aria-label="复制"
        disabled={disabled} onClick={onDuplicate}
      >
        <Copy size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="锁定 / 解锁"
        aria-label="锁定"
        disabled={disabled} onClick={onToggleLock}
      >
        <Lock size={16} />
      </button>
      <button
        type="button"
        className="icon-btn danger"
        title="删除"
        aria-label="删除"
        disabled={disabled} onClick={onDelete}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}
