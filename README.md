# Scientific Drawing

把论文截图、AI 生成图、流程图或模块图，转成一份**可编辑的 `scene.json`**，再导出为 SVG / PPTX / JSON 的本地工具。

它不是 Visio 的替代品，而是一条 **「图像 → 协议 → 编辑 → 导出 → 评估」** 的研究型流水线。

```text
┌──────────┐   启发式分析     ┌──────────┐   人工编辑     ┌──────────┐
│ 原图     │ ───────────────▶ │scene.json│ ─────────────▶ │ 导出     │
│ (PNG/    │   AI 重建        │  (协议)  │   校验/修复    │ SVG/PPTX │
│  JPEG)   │ ───────────────▶ │          │ ─────────────▶ │  JSON    │
└──────────┘                  └──────────┘                └──────────┘
                                   │                            │
                                   └──────── 评估脚本 ◀──────────┘
                                            (像素差 + 结构指标)
```

设计理念是 **复刻优先**：论文图里文字、箭头、配色、局部符号过多，一次性纯语义重建并不稳定。所以先把原图作为**锁定底图**保证视觉不跑偏，再叠加可编辑节点层，让用户逐步修正或替换。

---

## 目录

1. [实验设计与系统架构](#1-实验设计与系统架构)
2. [快速上手](#2-快速上手)
3. [scene.json 协议](#3-scenejson-协议)
4. [推荐工作流](#4-推荐工作流)
5. [HTTP API](#5-http-api)
6. [Visiomaster 风格导入](#6-visiomaster-风格导入)
7. [评估体系](#7-评估体系)
8. [开发命令与目录结构](#8-开发命令与目录结构)
9. [已知边界与后续方向](#9-已知边界与后续方向)
10. [常见问题](#10-常见问题)

---

## 1. 实验设计与系统架构

### 1.1 问题与设计目标

复刻一张论文图通常面对两个互相矛盾的目标：

- **视觉保真**：颜色、版式、字体、箭头细节要尽量接近原图；
- **可编辑性**：节点、连线、文字需要在导出后还能在 PPT 或 SVG 编辑器里二次修改。

本项目用一个统一的中间表示 `scene.json` 把这两条目标解耦：

$$
\text{Image} \xrightarrow{\text{analyze} / \text{reconstruct}} \mathcal{S} \xrightarrow{\text{edit}} \mathcal{S}' \xrightarrow{\text{export}} \{\text{SVG}, \text{PPTX}, \text{JSON}\}
$$

其中 $\mathcal{S}$ 是 scene 协议，所有渲染器（Canvas / SVG / PPTX）共享同一套几何与颜色规则（`src/shared/geometry.ts`），保证三个出口的视觉一致性。

### 1.2 两条重建支路

| 入口 | 技术 | 适合场景 |
| --- | --- | --- |
| 普通分析 | sharp + 连通域 + 启发式 | 复刻原图、再手工修 |
| AI 重建 | OpenAI Responses 多模态 | 强结构化、语义编辑 |

两条路径**最终都落到同一个 scene 协议**，并经过同一条修复链路 (`repairScene`) 收敛：补 metadata、去重 id、规范颜色、夹紧尺寸、丢掉悬空连线、自动插入锁定原图底图。

### 1.3 硬化分支（`scientific-drawing-hardening`）

当前分支把原型升级到稳定工具，覆盖六条线：

| 方向 | 实现位置 |
| --- | --- |
| 协议深校验 | `src/shared/sceneValidation.ts` |
| 渲染一致性 | `src/shared/geometry.ts`（Canvas / SVG / PPTX 共享） |
| AI 输出修复 | `server/src/scene/repairScene.ts` |
| 编辑交互 | Canvas 多选 / 缩放 / 平移 / 手柄 / 语义连线 |
| 文件治理 | `server/src/files/retention.ts` |
| 评估指标 | `server/src/evaluate.ts`（像素差 + 结构） |

### 1.4 模块分层

```text
┌─────────────────────────────────────────────────────┐
│ 前端 (React 19 + Vite 7)                            │
│  Toolbar  ──▶  App (状态/动作) ──▶  Canvas / Inspector│
│                     │                                │
│                     ▼                                │
│           src/lib/api.ts  ◀──┐                      │
└──────────────────────────────┼──────────────────────┘
                               │ HTTP
┌──────────────────────────────┼──────────────────────┐
│ 后端 (Express 5)             ▼                       │
│  routes/api.ts                                       │
│    ├─ analyze   ─▶ scene/analysis/{mask,components,  │
│    │                            elements}.ts        │
│    ├─ reconstruct ─▶ scene/reconstructWithOpenAI.ts │
│    ├─ export    ─▶ scene/{svg,pptx}.ts              │
│    └─ scenes    ─▶ data/scenes/<id>.scene.json      │
│                                                      │
│  共享: scene/repairScene.ts, files/retention.ts     │
└──────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────┐
│ shared (前后端同源)                                 │
│  scene.ts             // 协议类型                   │
│  sceneValidation.ts   // 运行时校验                 │
│  geometry.ts          // resolveEndpoint/shadeColor │
└─────────────────────────────────────────────────────┘
```

---

## 2. 快速上手

### 2.1 启动

```powershell
npm install
npm run dev          # 同启前端 5173 + 后端 8787
```

| 服务 | 地址 |
| --- | --- |
| 前端 (Vite) | http://localhost:5173 |
| 后端 (Express) | http://localhost:8787 |

仅启动后端：`npm run server:start`；仅启动前端：`npm run client:dev`。

### 2.2 配置 AI 重建（可选）

`POST /api/reconstruct` 依赖 OpenAI Responses API：

```powershell
$env:OPENAI_API_KEY            = "你的 key"
$env:OPENAI_BASE_URL           = "https://api.openai.com/v1"  # 可选，可填兼容网关根地址
$env:OPENAI_RECONSTRUCT_MODEL  = "gpt-4o"                     # 可选，模型列表失败时的兜底模型
npm run dev
```

未配置 `OPENAI_API_KEY` 时，**普通分析、手工编辑、导入导出依旧可用**，只是工具栏的「AI 重建」按钮被禁用。`OPENAI_BASE_URL` 支持写网关根地址，程序会自动补齐 `/v1/responses` 和 `/v1/models`。

`GET /api/config` 会由后端携带 API Key 请求 `/v1/models`，只把模型 id 列表返回给前端。前端不会接触 `OPENAI_API_KEY`。

### 2.3 日志与文件保留

```powershell
$env:LOG_LEVEL             = "info"  # 后端 info 日志
$env:VITE_ENABLE_INFO_LOGS = "1"     # 前端 info 日志
$env:DATA_RETENTION_DAYS   = "14"    # 运行产物保留天数
```

后端启动时按 `DATA_RETENTION_DAYS` 清理 `data/uploads`、`data/exports`、`data/scenes` 中过期的受管文件（默认 14 天，仅删除已知后缀，不递归删目录）。

---

## 3. scene.json 协议

`scene.json` 是项目的核心协议，前后端共享 `src/shared/scene.ts`，运行时由 `validateScene` 检查、由 `repairScene` 修复。

### 3.1 根结构

```json
{
  "version": "0.1",
  "page": {
    "width": 1280,
    "height": 720,
    "background": "#FFFFFF",
    "units": "px"
  },
  "metadata": {
    "id": "scene-id",
    "title": "Scientific Figure",
    "sourceImage": "/uploads/example.png",
    "createdAt": "2026-05-17T00:00:00.000Z",
    "engine": "scientific-drawing",
    "notes": []
  },
  "nodes": [],
  "edges": []
}
```

### 3.2 节点类型

| `type` | 含义 |
| --- | --- |
| `text` | 文本 |
| `rect` | 矩形 |
| `rounded_rect` | 圆角矩形 |
| `ellipse` | 椭圆 |
| `line` | 折线 |
| `arrow` | 带箭头的折线 |
| `image` | 图片（可设 `locked: true`） |
| `grid` | 规则网格 |
| `feature_grid` | 特征图 / 热力图网格 |
| `bracket` | 分组括号 |
| `operator` | 圆形算子或符号 |

通用字段：

```json
{
  "id": "node-id",
  "type": "rect",
  "x": 10, "y": 20, "w": 120, "h": 60,
  "text": "Label",
  "style": {
    "fill": "#FFFFFF",
    "stroke": "#111111",
    "strokeWidth": 1,
    "fontFamily": "Times New Roman",
    "fontSize": 16,
    "fontWeight": "400",
    "color": "#111111",
    "opacity": 1,
    "dash": "7 5"
  }
}
```

### 3.3 网格

`grid` 与 `feature_grid` 支持行色、列阴影和单元格自定义：

```json
{
  "id": "blocks", "type": "grid",
  "x": 100, "y": 100, "w": 300, "h": 50,
  "rows": 1, "cols": 6,
  "rowColors": ["#FFFFFF"],
  "columnShades": [0, 0, 0, 0, 0, 0],
  "cells": [
    { "row": 0, "col": 0, "fill": "#60A5FA", "text": "1" },
    { "row": 0, "col": 1, "fill": "#86EFAC", "text": "2" }
  ],
  "style": { "stroke": "#111111", "strokeWidth": 1, "fontSize": 18 }
}
```

### 3.4 连线

```json
{
  "id": "edge-1",
  "type": "arrow",
  "from": "source-node:right@0.5",
  "to":   "target-node:left@0.5",
  "points": [{ "x": 400, "y": 120 }, { "x": 520, "y": 120 }],
  "style": { "stroke": "#111111", "strokeWidth": 2 }
}
```

- `type`: `arrow | line | join | fork`
- 端点格式：`node-id:left|right|top|bottom@ratio`，`ratio ∈ [0, 1]`
- 若提供 `fromPoint` / `toPoint`，优先使用显式坐标

### 3.5 校验与修复

导入、AI 重建和导出都会过同一条链路：

```text
raw ──▶ normalizeImportedScene ──▶ repairScene ──▶ validateScene ──▶ ok
                                          │
                                          ├─ 缺失 metadata → 补默认
                                          ├─ 重复 id → 加 -2/-3 后缀
                                          ├─ 非法颜色 → 回退默认
                                          ├─ 异常尺寸 → 取绝对值并夹紧
                                          └─ 悬空连线 → 丢弃
```

`validateScene` 失败时 API 返回 `400 { error, issues }`；前端导入失败时**不会污染当前 scene**。

---

## 4. 推荐工作流

### 4.1 主流程

```text
1. 上传论文图
2. 优先尝试「普通分析」，得到锁定底图 + 辅助框
3. 如需结构化，使用「AI 重建」
4. 在画布拖动节点、改文字、调颜色
5. 导出 SVG / PPTX / JSON
6. 用 npm run evaluate 检查视觉与结构指标
```

### 4.2 两种重建模式

| 模式 | 特点 | 适合场景 |
| --- | --- | --- |
| 普通分析 | 保留底图 + 启发式辅助框，**评估覆盖** | 快速复刻、手工细修 |
| AI 重建  | 生成语义节点和连线，**自动叠加锁定底图** | 二次设计、结构编辑 |

> AI 重建后底图依旧锁定在最底层，最终视觉接近原图；AI 节点作为覆盖层存在，可逐步删除底图或调透明度，留下纯语义图元。

### 4.3 画布编辑能力

| 操作 | 说明 |
| --- | --- |
| 框选 / 多选 | 空白处拖拽选择多个对象 |
| 移动 | 拖动任一选中对象批量移动 |
| 缩放 | 选中后拖动蓝色八方向手柄 |
| 线条端点 | 拖动折线 / 箭头两个端点 |
| 语义连线 | 选连线工具，点起止节点 |
| 视图缩放 | `Ctrl` + 滚轮（0.25× ~ 4×） |
| 视图平移 | 中键拖拽，或 `空格` + 左键拖拽 |
| 重置视图 | 工具栏重置按钮 |
| 删除 | `Delete` / `Backspace` |
| 复制 | `Ctrl+D` / `Cmd+D` |
| 取消 | `Escape` |

锁定的源图底图不会被框选误选中。

---

## 5. HTTP API

后端默认监听 `http://localhost:8787`，静态资源挂载在 `/uploads` 与 `/exports`。

### `GET /api/config`

```json
{
  "aiReconstructionAvailable": true,
  "provider": "openai-compatible",
  "baseUrl": "https://api.openai.com/v1",
  "reconstructModel": "gpt-4o",
  "reconstructModels": ["gpt-4o", "gpt-4o-mini"],
  "modelListAvailable": true,
  "modelListError": null
}
```

### `POST /api/analyze`

启发式图片分析。`multipart/form-data`：`image`（必填）、`title`（可选）。

- 允许 MIME：`image/png`、`image/jpeg`、`image/webp`
- 单文件上限：20 MB（超出返回 413）

响应：

```json
{
  "scene":    { /* ... */ },
  "sourceUrl": "/uploads/<id>.png",
  "sceneUrl":  "/api/scenes/<id>"
}
```

### `POST /api/reconstruct`

AI 重建。同 `analyze`，额外可选 `mode = color | mono`（默认 `color`）。

服务端流程：

```text
1. 写入图片到 data/uploads
2. 调用 OpenAI Responses API
3. Visiomaster 风格 scene → 内部协议
4. repairScene 修复 id / 样式 / 尺寸 / 连线
5. ensureReplicaBaseLayer 插入锁定原图底图（index 0）
6. 持久化 scene 到 data/scenes
```

### `GET /api/scenes/:id`

读取已保存的 scene。`id` 必须只包含 `a-zA-Z0-9_-`，防止路径穿越。

### `POST /api/export/{json|svg|pptx}`

请求体：`{ "scene": Scene }`（最大 20 MB）。响应：`{ "url": "/exports/<file>" }`。

- **JSON**：原样持久化经过校验的 scene。
- **SVG**：尽可能把 `/uploads/...` 图片内嵌为 data URL，便于单文件迁移；非本地源或文件不存在时保留原始引用。
- **PPTX** 支持：`text`、`rect`、`rounded_rect`、`ellipse`、`operator`、`line`、`arrow`、`grid`、`feature_grid`、`bracket`、`image`、`edges`。多段折线被拆成多条线段，仅最后一段保留箭头。

### 导出文件名安全

`scene.metadata.id` 被清洗：只保留 `[a-zA-Z0-9_-]`，连续非法字符替换为 `-`，最大长度 80，空值回退到 UUID。

### 运行产物清理

后端启动时按 `DATA_RETENTION_DAYS` 清理 `data/uploads`、`data/exports`、`data/scenes`，**不递归删除目录**，只处理 `.png/.jpg/.jpeg/.webp/.img/.svg/.pptx/.json` 等已知后缀。

---

## 6. Visiomaster 风格导入

适配器会把 Visiomaster 类型映射到内部协议：

| Visiomaster | 内部 |
| --- | --- |
| `text_block` | `text` |
| `process_box` | `rect` |
| `rounded_process` / `group` | `rounded_rect` |
| `ellipse_node` | `ellipse` |
| `operator_node` | `operator` |
| `grid_matrix` | `grid` |
| `feature_map_grid` / `banded` | `feature_grid` |
| `bracket` | `bracket` |
| `image_tile` | `image` |

会保留：`x/y/w/h`、`text/symbol`、`style.fill/stroke/text_color`、`rows/cols`、`row_colors`、`column_shades`、`colored_cells`、`cell_labels`、`edges/points`。

> 只有显式声明虚线，容器才会渲染虚线；不会再默认把 `group_container` 视作虚线框。

---

## 7. 评估体系

`npm run evaluate` 优先读取 `data/eval-suite/manifest.json` 中登记的固定样本。清单为空时，回退扫描 `data/uploads` 中的 PNG/JPEG/WebP。评估会调用**普通分析**重新生成 scene 与 SVG，再把原图与导出 SVG 渲染到相同尺寸做像素差对比，同时统计 scene 的结构质量。

固定样本目录：

```text
data/eval-suite/
├─ manifest.json   # 固定样本清单
├─ baseline.json   # 可选基线指标
└─ README.md       # 样本字段说明
```

输出写入 `data/evaluation/summary.json`：

| 字段 | 含义 |
| --- | --- |
| `nodes` | 节点总数 |
| `editableNodes` | 可编辑节点数（非 `locked`） |
| `lockedNodes` | 锁定节点数 |
| `imageNodes` | 图片节点数 |
| `textNodes` | 文本节点数 |
| `shapeNodes` | 非图非文节点数 |
| `edges` | 语义连线数 |
| `edgeEndpointIssues` | 端点引用不存在节点的次数 |
| `meanDiff` | SVG 与原图平均像素差 |
| `normalizedMeanDiff` | `meanDiff / 255`，便于跨样本比较 |
| `normalizedMeanDiffDelta` | 当前归一化像素差相对基线的变化 |
| `psnr` | 基于均方误差的峰值信噪比，越高越好 |
| `ssim` | 全图统计近似 SSIM，越接近 1 越好 |
| `ssimDelta` | 当前 SSIM 相对基线的变化 |
| `typeSummary` | 类型分布字符串 |

像素差定义为对齐到相同分辨率后，每通道差值绝对值的均值：

$$
\text{meanDiff} = \frac{1}{3 W H}\sum_{c \in \{R,G,B\}}\sum_{i=1}^{W}\sum_{j=1}^{H} \left| I_{c,i,j}^{\text{orig}} - I_{c,i,j}^{\text{svg}} \right|
$$

值越小越接近原图。当前数据集（`data/evaluation/summary.json`）上典型 `meanDiff` 在 0.1 ~ 7 之间，说明启发式分析在视觉上接近原图，但 `edges` 通常为 0（启发式尚未稳定输出箭头语义）。

评估同时输出 `normalizedMeanDiff`、`psnr` 和 `ssim`。`normalizedMeanDiff` 用于把 0 到 255 的通道差值压到 0 到 1；`psnr` 更适合观察像素级退化；`ssim` 用全图亮度、方差和协方差做近似结构相似度。

如果存在 `data/eval-suite/baseline.json`，评估会按文件名匹配历史结果，并输出 `normalizedMeanDiffDelta` 与 `ssimDelta`。正的 `normalizedMeanDiffDelta` 表示像素误差变大；正的 `ssimDelta` 表示结构相似度提高。

> 评估目前只覆盖**普通分析**链路，不评估 AI 重建质量。

---

## 8. 开发命令与目录结构

### 8.1 命令

```powershell
npm run dev          # 同启前后端
npm run typecheck    # tsc --noEmit
npm test             # tsx --test tests/**/*.test.ts
npm run build        # tsc -b && vite build
npm run evaluate     # 批量评估脚本
```

### 8.2 测试覆盖

```text
- 上传 MIME 白名单 / 导出文件名清洗 / SVG 文本转义
- scene 校验与修复（geometry / sceneValidation / repairScene）
- 共享几何与颜色规则
- grid / bracket / 多段折线 SVG 导出
- Visiomaster 适配
- AI 重建自动复刻底图 (ensureReplicaBaseLayer)
- 文件保留策略 (fileRetention)
- 编辑器多选 / 缩放 / 手柄 / 连线 (editorOps / viewport)
- 评估结构指标 (evaluateMetrics)
- PPTX 文件生成
```

### 8.3 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19 + Vite 7 + TypeScript |
| 后端 | Express 5 + tsx + TypeScript |
| 图像处理 | sharp |
| PPTX 导出 | pptxgenjs |
| 图标 | lucide-react |
| 测试 | node:test + tsx |

### 8.4 目录

```text
scientific-drawing/
├─ src/                              前端
│  ├─ App.tsx                        主状态与业务动作
│  ├─ editor/
│  │  ├─ Canvas.tsx                  SVG 画布渲染、拖拽、手柄
│  │  ├─ Inspector.tsx               右侧属性面板
│  │  ├─ Toolbar.tsx                 左侧工具栏
│  │  ├─ sceneOps.ts                 节点 CRUD / 多选 / resize / edge
│  │  ├─ viewport.ts                 视口缩放与平移
│  │  ├─ reconstructionPrompt.ts     给外部模型用的提示词
│  │  └─ visiomasterAdapter.ts       前端 JSON 导入适配器
│  ├─ lib/                           api / id / logger
│  └─ shared/                        前后端共享
│     ├─ scene.ts                    scene 类型
│     ├─ sceneValidation.ts          运行时校验
│     └─ geometry.ts                 端点解析 / 颜色工具
├─ server/src/                       后端
│  ├─ index.ts                       Express 入口 + 启动清理
│  ├─ routes/api.ts                  /analyze /reconstruct /export
│  ├─ evaluate.ts                    批量评估脚本
│  ├─ paths.ts / logger.ts
│  ├─ files/retention.ts             文件保留策略
│  └─ scene/
│     ├─ analyzeImage.ts             启发式分析入口
│     ├─ analysis/                   mask / components / elements
│     ├─ reconstructWithOpenAI.ts    AI 多模态重建
│     ├─ reconstructionPrompt.ts     服务端 AI 提示词
│     ├─ repairScene.ts              统一修复层
│     ├─ visiomasterAdapter.ts       服务端 Visiomaster 适配
│     ├─ svg.ts / pptx.ts            两种导出器
│     └─ types.ts                    复用共享 scene 类型
├─ tests/                            10+ 个回归测试
├─ docs/superpowers/plans/           实施计划与决策记录
└─ data/
   ├─ uploads/        上传图片
   ├─ scenes/         每次分析或重建的 scene.json
   ├─ exports/        导出的 JSON / SVG / PPTX
   └─ evaluation/     评估脚本产物
```

`data/uploads`、`data/scenes`、`data/exports`、`data/evaluation` 和日志默认在 `.gitignore` 中。

---

## 9. 已知边界与后续方向

### 9.1 当前边界

| 问题 | 说明 |
| --- | --- |
| OCR | 普通分析只标记文本区域，不识别真实文字 |
| 箭头检测 | 普通分析暂不稳定输出 `arrow` edges |
| AI 稳定性 | 取决于模型能力与提示词 |
| 数学公式 | 以普通文本保存，不渲染 LaTeX |
| PPTX 保真 | 优先可编辑，不保证像素一致 |
| 图层管理 | 暂无显式图层面板 |
| 撤销重做 | 暂未实现 |

### 9.2 提升 AI 重建质量

```text
1. 使用 color 模式而非 mono 模式
2. 确认 OPENAI_RECONSTRUCT_MODEL 支持图像输入
3. 保留 source-image 底图，不要直接删除
4. 对关键区域手工修正文字与颜色
5. 复杂图先做局部重建，不要依赖一次全图重建
```

策略：**先保证视觉保真，再逐步提高可编辑程度。**

### 9.3 后续方向

- **OCR**：识别真实文字以替换默认 Text
- **箭头检测**：让普通分析稳定生成 `arrow` edges
- **局部重建**：用户框选区域，只让 AI 重建局部
- **差异闭环**：导出 SVG 后反渲染，与原图自动对比
- **图层面板**：控制底图、辅助层、语义层可见性
- **撤销重做**：保存编辑历史
- **视觉回归**：把 `meanDiff` 接入测试阈值，防止退化
- **AI 链路评估**：补 AI 重建的结构与视觉双指标

---

## 10. 常见问题

**AI 重建按钮不可用？** 后端启动时未读取到 `OPENAI_API_KEY`。重新设置环境变量后再启动。

**上传失败？** 检查 MIME（PNG / JPEG / WebP）与体积（≤ 20 MB）。

**导入 scene.json 失败？** 协议校验不通过会拒绝导入，不污染当前画布。打开浏览器控制台查看 `issues` 字段。

**SVG 打开后看不到原图？** 正常情况会内嵌 data URL；如果源不是 `/uploads/...` 或文件已被删除，会保留原始引用，迁移时可能丢图。

**PPTX 不是像素一致？** PPTX 优先可编辑性；字体、箭头端点、透明度在 PowerPoint 里会有差异。

**评估里 `edges` 一直是 0？** `npm run evaluate` 走的是普通分析，目前还没有稳定的箭头语义识别；AI 重建可以生成 edges，但不在评估脚本当前范围内。

**`data/` 里的文件被清掉了？** 后端启动时按 `DATA_RETENTION_DAYS`（默认 14 天）清理 `uploads/exports/scenes` 中过期的受管文件。需要长期保留可调大该值或迁出 `data/`。
