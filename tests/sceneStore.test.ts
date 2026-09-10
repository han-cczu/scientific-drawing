import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import type { Scene } from "../src/shared/scene";
import {
  MAX_PAGE_DIMENSION,
  MAX_STYLE_FONT_SIZE,
  MAX_STYLE_STROKE_WIDTH,
  validateScene
} from "../src/shared/sceneValidation";

/*
 * ============================================================================
 * 场景持久化适配层测试
 * ============================================================================
 * 目标：
 *   1) 合法 scene 可写入/恢复（round-trip）
 *   2) 损坏 JSON / 协议非法数据被备份清空并返回 null
 *   3) isSceneWorthPersisting 用内容判定而非结构等值
 *
 * 注意：isStorageAvailable 的结果是模块级缓存，必须在 import 副作用触发前
 * 装好 localStorage stub —— 这里用动态 import 保证顺序。
 */

// 1.1 安装基于 Map 的 localStorage stub
const backing = new Map<string, string>();
let failSceneStoreWrites = false;
let failBackupWrites = false;
let failSceneStoreClear = false;
const localStorageStub = {
  getItem: (key: string) => (backing.has(key) ? backing.get(key)! : null),
  setItem: (key: string, value: string) => {
    if (failSceneStoreWrites && key === "sciDraw.scene") {
      throw new Error("QuotaExceededError");
    }
    if (failBackupWrites && key === "sciDraw.scene.backup") {
      throw new Error("QuotaExceededError");
    }
    backing.set(key, String(value));
  },
  removeItem: (key: string) => {
    if (failSceneStoreClear && key === "sciDraw.scene") throw new Error("Storage clear failed");
    backing.delete(key);
  },
  clear: () => backing.clear(),
  key: (index: number) => [...backing.keys()][index] ?? null,
  get length() {
    return backing.size;
  }
};

let store: typeof import("../src/lib/sceneStore");

before(async () => {
  (globalThis as Record<string, unknown>).localStorage = localStorageStub;
  store = await import("../src/lib/sceneStore");
});

function validScene(): Scene {
  return {
    version: "0.1",
    page: { width: 320, height: 180, background: "#FFFFFF", units: "px" },
    metadata: { id: "scene-1", title: "Scene", createdAt: "2026-06-07T00:00:00.000Z", engine: "test", notes: [] },
    nodes: [
      { id: "a", type: "rect", x: 10, y: 10, w: 80, h: 40, style: { fill: "#FFFFFF", stroke: "#111111" } }
    ],
    edges: []
  };
}

describe("scene store", () => {
  it("reports a failed clear instead of restoring the stale persisted scene in this session", () => {
    const scene = validScene();
    store.saveStoredScene(scene);
    failSceneStoreClear = true;
    try {
      assert.equal(store.clearStoredScene(), "failed");
      assert.equal(store.loadStoredScene(), null);
      assert.equal(backing.has(store.SCENE_STORE_KEY), true);
    } finally {
      failSceneStoreClear = false;
      assert.equal(store.clearStoredScene(), "ok");
    }
  });

  it("leaves the memory fallback after a subsequent successful save", () => {
    store.clearStoredScene();
    const first = validScene();
    failSceneStoreWrites = true;
    try { assert.equal(store.saveStoredScene(first), "failed"); }
    finally { failSceneStoreWrites = false; }
    const next = { ...first, metadata: { ...first.metadata, id: "newest" } };
    assert.equal(store.saveStoredScene(next), "ok");
    assert.deepEqual(store.loadStoredScene(), next);
    store.clearStoredScene();
  });
  it("round-trips a valid scene through localStorage", () => {
    /*
     * ========================================================================
     * 步骤1：验证保存与恢复闭环
     * ========================================================================
     */

    // 1.1 写入并恢复
    backing.clear();
    const scene = validScene();
    assert.equal(store.saveStoredScene(scene), "ok");
    const restored = store.loadStoredScene();
    assert.deepEqual(restored, scene);

    // 1.2 清空后恢复为 null
    store.clearStoredScene();
    assert.equal(store.loadStoredScene(), null);
  });

  it("reads from memory fallback after localStorage write failure in the same session", () => {
    backing.clear();
    store.clearStoredScene();
    failSceneStoreWrites = true;

    try {
      const scene = validScene();
      scene.metadata.id = "memory-fallback-scene";
      assert.equal(store.saveStoredScene(scene), "failed");
      assert.deepEqual(store.loadStoredScene(), scene);
    } finally {
      failSceneStoreWrites = false;
      store.clearStoredScene();
      backing.clear();
    }
  });

  it("backs up and clears corrupted or invalid payloads", () => {
    /*
     * ========================================================================
     * 步骤1：验证损坏数据兜底
     * ========================================================================
     * 目标：
     *   1) JSON 损坏 → 备份 + 清空 + 返回 null
     *   2) 协议非法（过 JSON 但不过 validateScene）同样兜底
     */

    // 1.1 JSON 损坏
    backing.clear();
    backing.set(store.SCENE_STORE_KEY, "{not-json");
    assert.equal(store.loadStoredScene(), null);
    assert.equal(backing.get(store.SCENE_STORE_BACKUP_KEY), "{not-json");
    assert.equal(backing.has(store.SCENE_STORE_KEY), false);

    // 1.2 协议非法（nodes 不是数组）
    backing.clear();
    backing.set(
      store.SCENE_STORE_KEY,
      JSON.stringify({ version: 1, scene: { version: "0.1", nodes: "broken" }, savedAt: 0 })
    );
    assert.equal(store.loadStoredScene(), null);
    assert.equal(backing.has(store.SCENE_STORE_KEY), false);

    // 1.3 版本不符
    backing.clear();
    backing.set(store.SCENE_STORE_KEY, JSON.stringify({ version: 999, scene: validScene(), savedAt: 0 }));
    assert.equal(store.loadStoredScene(), null);
  });

  it("clears corrupted payloads even when backup storage is full", () => {
    /*
     * ========================================================================
     * 步骤1：验证损坏数据清理不依赖备份成功
     * ========================================================================
     * 目标：
     *   1) localStorage 配额满时 backup key 写入可能失败
     *   2) 主 scene key 仍必须被删除，避免每次启动反复解析同一份坏数据
     */
    backing.clear();
    backing.set(store.SCENE_STORE_KEY, "{not-json");
    failBackupWrites = true;

    try {
      assert.equal(store.loadStoredScene(), null);
      assert.equal(backing.has(store.SCENE_STORE_KEY), false);
      assert.equal(backing.has(store.SCENE_STORE_BACKUP_KEY), false);
    } finally {
      failBackupWrites = false;
      backing.clear();
    }
  });

  it("repairs recoverable stored scenes instead of discarding local drafts", () => {
    /*
     * ========================================================================
     * 步骤1：验证可修复草稿恢复
     * ========================================================================
     * 目标：
     *   1) schema 收紧后，旧 localStorage 草稿若可修复，不应直接丢弃
     *   2) 修复后的 scene 需要重新满足 validateScene
     */

    // 1.1 构造能修复但当前 schema 不接受的旧草稿
    backing.clear();
    const scene = validScene();
    scene.page.width = MAX_PAGE_DIMENSION + 10;
    scene.nodes[0].style.fill = "red";
    scene.nodes[0].style.strokeWidth = MAX_STYLE_STROKE_WIDTH + 10;
    scene.nodes[0].style.fontSize = MAX_STYLE_FONT_SIZE + 10;
    backing.set(store.SCENE_STORE_KEY, JSON.stringify({ version: 1, scene, savedAt: 0 }));

    // 1.2 恢复时应修复保留，而不是备份清空后返回 null
    const restored = store.loadStoredScene();
    assert.ok(restored);
    assert.equal(restored.page.width, MAX_PAGE_DIMENSION);
    assert.equal(restored.nodes[0].style.fill, "#FFFFFF");
    assert.equal(restored.nodes[0].style.strokeWidth, MAX_STYLE_STROKE_WIDTH);
    assert.equal(restored.nodes[0].style.fontSize, MAX_STYLE_FONT_SIZE);
    assert.equal(validateScene(restored).ok, true);
    assert.equal(backing.has(store.SCENE_STORE_KEY), true);
    assert.equal(backing.has(store.SCENE_STORE_BACKUP_KEY), false);
  });

  it("judges persist-worthiness by content, not blank-scene equality", () => {
    /*
     * ========================================================================
     * 步骤1：验证内容判定
     * ========================================================================
     */

    // 1.1 空白 scene 不值得保存
    const blank = validScene();
    blank.nodes = [];
    blank.edges = [];
    assert.equal(store.isSceneWorthPersisting(blank), false);

    // 1.2 有节点 / 有边 / 有底图任一即值得
    assert.equal(store.isSceneWorthPersisting(validScene()), true);
    const withSource = validScene();
    withSource.nodes = [];
    withSource.metadata.sourceImage = "/uploads/x.png";
    assert.equal(store.isSceneWorthPersisting(withSource), true);
  });
});
