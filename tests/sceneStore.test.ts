import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import type { Scene } from "../src/shared/scene";

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
const localStorageStub = {
  getItem: (key: string) => (backing.has(key) ? backing.get(key)! : null),
  setItem: (key: string, value: string) => {
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
