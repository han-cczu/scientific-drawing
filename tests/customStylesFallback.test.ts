import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CUSTOM_PRESETS_KEY, loadCustomPresets, saveCustomPreset } from "../src/lib/customStyles";

describe("自定义样式 localStorage 配额满回退一致性", () => {
  it("配额满写入回退内存后，读取仍能取回（不静默丢数据）", () => {
    /*
     * ========================================================================
     * 步骤1：验证 memoryFallbackActive 读回一致
     * ========================================================================
     * 目标：
     *   1) 修复前 writeToStorage 配额满回退内存，但 readFromStorage 仍读 localStorage 旧值 → 丢失
     *   2) 修复后一旦回退内存，读取也从内存取，乐观 UI 不再谎报
     */

    // 1.1 构造可控 localStorage：探针成功，真实 key 写入抛错（模拟配额满）
    const backing = new Map<string, string>();
    let failRealKey = false;
    const mockStorage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failRealKey && key === CUSTOM_PRESETS_KEY) {
          throw new Error("QuotaExceededError");
        }
        backing.set(key, value);
      },
      removeItem: (key: string) => { backing.delete(key); },
      clear: () => backing.clear(),
      key: () => null,
      length: 0
    };
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { value: mockStorage, configurable: true });

    try {
      // 1.2 触发配额满写入
      failRealKey = true;
      const saved = saveCustomPreset("#FF0000", "#00FF00");
      assert.ok(saved, "saveCustomPreset 乐观返回非 null");

      // 1.3 读取应从内存取回刚保存的预设
      const loaded = loadCustomPresets();
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].fill, "#FF0000");
      assert.equal(loaded[0].stroke, "#00FF00");
    } finally {
      if (original) {
        Object.defineProperty(globalThis, "localStorage", original);
      } else {
        Reflect.deleteProperty(globalThis as object, "localStorage");
      }
    }
  });
});
