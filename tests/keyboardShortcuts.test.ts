import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getEditorShortcutAction } from "../src/editor/keyboardShortcuts";

describe("editor keyboard shortcuts", () => {
  it("maps delete, duplicate, and cancel shortcuts", () => {
    /*
     * ========================================================================
     * 步骤1：验证编辑器快捷键映射
     * ========================================================================
     * 目标：
     *   1) Delete 和 Backspace 删除选中对象
     *   2) Ctrl+D 或 Meta+D 复制选中对象
     *   3) Escape 取消当前连线或工具中间态
     */

    // 1.1 校验删除快捷键
    assert.equal(getEditorShortcutAction({ key: "Delete" }), "delete");
    assert.equal(getEditorShortcutAction({ key: "Backspace" }), "delete");

    // 1.2 校验复制快捷键
    assert.equal(getEditorShortcutAction({ key: "d", ctrlKey: true }), "duplicate");
    assert.equal(getEditorShortcutAction({ key: "D", metaKey: true }), "duplicate");

    // 1.3 校验取消快捷键
    assert.equal(getEditorShortcutAction({ key: "Escape" }), "cancel");
  });

  it("ignores shortcuts from editable fields", () => {
    /*
     * ========================================================================
     * 步骤1：验证输入控件保护
     * ========================================================================
     * 目标：
     *   1) 文本输入时不触发画布快捷键
     *   2) 避免删除文字时误删节点
     */

    // 1.1 校验输入控件事件被忽略
    assert.equal(getEditorShortcutAction({ key: "Backspace", editable: true }), null);
    assert.equal(getEditorShortcutAction({ key: "d", ctrlKey: true, editable: true }), null);
  });
});
