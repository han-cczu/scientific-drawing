import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

/*
 * ============================================================================
 * 新手引导持久化测试
 * ============================================================================
 * 目标：
 *   1) 未标记 / JSON 损坏 / 版本过旧 → 视为未看过
 *   2) markOnboardingSeen 后当前版本不再展示
 *
 * 注意：isStorageAvailable 结果是模块级缓存，必须在首次调用前装好
 * localStorage stub —— 用动态 import 保证顺序（与 sceneStore.test.ts 一致）。
 */

// 1.1 安装基于 Map 的 localStorage stub
const backing = new Map<string, string>();
let failOnboardingWrites = false;
const localStorageStub = {
  getItem: (key: string) => (backing.has(key) ? backing.get(key)! : null),
  setItem: (key: string, value: string) => {
    if (failOnboardingWrites && key === "sciDraw.onboarding") {
      throw new Error("QuotaExceededError");
    }
    backing.set(key, String(value));
  },
  removeItem: (key: string) => {
    backing.delete(key);
  },
  clear: () => backing.clear(),
  key: (index: number) => [...backing.keys()][index] ?? null,
  get length() {
    return backing.size;
  }
};

let store: typeof import("../src/lib/onboarding");

before(async () => {
  (globalThis as Record<string, unknown>).localStorage = localStorageStub;
  store = await import("../src/lib/onboarding");
});

describe("onboarding store", () => {
  it("treats missing, corrupted, or outdated markers as unseen", () => {
    /*
     * ========================================================================
     * 步骤1：验证未看过的判定
     * ========================================================================
     */

    // 1.1 无标记
    backing.clear();
    assert.equal(store.hasSeenOnboarding(), false);

    // 1.2 JSON 损坏
    backing.set(store.ONBOARDING_KEY, "{broken");
    assert.equal(store.hasSeenOnboarding(), false);

    // 1.3 版本过旧（引导内容大改后老用户重新看到）
    backing.set(store.ONBOARDING_KEY, JSON.stringify({ version: store.ONBOARDING_VERSION - 1, seenAt: 0 }));
    assert.equal(store.hasSeenOnboarding(), false);
  });

  it("remembers completion for the current version", () => {
    /*
     * ========================================================================
     * 步骤1：验证完成标记
     * ========================================================================
     */

    // 1.1 标记后视为已看过
    backing.clear();
    store.markOnboardingSeen();
    assert.equal(store.hasSeenOnboarding(), true);

    // 1.2 持久化的版本号是当前版本
    const stored = JSON.parse(backing.get(store.ONBOARDING_KEY)!) as { version: number };
    assert.equal(stored.version, store.ONBOARDING_VERSION);
  });

  it("uses memory marker after onboarding localStorage write failure", () => {
    /*
     * ========================================================================
     * 步骤1：验证写入失败后的同会话记忆
     * ========================================================================
     * 目标：
     *   1) 探针成功但真实 key 写入失败时，不应反复弹引导
     *   2) markOnboardingSeen 的 memorySeen 标记必须被 hasSeenOnboarding 读取
     */
    backing.clear();
    failOnboardingWrites = true;
    try {
      store.markOnboardingSeen();
      assert.equal(store.hasSeenOnboarding(), true);
      assert.equal(backing.has(store.ONBOARDING_KEY), false);
    } finally {
      failOnboardingWrites = false;
      backing.clear();
    }
  });
});
