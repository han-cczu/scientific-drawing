import { logger } from "../lib/logger";

export type EditorShortcutAction = "delete" | "duplicate" | "cancel";

export type EditorShortcutInput = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  editable?: boolean;
};

export function isEditableKeyboardTarget(target: EventTarget | null) {
  /*
   * ========================================================================
   * 步骤1：判断键盘事件来源
   * ========================================================================
   * 目标：
   *   1) 保护 input 和 textarea 的原生编辑行为
   *   2) 保护 contenteditable 区域
   */
  logger.info("开始判断键盘事件来源...");

  // 1.1 处理空目标
  if (!(target instanceof HTMLElement)) {
    logger.info("判断键盘事件来源完成", { editable: false });
    return false;
  }

  // 1.2 判断可编辑元素
  const editable =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable;

  logger.info("判断键盘事件来源完成", { editable });
  return editable;
}

export function getEditorShortcutAction(input: EditorShortcutInput): EditorShortcutAction | null {
  /*
   * ========================================================================
   * 步骤1：映射编辑器快捷键
   * ========================================================================
   * 目标：
   *   1) 把 DOM 键盘事件转换为编辑器动作
   *   2) 让 App 只负责调度动作
   */
  logger.info("开始映射编辑器快捷键...", { key: input.key });

  // 1.1 忽略输入控件内事件
  if (input.editable) {
    logger.info("映射编辑器快捷键完成", { action: null });
    return null;
  }

  // 1.2 映射删除动作
  if (input.key === "Delete" || input.key === "Backspace") {
    logger.info("映射编辑器快捷键完成", { action: "delete" });
    return "delete";
  }

  // 1.3 映射复制动作
  if ((input.ctrlKey || input.metaKey) && input.key.toLowerCase() === "d") {
    logger.info("映射编辑器快捷键完成", { action: "duplicate" });
    return "duplicate";
  }

  // 1.4 映射取消动作
  if (input.key === "Escape") {
    logger.info("映射编辑器快捷键完成", { action: "cancel" });
    return "cancel";
  }

  logger.info("映射编辑器快捷键完成", { action: null });
  return null;
}
