import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHistoryState, pushHistory, redoHistory, undoHistory } from "../src/editor/history";

describe("editor history", () => {
  it("pushes scene snapshots and walks undo redo stacks", () => {
    /*
     * ========================================================================
     * 步骤1：验证历史快照流转
     * ========================================================================
     * 目标：
     *   1) 新修改进入 past 栈
     *   2) undo 和 redo 在 past/future 之间移动快照
     */

    // 1.1 创建历史状态
    const first = { value: "first" };
    const second = { value: "second" };
    const third = { value: "third" };
    let state = createHistoryState(first);

    // 1.2 推入两次修改
    state = pushHistory(state, second);
    state = pushHistory(state, third);
    assert.deepEqual(state.present, third);
    assert.equal(state.past.length, 2);
    assert.equal(state.future.length, 0);

    // 1.3 撤销和重做
    state = undoHistory(state);
    assert.deepEqual(state.present, second);
    assert.deepEqual(state.future, [third]);
    state = redoHistory(state);
    assert.deepEqual(state.present, third);
    assert.equal(state.future.length, 0);
  });

  it("clears redo snapshots after a new edit", () => {
    /*
     * ========================================================================
     * 步骤1：验证新编辑清理 redo
     * ========================================================================
     * 目标：
     *   1) 撤销后产生 future
     *   2) 新编辑后 future 被丢弃
     */

    // 1.1 准备撤销后的历史状态
    const first = { value: "first" };
    const second = { value: "second" };
    const third = { value: "third" };
    let state = createHistoryState(first);
    state = pushHistory(state, second);
    state = undoHistory(state);

    // 1.2 推入新修改
    state = pushHistory(state, third);

    // 1.3 校验 redo 被清理
    assert.deepEqual(state.present, third);
    assert.equal(state.future.length, 0);
    assert.deepEqual(redoHistory(state).present, third);
  });

  it("ignores unchanged snapshots and limits history depth", () => {
    /*
     * ========================================================================
     * 步骤1：验证去重和容量上限
     * ========================================================================
     * 目标：
     *   1) 相同引用不创建历史
     *   2) 超出上限时丢弃最早快照
     */

    // 1.1 验证相同引用不入栈
    const first = { value: "first" };
    let state = createHistoryState(first, 2);
    state = pushHistory(state, first);
    assert.equal(state.past.length, 0);

    // 1.2 验证容量上限
    state = pushHistory(state, { value: "second" });
    state = pushHistory(state, { value: "third" });
    state = pushHistory(state, { value: "fourth" });

    // 1.3 校验只保留最近两个 past
    assert.equal(state.past.length, 2);
    assert.deepEqual(state.past.map((item) => item.value), ["second", "third"]);
  });
});
