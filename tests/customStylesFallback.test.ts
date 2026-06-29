import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CUSTOM_PRESETS_KEY, loadCustomPresets, saveCustomPreset } from "../src/lib/customStyles";

function withMockLocalStorage<T>(mockStorage: Storage, callback: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { value: mockStorage, configurable: true });
  try {
    return callback();
  } finally {
    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
    } else {
      Reflect.deleteProperty(globalThis as object, "localStorage");
    }
  }
}

function mapStorage(backing: Map<string, string>, options?: { failRealKey?: () => boolean }): Storage {
  return {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (options?.failRealKey?.() && key === CUSTOM_PRESETS_KEY) {
        throw new Error("QuotaExceededError");
      }
      backing.set(key, value);
    },
    removeItem: (key: string) => { backing.delete(key); },
    clear: () => backing.clear(),
    key: () => null,
    get length() {
      return backing.size;
    }
  };
}

describe("自定义样式 localStorage 配额满回退一致性", () => {
  it("读取持久化预设时过滤非法颜色，避免把坏样式应用进 scene", () => {
    /*
     * ========================================================================
     * 步骤1：验证 localStorage 预设颜色协议
     * ========================================================================
     * 目标：
     *   1) localStorage 是不可信输入，只是字符串不代表可作为 scene 颜色
     *   2) 非 #RGB/#RRGGBB/none 的 fill/stroke 不应进入 quick style
     */

    // 1.1 构造一条非法颜色和一条合法颜色
    const backing = new Map<string, string>();
    backing.set(CUSTOM_PRESETS_KEY, JSON.stringify({
      version: 1,
      presets: [
        { id: "bad", fill: "url(javascript:alert(1))", stroke: "#111111", createdAt: 1 },
        { id: "ok", fill: "#ABC", stroke: "none", createdAt: 2 }
      ]
    }));

    // 1.2 读取时只保留符合 scene 颜色协议的预设
    const loaded = withMockLocalStorage(mapStorage(backing), () => loadCustomPresets());
    assert.deepEqual(loaded.map((preset) => preset.id), ["ok"]);
    assert.equal(loaded[0].fill, "#ABC");
    assert.equal(loaded[0].stroke, "none");
  });

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
    const mockStorage = mapStorage(backing, { failRealKey: () => failRealKey });

    withMockLocalStorage(mockStorage, () => {
      // 1.2 触发配额满写入
      failRealKey = true;
      const saved = saveCustomPreset("#FF0000", "#00FF00");
      assert.ok(saved, "saveCustomPreset 乐观返回非 null");

      // 1.3 读取应从内存取回刚保存的预设
      const loaded = loadCustomPresets();
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].fill, "#FF0000");
      assert.equal(loaded[0].stroke, "#00FF00");
    });
  });
});
