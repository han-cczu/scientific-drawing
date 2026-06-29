import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveEndpoint } from "../src/shared/geometry";
import { createEdgeBetweenNodes, duplicateNode, moveNodeLayer, moveNodes, normalizeBox, removeNode, resizeNode, resizeNodeFromHandle, selectNodesInRect, setNodeHidden, setNodeLocked, updateNode, updateNodeStyle } from "../src/editor/sceneOps";
import type { Scene } from "../src/shared/scene";
import { MAX_GEOMETRY_COORDINATE, MAX_NODE_SIZE, MAX_STYLE_FONT_SIZE, MAX_STYLE_STROKE_WIDTH, MAX_TEXT_LENGTH, validateScene } from "../src/shared/sceneValidation";

function editorScene(): Scene {
  /*
   * ========================================================================
   * 步骤1：创建编辑操作测试场景
   * ========================================================================
   * 目标：
   *   1) 覆盖普通节点、锁定底图和线段节点
   *   2) 给移动、缩放和框选提供稳定输入
   */

  // 1.1 返回测试 scene
  return {
    version: "0.1",
    page: { width: 400, height: 240, background: "#FFFFFF", units: "px" },
    metadata: { id: "editor-scene", title: "Editor Scene", createdAt: "2026-05-19T00:00:00.000Z", engine: "test", notes: [] },
    nodes: [
      { id: "base", type: "image", x: 0, y: 0, w: 400, h: 240, source: "/uploads/source.png", locked: true, style: { opacity: 1 } },
      { id: "a", type: "rect", x: 20, y: 30, w: 60, h: 40, style: { fill: "#FFFFFF", stroke: "#111111" } },
      { id: "b", type: "ellipse", x: 140, y: 40, w: 50, h: 50, locked: true, style: { fill: "#FFFFFF", stroke: "#111111" } },
      {
        id: "line",
        type: "line",
        x: 70,
        y: 140,
        w: 80,
        h: 0,
        points: [{ x: 70, y: 140 }, { x: 150, y: 140 }],
        style: { fill: "none", stroke: "#111111" }
      },
      {
        id: "arrow",
        type: "arrow",
        x: 220,
        y: 160,
        w: 80,
        h: 0,
        points: [{ x: 220, y: 160 }, { x: 300, y: 160 }],
        style: { fill: "none", stroke: "#111111" }
      }
    ],
    edges: []
  };
}

describe("editor scene operations", () => {
  it("moves multiple unlocked nodes and their point arrays", () => {
    /*
     * ========================================================================
     * 步骤1：验证多选移动
     * ========================================================================
     * 目标：
     *   1) 多个未锁定节点一起移动
     *   2) 线段 points 跟随节点坐标移动
     */

    // 1.1 移动多个节点
    const scene = moveNodes(editorScene(), ["a", "line"], 10, -5);

    // 1.2 校验节点和点数组
    assert.deepEqual(scene.nodes.find((node) => node.id === "a"), {
      id: "a",
      type: "rect",
      x: 30,
      y: 25,
      w: 60,
      h: 40,
      style: { fill: "#FFFFFF", stroke: "#111111" }
    });
    assert.deepEqual(scene.nodes.find((node) => node.id === "line")?.points, [{ x: 80, y: 135 }, { x: 160, y: 135 }]);
  });

  it("does not move locked nodes", () => {
    /*
     * ========================================================================
     * 步骤1：验证锁定节点保护
     * ========================================================================
     * 目标：
     *   1) 多选移动时跳过锁定节点
     *   2) 保留锁定节点原坐标
     */

    // 1.1 尝试移动锁定节点
    const scene = moveNodes(editorScene(), ["base", "b"], 20, 20);

    // 1.2 校验坐标不变
    assert.equal(scene.nodes.find((node) => node.id === "base")?.x, 0);
    assert.equal(scene.nodes.find((node) => node.id === "b")?.x, 140);
  });

  it("normalizes and clamps resized boxes", () => {
    /*
     * ========================================================================
     * 步骤1：验证尺寸调整
     * ========================================================================
     * 目标：
     *   1) 负宽高会转成正向盒子
     *   2) 宽高会被限制到最小尺寸
     */

    // 1.1 校验盒子归一化
    assert.deepEqual(normalizeBox({ x: 80, y: 90, w: -30, h: -20 }), { x: 50, y: 70, w: 30, h: 20 });

    // 1.2 调整节点尺寸
    const scene = resizeNode(editorScene(), "a", { x: 40, y: 50, w: 2, h: -4 });
    const node = scene.nodes.find((item) => item.id === "a");
    assert.equal(node?.x, 40);
    assert.equal(node?.y, 46);
    assert.equal(node?.w, 8);
    assert.equal(node?.h, 8);
  });

  it("selects nodes in a rectangle and ignores locked source images", () => {
    /*
     * ========================================================================
     * 步骤1：验证框选
     * ========================================================================
     * 目标：
     *   1) 选中和选择框相交的可编辑节点
     *   2) 默认忽略锁定底图
     */

    // 1.1 执行框选
    const ids = selectNodesInRect(editorScene(), { x: -10, y: -10, w: 120, h: 180 });

    // 1.2 校验选中结果
    assert.deepEqual(ids, ["a", "line"]);
  });

  it("ignores hidden nodes during box selection", () => {
    /*
     * ========================================================================
     * 步骤1：验证隐藏节点不可框选
     * ========================================================================
     * 目标：
     *   1) 隐藏节点不进入框选结果
     *   2) 可见节点仍正常命中
     */

    // 1.1 隐藏一个节点
    const scene = editorScene();
    scene.nodes[1].hidden = true;

    // 1.2 执行框选
    const ids = selectNodesInRect(scene, { x: -10, y: -10, w: 120, h: 180 });

    // 1.3 校验隐藏节点未选中
    assert.deepEqual(ids, ["line"]);
  });

  it("toggles layer visibility and lock flags", () => {
    /*
     * ========================================================================
     * 步骤1：验证图层标记修改
     * ========================================================================
     * 目标：
     *   1) 支持设置 hidden
     *   2) 支持设置 locked
     */

    // 1.1 切换图层状态
    const hidden = setNodeHidden(editorScene(), "a", true);
    const locked = setNodeLocked(hidden, "a", true);

    // 1.2 校验节点状态
    const node = locked.nodes.find((item) => item.id === "a");
    assert.equal(node?.hidden, true);
    assert.equal(node?.locked, true);
  });

  it("keeps manual edit operations within the shared scene schema", () => {
    /*
     * ========================================================================
     * 步骤1：验证编辑器手动输入不会写出非法 scene
     * ========================================================================
     * 目标：
     *   1) 属性面板输入的几何和文本需要钳到共享 schema 上界
     *   2) 样式面板输入的线宽和字号需要钳到共享 schema 上界
     *   3) 拖拽移动、缩放和线条端点调整不能绕过同一上界
     */

    // 1.1 模拟属性/样式面板写入超界值
    let scene = updateNode(editorScene(), "a", {
      x: MAX_GEOMETRY_COORDINATE + 100,
      y: -MAX_GEOMETRY_COORDINATE - 100,
      w: MAX_NODE_SIZE + 100,
      h: MAX_NODE_SIZE + 100,
      text: "x".repeat(MAX_TEXT_LENGTH + 100)
    });
    scene = updateNodeStyle(scene, "a", {
      strokeWidth: MAX_STYLE_STROKE_WIDTH + 100,
      fontSize: MAX_STYLE_FONT_SIZE + 100
    });

    // 1.2 编辑后的 scene 仍应可持久化/导出
    const node = scene.nodes.find((item) => item.id === "a");
    assert.equal(node?.x, MAX_GEOMETRY_COORDINATE);
    assert.equal(node?.y, -MAX_GEOMETRY_COORDINATE);
    assert.equal(node?.w, MAX_NODE_SIZE);
    assert.equal(node?.h, MAX_NODE_SIZE);
    assert.equal(node?.text?.length, MAX_TEXT_LENGTH);
    assert.equal(node?.style.strokeWidth, MAX_STYLE_STROKE_WIDTH);
    assert.equal(node?.style.fontSize, MAX_STYLE_FONT_SIZE);
    assert.equal(validateScene(scene).ok, true);

    // 1.3 画布拖拽入口同样不能写出非法几何
    const moved = moveNodes(editorScene(), ["a"], MAX_GEOMETRY_COORDINATE * 2, -MAX_GEOMETRY_COORDINATE * 2);
    const movedNode = moved.nodes.find((item) => item.id === "a");
    assert.equal(movedNode?.x, MAX_GEOMETRY_COORDINATE);
    assert.equal(movedNode?.y, -MAX_GEOMETRY_COORDINATE);
    assert.equal(validateScene(moved).ok, true);

    // 1.4 缩放和线条端点入口也需要收敛到共享 schema
    const resized = resizeNode(editorScene(), "a", { x: 0, y: 0, w: MAX_NODE_SIZE + 100, h: MAX_NODE_SIZE + 100 });
    const resizedNode = resized.nodes.find((item) => item.id === "a");
    assert.equal(resizedNode?.w, MAX_NODE_SIZE);
    assert.equal(resizedNode?.h, MAX_NODE_SIZE);
    assert.equal(validateScene(resized).ok, true);

    const lineResized = resizeNodeFromHandle(editorScene(), "line", "line-end", { x: 70, y: 140, w: 80, h: 0 }, MAX_GEOMETRY_COORDINATE * 2, 0);
    const lineNode = lineResized.nodes.find((item) => item.id === "line");
    assert.equal(lineNode?.points?.[1]?.x, MAX_GEOMETRY_COORDINATE);
    assert.equal(validateScene(lineResized).ok, true);
  });

  it("moves nodes through layer order without moving locked base below top constraints", () => {
    /*
     * ========================================================================
     * 步骤1：验证图层排序
     * ========================================================================
     * 目标：
     *   1) 支持上移、下移、置顶、置底
     *   2) 保持节点总数不变
     */

    // 1.1 移动图层
    const forward = moveNodeLayer(editorScene(), "a", "forward");
    const backward = moveNodeLayer(forward, "a", "backward");
    const front = moveNodeLayer(backward, "line", "front");
    const back = moveNodeLayer(front, "line", "back");
    const baseMoved = moveNodeLayer(editorScene(), "base", "front");

    // 1.2 校验顺序
    assert.deepEqual(forward.nodes.map((node) => node.id), ["base", "b", "a", "line", "arrow"]);
    assert.deepEqual(backward.nodes.map((node) => node.id), ["base", "a", "b", "line", "arrow"]);
    assert.equal(front.nodes.at(-1)?.id, "line");
    assert.deepEqual(back.nodes.map((node) => node.id), ["base", "line", "a", "b", "arrow"]);
    assert.deepEqual(baseMoved.nodes.map((node) => node.id), editorScene().nodes.map((node) => node.id));
    assert.equal(back.nodes.length, editorScene().nodes.length);
  });

  it("resizes shape nodes from directional handles", () => {
    /*
     * ========================================================================
     * 步骤1：验证形状手柄缩放
     * ========================================================================
     * 目标：
     *   1) 东侧手柄只增加宽度
     *   2) 西侧手柄修改 x 和 w，并受最小尺寸保护
     */

    // 1.1 从东侧放大节点
    const east = resizeNodeFromHandle(editorScene(), "a", "e", { x: 20, y: 30, w: 60, h: 40 }, 15, 0);
    const eastNode = east.nodes.find((node) => node.id === "a");
    assert.equal(eastNode?.x, 20);
    assert.equal(eastNode?.w, 75);

    // 1.2 从西侧缩小到最小尺寸
    const west = resizeNodeFromHandle(editorScene(), "a", "w", { x: 20, y: 30, w: 60, h: 40 }, 100, 0);
    const westNode = west.nodes.find((node) => node.id === "a");
    assert.equal(westNode?.x, 72);
    assert.equal(westNode?.w, 8);
  });

  it("resizes line and arrow nodes by endpoint handles", () => {
    /*
     * ========================================================================
     * 步骤1：验证线条端点手柄
     * ========================================================================
     * 目标：
     *   1) 线段结束点拖拽会更新 points
     *   2) 箭头起点拖拽会更新 points 和包围盒
     */

    // 1.1 调整线段结束点
    const lineScene = resizeNodeFromHandle(editorScene(), "line", "line-end", { x: 70, y: 140, w: 80, h: 0 }, 20, 10);
    const line = lineScene.nodes.find((node) => node.id === "line");
    assert.deepEqual(line?.points, [{ x: 70, y: 140 }, { x: 170, y: 150 }]);
    assert.equal(line?.w, 100);
    assert.equal(line?.h, 10);

    // 1.2 调整箭头起点
    const arrowScene = resizeNodeFromHandle(editorScene(), "arrow", "line-start", { x: 220, y: 160, w: 80, h: 0 }, -10, -20);
    const arrow = arrowScene.nodes.find((node) => node.id === "arrow");
    assert.deepEqual(arrow?.points, [{ x: 210, y: 140 }, { x: 300, y: 160 }]);
    assert.equal(arrow?.x, 210);
    assert.equal(arrow?.y, 140);
  });

  it("duplicates a node into a reference-independent copy", () => {
    /*
     * ========================================================================
     * 步骤1：验证复制节点的引用独立性
     * ========================================================================
     * 目标：
     *   1) 副本带坐标偏移、解锁、新 id
     *   2) style/cells/rowColors 等可变字段不与源节点共享引用，避免后续就地修改互相污染
     */

    // 1.1 用含可变嵌套字段的网格节点复制
    const scene = editorScene();
    scene.nodes[1] = {
      id: "grid",
      type: "grid",
      x: 20,
      y: 30,
      w: 80,
      h: 40,
      rows: 1,
      cols: 2,
      rowColors: ["#FFFFFF"],
      cells: [{ row: 0, col: 0, fill: "#FFFFFF" }],
      style: { fill: "#FFFFFF", stroke: "#111111" }
    } as Scene["nodes"][number];
    const copy = duplicateNode(scene, "grid");

    // 1.2 校验偏移与引用独立
    assert.ok(copy);
    assert.notEqual(copy?.id, "grid");
    assert.equal(copy?.x, 38);
    assert.equal(copy?.locked, false);
    assert.notEqual(copy?.style, scene.nodes[1].style);
    assert.notEqual(copy?.cells, scene.nodes[1].cells);
    assert.notEqual(copy?.cells?.[0], scene.nodes[1].cells?.[0]);
    assert.notEqual(copy?.rowColors, scene.nodes[1].rowColors);
    assert.deepEqual(copy?.style, scene.nodes[1].style);
  });

  it("creates semantic edges and keeps endpoint behavior tied to nodes", () => {
    /*
     * ========================================================================
     * 步骤1：验证语义连线
     * ========================================================================
     * 目标：
     *   1) 从两个节点创建 arrow edge
     *   2) 删除节点清理依赖 edge，移动节点后端点随节点变化
     */

    // 1.1 创建语义连线
    const scene = createEdgeBetweenNodes(editorScene(), "a", "b");
    const edge = scene.edges[0];
    assert.equal(edge.type, "arrow");
    assert.equal(edge.from, "a:right@0.5");
    assert.equal(edge.to, "b:left@0.5");

    // 1.2 删除节点时清理连线
    assert.equal(removeNode(scene, "a").edges.length, 0);

    // 1.3 移动节点后端点跟随变化
    const moved = moveNodes(scene, ["a"], 20, 0);
    assert.deepEqual(resolveEndpoint(edge.from ?? "", moved.nodes), { x: 100, y: 50 });
  });
});
