# Scientific Drawing ROI Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 ROI 修复当前代码里的状态冗余、重复路由、写盘前协议缺口、分析性能、AI 提供方配置、评估体系和工程治理债。

**Architecture:** 第一批只做低风险工程修正，保持行为不变并补回归测试。AI 重建先统一成 OpenAI 兼容配置层，由后端代理模型列表并保护 API Key。第二批建立固定评估集和可比较指标，再扩展 AI 链路评估。第三批做结构治理，拆提示词、路径别名、日志策略、Canvas 拆分和 CI。

**Tech Stack:** React 19, Vite 7, TypeScript, Express 5, sharp, pptxgenjs, node:test, tsx.

---

## Scope

本计划按三批执行：

1. 高价值低成本：去冗余状态、抽 reset、analyze 写盘前修复校验、sharp 并行、export 表驱动、键盘快捷键、OpenAI 兼容 API 模型发现。
2. 研究评估：固定评估集、归一化视觉指标、baseline 对比、AI 链路评估。
3. 工程治理：提示词共享、path alias、日志策略、Canvas 拆分、CI 和 Node engines。

默认每个 Task 完成后单独提交，提交消息用中文。

## File Structure

Modify:

- `src/App.tsx`
  - 删除 `selectedId` state，改为从 `selectedIds[0]` 派生。
  - 抽 `resetEditorState`，统一上传、AI 重建、导入后的状态复位。
  - 增加 `Escape`、`Delete`、`Ctrl+D` 快捷键。
  - 展示后端返回的可选 AI 模型列表，并把当前模型随重建请求提交。
- `src/editor/Canvas.tsx`
  - `selectedId` 由调用方传入派生值，Task 14 拆分时保留编排职责。
- `server/src/routes/api.ts`
  - 新增 scene 写盘前修复/校验 helper。
  - `/analyze` 和 `/reconstruct` 写盘前共用 helper。
  - `/config` 返回 OpenAI 兼容提供方配置和模型列表。
  - `/export/:kind` 表驱动替代三个重复路由。
- `server/src/scene/aiProviderConfig.ts`
  - 统一解析 OpenAI 兼容 baseUrl、modelsUrl、responsesUrl、API Key 可用性和模型列表。
- `server/src/scene/reconstructWithOpenAI.ts`
  - 从统一配置读取 Responses URL、API Key 和请求模型。
- `server/src/scene/analyzeImage.ts`
  - sharp 灰度和彩色 raw buffer 并行。
- `server/src/evaluate.ts`
  - 增加固定评估集读取、归一化指标、PSNR/SSIM、baseline 对比。
  - Task 10 增加可选 AI 链路评估。
- `server/src/scene/reconstructionPrompt.ts`
  - Task 11 改为共享 prompt 构建入口的服务端包装。
- `src/editor/reconstructionPrompt.ts`
  - Task 11 改为共享 prompt 构建入口的前端包装。
- `tsconfig.json`
  - Task 12 增加 path alias。
- `vite.config.ts`
  - Task 12 同步 alias。
- `package.json`
  - Task 15 增加 Node engines 和 CI 相关脚本。
- `README.md`
  - 更新 AI API 配置、模型发现、评估集、指标、快捷键、CI 说明。

Create:

- `tests/appState.test.ts`
  - 测 `selectedId` 派生和 reset helper 的纯函数。
- `tests/apiScenePipeline.test.ts`
  - 测 analyze/reconstruct 写盘前修复校验 helper、export 表驱动。
- `src/editor/keyboardShortcuts.ts`
  - 把键盘事件判定拆成纯函数，避免 `App.tsx` 里直接堆分支。
- `tests/keyboardShortcuts.test.ts`
  - 测键盘快捷键对应的纯动作 helper。
- `tests/aiProviderConfig.test.ts`
  - 测 OpenAI 兼容 API 地址解析、模型列表归一化和安全配置输出。
- `data/eval-suite/README.md`
  - 说明固定评估集目录和样本要求。
- `data/eval-suite/manifest.json`
  - 固定评估样本清单。
- `tests/evaluationVisualMetrics.test.ts`
  - 测 normalizedMeanDiff、PSNR、SSIM、baseline delta。
- `tests/evaluateAiMetrics.test.ts`
  - 测 AI 评估结果结构，不实际调用 OpenAI。
- `src/shared/reconstructionPrompt.ts`
  - 共享 prompt base 和两端包装共用的 schema 文本。
- `.github/workflows/ci.yml`
  - typecheck/test/build。

---

### Task 1: Remove Redundant Selection State

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/editor/Canvas.tsx`
- Create: `tests/appState.test.ts`

- [ ] **Step 1: Write failing selection helper tests**

Create `tests/appState.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectedIdFromIds } from "../src/editor/appState";

describe("app state helpers", () => {
  it("derives selectedId from the first selected id", () => {
    /*
     * ========================================================================
     * 步骤1：验证选中 id 派生
     * ========================================================================
     * 目标：
     *   1) selectedId 不再作为独立状态
     *   2) 空选择返回 null
     */

    // 1.1 校验非空选择
    assert.equal(selectedIdFromIds(["a", "b"]), "a");

    // 1.2 校验空选择
    assert.equal(selectedIdFromIds([]), null);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npm test -- tests/appState.test.ts
```

Expected: FAIL because `src/editor/appState.ts` does not exist.

- [ ] **Step 3: Create `src/editor/appState.ts`**

Add:

```ts
import { logger } from "../lib/logger";
import type { Tool } from "./Toolbar";
import type { Viewport } from "./viewport";

export type EditorTransientState = {
  selectedIds: string[];
  tool: Tool;
  viewport: Viewport;
  pendingEdgeFromId: string | null;
};

export function selectedIdFromIds(selectedIds: string[]) {
  /*
   * ========================================================================
   * 步骤1：派生单选 id
   * ========================================================================
   * 目标：
   *   1) 避免 selectedId 和 selectedIds 双状态不同步
   *   2) 保留 Inspector 和 Canvas 的单选入口
   */
  logger.info("开始派生单选 id...", { selectedCount: selectedIds.length });

  // 1.1 读取首个选中 id
  const selectedId = selectedIds[0] ?? null;

  logger.info("派生单选 id 完成", { selectedId });
  return selectedId;
}

export function resetEditorState(): EditorTransientState {
  /*
   * ========================================================================
   * 步骤1：生成编辑器复位状态
   * ========================================================================
   * 目标：
   *   1) 清空选择和语义连线中间态
   *   2) 恢复选择工具和默认视图
   */
  logger.info("开始生成编辑器复位状态...");

  // 1.1 返回统一复位状态
  const state: EditorTransientState = {
    selectedIds: [],
    tool: "select",
    viewport: { scale: 1, offset: { x: 0, y: 0 } },
    pendingEdgeFromId: null
  };

  logger.info("生成编辑器复位状态完成");
  return state;
}
```

- [ ] **Step 4: Replace `selectedId` state in `src/App.tsx`**

Change:

```ts
const [selectedId, setSelectedId] = useState<string | null>(null);
const [selectedIds, setSelectedIds] = useState<string[]>([]);
```

to:

```ts
const [selectedIds, setSelectedIds] = useState<string[]>([]);
const selectedId = selectedIdFromIds(selectedIds);
```

Import:

```ts
import { resetEditorState, selectedIdFromIds } from "./editor/appState";
```

Change `handleSelect`:

```ts
const handleSelect = (ids: string[]) => {
  setSelectedIds(ids);
};
```

Remove all `setSelectedId(...)` calls.

- [ ] **Step 5: Run verification and commit**

Run:

```powershell
npm test -- tests/appState.test.ts
npm test
npm run typecheck
```

Expected: all pass.

Commit:

```powershell
git add src/App.tsx src/editor/appState.ts tests/appState.test.ts
git commit -m "移除冗余选中状态"
```

---

### Task 2: Extract Editor Reset Flow

**Files:**

- Modify: `src/App.tsx`
- Modify: `tests/appState.test.ts`

- [ ] **Step 1: Extend reset helper tests**

Append to `tests/appState.test.ts`:

```ts
import { resetEditorState } from "../src/editor/appState";

it("returns the complete editor reset state", () => {
  /*
   * ========================================================================
   * 步骤1：验证编辑器复位状态
   * ========================================================================
   * 目标：
   *   1) 上传、AI 重建、导入后复用同一份复位逻辑
   *   2) 防止遗漏 pendingEdge 或 viewport
   */

  // 1.1 读取复位状态
  const state = resetEditorState();

  // 1.2 校验全部字段
  assert.deepEqual(state, {
    selectedIds: [],
    tool: "select",
    viewport: { scale: 1, offset: { x: 0, y: 0 } },
    pendingEdgeFromId: null
  });
});
```

- [ ] **Step 2: Run test**

Run:

```powershell
npm test -- tests/appState.test.ts
```

Expected: PASS if Task 1 added helper.

- [ ] **Step 3: Add local `applyEditorReset` in `src/App.tsx`**

Inside `App`, add:

```ts
const applyEditorReset = () => {
  /*
   * ========================================================================
   * 步骤1：复位编辑器临时状态
   * ========================================================================
   * 目标：
   *   1) 上传、AI 重建、导入后统一清理交互状态
   *   2) 防止选择、视图和连线中间态遗漏
   */
  logger.info("开始复位编辑器临时状态...");

  // 1.1 读取复位状态
  const next = resetEditorState();

  // 1.2 应用复位状态
  setSelectedIds(next.selectedIds);
  setTool(next.tool);
  setViewport(next.viewport);
  setPendingEdgeFromId(next.pendingEdgeFromId);

  logger.info("复位编辑器临时状态完成");
};
```

Replace the repeated blocks in `handleFile`、`handleReconstruct`、`handleSceneImport` with:

```ts
applyEditorReset();
```

- [ ] **Step 4: Run verification and commit**

Run:

```powershell
npm test
npm run typecheck
```

Commit:

```powershell
git add src/App.tsx tests/appState.test.ts
git commit -m "抽取编辑器复位状态"
```

---

### Task 3: Repair And Validate Scenes Before Persistence

**Files:**

- Modify: `server/src/routes/api.ts`
- Create: `tests/apiScenePipeline.test.ts`

- [ ] **Step 1: Write failing tests for persist helper**

Create `tests/apiScenePipeline.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { repairAndValidateSceneForPersistence } from "../server/src/routes/api";
import type { Scene } from "../src/shared/scene";

function invalidButRepairableScene(): Scene {
  /*
   * ========================================================================
   * 步骤1：创建可修复 scene
   * ========================================================================
   * 目标：
   *   1) 模拟 analyzeImage 或 AI 产出的异常 scene
   *   2) 覆盖非法颜色、负尺寸、悬空边
   */

  // 1.1 返回可修复 scene
  return {
    version: "0.1",
    page: { width: 300, height: 200, background: "bad", units: "px" },
    metadata: { id: "", title: "", createdAt: "", engine: "", notes: [] },
    nodes: [
      { id: "a", type: "rect", x: 10, y: 10, w: -40, h: 20, style: { fill: "bad", stroke: "#111111" } }
    ],
    edges: [
      { id: "e1", type: "arrow", from: "a:right@0.5", to: "missing:left@0.5", style: { stroke: "#111111" } }
    ]
  };
}

describe("api scene persistence pipeline", () => {
  it("repairs and validates scenes before writing them", () => {
    /*
     * ========================================================================
     * 步骤1：验证写盘前修复校验
     * ========================================================================
     * 目标：
     *   1) 修复可修复字段
     *   2) 丢弃无法可靠渲染的边
     */

    // 1.1 执行修复校验
    const result = repairAndValidateSceneForPersistence(invalidButRepairableScene(), {
      id: "scene-1",
      sourceUrl: "/uploads/a.png"
    });

    // 1.2 校验输出
    assert.equal(result.ok, true);
    assert.equal(result.scene.metadata.id, "scene-1");
    assert.equal(result.scene.metadata.sourceImage, "/uploads/a.png");
    assert.equal(result.scene.nodes[0].w, 40);
    assert.equal(result.scene.edges.length, 0);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npm test -- tests/apiScenePipeline.test.ts
```

Expected: FAIL because helper is not exported.

- [ ] **Step 3: Implement persistence helper**

In `server/src/routes/api.ts`, export:

```ts
export function repairAndValidateSceneForPersistence(scene: Scene, options: { id: string; sourceUrl: string }) {
  /*
   * ========================================================================
   * 步骤1：修复并校验待持久化 scene
   * ========================================================================
   * 目标：
   *   1) 所有写入 data/scenes 的 scene 都先经过修复层
   *   2) 阻止非法 scene 延迟到导出阶段才暴露
   */
  logger.info("开始修复并校验待持久化 scene...", { id: options.id });

  // 1.1 修复 scene 并覆盖服务端元数据
  const repaired = repairScene(scene);
  repaired.metadata.id = options.id;
  repaired.metadata.sourceImage = options.sourceUrl;
  ensureReplicaBaseLayer(repaired, options.sourceUrl);

  // 1.2 校验修复结果
  const validation = validateScene(repaired);
  if (!validation.ok) {
    logger.warn("待持久化 scene 校验失败", { issues: validation.issues });
    return { ok: false as const, issues: validation.issues };
  }

  logger.info("修复并校验待持久化 scene 完成", { nodes: repaired.nodes.length });
  return { ok: true as const, scene: repaired, issues: [] as ValidationIssue[] };
}
```

- [ ] **Step 4: Use helper in `/analyze` and `/reconstruct`**

In `/analyze`, replace:

```ts
const scene = await analyzeImage(...);
await fs.writeFile(scenePath, JSON.stringify(scene, null, 2), "utf-8");
```

with:

```ts
const rawScene = await analyzeImage(...);
const validation = repairAndValidateSceneForPersistence(rawScene, { id, sourceUrl });
if (!validation.ok) {
  res.status(500).json({ error: "Generated scene is invalid.", issues: validation.issues });
  return;
}
const scene = validation.scene;
await fs.writeFile(scenePath, JSON.stringify(scene, null, 2), "utf-8");
```

In `/reconstruct`, replace direct `repairScene(normalizeImportedScene(rawScene))` and metadata mutation with helper. Keep `scene.metadata.notes = [...scene.metadata.notes, ...]` after helper.

- [ ] **Step 5: Run verification and commit**

Run:

```powershell
npm test -- tests/apiScenePipeline.test.ts
npm test
npm run typecheck
```

Commit:

```powershell
git add server/src/routes/api.ts tests/apiScenePipeline.test.ts
git commit -m "统一场景写盘前修复校验"
```

---

### Task 4: Parallelize Sharp Analysis Buffers

**Files:**

- Modify: `server/src/scene/analyzeImage.ts`

- [ ] **Step 1: Edit buffer extraction**

Replace:

```ts
const buffer = await resized
  .clone()
  .grayscale()
  .raw()
  .toBuffer();

const colorBuffer = await resized
  .clone()
  .toColourspace("srgb")
  .removeAlpha()
  .raw()
  .toBuffer();
```

with:

```ts
const [buffer, colorBuffer] = await Promise.all([
  resized
    .clone()
    .grayscale()
    .raw()
    .toBuffer(),
  resized
    .clone()
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer()
]);
```

- [ ] **Step 2: Run evaluation and tests**

Run:

```powershell
npm test
npm run typecheck
npm run evaluate
```

Expected: all pass, evaluation still generates `data/evaluation/summary.json`.

- [ ] **Step 3: Commit**

```powershell
git add server/src/scene/analyzeImage.ts
git commit -m "并行生成图片分析像素缓冲"
```

---

### Task 5: Table-Drive Export Routes

**Files:**

- Modify: `server/src/routes/api.ts`
- Modify: `tests/exportAndUpload.test.ts`

- [ ] **Step 1: Add route kind test**

Extend `tests/exportAndUpload.test.ts`:

```ts
import { exportKindConfig } from "../server/src/routes/api";

it("defines all supported export kinds in one table", () => {
  /*
   * ========================================================================
   * 步骤1：验证导出类型配置
   * ========================================================================
   * 目标：
   *   1) svg/pptx/json 由同一张表驱动
   *   2) 文件后缀稳定
   */

  // 1.1 校验导出配置
  assert.deepEqual(Object.keys(exportKindConfig).sort(), ["json", "pptx", "svg"]);

  // 1.2 校验后缀
  assert.equal(exportKindConfig.svg.ext, "svg");
  assert.equal(exportKindConfig.pptx.ext, "pptx");
  assert.equal(exportKindConfig.json.ext, "scene.json");
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npm test -- tests/exportAndUpload.test.ts
```

Expected: FAIL because `exportKindConfig` does not exist.

- [ ] **Step 3: Implement `exportKindConfig` and single route**

In `server/src/routes/api.ts`, add:

```ts
type ExportKind = "svg" | "pptx" | "json";

export const exportKindConfig: Record<ExportKind, {
  ext: string;
  write: (scene: Scene, outputPath: string) => Promise<void>;
}> = {
  svg: {
    ext: "svg",
    write: async (scene, outputPath) => {
      const svg = await sceneToSvg(scene);
      await fs.writeFile(outputPath, svg, "utf-8");
    }
  },
  pptx: {
    ext: "pptx",
    write: sceneToPptx
  },
  json: {
    ext: "scene.json",
    write: async (scene, outputPath) => {
      await fs.writeFile(outputPath, JSON.stringify(scene, null, 2), "utf-8");
    }
  }
};
```

Replace three `/export/svg|pptx|json` routes with:

```ts
apiRouter.post("/export/:kind", express.json({ limit: "20mb" }), async (req, res, next) => {
  /*
   * ========================================================================
   * 步骤1：导出 scene
   * ========================================================================
   * 目标：
   *   1) 按 kind 选择导出器
   *   2) 共用 scene 校验、文件命名和响应逻辑
   */
  logger.info("开始导出 scene...", { kind: req.params.kind });

  try {
    // 1.1 校验导出类型
    const kind = req.params.kind as ExportKind;
    const config = exportKindConfig[kind];
    if (!config) {
      res.status(404).json({ error: "Unsupported export kind." });
      return;
    }

    // 1.2 校验 scene
    const validation = validateSceneForExport(req.body?.scene);
    if (!validation.ok) {
      res.status(400).json({ error: "Invalid scene.", issues: validation.issues });
      return;
    }
    const scene = validation.scene;

    // 1.3 写入导出文件
    const fileName = `${sanitizeFileBase(scene.metadata?.id || randomUUID())}.${config.ext}`;
    const outputPath = path.join(exportDir, fileName);
    await config.write(scene, outputPath);

    logger.info("导出 scene 完成", { kind, outputPath });
    res.json({ url: `/exports/${fileName}` });
  } catch (error) {
    logger.error("导出 scene 失败", { error: String(error), kind: req.params.kind });
    next(error);
  }
});
```

- [ ] **Step 4: Run verification and commit**

Run:

```powershell
npm test
npm run typecheck
```

Commit:

```powershell
git add server/src/routes/api.ts tests/exportAndUpload.test.ts
git commit -m "合并导出路由"
```

---

### Task 6: Add Low-Cost Keyboard Shortcuts

**Files:**

- Create: `src/editor/keyboardShortcuts.ts`
- Create: `tests/keyboardShortcuts.test.ts`
- Modify: `src/App.tsx`
- Modify: `README.md`

- [ ] **Step 1: Write keyboard shortcut tests**

Create `tests/keyboardShortcuts.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getEditorShortcutAction } from "../src/editor/keyboardShortcuts";

describe("editor keyboard shortcuts", () => {
  it("maps delete, duplicate, and cancel shortcuts", () => {
    /*
     * ========================================================================
     * 步骤1：验证编辑器快捷键映射
     * ========================================================================
     * 目标：
     *   1) Delete 和 Backspace 删除选中对象
     *   2) Ctrl+D 或 Meta+D 复制选中对象
     *   3) Escape 取消当前连线或工具中间态
     */

    // 1.1 校验删除快捷键
    assert.equal(getEditorShortcutAction({ key: "Delete" }), "delete");
    assert.equal(getEditorShortcutAction({ key: "Backspace" }), "delete");

    // 1.2 校验复制快捷键
    assert.equal(getEditorShortcutAction({ key: "d", ctrlKey: true }), "duplicate");
    assert.equal(getEditorShortcutAction({ key: "D", metaKey: true }), "duplicate");

    // 1.3 校验取消快捷键
    assert.equal(getEditorShortcutAction({ key: "Escape" }), "cancel");
  });

  it("ignores shortcuts from editable fields", () => {
    /*
     * ========================================================================
     * 步骤1：验证输入控件保护
     * ========================================================================
     * 目标：
     *   1) 文本输入时不触发画布快捷键
     *   2) 避免删除文字时误删节点
     */

    // 1.1 校验输入控件事件被忽略
    assert.equal(getEditorShortcutAction({ key: "Backspace", editable: true }), null);
    assert.equal(getEditorShortcutAction({ key: "d", ctrlKey: true, editable: true }), null);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npm test -- tests/keyboardShortcuts.test.ts
```

Expected: FAIL because `src/editor/keyboardShortcuts.ts` does not exist.

- [ ] **Step 3: Create keyboard shortcut helper**

Create `src/editor/keyboardShortcuts.ts`:

```ts
import { logger } from "../lib/logger";

export type EditorShortcutAction = "delete" | "duplicate" | "cancel";

export type EditorShortcutInput = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  editable?: boolean;
};

export function isEditableKeyboardTarget(target: EventTarget | null) {
  /*
   * ========================================================================
   * 步骤1：判断键盘事件来源
   * ========================================================================
   * 目标：
   *   1) 保护 input 和 textarea 的原生编辑行为
   *   2) 保护 contenteditable 区域
   */
  logger.info("开始判断键盘事件来源...");

  // 1.1 处理空目标
  if (!(target instanceof HTMLElement)) {
    logger.info("判断键盘事件来源完成", { editable: false });
    return false;
  }

  // 1.2 判断可编辑元素
  const editable =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable;

  logger.info("判断键盘事件来源完成", { editable });
  return editable;
}

export function getEditorShortcutAction(input: EditorShortcutInput): EditorShortcutAction | null {
  /*
   * ========================================================================
   * 步骤1：映射编辑器快捷键
   * ========================================================================
   * 目标：
   *   1) 把 DOM 键盘事件转换为编辑器动作
   *   2) 让 App 只负责调度动作
   */
  logger.info("开始映射编辑器快捷键...", { key: input.key });

  // 1.1 忽略输入控件内事件
  if (input.editable) {
    logger.info("映射编辑器快捷键完成", { action: null });
    return null;
  }

  // 1.2 映射删除动作
  if (input.key === "Delete" || input.key === "Backspace") {
    logger.info("映射编辑器快捷键完成", { action: "delete" });
    return "delete";
  }

  // 1.3 映射复制动作
  if ((input.ctrlKey || input.metaKey) && input.key.toLowerCase() === "d") {
    logger.info("映射编辑器快捷键完成", { action: "duplicate" });
    return "duplicate";
  }

  // 1.4 映射取消动作
  if (input.key === "Escape") {
    logger.info("映射编辑器快捷键完成", { action: "cancel" });
    return "cancel";
  }

  logger.info("映射编辑器快捷键完成", { action: null });
  return null;
}
```

- [ ] **Step 4: Add keyboard behavior**

In `src/App.tsx`, add a `useEffect` after action handlers are defined:

```ts
useEffect(() => {
  /*
   * ========================================================================
   * 步骤1：绑定编辑器快捷键
   * ========================================================================
   * 目标：
   *   1) Delete 删除选中对象
   *   2) Ctrl+D 复制选中对象
   *   3) Escape 取消语义连线中间态并回到选择工具
   */
  logger.info("开始绑定编辑器快捷键...");

  // 1.1 处理键盘事件
  const handleKeyDown = (event: KeyboardEvent) => {
    const action = getEditorShortcutAction({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      editable: isEditableKeyboardTarget(event.target)
    });
    if (!action) {
      return;
    }
    event.preventDefault();
    if (action === "delete") {
      handleDelete();
    }
    if (action === "duplicate") {
      handleDuplicate();
    }
    if (action === "cancel") {
      setPendingEdgeFromId(null);
      setTool("select");
      setMessage("已取消当前操作。");
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  logger.info("绑定编辑器快捷键完成");
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [selectedIds, scene, pendingEdgeFromId]);
```

- [ ] **Step 5: Update README controls table**

Add rows:

```text
│ 删除       │ Delete / Backspace          │
│ 复制       │ Ctrl+D                      │
│ 取消       │ Escape                      │
```

- [ ] **Step 6: Run verification and commit**

Run:

```powershell
npm test -- tests/keyboardShortcuts.test.ts
npm test
npm run typecheck
npm run build
```

Commit:

```powershell
git add src/App.tsx src/editor/keyboardShortcuts.ts tests/keyboardShortcuts.test.ts README.md
git commit -m "添加编辑器快捷键"
```

---

### Task 7: Add OpenAI-Compatible Model Discovery

**Files:**

- Create: `server/src/scene/aiProviderConfig.ts`
- Create: `tests/aiProviderConfig.test.ts`
- Modify: `server/src/scene/reconstructWithOpenAI.ts`
- Modify: `server/src/routes/api.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/App.tsx`
- Modify: `src/editor/Toolbar.tsx`
- Modify: `README.md`

- [ ] **Step 1: Write provider config tests**

Create `tests/aiProviderConfig.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSafeAiProviderConfig,
  normalizeModelListPayload,
  resolveOpenAiCompatibleUrls
} from "../server/src/scene/aiProviderConfig";

describe("OpenAI-compatible AI provider config", () => {
  it("resolves base, responses, and models URLs", () => {
    /*
     * ========================================================================
     * 步骤1：验证 OpenAI 兼容地址解析
     * ========================================================================
     * 目标：
     *   1) baseUrl 允许写根地址或 /v1 地址
     *   2) responses 和 models 路径保持稳定
     */

    // 1.1 校验根地址
    assert.deepEqual(resolveOpenAiCompatibleUrls("https://gateway.example.com"), {
      apiRoot: "https://gateway.example.com/v1",
      responsesUrl: "https://gateway.example.com/v1/responses",
      modelsUrl: "https://gateway.example.com/v1/models"
    });

    // 1.2 校验 /v1 地址
    assert.deepEqual(resolveOpenAiCompatibleUrls("https://gateway.example.com/v1/"), {
      apiRoot: "https://gateway.example.com/v1",
      responsesUrl: "https://gateway.example.com/v1/responses",
      modelsUrl: "https://gateway.example.com/v1/models"
    });
  });

  it("normalizes /v1/models payloads", () => {
    /*
     * ========================================================================
     * 步骤1：验证模型列表归一化
     * ========================================================================
     * 目标：
     *   1) 兼容 OpenAI 标准 data 数组
     *   2) 丢弃没有 id 的异常项
     */

    // 1.1 归一化模型列表
    const models = normalizeModelListPayload({
      data: [
        { id: "gpt-4o" },
        { id: "gpt-4o-mini" },
        { name: "bad" }
      ]
    });

    // 1.2 校验模型名称
    assert.deepEqual(models, ["gpt-4o", "gpt-4o-mini"]);
  });

  it("returns safe config without exposing api key", () => {
    /*
     * ========================================================================
     * 步骤1：验证前端安全配置
     * ========================================================================
     * 目标：
     *   1) 前端只知道能力、baseUrl 和模型名
     *   2) API Key 不进入响应体
     */

    // 1.1 构建安全配置
    const config = buildSafeAiProviderConfig({
      apiKey: "secret",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o",
      models: ["gpt-4o", "gpt-4o-mini"]
    });

    // 1.2 校验安全字段
    assert.equal(config.aiReconstructionAvailable, true);
    assert.equal(config.reconstructModel, "gpt-4o");
    assert.deepEqual(config.reconstructModels, ["gpt-4o", "gpt-4o-mini"]);
    assert.equal(Object.hasOwn(config, "apiKey"), false);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npm test -- tests/aiProviderConfig.test.ts
```

Expected: FAIL because `server/src/scene/aiProviderConfig.ts` does not exist.

- [ ] **Step 3: Create AI provider config module**

Create `server/src/scene/aiProviderConfig.ts`:

```ts
import { logger } from "../logger";

export type SafeAiProviderConfig = {
  aiReconstructionAvailable: boolean;
  provider: "openai-compatible";
  baseUrl: string;
  reconstructModel: string;
  reconstructModels: string[];
  modelListAvailable: boolean;
  modelListError: string | null;
};

export type AiRuntimeConfig = {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
};

export function resolveOpenAiCompatibleUrls(baseUrl = "https://api.openai.com/v1") {
  /*
   * ========================================================================
   * 步骤1：解析 OpenAI 兼容接口地址
   * ========================================================================
   * 目标：
   *   1) 允许用户配置网关根地址
   *   2) 统一生成 responses 和 models 地址
   */
  logger.info("开始解析 OpenAI 兼容接口地址...", { baseUrl });

  // 1.1 清理尾部斜杠
  const trimmed = baseUrl.replace(/\/+$/, "");

  // 1.2 补齐 /v1
  const apiRoot = trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;

  // 1.3 生成端点地址
  const urls = {
    apiRoot,
    responsesUrl: `${apiRoot}/responses`,
    modelsUrl: `${apiRoot}/models`
  };

  logger.info("解析 OpenAI 兼容接口地址完成", urls);
  return urls;
}

export function readAiRuntimeConfig(env: NodeJS.ProcessEnv = process.env): AiRuntimeConfig {
  /*
   * ========================================================================
   * 步骤1：读取 AI 运行配置
   * ========================================================================
   * 目标：
   *   1) 从环境变量读取 API Key、baseUrl 和默认模型
   *   2) 给重建接口和配置接口共用
   */
  logger.info("开始读取 AI 运行配置...");

  // 1.1 读取环境变量
  const config = {
    apiKey: env.OPENAI_API_KEY ?? "",
    baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    defaultModel: env.OPENAI_RECONSTRUCT_MODEL ?? "gpt-4o"
  };

  logger.info("读取 AI 运行配置完成", {
    hasApiKey: Boolean(config.apiKey),
    baseUrl: config.baseUrl,
    defaultModel: config.defaultModel
  });
  return config;
}

export function normalizeModelListPayload(payload: unknown) {
  /*
   * ========================================================================
   * 步骤1：归一化模型列表
   * ========================================================================
   * 目标：
   *   1) 读取 OpenAI 兼容 /v1/models 响应
   *   2) 输出前端可直接展示的模型 id 数组
   */
  logger.info("开始归一化模型列表...");

  // 1.1 读取 data 数组
  const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];

  // 1.2 提取模型 id
  const models = data
    .map((item) => (isRecord(item) && typeof item.id === "string" ? item.id : ""))
    .filter((id) => id.length > 0)
    .sort((left, right) => left.localeCompare(right));

  logger.info("归一化模型列表完成", { count: models.length });
  return models;
}

export async function fetchOpenAiCompatibleModels(config = readAiRuntimeConfig()) {
  /*
   * ========================================================================
   * 步骤1：获取 OpenAI 兼容模型列表
   * ========================================================================
   * 目标：
   *   1) 从后端代理调用 /v1/models
   *   2) 不向前端暴露 API Key
   */
  logger.info("开始获取 OpenAI 兼容模型列表...");

  // 1.1 缺少 API Key 时返回空列表
  if (!config.apiKey) {
    logger.warn("获取模型列表失败，缺少 API Key");
    return { models: [] as string[], error: "OPENAI_API_KEY is not set." };
  }

  // 1.2 请求模型列表
  const { modelsUrl } = resolveOpenAiCompatibleUrls(config.baseUrl);
  const response = await fetch(modelsUrl, {
    headers: {
      "Authorization": `Bearer ${config.apiKey}`
    }
  });

  // 1.3 解析响应
  const payload = await response.json() as unknown;
  if (!response.ok) {
    const error = JSON.stringify(payload);
    logger.warn("获取模型列表失败", { error });
    return { models: [] as string[], error };
  }

  const models = normalizeModelListPayload(payload);
  logger.info("获取 OpenAI 兼容模型列表完成", { count: models.length });
  return { models, error: null };
}

export function buildSafeAiProviderConfig(input: {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  modelListError?: string | null;
}): SafeAiProviderConfig {
  /*
   * ========================================================================
   * 步骤1：构建前端安全 AI 配置
   * ========================================================================
   * 目标：
   *   1) 返回模型选择所需信息
   *   2) 禁止返回 API Key
   */
  logger.info("开始构建前端安全 AI 配置...");

  // 1.1 合并默认模型和远程模型
  const reconstructModels = [...new Set([input.defaultModel, ...input.models].filter(Boolean))];

  // 1.2 返回安全配置
  const config: SafeAiProviderConfig = {
    aiReconstructionAvailable: Boolean(input.apiKey),
    provider: "openai-compatible",
    baseUrl: input.baseUrl,
    reconstructModel: input.defaultModel,
    reconstructModels,
    modelListAvailable: input.models.length > 0,
    modelListError: input.modelListError ?? null
  };

  logger.info("构建前端安全 AI 配置完成", {
    aiReconstructionAvailable: config.aiReconstructionAvailable,
    modelCount: config.reconstructModels.length
  });
  return config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Use selected model in reconstruction request**

In `server/src/scene/reconstructWithOpenAI.ts`, update input type:

```ts
type ReconstructInput = {
  imagePath: string;
  mimeType: string;
  mode: ReconstructionMode;
  model?: string;
};
```

Import:

```ts
import { readAiRuntimeConfig, resolveOpenAiCompatibleUrls } from "./aiProviderConfig";
```

Replace API Key and URL reads:

```ts
const runtimeConfig = readAiRuntimeConfig();
if (!runtimeConfig.apiKey) {
  throw new Error("OPENAI_API_KEY is not set.");
}
const { responsesUrl } = resolveOpenAiCompatibleUrls(runtimeConfig.baseUrl);
const model = input.model || runtimeConfig.defaultModel;
```

Replace request header and body model:

```ts
"Authorization": `Bearer ${runtimeConfig.apiKey}`,
```

```ts
model,
```

Remove local `resolveResponsesUrl()`.

- [ ] **Step 5: Return model list from `/api/config`**

In `server/src/routes/api.ts`, import:

```ts
import { buildSafeAiProviderConfig, fetchOpenAiCompatibleModels, readAiRuntimeConfig } from "../scene/aiProviderConfig";
```

Change `/config` to async:

```ts
apiRouter.get("/config", async (_req, res) => {
  /*
   * ========================================================================
   * 步骤1：返回前端运行配置
   * ========================================================================
   * 目标：
   *   1) 暴露 AI 重建是否可用
   *   2) 返回 OpenAI 兼容模型列表
   */
  logger.info("开始返回前端运行配置...");

  // 1.1 读取服务端 AI 配置
  const runtimeConfig = readAiRuntimeConfig();

  // 1.2 获取模型列表
  const modelList = await fetchOpenAiCompatibleModels(runtimeConfig);

  // 1.3 返回安全配置
  const config = buildSafeAiProviderConfig({
    apiKey: runtimeConfig.apiKey,
    baseUrl: runtimeConfig.baseUrl,
    defaultModel: runtimeConfig.defaultModel,
    models: modelList.models,
    modelListError: modelList.error
  });
  logger.info("返回前端运行配置完成", {
    aiReconstructionAvailable: config.aiReconstructionAvailable,
    modelCount: config.reconstructModels.length
  });
  res.json(config);
});
```

In `/reconstruct`, read selected model:

```ts
const model = reconstructModelValue(req.body?.model);
```

Pass it:

```ts
const rawScene = await reconstructWithOpenAI({
  imagePath,
  mimeType: req.file.mimetype,
  mode,
  model
});
```

Add helper:

```ts
function reconstructModelValue(value: unknown) {
  /*
   * ========================================================================
   * 步骤1：读取重建模型名
   * ========================================================================
   * 目标：
   *   1) 允许前端从模型列表选择模型
   *   2) 限制异常输入长度和类型
   */
  logger.info("开始读取重建模型名...", { value });

  // 1.1 校验模型名
  const model = typeof value === "string" && value.trim().length > 0 && value.length <= 120
    ? value.trim()
    : undefined;

  logger.info("读取重建模型名完成", { model });
  return model;
}
```

- [ ] **Step 6: Send model from frontend API client**

In `src/lib/api.ts`, update types:

```ts
export type AppConfig = {
  aiReconstructionAvailable: boolean;
  provider: "openai-compatible";
  baseUrl: string;
  reconstructModel: string;
  reconstructModels: string[];
  modelListAvailable: boolean;
  modelListError: string | null;
};
```

Change function signature:

```ts
export async function reconstructImage(file: File, mode: ReconstructionMode, model: string): Promise<AnalyzeResponse>
```

Add form field:

```ts
form.append("model", model);
```

- [ ] **Step 7: Add model selector to App and Toolbar**

In `src/App.tsx`, add state:

```ts
const [reconstructionModel, setReconstructionModel] = useState("");
const [reconstructionModels, setReconstructionModels] = useState<string[]>([]);
```

In config load success:

```ts
setReconstructionModel(config.reconstructModel);
setReconstructionModels(config.reconstructModels);
if (config.modelListError) {
  logger.warn("读取模型列表失败", { error: config.modelListError });
}
```

Change reconstruct call:

```ts
const payload = await reconstructImage(file, reconstructionMode, reconstructionModel);
```

Pass props to `Toolbar`:

```tsx
reconstructionModel={reconstructionModel}
reconstructionModels={reconstructionModels}
onModelChange={setReconstructionModel}
```

In `src/editor/Toolbar.tsx`, extend props:

```ts
reconstructionModel: string;
reconstructionModels: string[];
onModelChange: (model: string) => void;
```

Render a compact selector near mode buttons:

```tsx
<select
  className="model-select"
  title="AI模型"
  value={reconstructionModel}
  onChange={(event) => onModelChange(event.target.value)}
  disabled={busy || !aiReconstructionAvailable}
>
  {reconstructionModels.map((model) => (
    <option key={model} value={model}>{model}</option>
  ))}
</select>
```

Add CSS only if existing styles need it:

```css
.model-select {
  width: 112px;
  min-height: 32px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  font-size: 12px;
}
```

- [ ] **Step 8: Update README AI config section**

Update env docs:

```text
OPENAI_API_KEY             必填。OpenAI 或兼容网关的 API Key。
OPENAI_BASE_URL            可选。默认 https://api.openai.com/v1，兼容网关可填根地址或 /v1 地址。
OPENAI_RECONSTRUCT_MODEL   可选。默认 gpt-4o，也是模型列表获取失败时的兜底模型。
```

Add API note:

```text
GET /api/config 会由后端携带 API Key 请求 /v1/models，只把模型 id 列表返回给前端。
前端不会接触 OPENAI_API_KEY。
```

- [ ] **Step 9: Run verification and commit**

Run:

```powershell
npm test -- tests/aiProviderConfig.test.ts
npm test
npm run typecheck
npm run build
```

Commit:

```powershell
git add server/src/scene/aiProviderConfig.ts tests/aiProviderConfig.test.ts server/src/scene/reconstructWithOpenAI.ts server/src/routes/api.ts src/lib/api.ts src/App.tsx src/editor/Toolbar.tsx src/styles.css README.md
git commit -m "支持 OpenAI 兼容模型发现"
```

---

### Task 8: Create Fixed Evaluation Suite

**Files:**

- Create: `data/eval-suite/README.md`
- Create: `data/eval-suite/manifest.json`
- Modify: `server/src/evaluate.ts`
- Modify: `README.md`

- [ ] **Step 1: Add eval suite manifest**

Create `data/eval-suite/manifest.json`:

```json
{
  "version": 1,
  "samples": []
}
```

Create `data/eval-suite/README.md`:

```markdown
# Evaluation Suite

Put stable evaluation images in this directory and register them in `manifest.json`.

Each sample should include:

- `file`: image file name under this directory.
- `category`: one of `paper_figure`, `flowchart`, `table`, `module`.
- `expectedNodes`: expected approximate editable node count.
- `expectedEdges`: expected approximate semantic edge count.

Runtime uploads under `data/uploads` are not a stable benchmark.
```

- [ ] **Step 2: Update evaluator to prefer manifest**

In `server/src/evaluate.ts`, add `listEvaluationSamples(rootDir)` that:

1. Reads `data/eval-suite/manifest.json`.
2. If `samples.length > 0`, returns those files.
3. Otherwise falls back to `data/uploads`.

- [ ] **Step 3: Run verification and commit**

Run:

```powershell
npm test
npm run typecheck
npm run evaluate
```

Commit:

```powershell
git add data/eval-suite/README.md data/eval-suite/manifest.json server/src/evaluate.ts README.md
git commit -m "添加固定评估集入口"
```

---

### Task 9: Add Normalized Visual Metrics

**Files:**

- Modify: `server/src/evaluate.ts`
- Create: `tests/evaluationVisualMetrics.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write metric tests**

Create `tests/evaluationVisualMetrics.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computePsnr, computeSsimApprox, normalizeMeanDiff } from "../server/src/evaluate";

describe("visual evaluation metrics", () => {
  it("normalizes meanDiff to 0..1", () => {
    /*
     * ========================================================================
     * 步骤1：验证 meanDiff 归一化
     * ========================================================================
     * 目标：
     *   1) 让不同尺寸样本更容易横向比较
     *   2) 保留原始 meanDiff
     */

    // 1.1 校验归一化
    assert.equal(normalizeMeanDiff(0), 0);
    assert.equal(normalizeMeanDiff(255), 1);
  });

  it("computes PSNR and approximate SSIM", () => {
    /*
     * ========================================================================
     * 步骤1：验证视觉指标
     * ========================================================================
     * 目标：
     *   1) PSNR 可衡量像素级误差
     *   2) SSIM 近似值落在合法范围
     */

    // 1.1 校验 PSNR
    assert.equal(computePsnr(0), Infinity);
    assert.ok(computePsnr(100) > 20);

    // 1.2 校验 SSIM 近似范围
    const ssim = computeSsimApprox(Buffer.from([0, 10, 20]), Buffer.from([0, 10, 25]));
    assert.ok(ssim <= 1);
    assert.ok(ssim >= -1);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npm test -- tests/evaluationVisualMetrics.test.ts
```

Expected: FAIL because functions do not exist.

- [ ] **Step 3: Implement metrics**

In `server/src/evaluate.ts`, add:

```ts
export function normalizeMeanDiff(meanDiff: number | null) {
  if (meanDiff === null) {
    return null;
  }
  return Math.round((meanDiff / 255) * 10000) / 10000;
}

export function computePsnr(mse: number) {
  if (mse === 0) {
    return Infinity;
  }
  return Math.round(10 * Math.log10((255 * 255) / mse) * 100) / 100;
}

export function computeSsimApprox(source: Buffer, rendered: Buffer) {
  const length = Math.min(source.length, rendered.length);
  if (length === 0) {
    return 0;
  }
  let meanX = 0;
  let meanY = 0;
  for (let index = 0; index < length; index += 1) {
    meanX += source[index];
    meanY += rendered[index];
  }
  meanX /= length;
  meanY /= length;
  let varianceX = 0;
  let varianceY = 0;
  let covariance = 0;
  for (let index = 0; index < length; index += 1) {
    const dx = source[index] - meanX;
    const dy = rendered[index] - meanY;
    varianceX += dx * dx;
    varianceY += dy * dy;
    covariance += dx * dy;
  }
  varianceX /= length;
  varianceY /= length;
  covariance /= length;
  const c1 = 6.5025;
  const c2 = 58.5225;
  const value = ((2 * meanX * meanY + c1) * (2 * covariance + c2)) / ((meanX * meanX + meanY * meanY + c1) * (varianceX + varianceY + c2));
  return Math.round(value * 10000) / 10000;
}
```

- [ ] **Step 4: Add fields to `SampleResult`**

Add:

```ts
normalizedMeanDiff: number | null;
psnr: number | null;
ssim: number | null;
```

Update `measureMeanDiff` or create `measureVisualMetrics` to return raw meanDiff, MSE, PSNR, SSIM.

- [ ] **Step 5: Run verification and commit**

Run:

```powershell
npm test
npm run typecheck
npm run evaluate
```

Commit:

```powershell
git add server/src/evaluate.ts tests/evaluationVisualMetrics.test.ts README.md
git commit -m "增加归一化视觉评估指标"
```

---

### Task 10: Add Evaluation Baseline Comparison

**Files:**

- Modify: `server/src/evaluate.ts`
- Modify: `README.md`

- [ ] **Step 1: Add baseline loading**

In `server/src/evaluate.ts`, read optional `data/eval-suite/baseline.json`.

Expected structure:

```json
{
  "version": 1,
  "results": [
    { "file": "sample.png", "normalizedMeanDiff": 0.1, "ssim": 0.92 }
  ]
}
```

Add `deltaFromBaseline(result, baseline)` returning:

```ts
{
  normalizedMeanDiffDelta: number | null,
  ssimDelta: number | null
}
```

- [ ] **Step 2: Add tests to `tests/evaluationVisualMetrics.test.ts`**

Append:

```ts
import { deltaFromBaseline } from "../server/src/evaluate";

it("computes baseline deltas by file name", () => {
  /*
   * ========================================================================
   * 步骤1：验证基线差异
   * ========================================================================
   * 目标：
   *   1) 按文件名匹配历史指标
   *   2) 输出当前指标相对基线的变化
   */

  // 1.1 计算 delta
  const delta = deltaFromBaseline(
    { file: "a.png", normalizedMeanDiff: 0.12, ssim: 0.9 },
    [{ file: "a.png", normalizedMeanDiff: 0.1, ssim: 0.92 }]
  );

  // 1.2 校验 delta
  assert.deepEqual(delta, {
    normalizedMeanDiffDelta: 0.02,
    ssimDelta: -0.02
  });
});
```

- [ ] **Step 3: Run verification and commit**

Run:

```powershell
npm test
npm run typecheck
```

Commit:

```powershell
git add server/src/evaluate.ts tests/evaluationVisualMetrics.test.ts README.md
git commit -m "添加评估基线对比"
```

---

### Task 11: Add Optional AI Evaluation Path

**Files:**

- Modify: `server/src/evaluate.ts`
- Create: `tests/evaluateAiMetrics.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Define AI result shape tests**

Create `tests/evaluateAiMetrics.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createEvaluationModeResult } from "../server/src/evaluate";

describe("AI evaluation metrics", () => {
  it("records mode, latency, estimated cost field, and failure state", () => {
    /*
     * ========================================================================
     * 步骤1：验证 AI 评估结果结构
     * ========================================================================
     * 目标：
     *   1) AI 链路指标不依赖真实 OpenAI 调用
     *   2) 失败率和耗时可记录
     */

    // 1.1 创建失败结果
    const result = createEvaluationModeResult({
      mode: "ai",
      file: "a.png",
      startedAt: 100,
      endedAt: 350,
      error: "missing key"
    });

    // 1.2 校验结构
    assert.equal(result.mode, "ai");
    assert.equal(result.latencyMs, 250);
    assert.equal(result.success, false);
    assert.equal(result.error, "missing key");
  });
});
```

- [ ] **Step 2: Implement mode result helper**

In `server/src/evaluate.ts`, add:

```ts
export type EvaluationMode = "heuristic" | "ai";

export function createEvaluationModeResult(input: {
  mode: EvaluationMode;
  file: string;
  startedAt: number;
  endedAt: number;
  error?: string;
}) {
  return {
    mode: input.mode,
    file: input.file,
    latencyMs: input.endedAt - input.startedAt,
    success: !input.error,
    error: input.error,
    estimatedCostUsd: null
  };
}
```

- [ ] **Step 3: Add optional CLI flag**

Use environment variable instead of CLI parser:

```powershell
$env:EVALUATE_AI = "1"
npm run evaluate
```

When `EVALUATE_AI !== "1"` keep current behavior. When enabled and `OPENAI_API_KEY` missing, record AI failure entries without throwing.

- [ ] **Step 4: Run verification and commit**

Run:

```powershell
npm test
npm run typecheck
```

Commit:

```powershell
git add server/src/evaluate.ts tests/evaluateAiMetrics.test.ts README.md
git commit -m "添加可选 AI 评估链路"
```

---

### Task 12: Share Reconstruction Prompt Base

**Files:**

- Create: `src/shared/reconstructionPrompt.ts`
- Modify: `src/editor/reconstructionPrompt.ts`
- Modify: `server/src/scene/reconstructionPrompt.ts`
- Modify: `README.md`

- [ ] **Step 1: Create shared prompt module**

Move common JSON schema and reconstruction rules into `src/shared/reconstructionPrompt.ts`:

```ts
export function buildReconstructionSchemaText() {
  /*
   * ========================================================================
   * 步骤1：构建共享 scene schema 文本
   * ========================================================================
   * 目标：
   *   1) 前端提示词导出和服务端 AI 调用共用同一份协议说明
   *   2) 避免两份 prompt 分叉
   */
  return `Return strict JSON using this scene schema:
{
  "version": "0.1",
  "page": { "width": number, "height": number, "background": "#FFFFFF", "units": "px" },
  "metadata": { "id": string, "title": string, "createdAt": string, "engine": string, "notes": [] },
  "nodes": [],
  "edges": []
}`;
}
```

- [ ] **Step 2: Use shared module from both wrappers**

In both prompt files, import `buildReconstructionSchemaText()` and include its output in the existing prompt.

- [ ] **Step 3: Run verification and commit**

Run:

```powershell
npm test
npm run typecheck
```

Commit:

```powershell
git add src/shared/reconstructionPrompt.ts src/editor/reconstructionPrompt.ts server/src/scene/reconstructionPrompt.ts README.md
git commit -m "统一重建提示词协议说明"
```

---

### Task 13: Add Shared Path Alias

**Files:**

- Modify: `tsconfig.json`
- Modify: `vite.config.ts`
- Modify: `server/src/routes/api.ts`
- Modify: other imports under `server/src` using `../../../src/shared/*`

- [ ] **Step 1: Configure TypeScript paths**

Add to `compilerOptions`:

```json
"baseUrl": ".",
"paths": {
  "@shared/*": ["src/shared/*"]
}
```

- [ ] **Step 2: Configure Vite alias**

In `vite.config.ts`:

```ts
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared")
    }
  },
  server: { ... }
});
```

- [ ] **Step 3: Replace brittle imports**

Example:

```ts
import { validateScene, type ValidationIssue } from "@shared/sceneValidation";
```

- [ ] **Step 4: Run verification and commit**

Run:

```powershell
npm test
npm run typecheck
npm run build
```

Commit:

```powershell
git add tsconfig.json vite.config.ts server/src/routes/api.ts
git commit -m "添加共享模块路径别名"
```

---

### Task 14: Tune Logger Info Fast Path

**Files:**

- Modify: `src/lib/logger.ts`
- Modify: `server/src/logger.ts`

- [ ] **Step 1: Inspect current logger behavior**

Open:

```powershell
Get-Content -Raw src/lib/logger.ts
Get-Content -Raw server/src/logger.ts
```

- [ ] **Step 2: Add early return before formatting**

Implement info short-circuit so disabled info logs return before building console payloads. Preserve warn/error behavior.

Expected shape:

```ts
const infoEnabled = import.meta.env?.VITE_ENABLE_INFO_LOGS === "1";

export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    if (!infoEnabled) {
      return;
    }
    console.info(message, meta ?? "");
  },
  warn(...) {},
  error(...) {}
};
```

Server equivalent should derive from `LOG_LEVEL`.

- [ ] **Step 3: Run verification and commit**

Run:

```powershell
npm test
npm run typecheck
```

Commit:

```powershell
git add src/lib/logger.ts server/src/logger.ts
git commit -m "优化 info 日志短路"
```

---

### Task 15: Split Canvas Responsibilities

**Files:**

- Create: `src/editor/canvasRender.tsx`
- Create: `src/editor/canvasHandles.tsx`
- Create: `src/editor/canvasPointer.ts`
- Modify: `src/editor/Canvas.tsx`

- [ ] **Step 1: Move pure render components**

Move these from `Canvas.tsx` to `canvasRender.tsx`:

- `NodeView`
- `renderNodeBody`
- `EdgeView`
- `GridNode`
- `BracketNode`

Keep props identical.

- [ ] **Step 2: Move resize handle rendering**

Move `ResizeHandles` to `canvasHandles.tsx`.

- [ ] **Step 3: Move pointer state types and coordinate helpers**

Move these types to `canvasPointer.ts`:

- `DragState`
- `ResizeState`
- `BoxSelectState`
- `PanState`

Do not move React state on first pass; keep runtime behavior unchanged.

- [ ] **Step 4: Run verification and commit**

Run:

```powershell
npm test
npm run typecheck
npm run build
```

Commit:

```powershell
git add src/editor/Canvas.tsx src/editor/canvasRender.tsx src/editor/canvasHandles.tsx src/editor/canvasPointer.ts
git commit -m "拆分画布渲染和手柄模块"
```

---

### Task 16: Add CI And Node Engine Metadata

**Files:**

- Modify: `package.json`
- Create: `.github/workflows/ci.yml`
- Modify: `README.md`

- [ ] **Step 1: Add Node engine**

In `package.json`:

```json
"engines": {
  "node": ">=20"
}
```

- [ ] **Step 2: Add GitHub Actions workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 3: Update README**

Mention:

```text
CI runs typecheck, tests, and production build on push and pull request.
```

- [ ] **Step 4: Run local verification and commit**

Run:

```powershell
npm run typecheck
npm test
npm run build
```

Commit:

```powershell
git add package.json .github/workflows/ci.yml README.md
git commit -m "添加 CI 和 Node 版本约束"
```

---

## Execution Order

```text
┌──────┬──────────────────────────────┐
│ 顺序 │ 任务                         │
├──────┼──────────────────────────────┤
│ 1    │ Remove Redundant Selection   │
│ 2    │ Extract Editor Reset Flow    │
│ 3    │ Repair Before Persistence    │
│ 4    │ Parallelize Sharp Buffers    │
│ 5    │ Table-Drive Export Routes    │
│ 6    │ Keyboard Shortcuts           │
│ 7    │ OpenAI-Compatible Models     │
│ 8    │ Fixed Evaluation Suite       │
│ 9    │ Normalized Visual Metrics    │
│ 10   │ Evaluation Baseline          │
│ 11   │ Optional AI Evaluation       │
│ 12   │ Shared Prompt Base           │
│ 13   │ Shared Path Alias            │
│ 14   │ Logger Fast Path             │
│ 15   │ Canvas Split                 │
│ 16   │ CI And Engines               │
└──────┴──────────────────────────────┘
```

Reason:

- App state and reset are prerequisites for shortcuts.
- Persistence helper should land before export route refactor, so API validity has one clear boundary.
- OpenAI-compatible model discovery must land before AI evaluation, so evaluation reuses the same provider config.
- Evaluation suite must exist before baseline and AI comparisons.
- Prompt sharing and aliases should happen before larger file splits.
- Canvas split is last among code refactors because it touches the largest surface.

## Verification Matrix

```text
┌────────────┬────────────────────────────┬────────────────────┐
│ Area       │ Command                    │ Expected           │
├────────────┼────────────────────────────┼────────────────────┤
│ Types      │ npm run typecheck          │ no errors          │
│ Tests      │ npm test                   │ all pass           │
│ Build      │ npm run build              │ dist generated     │
│ Evaluation │ npm run evaluate           │ summary generated  │
│ Smoke      │ npm run dev                │ UI loads locally   │
└────────────┴────────────────────────────┴────────────────────┘
```

## Self-Review

Spec coverage:

- #1 covered by Task 1.
- #2 covered by Task 2.
- #3 covered by Task 3.
- #4 covered by Task 5.
- #5 covered by Task 4.
- #6 intentionally excluded from implementation because official OpenAI model docs currently list `gpt-5.4`; keep environment override and improve error messaging only if real runtime failures appear.
- User request for OpenAI-compatible API model discovery covered by Task 7.
- #7 covered by Task 11.
- #8 covered by Task 9.
- #9 covered by Task 10.
- #10 covered by Task 8.
- #11 covered by Task 14.
- #12 covered by Task 15.
- #13 covered by Task 13.
- #14 covered by Task 12.
- #15 covered by Task 6.
- #16 covered by Task 16.

未发现空占位任务或缺少执行细节的任务。
