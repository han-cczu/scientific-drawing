# Scientific Drawing Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Scientific Drawing 从可用原型提升到稳定的本地科研图重建工具，覆盖协议校验、渲染一致性、AI 输出修复、编辑交互、文件治理和评估体系。

**Architecture:** 先收紧 `scene.json` 边界，再抽出 Canvas/SVG/PPTX 共用几何规则。AI、导入、导出都经过同一套修复和校验链路，编辑器只消费合法 scene。普通分析和评估脚本按职责拆分，避免单文件继续膨胀。

**Tech Stack:** React 19, Vite 7, TypeScript, Express 5, sharp, pptxgenjs, node:test, tsx.

---

## Scope

本计划覆盖六条线：

1. scene 深校验和导入修复。
2. Canvas、SVG、PPTX 的几何和颜色规则统一。
3. AI 重建结果后处理。
4. 编辑体验：缩放、平移、框选、尺寸调整、连线编辑。
5. uploads、exports、scenes 的保留和清理策略。
6. 普通分析拆分、评估指标增强、文档更新。

当前目录不是 Git 仓库。执行时每个任务完成后跑验证命令；如果后续初始化 Git，再按任务粒度提交。

## File Structure

Create:

- `src/shared/geometry.ts`
  - 提供 `resolveEndpoint`、`endpointReferencesNode`、`shadeColor`、`normalizeHexColor`、`clampNumber`。
- `src/shared/sceneValidation.ts`
  - 提供 `validateScene`、`assertScene`、`ValidationIssue`。
- `server/src/scene/repairScene.ts`
  - 修复导入和 AI 生成的 scene，补齐 metadata、style、尺寸、端点和颜色。
- `server/src/files/retention.ts`
  - 清理过期上传、导出、scene 文件。
- `server/src/scene/analysis/mask.ts`
  - 承担前景和彩色掩码生成。
- `server/src/scene/analysis/components.ts`
  - 承担连通域、框合并和几何工具。
- `server/src/scene/analysis/elements.ts`
  - 承担文本、颜色块、矩形、线段候选转换。
- `tests/geometry.test.ts`
- `tests/sceneValidation.test.ts`
- `tests/repairScene.test.ts`
- `tests/fileRetention.test.ts`
- `tests/editorOps.test.ts`
- `tests/evaluateMetrics.test.ts`

Modify:

- `src/editor/Canvas.tsx`
  - 使用共享几何函数；加入 viewport、框选、resize handles、连线编辑入口。
- `src/editor/sceneOps.ts`
  - 增加多选、批量移动、resize、edge create/update/delete 操作。
- `src/editor/Toolbar.tsx`
  - 增加缩放复位、连线工具、框选状态。
- `src/App.tsx`
  - 接入新编辑状态和导入校验。
- `src/editor/visiomasterAdapter.ts`
  - 使用共享几何和修复规则。
- `server/src/scene/visiomasterAdapter.ts`
  - 使用共享几何和修复规则。
- `server/src/scene/svg.ts`
  - 使用共享几何和颜色规则。
- `server/src/scene/pptx.ts`
  - 使用共享几何和颜色规则。
- `server/src/routes/api.ts`
  - 导出前执行 scene 校验；新增清理接口或启动清理。
- `server/src/index.ts`
  - 启动时创建目录并执行一次保留策略。
- `server/src/evaluate.ts`
  - 输出结构指标和视觉指标。
- `README.md`
  - 更新配置、清理策略、编辑能力和评估说明。

---

### Task 1: Shared Geometry And Color Utilities

**Files:**

- Create: `src/shared/geometry.ts`
- Create: `tests/geometry.test.ts`
- Modify: none

- [ ] **Step 1: Write failing tests**

Create `tests/geometry.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { endpointReferencesNode, normalizeHexColor, resolveEndpoint, shadeColor } from "../src/shared/geometry";
import type { SceneNode } from "../src/shared/scene";

const node: SceneNode = {
  id: "box",
  type: "rect",
  x: 10,
  y: 20,
  w: 100,
  h: 40,
  style: { fill: "#FFFFFF", stroke: "#111111" }
};

describe("shared geometry", () => {
  it("resolves endpoint references consistently", () => {
    /*
     * ========================================================================
     * 步骤1：验证端点解析
     * ========================================================================
     * 目标：
     *   1) 支持 node:side@ratio 写法
     *   2) 缺省端点回到中心点
     */

    // 1.1 解析右侧中点
    assert.deepEqual(resolveEndpoint("box:right@0.5", [node]), { x: 110, y: 40 });

    // 1.2 解析中心点
    assert.deepEqual(resolveEndpoint("box", [node]), { x: 60, y: 40 });
  });

  it("checks endpoint ownership without false positives", () => {
    /*
     * ========================================================================
     * 步骤1：验证端点归属
     * ========================================================================
     * 目标：
     *   1) 删除节点时精准判断边引用
     *   2) 避免 node-1 误匹配 node-10
     */

    // 1.1 命中同名节点
    assert.equal(endpointReferencesNode("node-1:right@0.5", "node-1"), true);

    // 1.2 排除前缀相似节点
    assert.equal(endpointReferencesNode("node-10:right@0.5", "node-1"), false);
  });

  it("normalizes and shades colors", () => {
    /*
     * ========================================================================
     * 步骤1：验证颜色工具
     * ========================================================================
     * 目标：
     *   1) 统一十六进制颜色格式
     *   2) 非法颜色保留原值
     */

    // 1.1 规范化颜色
    assert.equal(normalizeHexColor("#abc"), "#AABBCC");
    assert.equal(normalizeHexColor("112233"), "#112233");

    // 1.2 计算阴影色
    assert.equal(shadeColor("#808080", 0.5), "#404040");
    assert.equal(shadeColor("none", 0.5), "none");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/geometry.test.ts
```

Expected: FAIL because `src/shared/geometry.ts` does not exist.

- [ ] **Step 3: Add shared geometry implementation**

Create `src/shared/geometry.ts`:

```ts
import type { SceneNode } from "./scene";

export function resolveEndpoint(endpoint: string, nodes: SceneNode[]) {
  /*
   * ========================================================================
   * 步骤1：解析连线端点
   * ========================================================================
   * 目标：
   *   1) 支持 node:right@0.5 写法
   *   2) 给 Canvas、SVG、PPTX 共用同一套坐标规则
   */

  // 1.1 拆解节点和边位
  const [id, rawSide] = endpoint.split(":");
  const node = nodes.find((item) => item.id === id);
  if (!node) {
    return undefined;
  }

  // 1.2 计算端点坐标
  const [side, rawRatio] = (rawSide ?? "center").split("@");
  const ratio = clampNumber(rawRatio === undefined ? 0.5 : Number(rawRatio), 0, 1);
  if (side === "left") {
    return { x: node.x, y: node.y + node.h * ratio };
  }
  if (side === "right") {
    return { x: node.x + node.w, y: node.y + node.h * ratio };
  }
  if (side === "top") {
    return { x: node.x + node.w * ratio, y: node.y };
  }
  if (side === "bottom") {
    return { x: node.x + node.w * ratio, y: node.y + node.h };
  }
  return { x: node.x + node.w / 2, y: node.y + node.h / 2 };
}

export function endpointReferencesNode(endpoint: string | undefined, nodeId: string) {
  /*
   * ========================================================================
   * 步骤1：判断端点归属
   * ========================================================================
   * 目标：
   *   1) 删除节点时清理依赖边
   *   2) 只比较端点冒号前的节点 id
   */

  // 1.1 读取端点节点 id
  const endpointNodeId = endpoint?.split(":")[0];

  // 1.2 返回归属判断
  return endpointNodeId === nodeId;
}

export function normalizeHexColor(value: string) {
  /*
   * ========================================================================
   * 步骤1：规范化十六进制颜色
   * ========================================================================
   * 目标：
   *   1) 支持 #RGB 和 RRGGBB
   *   2) 非法颜色保持原值
   */

  // 1.1 清理输入
  const raw = value.trim();
  const body = raw.startsWith("#") ? raw.slice(1) : raw;

  // 1.2 转换短颜色
  if (/^[0-9a-fA-F]{3}$/.test(body)) {
    return `#${body.split("").map((item) => item + item).join("").toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(body)) {
    return `#${body.toUpperCase()}`;
  }
  return value;
}

export function shadeColor(color: string, amount: number) {
  /*
   * ========================================================================
   * 步骤1：计算阴影色
   * ========================================================================
   * 目标：
   *   1) 把基础颜色按比例混合到黑色
   *   2) 统一 Canvas、SVG、PPTX 网格渲染
   */

  // 1.1 校验颜色格式
  const normalized = normalizeHexColor(color);
  const body = normalized.startsWith("#") ? normalized.slice(1) : normalized;
  if (!/^[0-9A-F]{6}$/.test(body)) {
    return color;
  }

  // 1.2 混合到黑色
  const factor = clampNumber(amount, 0, 1);
  const red = Math.round(parseInt(body.slice(0, 2), 16) * (1 - factor));
  const green = Math.round(parseInt(body.slice(2, 4), 16) * (1 - factor));
  const blue = Math.round(parseInt(body.slice(4, 6), 16) * (1 - factor));
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

export function clampNumber(value: number, min: number, max: number) {
  /*
   * ========================================================================
   * 步骤1：限制数字范围
   * ========================================================================
   * 目标：
   *   1) 防止 NaN 进入几何计算
   *   2) 把比例和透明度限制在合法范围
   */

  // 1.1 处理非法数字
  if (!Number.isFinite(value)) {
    return min;
  }

  // 1.2 返回范围内数值
  return Math.max(min, Math.min(max, value));
}

function toHex(value: number) {
  return clampNumber(value, 0, 255).toString(16).padStart(2, "0").toUpperCase();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm test -- tests/geometry.test.ts
npm run typecheck
```

Expected: PASS and no TypeScript errors.

---

### Task 2: Runtime Scene Validation

**Files:**

- Create: `src/shared/sceneValidation.ts`
- Create: `tests/sceneValidation.test.ts`
- Modify: none

- [ ] **Step 1: Write failing tests**

Create `tests/sceneValidation.test.ts` with cases for valid scene, bad page, duplicate node ids, invalid edge endpoints, illegal colors, and non-positive sizes.

Required assertions:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateScene } from "../src/shared/sceneValidation";
import type { Scene } from "../src/shared/scene";

function validScene(): Scene {
  /*
   * ========================================================================
   * 步骤1：创建合法测试场景
   * ========================================================================
   * 目标：
   *   1) 提供校验器的基线输入
   *   2) 覆盖节点和连线最小结构
   */

  // 1.1 返回合法 scene
  return {
    version: "0.1",
    page: { width: 320, height: 180, background: "#FFFFFF", units: "px" },
    metadata: { id: "scene-1", title: "Scene", createdAt: "2026-05-19T00:00:00.000Z", engine: "test", notes: [] },
    nodes: [
      { id: "a", type: "rect", x: 10, y: 10, w: 80, h: 40, style: { fill: "#FFFFFF", stroke: "#111111" } },
      { id: "b", type: "rect", x: 160, y: 10, w: 80, h: 40, style: { fill: "#FFFFFF", stroke: "#111111" } }
    ],
    edges: [
      { id: "e1", type: "arrow", from: "a:right@0.5", to: "b:left@0.5", style: { stroke: "#111111" } }
    ]
  };
}

describe("scene validation", () => {
  it("accepts a valid scene", () => {
    /*
     * ========================================================================
     * 步骤1：验证合法 scene
     * ========================================================================
     * 目标：
     *   1) 合法输入不产生错误
     *   2) 校验器返回 ok=true
     */

    // 1.1 校验合法 scene
    const result = validateScene(validScene());

    // 1.2 判断结果
    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, []);
  });

  it("rejects duplicate ids and invalid edge endpoints", () => {
    /*
     * ========================================================================
     * 步骤1：验证结构错误
     * ========================================================================
     * 目标：
     *   1) 捕获重复节点 id
     *   2) 捕获引用不存在节点的边
     */

    // 1.1 构造非法 scene
    const scene = validScene();
    scene.nodes[1].id = "a";
    scene.edges[0].to = "missing:left@0.5";

    // 1.2 校验错误码
    const result = validateScene(scene);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === "duplicate_node_id"));
    assert.ok(result.issues.some((issue) => issue.code === "missing_edge_target"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/sceneValidation.test.ts
```

Expected: FAIL because `src/shared/sceneValidation.ts` does not exist.

- [ ] **Step 3: Implement validator**

Create `src/shared/sceneValidation.ts` with these exports:

```ts
import { endpointReferencesNode, normalizeHexColor } from "./geometry";
import type { Scene, SceneEdge, SceneNode, SceneStyle } from "./scene";

export type ValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
};

export function validateScene(value: unknown): ValidationResult {
  /*
   * ========================================================================
   * 步骤1：校验 scene 根结构
   * ========================================================================
   * 目标：
   *   1) 确认导入和导出对象满足运行时协议
   *   2) 返回可读错误列表，不抛出不透明异常
   */

  // 1.1 校验根对象
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "$", code: "scene_not_object", message: "Scene must be an object." }] };
  }

  // 1.2 校验 page、metadata、nodes、edges
  validatePage(value, issues);
  const nodes = Array.isArray(value.nodes) ? value.nodes.filter(isRecord) as unknown as SceneNode[] : [];
  validateNodes(nodes, issues);
  validateEdges(Array.isArray(value.edges) ? value.edges.filter(isRecord) as unknown as SceneEdge[] : [], nodes, issues);

  return { ok: issues.length === 0, issues };
}

export function assertScene(value: unknown): Scene {
  /*
   * ========================================================================
   * 步骤1：断言 scene 合法
   * ========================================================================
   * 目标：
   *   1) 给 API 路由提供简单入口
   *   2) 把校验错误转成异常文本
   */

  // 1.1 执行校验
  const result = validateScene(value);
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => `${issue.path} ${issue.code}: ${issue.message}`).join("; "));
  }

  // 1.2 返回类型化 scene
  return value as Scene;
}
```

Implementation details:

- `validatePage` checks `page.width > 0`, `page.height > 0`, `page.units === "px"`, and color fields use `normalizeHexColor(value) === value` or `value === "none"`.
- `validateNodes` checks unique `id`, allowed node `type`, finite `x/y/w/h`, `w > 0`, `h >= 0`, and `style` object.
- `validateEdges` checks unique edge ids and `from`/`to` node ids when endpoints exist.
- `validateStyle` checks `fill`、`stroke`、`color` format, `strokeWidth >= 0`, `fontSize > 0`, and `opacity` between `0` and `1`.

- [ ] **Step 4: Run validation tests**

Run:

```powershell
npm test -- tests/sceneValidation.test.ts
npm run typecheck
```

Expected: PASS and no TypeScript errors.

---

### Task 3: Wire Validation Into Import And Export

**Files:**

- Modify: `src/App.tsx`
- Modify: `server/src/routes/api.ts`
- Modify: `tests/exportAndUpload.test.ts`

- [ ] **Step 1: Add API tests for invalid export scene**

Extend `tests/exportAndUpload.test.ts` with a pure helper test by exporting `sceneFromBody` or adding a new exported wrapper `validateSceneForExport` from `server/src/routes/api.ts`.

Expected behavior:

- missing `page` returns `undefined`;
- invalid edge endpoint returns `undefined`;
- valid scene returns typed `Scene`.

- [ ] **Step 2: Run focused test to verify it fails**

Run:

```powershell
npm test -- tests/exportAndUpload.test.ts
```

Expected: FAIL until route validation uses `assertScene` or `validateScene`.

- [ ] **Step 3: Update server export validation**

In `server/src/routes/api.ts`:

- import `validateScene` from `../../src/shared/sceneValidation` is invalid because route is under `server/src`; use `../../../src/shared/sceneValidation`;
- replace shallow `sceneFromBody` logic with `validateScene`;
- return 400 with `{ error: "Invalid scene.", issues }` for invalid input;
- keep `sanitizeFileBase` unchanged.

- [ ] **Step 4: Update front-end import validation**

In `src/App.tsx`:

- after `normalizeImportedScene(JSON.parse(content))`, call `validateScene(imported)`;
- when invalid, log issues and show `导入 scene.json 失败：协议不合法。`;
- do not mutate current scene on invalid import.

- [ ] **Step 5: Run verification**

Run:

```powershell
npm test
npm run typecheck
```

Expected: all tests pass.

---

### Task 4: Replace Duplicate Geometry In Renderers And Adapters

**Files:**

- Modify: `src/editor/Canvas.tsx`
- Modify: `src/editor/sceneOps.ts`
- Modify: `src/editor/visiomasterAdapter.ts`
- Modify: `server/src/scene/visiomasterAdapter.ts`
- Modify: `server/src/scene/svg.ts`
- Modify: `server/src/scene/pptx.ts`
- Modify: `tests/geometry.test.ts`
- Modify: `tests/exportAndUpload.test.ts`

- [ ] **Step 1: Add regression test for renderer consistency**

Add a test that resolves the same edge endpoint through the shared helper and through SVG/PPTX output. The assertion checks that SVG contains the expected first and last polyline points for `a:right@0.5` to `b:left@0.5`.

- [ ] **Step 2: Replace local `resolveEndpoint`**

Remove local `resolveEndpoint` functions from:

- `src/editor/Canvas.tsx`
- `src/editor/visiomasterAdapter.ts`
- `server/src/scene/visiomasterAdapter.ts`
- `server/src/scene/svg.ts`
- `server/src/scene/pptx.ts`

Import:

```ts
import { resolveEndpoint } from "../shared/geometry";
```

Use the correct relative path per file.

- [ ] **Step 3: Replace local `shadeColor`**

Remove local `shadeColor` functions from:

- `src/editor/Canvas.tsx`
- `server/src/scene/svg.ts`
- `server/src/scene/pptx.ts`

Import shared `shadeColor`.

- [ ] **Step 4: Replace edge ownership check**

In `src/editor/sceneOps.ts`, replace local `edgeReferencesNode` body with shared `endpointReferencesNode`.

- [ ] **Step 5: Run verification**

Run:

```powershell
npm test
npm run typecheck
```

Expected: all tests pass and no duplicate `function resolveEndpoint` remains under `src` or `server`.

Check:

```powershell
rg "function resolveEndpoint|function shadeColor" src server
```

Expected: only `src/shared/geometry.ts` contains those function names.

---

### Task 5: AI And Import Scene Repair Layer

**Files:**

- Create: `server/src/scene/repairScene.ts`
- Create: `tests/repairScene.test.ts`
- Modify: `server/src/routes/api.ts`
- Modify: `server/src/scene/visiomasterAdapter.ts`

- [ ] **Step 1: Write failing repair tests**

Create tests that assert:

- missing metadata fields are filled;
- nodes with duplicate ids are renamed deterministically;
- negative width/height are normalized to positive geometry;
- edges pointing to missing nodes are dropped;
- invalid colors are replaced with safe defaults;
- `ensureReplicaBaseLayer` still inserts source image at index `0`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/repairScene.test.ts
```

Expected: FAIL because `repairScene` does not exist.

- [ ] **Step 3: Implement `repairScene`**

Create `server/src/scene/repairScene.ts`:

```ts
import { normalizeHexColor } from "../../../src/shared/geometry";
import type { Scene, SceneEdge, SceneNode, SceneStyle } from "./types";

export function repairScene(scene: Scene): Scene {
  /*
   * ========================================================================
   * 步骤1：修复 scene 结构
   * ========================================================================
   * 目标：
   *   1) 把 AI 和导入结果收敛到内部协议
   *   2) 删除无法可靠渲染的边和节点异常字段
   */

  // 1.1 修复页面和元数据
  const next: Scene = {
    ...scene,
    page: {
      width: positive(scene.page?.width, 1280),
      height: positive(scene.page?.height, 720),
      background: safeColor(scene.page?.background, "#FFFFFF"),
      units: "px"
    },
    metadata: {
      id: scene.metadata?.id || "repaired-scene",
      title: scene.metadata?.title || "Scientific Figure",
      sourceImage: scene.metadata?.sourceImage,
      createdAt: scene.metadata?.createdAt || new Date().toISOString(),
      engine: scene.metadata?.engine || "scientific-drawing.repair",
      notes: Array.isArray(scene.metadata?.notes) ? scene.metadata.notes : []
    },
    nodes: [],
    edges: []
  };

  // 1.2 修复节点和边
  const idMap = new Map<string, string>();
  next.nodes = scene.nodes.map((node, index) => repairNode(node, index, idMap));
  next.edges = scene.edges
    .map((edge, index) => repairEdge(edge, index, idMap))
    .filter((edge): edge is SceneEdge => Boolean(edge));

  return next;
}
```

Complete helper rules:

- `repairNode` keeps allowed types only; unknown types become `rect`.
- duplicate ids get suffix `-2`, `-3`.
- `w` uses `Math.abs(w)` with minimum `1`; `h` uses `Math.abs(h)` with minimum `0`.
- style is passed through `repairStyle`.
- `repairEdge` rewrites endpoint node ids through `idMap`; drops edge if `from` or `to` targets are missing.
- `safeColor` allows `"none"` and valid hex colors; otherwise uses fallback.

- [ ] **Step 4: Wire repair into AI route**

In `server/src/routes/api.ts`, after `normalizeImportedScene(rawScene)`, call `repairScene(scene)` before metadata overwrite and `ensureReplicaBaseLayer`.

- [ ] **Step 5: Wire repair into server adapter path**

In `server/src/scene/visiomasterAdapter.ts`, return repaired scene from the public `normalizeImportedScene` flow when running on server side.

- [ ] **Step 6: Run verification**

Run:

```powershell
npm test
npm run typecheck
```

Expected: all tests pass.

---

### Task 6: File Retention And Cleanup

**Files:**

- Create: `server/src/files/retention.ts`
- Create: `tests/fileRetention.test.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/paths.ts`
- Modify: `README.md`

- [ ] **Step 1: Write failing cleanup tests**

Create temp directories with:

- one fresh file;
- one old `.png`;
- one old `.scene.json`;
- one old `.pptx`;
- one nested directory that must be ignored.

Assert old files are removed and fresh files remain.

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/fileRetention.test.ts
```

Expected: FAIL because retention module does not exist.

- [ ] **Step 3: Implement retention module**

Create `server/src/files/retention.ts` with:

- `cleanupDataFiles({ directories, maxAgeDays, now, logger })`;
- `isManagedDataFile(name)` allowing `.png`, `.jpg`, `.jpeg`, `.webp`, `.img`, `.svg`, `.pptx`, `.json`;
- no recursive delete;
- no deletion outside provided directories.

- [ ] **Step 4: Wire startup cleanup**

In `server/src/index.ts`:

- after `ensureDataDirs(logger)`, call `cleanupDataFiles`;
- read `DATA_RETENTION_DAYS`, default `14`;
- log warnings but do not block server startup.

- [ ] **Step 5: Update README**

Document:

```powershell
$env:DATA_RETENTION_DAYS = "14"
```

State that `data/uploads`、`data/exports`、`data/scenes` old files are cleaned on server start.

- [ ] **Step 6: Run verification**

Run:

```powershell
npm test
npm run typecheck
```

Expected: all tests pass.

---

### Task 7: Editor Multi-Selection And Transform Operations

**Files:**

- Modify: `src/editor/sceneOps.ts`
- Modify: `src/editor/Canvas.tsx`
- Modify: `src/App.tsx`
- Create: `tests/editorOps.test.ts`

- [ ] **Step 1: Write scene operation tests**

Create tests for:

- `moveNodes(scene, ids, dx, dy)` moves multiple unlocked nodes and their point arrays;
- locked nodes do not move;
- `resizeNode(scene, id, patch)` clamps width and height;
- `selectNodesInRect(scene, rect)` ignores locked source image by default.

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/editorOps.test.ts
```

Expected: FAIL because new operations do not exist.

- [ ] **Step 3: Add operations in `sceneOps.ts`**

Add exports:

- `moveNodes(scene, nodeIds, dx, dy)`;
- `resizeNode(scene, nodeId, nextBox)`;
- `selectNodesInRect(scene, rect)`;
- `normalizeBox(box)`.

Follow existing immutable update style.

- [ ] **Step 4: Update `App.tsx` selection state**

Change:

- keep `selectedId` for backward compatibility only where single selection is required;
- add `selectedIds: string[]`;
- Inspector uses the first selected editable node;
- Delete and duplicate operate over selected ids.

- [ ] **Step 5: Update `Canvas.tsx` box selection**

Add:

- drag on empty area with select tool creates selection rectangle;
- pointer up calls `selectNodesInRect`;
- selected nodes show selection outline;
- no visual change for locked source image.

- [ ] **Step 6: Run verification**

Run:

```powershell
npm test
npm run typecheck
```

Expected: all tests pass.

---

### Task 8: Viewport Zoom, Pan, And Reset

**Files:**

- Modify: `src/editor/Canvas.tsx`
- Modify: `src/editor/Toolbar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add viewport state**

In `App.tsx`, add:

- `viewportScale`, default `1`;
- `viewportOffset`, default `{ x: 0, y: 0 }`;
- reset action to restore both.

- [ ] **Step 2: Update Canvas coordinate conversion**

Change point conversion so scene coordinates account for:

- SVG bounding rect;
- current scale;
- current offset.

The same function must be used by node dragging, box selection, and draw-on-click.

- [ ] **Step 3: Add wheel zoom and middle/space pan**

Behavior:

- wheel with `ctrlKey` or trackpad pinch zooms around pointer;
- middle mouse drag pans;
- space + left drag pans;
- zoom clamp: `0.25` to `4`.

- [ ] **Step 4: Add toolbar reset button**

Use a lucide icon button. Tooltip text: `重置视图`.

- [ ] **Step 5: Manual browser check**

Run:

```powershell
npm run dev
```

Expected:

- app opens on `http://localhost:5173`;
- upload still works;
- node drag remains aligned after zoom;
- reset returns page to original view.

---

### Task 9: Resize Handles And Direct Edge Editing

**Files:**

- Modify: `src/editor/Canvas.tsx`
- Modify: `src/editor/Toolbar.tsx`
- Modify: `src/editor/sceneOps.ts`
- Modify: `src/App.tsx`
- Modify: `src/shared/scene.ts`
- Modify: `tests/editorOps.test.ts`

- [ ] **Step 1: Add resize tests**

Extend `tests/editorOps.test.ts`:

- resizing from east changes `w`;
- resizing from west changes `x` and `w`;
- min size is respected;
- line and arrow resize updates `points`.

- [ ] **Step 2: Add edge operation tests**

Add tests for:

- `createEdgeBetweenNodes(scene, fromNodeId, toNodeId)` creates an arrow edge;
- deleting a node removes dependent edges;
- moving a connected node changes rendered endpoint through shared `resolveEndpoint`.

- [ ] **Step 3: Implement resize handles**

In `Canvas.tsx`:

- draw 8 handles for selected non-locked shape nodes;
- draw 2 handles for line/arrow nodes;
- pointer drag calls `resizeNode`.

- [ ] **Step 4: Implement edge creation tool**

In `Toolbar.tsx`, add arrow connector tool separate from drawing raw arrow node.

In `App.tsx`:

- first click selects source node;
- second click creates edge to target node;
- Escape cancels pending edge.

- [ ] **Step 5: Run verification**

Run:

```powershell
npm test
npm run typecheck
```

Expected: all tests pass.

---

### Task 10: Split Heuristic Image Analysis

**Files:**

- Create: `server/src/scene/analysis/mask.ts`
- Create: `server/src/scene/analysis/components.ts`
- Create: `server/src/scene/analysis/elements.ts`
- Modify: `server/src/scene/analyzeImage.ts`
- Modify: `tests/exportAndUpload.test.ts`

- [ ] **Step 1: Add exported helper tests**

Add tests for:

- `buildForegroundMask` marks dark pixels against white background;
- `findComponents` returns one box for connected pixels;
- `mergeNearbyBoxes` merges close boxes and keeps distant boxes separate;
- `dedupeElements` removes near duplicates.

- [ ] **Step 2: Move mask code**

Move from `analyzeImage.ts` to `analysis/mask.ts`:

- `buildForegroundMask`;
- `buildColorMask`;
- `denoiseMask`.

Keep function behavior identical.

- [ ] **Step 3: Move component code**

Move to `analysis/components.ts`:

- `findComponents`;
- `findRawComponents`;
- `flood`;
- `mergeNearbyBoxes`;
- `boxesTouch`;
- `unionBox`;
- `scaleBox`;
- `expandBox`;
- overlap helpers.

- [ ] **Step 4: Move element code**

Move to `analysis/elements.ts`:

- text detection;
- color element detection;
- structured element detection;
- `elementFromRect`;
- `elementFromColorBox`;
- `elementFromTextBox`;
- `componentToElement`.

- [ ] **Step 5: Keep public behavior unchanged**

Run evaluation before and after refactor on existing samples:

```powershell
npm run evaluate
```

Expected: generated summary still exists at `data/evaluation/summary.json`, and sample count is unchanged.

- [ ] **Step 6: Run verification**

Run:

```powershell
npm test
npm run typecheck
```

Expected: all tests pass.

---

### Task 11: Evaluation Metrics Upgrade

**Files:**

- Modify: `server/src/evaluate.ts`
- Create: `tests/evaluateMetrics.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Add metric tests**

Create tests for pure helpers:

- `summarizeTypes(scene)` stable sort;
- `countEditableNodes(scene)`;
- `computeSceneComplexity(scene)` returns nodes, edges, lockedNodes, imageNodes, textNodes;
- `formatSummaryLine(result)` includes meanDiff and complexity fields.

- [ ] **Step 2: Export pure helpers from `evaluate.ts`**

Refactor top-level script:

- keep CLI execution behavior;
- export helpers for tests;
- avoid running evaluation when imported by tests.

Use:

```ts
const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await runEvaluation();
}
```

- [ ] **Step 3: Add structure metrics to summary**

Extend `SampleResult` with:

- `lockedNodes`;
- `imageNodes`;
- `textNodes`;
- `shapeNodes`;
- `edgeEndpointIssues`;
- `meanDiff`.

- [ ] **Step 4: Update README**

Document:

```powershell
npm run evaluate
```

Explain that the report checks visual difference and structural quality.

- [ ] **Step 5: Run verification**

Run:

```powershell
npm test
npm run typecheck
npm run evaluate
```

Expected: tests pass, typecheck passes, and evaluation summary is regenerated.

---

### Task 12: End-To-End Verification And Documentation

**Files:**

- Modify: `README.md`
- Modify: `.gitignore`

- [ ] **Step 1: Update README sections**

Update:

- quick start;
- AI reconstruction;
- editor controls;
- file retention;
- evaluation;
- current limitations.

- [ ] **Step 2: Update `.gitignore`**

Ensure generated runtime outputs stay ignored:

```gitignore
/data/uploads/
/data/exports/
/data/evaluation/
/data/scenes/
/data/*.log
```

Keep checked-in sample files only if explicitly needed.

- [ ] **Step 3: Run full verification**

Run:

```powershell
npm run typecheck
npm test
npm run build
```

Expected:

- TypeScript passes.
- All tests pass.
- Vite build succeeds.

- [ ] **Step 4: Manual smoke test**

Run:

```powershell
npm run dev
```

Verify:

- front-end loads at `http://localhost:5173`;
- upload image generates locked base layer;
- import invalid JSON fails without replacing current scene;
- add rectangle/text/arrow works;
- drag, resize, box select, zoom and reset work;
- export JSON/SVG/PPTX returns files under `/exports`;
- no console error during the flow.

---

## Execution Order

Recommended order:

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Task 10
8. Task 11
9. Task 7
10. Task 8
11. Task 9
12. Task 12

Reason:

- protocol and geometry must stabilize first;
- AI and export quality rely on protocol stability;
- file cleanup is isolated and low risk;
- analysis split should happen before adding more metrics;
- editor interaction changes are larger and should land after shared helpers are tested.

## Verification Matrix

```text
┌────────────┬────────────────────────────────────┬────────────────────┐
│ Area       │ Command                            │ Expected           │
├────────────┼────────────────────────────────────┼────────────────────┤
│ Types      │ npm run typecheck                  │ no errors          │
│ Tests      │ npm test                           │ all pass           │
│ Build      │ npm run build                      │ dist generated     │
│ Evaluation │ npm run evaluate                   │ summary generated  │
│ Dev smoke  │ npm run dev                        │ UI usable          │
└────────────┴────────────────────────────────────┴────────────────────┘
```

## Self-Review

Spec coverage:

- scene 深校验 covered by Tasks 2 and 3.
- 渲染一致性 covered by Tasks 1 and 4.
- AI 输出后处理 covered by Task 5.
- 文件治理 covered by Task 6.
- 编辑能力 covered by Tasks 7, 8, and 9.
- 普通分析拆分 covered by Task 10.
- 评估体系 covered by Task 11.
- 文档和最终验证 covered by Task 12.

No placeholder tokens are intentionally present. All planned modules have explicit file paths and verification commands.
