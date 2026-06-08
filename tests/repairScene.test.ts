import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensureReplicaBaseLayer } from "../server/src/routes/api";
import { repairScene } from "../server/src/scene/repairScene";
import type { Scene } from "../src/shared/scene";
import { validateScene } from "../src/shared/sceneValidation";

function damagedScene(): Scene {
  /*
   * ========================================================================
   * 步骤1：创建待修复场景
   * ========================================================================
   * 目标：
   *   1) 覆盖 AI 输出常见坏字段
   *   2) 给修复器提供稳定输入
   */

  // 1.1 返回包含坏字段的 scene
  return {
    version: "0.1",
    page: { width: -10, height: 0, background: "white", units: "px" },
    metadata: { id: "", title: "", createdAt: "", engine: "", notes: [] },
    nodes: [
      { id: "dup", type: "rect", x: 0, y: 0, w: -80, h: -40, style: { fill: "red", stroke: "#111111", opacity: 2 } },
      { id: "dup", type: "bad" as Scene["nodes"][number]["type"], x: Number.NaN, y: 10, w: 0, h: 20, style: { fill: "#FFFFFF", stroke: "black" } },
      { id: "target", type: "text", x: 120, y: 20, w: 90, h: 24, text: "Label", style: { color: "blue", fontSize: -1 } }
    ],
    edges: [
      { id: "keep", type: "arrow", from: "dup:right@0.5", to: "target:left@0.5", style: { stroke: "#111111" } },
      { id: "drop", type: "arrow", from: "missing:right@0.5", to: "target:left@0.5", style: { stroke: "#111111" } }
    ]
  };
}

describe("scene repair", () => {
  it("repairs malformed AI scenes into valid internal scenes", () => {
    /*
     * ========================================================================
     * 步骤1：验证 scene 修复
     * ========================================================================
     * 目标：
     *   1) 修复重复 id、尺寸、颜色和元数据
     *   2) 删除引用缺失节点的边
     */

    // 1.1 执行修复
    const repaired = repairScene(damagedScene());

    // 1.2 校验修复结果
    assert.equal(repaired.page.width, 1280);
    assert.equal(repaired.page.height, 720);
    assert.equal(repaired.page.background, "#FFFFFF");
    assert.notEqual(repaired.nodes[0].id, repaired.nodes[1].id);
    assert.equal(repaired.nodes[0].w, 80);
    assert.equal(repaired.nodes[0].h, 40);
    assert.equal(repaired.nodes[1].type, "rect");
    assert.equal(repaired.nodes[1].x, 0);
    assert.equal(repaired.nodes[1].w, 1);
    assert.equal(repaired.nodes[0].style.fill, "#FFFFFF");
    assert.equal(repaired.nodes[0].style.opacity, 1);
    assert.equal(repaired.nodes[2].style.color, "#111111");
    assert.equal(repaired.edges.length, 1);
    assert.equal(repaired.edges[0].id, "keep");
    assert.equal(repaired.edges[0].from, `${repaired.nodes[0].id}:right@0.5`);
    assert.equal(validateScene(repaired).ok, true);
  });

  it("survives malformed array fields, clamps oversized grids, and normalizes short colors", () => {
    /*
     * ========================================================================
     * 步骤1：验证畸形附属字段的兜底
     * ========================================================================
     * 目标：
     *   1) 非数组 points/cells 不抛错且被清空
     *   2) 超大 rows/cols 被钳制，3 位短色被规范化
     */

    // 1.1 构造畸形附属字段
    const scene = {
      version: "0.1",
      page: { width: 320, height: 180, background: "#FFFFFF", units: "px" },
      metadata: { id: "s", title: "", createdAt: "", engine: "", notes: [] },
      nodes: [
        {
          id: "g1",
          type: "grid",
          x: 0,
          y: 0,
          w: 100,
          h: 100,
          rows: 100000,
          cols: 5,
          style: {},
          points: "not-an-array",
          cells: [null, { row: 0, col: 0, fill: "#abc" }]
        }
      ],
      edges: []
    } as unknown as Scene;

    // 1.2 执行修复并校验兜底
    const repaired = repairScene(scene);
    assert.equal(repaired.nodes[0].points, undefined);
    assert.equal(repaired.nodes[0].cells?.length, 1);
    assert.equal(repaired.nodes[0].cells?.[0].fill, "#AABBCC");
    assert.equal(repaired.nodes[0].rows, 256);
    assert.equal(repaired.nodes[0].cols, 5);
    assert.equal(validateScene(repaired).ok, true);
  });

  it("repairs non-number grid dimensions instead of leaking them to validation", () => {
    /*
     * ========================================================================
     * 步骤1：验证非数字网格维度的修复
     * ========================================================================
     * 目标：
     *   1) 数字字符串 rows 被转数后钳制（不修复会被 validateScene 拒绝返回 500）
     *   2) 完全非法的 cols（null）回退为 1
     */

    // 1.1 构造字符串/null 维度
    const scene = {
      version: "0.1",
      page: { width: 320, height: 180, background: "#FFFFFF", units: "px" },
      metadata: { id: "s", title: "", createdAt: "", engine: "", notes: [] },
      nodes: [
        { id: "g1", type: "grid", x: 0, y: 0, w: 100, h: 100, rows: "100000", cols: null, style: {} }
      ],
      edges: []
    } as unknown as Scene;

    // 1.2 字符串转数钳制、null 回退 1，修复结果可通过校验
    const repaired = repairScene(scene);
    assert.equal(repaired.nodes[0].rows, 256);
    assert.equal(repaired.nodes[0].cols, 1);
    assert.equal(validateScene(repaired).ok, true);
  });

  it("keeps replica base layer compatible with repaired scenes", () => {
    /*
     * ========================================================================
     * 步骤1：验证底图补充兼容性
     * ========================================================================
     * 目标：
     *   1) 修复后仍可插入锁定底图
     *   2) 底图位于语义节点下方
     */

    // 1.1 修复并插入底图
    const repaired = repairScene(damagedScene());
    ensureReplicaBaseLayer(repaired, "/uploads/sample.png");

    // 1.2 校验底图节点
    assert.equal(repaired.nodes[0].id, "source-image");
    assert.equal(repaired.nodes[0].type, "image");
    assert.equal(repaired.nodes[0].locked, true);
    assert.equal(repaired.nodes[0].source, "/uploads/sample.png");
    assert.equal(validateScene(repaired).ok, true);
  });

  it("deduplicates three or more nodes sharing one id into unique ids", () => {
    /*
     * ========================================================================
     * 步骤1：验证 ≥3 次 id 碰撞的去重
     * ========================================================================
     * 目标：
     *   1) 旧实现对 ≥3 个同 id 节点会产出重复 id（如 x-2,x-2），被 validateScene 拒绝返回 500
     *   2) 修复后全部 id 唯一且通过校验
     */

    // 1.1 四个同 id 节点
    const scene = {
      version: "0.1",
      page: { width: 100, height: 100, background: "#FFFFFF", units: "px" },
      metadata: { id: "s", title: "", createdAt: "", engine: "", notes: [] },
      nodes: [
        { id: "x", type: "rect", x: 0, y: 0, w: 10, h: 10, style: {} },
        { id: "x", type: "rect", x: 0, y: 0, w: 10, h: 10, style: {} },
        { id: "x", type: "rect", x: 0, y: 0, w: 10, h: 10, style: {} },
        { id: "x", type: "rect", x: 0, y: 0, w: 10, h: 10, style: {} }
      ],
      edges: []
    } as unknown as Scene;

    // 1.2 去重后全部唯一且校验通过
    const repaired = repairScene(scene);
    const ids = repaired.nodes.map((node) => node.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(validateScene(repaired).ok, true);
  });
});
