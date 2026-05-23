import type { QuickStylePreset } from "../editor/quickStyles";

/*
 * ============================================================================
 * 自定义快速样式 localStorage 适配层（P4）
 * ============================================================================
 * 目标：
 *   1) 把用户自定义的 fill/stroke 组合持久化到 localStorage
 *   2) localStorage 不可用 / JSON 损坏 / 配额满时不破坏 UI，仅 console.warn
 *   3) 数量上限 12，达到后 saveCustomPreset 返回 null
 */

export const CUSTOM_PRESETS_KEY = "sciDraw.customStyles";
export const CUSTOM_PRESETS_BACKUP_KEY = "sciDraw.customStyles.backup";
export const CUSTOM_PRESET_LIMIT = 12;

const SCHEMA_VERSION = 1;

type StoredPreset = {
  id: string;
  fill: string;
  stroke: string;
  createdAt: number;
};

type StoredSchema = {
  version: number;
  presets: StoredPreset[];
};

// in-memory fallback when localStorage 不可用
let memoryStore: StoredPreset[] = [];
let storageWarned = false;
let storageAvailableCache: boolean | null = null;

function isStorageAvailable(): boolean {
  if (storageAvailableCache !== null) {
    return storageAvailableCache;
  }
  try {
    const testKey = "__sciDraw_probe__";
    globalThis.localStorage.setItem(testKey, "1");
    globalThis.localStorage.removeItem(testKey);
    storageAvailableCache = true;
  } catch {
    storageAvailableCache = false;
  }
  return storageAvailableCache;
}

function warnOnce(message: string, detail?: unknown) {
  if (storageWarned) return;
  storageWarned = true;
  if (detail !== undefined) {
    console.warn(message, detail);
  } else {
    console.warn(message);
  }
}

function isStoredPreset(value: unknown): value is StoredPreset {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.fill === "string" &&
    typeof v.stroke === "string" &&
    typeof v.createdAt === "number"
  );
}

function readFromStorage(): StoredPreset[] {
  if (!isStorageAvailable()) {
    return memoryStore.slice();
  }
  let raw: string | null = null;
  try {
    raw = globalThis.localStorage.getItem(CUSTOM_PRESETS_KEY);
  } catch (err) {
    warnOnce("[customStyles] 读取 localStorage 失败，使用内存模式", err);
    return memoryStore.slice();
  }
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as StoredSchema).version !== SCHEMA_VERSION ||
      !Array.isArray((parsed as StoredSchema).presets)
    ) {
      throw new Error("schema invalid");
    }
    const presets = (parsed as StoredSchema).presets.filter(isStoredPreset);
    return presets;
  } catch (err) {
    // JSON 损坏或 schema 不匹配：备份后清空主 key
    try {
      if (raw) {
        globalThis.localStorage.setItem(CUSTOM_PRESETS_BACKUP_KEY, raw);
      }
      globalThis.localStorage.removeItem(CUSTOM_PRESETS_KEY);
    } catch {
      // 备份失败也不影响主流程
    }
    console.warn("[customStyles] 自定义预设 JSON 损坏，已备份并清空", err);
    return [];
  }
}

function writeToStorage(presets: StoredPreset[]): void {
  if (!isStorageAvailable()) {
    memoryStore = presets.slice();
    warnOnce("[customStyles] localStorage 不可用，已 fallback 内存模式（刷新会丢）");
    return;
  }
  const payload: StoredSchema = { version: SCHEMA_VERSION, presets };
  try {
    globalThis.localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(payload));
  } catch (err) {
    // 写入失败（配额满等）：fallback 内存
    memoryStore = presets.slice();
    warnOnce("[customStyles] 写入 localStorage 失败，已 fallback 内存模式", err);
  }
}

function generateId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") {
    return randomUUID.call(globalThis.crypto);
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toPublicPreset(stored: StoredPreset): QuickStylePreset {
  return {
    name: "自定义",
    fill: stored.fill,
    stroke: stored.stroke,
    id: stored.id,
    createdAt: stored.createdAt
  };
}

export function loadCustomPresets(): QuickStylePreset[] {
  return readFromStorage().map(toPublicPreset);
}

export function saveCustomPreset(fill: string, stroke: string): QuickStylePreset | null {
  const current = readFromStorage();
  if (current.length >= CUSTOM_PRESET_LIMIT) {
    return null;
  }
  const next: StoredPreset = {
    id: generateId(),
    fill,
    stroke,
    createdAt: Date.now()
  };
  writeToStorage([...current, next]);
  return toPublicPreset(next);
}

export function deleteCustomPreset(id: string): void {
  const current = readFromStorage();
  const filtered = current.filter((p) => p.id !== id);
  if (filtered.length === current.length) {
    return;
  }
  writeToStorage(filtered);
}
