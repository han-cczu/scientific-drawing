import type { Scene } from "../shared/scene";
import { repairScene } from "../shared/repairScene";
import { validateScene } from "../shared/sceneValidation";

/*
 * ============================================================================
 * 场景 localStorage 持久化适配层
 * ============================================================================
 * 目标：
 *   1) 把当前编辑中的 scene（history.present）持久化，刷新/崩溃后可恢复
 *   2) localStorage 不可用 / JSON 损坏 / 配额满时不破坏 UI，仅 console.warn
 *   3) 恢复时必须通过 validateScene 门控，损坏数据先备份再清空
 *   4) 只存 present 单个 Scene，不存撤销栈（80 份快照可能逼近 5MB 配额）
 */

export const SCENE_STORE_KEY = "sciDraw.scene";
export const SCENE_STORE_BACKUP_KEY = "sciDraw.scene.backup";

const SCHEMA_VERSION = 1;

type StoredSchema = {
  version: number;
  scene: unknown;
  savedAt: number;
};

export type SceneSaveResult = "ok" | "memory" | "failed";

// in-memory fallback when localStorage 不可用
let memoryScene: Scene | null = null;
let memoryFallbackActive = false;
let storageWarned = false;
let storageAvailableCache: boolean | null = null;

function isStorageAvailable(): boolean {
  if (storageAvailableCache !== null) {
    return storageAvailableCache;
  }
  try {
    const testKey = "__sciDraw_scene_probe__";
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

export function isSceneWorthPersisting(scene: Scene): boolean {
  /*
   * ========================================================================
   * 步骤1：判断 scene 是否值得保存
   * ========================================================================
   * 目标：
   *   1) 空白画布不写盘、不触发 beforeunload 守卫
   *   2) 不能与 createBlankScene 做结构等值比较——它每次生成新的
   *      metadata.id/createdAt，等值法会恒判“有内容”
   */
  return scene.nodes.length > 0 || scene.edges.length > 0 || Boolean(scene.metadata.sourceImage);
}

export function saveStoredScene(scene: Scene): SceneSaveResult {
  /*
   * ========================================================================
   * 步骤1：持久化当前 scene
   * ========================================================================
   * 目标：
   *   1) 正常路径写 localStorage
   *   2) 不可用/配额满时 fallback 内存（刷新即丢），返回值供指示器诚实显示
   */
  const payload: StoredSchema = { version: SCHEMA_VERSION, scene, savedAt: Date.now() };
  if (!isStorageAvailable()) {
    memoryScene = scene;
    memoryFallbackActive = true;
    warnOnce("[sceneStore] localStorage 不可用，场景仅保存在内存（刷新会丢）");
    return "memory";
  }
  try {
    globalThis.localStorage.setItem(SCENE_STORE_KEY, JSON.stringify(payload));
    return "ok";
  } catch (err) {
    memoryScene = scene;
    memoryFallbackActive = true;
    warnOnce("[sceneStore] 写入 localStorage 失败（配额满？），场景仅保存在内存", err);
    return "failed";
  }
}

export function loadStoredScene(): Scene | null {
  /*
   * ========================================================================
   * 步骤1：恢复持久化 scene
   * ========================================================================
   * 目标：
   *   1) 版本不符 / JSON 损坏 / 协议非法一律返回 null，由调用方回退空白画布
   *   2) 损坏数据先备份到 backup key 再清空主 key，避免反复报错
   */
  if (memoryFallbackActive || !isStorageAvailable()) {
    return memoryScene;
  }
  let raw: string | null = null;
  try {
    raw = globalThis.localStorage.getItem(SCENE_STORE_KEY);
  } catch (err) {
    warnOnce("[sceneStore] 读取 localStorage 失败", err);
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as StoredSchema).version !== SCHEMA_VERSION
    ) {
      throw new Error("schema invalid");
    }
    const candidate = (parsed as StoredSchema).scene;
    const validation = validateScene(candidate);
    if (validation.ok) {
      return candidate as Scene;
    }
    if (!isRecoverableSceneDraft(candidate)) {
      throw new Error("scene invalid");
    }
    const repaired = repairScene(candidate as Scene);
    const repairedValidation = validateScene(repaired);
    if (!repairedValidation.ok) {
      throw new Error("scene invalid");
    }
    saveStoredScene(repaired);
    return repaired;
  } catch (err) {
    try {
      globalThis.localStorage.setItem(SCENE_STORE_BACKUP_KEY, raw);
    } catch {
      // 备份失败不影响主数据清理
    }
    try {
      globalThis.localStorage.removeItem(SCENE_STORE_KEY);
    } catch {
      // 清理失败不影响主流程
    }
    console.warn("[sceneStore] 本地场景数据损坏或不兼容，已备份并清空", err);
    return null;
  }
}

function isRecoverableSceneDraft(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const scene = value as Partial<Scene>;
  const hasPage = Boolean(scene.page && typeof scene.page === "object" && !Array.isArray(scene.page));
  const hasMetadata = Boolean(scene.metadata && typeof scene.metadata === "object" && !Array.isArray(scene.metadata));
  const nodes = scene.nodes;
  const edges = scene.edges;
  const hasNodes = Array.isArray(nodes);
  const hasEdges = Array.isArray(edges);
  return hasPage && hasMetadata && hasNodes && hasEdges && (nodes.length > 0 || edges.length > 0 || Boolean(scene.metadata?.sourceImage));
}

export function clearStoredScene(): void {
  memoryScene = null;
  memoryFallbackActive = false;
  if (!isStorageAvailable()) {
    return;
  }
  try {
    globalThis.localStorage.removeItem(SCENE_STORE_KEY);
  } catch {
    // 清理失败不影响主流程
  }
}
