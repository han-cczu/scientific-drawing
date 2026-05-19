import { logger } from "../lib/logger";
import type { Tool } from "./Toolbar";
import type { Viewport } from "./viewport";

export type EditorTransientState = {
  selectedIds: string[];
  tool: Tool;
  viewport: Viewport;
  pendingEdgeFromId: string | null;
};

export function selectedIdFromIds(selectedIds: string[]) {
  /*
   * ========================================================================
   * 步骤1：派生单选 id
   * ========================================================================
   * 目标：
   *   1) 避免 selectedId 和 selectedIds 双状态不同步
   *   2) 保留 Inspector 和 Canvas 的单选入口
   */
  logger.info("开始派生单选 id...", { selectedCount: selectedIds.length });

  // 1.1 读取首个选中 id
  const selectedId = selectedIds[0] ?? null;

  logger.info("派生单选 id 完成", { selectedId });
  return selectedId;
}

export function resetEditorState(): EditorTransientState {
  /*
   * ========================================================================
   * 步骤1：生成编辑器复位状态
   * ========================================================================
   * 目标：
   *   1) 清空选择和语义连线中间态
   *   2) 恢复选择工具和默认视图
   */
  logger.info("开始生成编辑器复位状态...");

  // 1.1 返回统一复位状态
  const state: EditorTransientState = {
    selectedIds: [],
    tool: "select",
    viewport: { scale: 1, offset: { x: 0, y: 0 } },
    pendingEdgeFromId: null
  };

  logger.info("生成编辑器复位状态完成");
  return state;
}
