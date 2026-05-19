import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectedIdFromIds } from "../src/editor/appState";

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
});
