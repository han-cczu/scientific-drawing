import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resetEditorState, selectedIdFromIds } from "../src/editor/appState";

describe("app state helpers", () => {
  it("derives selectedId from the first selected id", () => {
    /*
     * ========================================================================
     * 步骤1：验证选中 id 派生
     * ========================================================================
     * 目标：
     *   1) selectedId 不再作为独立状态
     *   2) 空选择返回 null
     */

    // 1.1 校验非空选择
    assert.equal(selectedIdFromIds(["a", "b"]), "a");

    // 1.2 校验空选择
    assert.equal(selectedIdFromIds([]), null);
  });

  it("returns the complete editor reset state", () => {
    /*
     * ========================================================================
     * 步骤1：验证编辑器复位状态
     * ========================================================================
     * 目标：
     *   1) 上传、AI 重建、导入后复用同一份复位逻辑
     *   2) 防止遗漏 pendingEdge 或 viewport
     */

    // 1.1 读取复位状态
    const state = resetEditorState();

    // 1.2 校验全部字段
    assert.deepEqual(state, {
      selectedIds: [],
      tool: "select",
      viewport: { scale: 1, offset: { x: 0, y: 0 } },
      pendingEdgeFromId: null
    });
  });
});
