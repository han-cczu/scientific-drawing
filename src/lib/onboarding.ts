/*
 * ============================================================================
 * 新手引导 localStorage 适配层
 * ============================================================================
 * 目标：
 *   1) 记录用户是否看完（或跳过）当前版本的操作引导
 *   2) ONBOARDING_VERSION 提升时对老用户重新展示（界面大改后值得再引导）
 *   3) localStorage 不可用时回退内存（每会话最多展示一次），不破坏 UI
 */

export const ONBOARDING_KEY = "sciDraw.onboarding";

//   引导内容大改时 +1，老用户会重新看到引导
export const ONBOARDING_VERSION = 1;

type StoredSchema = {
  version: number;
  seenAt: number;
};

let memorySeen = false;
let storageAvailableCache: boolean | null = null;

function isStorageAvailable(): boolean {
  if (storageAvailableCache !== null) {
    return storageAvailableCache;
  }
  try {
    const testKey = "__sciDraw_onboarding_probe__";
    globalThis.localStorage.setItem(testKey, "1");
    globalThis.localStorage.removeItem(testKey);
    storageAvailableCache = true;
  } catch {
    storageAvailableCache = false;
  }
  return storageAvailableCache;
}

export function hasSeenOnboarding(): boolean {
  /*
   * ========================================================================
   * 步骤1：判断是否已看过当前版本引导
   * ========================================================================
   * 目标：
   *   1) 标记缺失 / JSON 损坏 / 版本过旧一律视为未看过
   */
  if (!isStorageAvailable()) {
    return memorySeen;
  }
  try {
    const raw = globalThis.localStorage.getItem(ONBOARDING_KEY);
    if (!raw) {
      return false;
    }
    const parsed = JSON.parse(raw) as StoredSchema;
    return typeof parsed?.version === "number" && parsed.version >= ONBOARDING_VERSION;
  } catch {
    return false;
  }
}

export function markOnboardingSeen(): void {
  /*
   * ========================================================================
   * 步骤1：记录引导已完成/已跳过
   * ========================================================================
   */
  memorySeen = true;
  if (!isStorageAvailable()) {
    return;
  }
  try {
    const payload: StoredSchema = { version: ONBOARDING_VERSION, seenAt: Date.now() };
    globalThis.localStorage.setItem(ONBOARDING_KEY, JSON.stringify(payload));
  } catch {
    // 写入失败不影响主流程：内存标记已保证本会话不重复弹出
  }
}
