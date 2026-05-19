import { logger } from "../lib/logger";

export type HistoryState<T> = {
  past: T[];
  present: T;
  future: T[];
  limit: number;
};

const DEFAULT_HISTORY_LIMIT = 80;

export function createHistoryState<T>(present: T, limit = DEFAULT_HISTORY_LIMIT): HistoryState<T> {
  /*
   * ========================================================================
   * 步骤1：创建历史状态
   * ========================================================================
   * 目标：
   *   1) 保存当前快照
   *   2) 初始化撤销和重做栈
   */
  logger.info("开始创建历史状态...");

  // 1.1 创建空历史栈
  const state = {
    past: [],
    present,
    future: [],
    limit
  };

  logger.info("创建历史状态完成", { limit });
  return state;
}

export function pushHistory<T>(state: HistoryState<T>, nextPresent: T): HistoryState<T> {
  /*
   * ========================================================================
   * 步骤1：推入历史快照
   * ========================================================================
   * 目标：
   *   1) 把当前快照压入 past
   *   2) 新编辑后清空 redo 栈
   */
  logger.info("开始推入历史快照...", { past: state.past.length, future: state.future.length });

  // 1.1 跳过相同引用
  if (Object.is(state.present, nextPresent)) {
    logger.info("推入历史快照完成，快照未变化");
    return state;
  }

  // 1.2 生成新历史状态
  const next = {
    ...state,
    past: trimPast([...state.past, state.present], state.limit),
    present: nextPresent,
    future: []
  };

  logger.info("推入历史快照完成", { past: next.past.length });
  return next;
}

export function replaceHistoryPresent<T>(state: HistoryState<T>, nextPresent: T): HistoryState<T> {
  /*
   * ========================================================================
   * 步骤1：替换当前快照
   * ========================================================================
   * 目标：
   *   1) 支持拖拽中的连续预览
   *   2) 不产生逐像素撤销记录
   */
  logger.info("开始替换当前历史快照...");

  // 1.1 跳过相同引用
  if (Object.is(state.present, nextPresent)) {
    logger.info("替换当前历史快照完成，快照未变化");
    return state;
  }

  // 1.2 替换 present
  const next = { ...state, present: nextPresent };
  logger.info("替换当前历史快照完成");
  return next;
}

export function commitHistoryPresent<T>(state: HistoryState<T>, baseline: T | null): HistoryState<T> {
  /*
   * ========================================================================
   * 步骤1：提交连续编辑
   * ========================================================================
   * 目标：
   *   1) 把拖拽前快照作为一个撤销点
   *   2) 保留拖拽结束后的当前快照
   */
  logger.info("开始提交连续编辑历史...");

  // 1.1 跳过空基线或未变化编辑
  if (!baseline || Object.is(baseline, state.present)) {
    logger.info("提交连续编辑历史完成，未产生变化");
    return state;
  }

  // 1.2 写入单个撤销点
  const next = {
    ...state,
    past: trimPast([...state.past, baseline], state.limit),
    future: []
  };

  logger.info("提交连续编辑历史完成", { past: next.past.length });
  return next;
}

export function undoHistory<T>(state: HistoryState<T>): HistoryState<T> {
  /*
   * ========================================================================
   * 步骤1：撤销历史快照
   * ========================================================================
   * 目标：
   *   1) 从 past 取出最近快照
   *   2) 把当前快照压入 future
   */
  logger.info("开始撤销历史快照...", { past: state.past.length });

  // 1.1 无历史时保持不变
  if (state.past.length === 0) {
    logger.info("撤销历史快照完成，无可撤销项");
    return state;
  }

  // 1.2 移动快照
  const present = state.past[state.past.length - 1];
  const next = {
    ...state,
    past: state.past.slice(0, -1),
    present,
    future: [state.present, ...state.future]
  };

  logger.info("撤销历史快照完成", { past: next.past.length, future: next.future.length });
  return next;
}

export function redoHistory<T>(state: HistoryState<T>): HistoryState<T> {
  /*
   * ========================================================================
   * 步骤1：重做历史快照
   * ========================================================================
   * 目标：
   *   1) 从 future 取出最近快照
   *   2) 把当前快照压回 past
   */
  logger.info("开始重做历史快照...", { future: state.future.length });

  // 1.1 无 future 时保持不变
  if (state.future.length === 0) {
    logger.info("重做历史快照完成，无可重做项");
    return state;
  }

  // 1.2 移动快照
  const present = state.future[0];
  const next = {
    ...state,
    past: trimPast([...state.past, state.present], state.limit),
    present,
    future: state.future.slice(1)
  };

  logger.info("重做历史快照完成", { past: next.past.length, future: next.future.length });
  return next;
}

export function canUndoHistory<T>(state: HistoryState<T>) {
  /*
   * ========================================================================
   * 步骤1：判断是否可撤销
   * ========================================================================
   * 目标：
   *   1) 给工具栏控制按钮状态
   *   2) 避免无效操作
   */
  logger.info("开始判断是否可撤销...");

  // 1.1 读取 past 长度
  const result = state.past.length > 0;

  logger.info("判断是否可撤销完成", { result });
  return result;
}

export function canRedoHistory<T>(state: HistoryState<T>) {
  /*
   * ========================================================================
   * 步骤1：判断是否可重做
   * ========================================================================
   * 目标：
   *   1) 给工具栏控制按钮状态
   *   2) 避免无效操作
   */
  logger.info("开始判断是否可重做...");

  // 1.1 读取 future 长度
  const result = state.future.length > 0;

  logger.info("判断是否可重做完成", { result });
  return result;
}

function trimPast<T>(past: T[], limit: number) {
  /*
   * ========================================================================
   * 步骤1：裁剪历史容量
   * ========================================================================
   * 目标：
   *   1) 限制内存增长
   *   2) 保留最近快照
   */
  logger.info("开始裁剪历史容量...", { count: past.length, limit });

  // 1.1 返回最近快照
  const next = past.length > limit ? past.slice(past.length - limit) : past;

  logger.info("裁剪历史容量完成", { count: next.length });
  return next;
}
