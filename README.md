# Scientific Drawing

把论文截图、AI 生成图、流程图或模块图转成一份可编辑的 `scene.json`，再导出为 SVG、PPTX 或 JSON。

它不是 Visio 的替代品，而是一条 **「图 → 协议 → 编辑 → 导出」** 的流水线。设计理念是“复刻优先”：

```text
图片  →  锁定原图底图  →  叠加可编辑语义层  →  手工修正  →  SVG / PPTX / JSON
```

之所以先保留原图底图，是因为论文图里的文字、箭头、配色和局部符号过多，一次性完全语义重建并不稳定。先把原图作为锁定底层，可以保证视觉不跑偏；再叠加可编辑节点，让用户逐步替换或修正。

---

## 1. 快速上手

```powershell
# 安装依赖
npm install

# 同时启动前端 (5173) 和后端 (8787)
npm run dev
```

默认入口：

| 服务 | 地址 |
| --- | --- |
| 前端 (Vite) | http://localhost:5173 |
| 后端 (Express) | http://localhost:8787 |

仅启动后端：`npm run server:start`；仅启动前端：`npm run client:dev`。

### 配置 AI 重建（可选）

`POST /api/reconstruct` 依赖 OpenAI Responses API：

```powershell
$env:OPENAI_API_KEY      = "你的 key"
$env:OPENAI_BASE_URL     = "https://api.openai.com/v1"   # 可选，默认即此值
$env:OPENAI_RECONSTRUCT_MODEL = "gpt-5.4"                 # 可选，默认 gpt-5.4
npm run dev
```

没有 `OPENAI_API_KEY` 时，**普通分析、手工编辑、导入导出全部仍可用**，只是工具栏中的「AI 重建」按钮会被禁用。`OPENAI_BASE_URL` 支持写网关根地址，程序会自动补齐 `/v1/responses`。

### 日志开关

```powershell
$env:LOG_LEVEL              = "info"  # 开启后端 info 日志
$env:VITE_ENABLE_INFO_LOGS  = "1"     # 开启前端 info 日志
```

默认关闭 info 级日志，避免拖拽和高频渲染刷屏。

---

## 2. 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19 + Vite 7 + TypeScript |
| 后端 | Express 5 + tsx + TypeScript |
| 图片处理 | sharp |
| PPTX 导出 | pptxgenjs |
| 图标 | lucide-react |
| 测试 | `node:test` + tsx |

---

## 3. 目录结构

```text
scientific-drawing/
├─ src/                              前端
│  ├─ App.tsx                        主状态与业务动作
│  ├─ editor/
│  │  ├─ Canvas.tsx                  SVG 画布渲染与拖拽
│  │  ├─ Inspector.tsx               右侧属性面板
│  │  ├─ Toolbar.tsx                 左侧工具栏
│  │  ├─ sceneOps.ts                 节点的增/删/改/复
│  │  ├─ reconstructionPrompt.ts     给外部模型用的提示词
│  │  └─ visiomasterAdapter.ts       前端 JSON 导入适配器
│  ├─ lib/                           api、id、logger
│  └─ shared/scene.ts                前后端共享 scene 协议
├─ server/src/                       后端
│  ├─ index.ts                       Express 入口（注册静态与 API 路由）
│  ├─ routes/api.ts                  /analyze /reconstruct /export 等
│  ├─ evaluate.ts                    批量评估脚本
│  ├─ paths.ts / logger.ts
│  └─ scene/
│     ├─ analyzeImage.ts             启发式图片分析
│     ├─ reconstructWithOpenAI.ts    AI 多模态重建
│     ├─ reconstructionPrompt.ts     服务端 AI 提示词
│     ├─ visiomasterAdapter.ts       Visiomaster 风格 JSON 适配
│     ├─ svg.ts / pptx.ts            两种导出器
│     └─ types.ts                    复用共享 scene 类型
├─ tests/exportAndUpload.test.ts     回归测试
└─ data/
   ├─ uploads/        上传的图片
   ├─ scenes/         每次分析或重建生成的 scene.json
   ├─ exports/        导出的 JSON / SVG / PPTX
   └─ evaluation/     评估脚本生成的产物
```

`data/exports`、`data/evaluation` 和日志默认在 `.gitignore` 中。

---

## 4. 推荐工作流

工具栏（左侧）提供两条入口：

| 入口 | 何时用 | 产物 |
| --- | --- | --- |
| 上传图片（普通分析） | 追求视觉接近原图 | 原图底图 + 低透明辅助框 |
| AI 重建 | 需要语义结构 | 锁定原图底图 + 语义节点/连线 |

之后在画布上手工修正：

```text
1. 上传论文图
2. 优先尝试普通分析，得到可编辑覆盖层
3. 如需进一步结构化，使用 AI 重建
4. 在画布拖动节点、改文字、调颜色
5. 导出 SVG / PPTX / JSON
6. 用 npm run evaluate 检查视觉差异
```

**两种模式的区别：**

| 模式 | 特点 | 适合场景 |
| --- | --- | --- |
| 普通分析 | 保留原图底图，附加低透明辅助框 | 快速复刻、手工细修 |
| AI 重建 | 在底图之上生成语义节点和连线 | 需要可编辑结构、二次设计 |

AI 重建会自动加锁定原图底图，意味着最终画面优先接近原图；AI 生成的节点作为覆盖层存在。后续可以逐步删除底图，或调低透明度，只留语义图元。

---

## 5. scene.json 协议

`scene.json` 是项目核心协议，前后端共享 `src/shared/scene.ts`。最小结构如下：

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

### 5.1 节点类型

| `type` | 含义 |
| --- | --- |
| `text` | 文本 |
| `rect` | 矩形 |
| `rounded_rect` | 圆角矩形 |
| `ellipse` | 椭圆 |
| `line` | 折线 |
| `arrow` | 带箭头的折线 |
| `image` | 图片 |
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

### 5.2 网格

`grid` 与 `feature_grid` 支持行色、列阴影与单元格自定义：

```json
{
  "id": "blocks", "type": "grid",
  "x": 100, "y": 100, "w": 300, "h": 50,
  "rows": 1, "cols": 6,
  "rowColors": ["#FFFFFF"],
  "columnShades": [0, 0, 0, 0, 0, 0],
  "cells": [
    { "row": 0, "col": 0, "fill": "#60A5FA", "text": "1", "color": "#111111" },
    { "row": 0, "col": 1, "fill": "#86EFAC", "text": "2", "color": "#111111" }
  ],
  "style": { "stroke": "#111111", "strokeWidth": 1, "fontSize": 18 }
}
```

### 5.3 连线

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

边类型支持 `arrow | line | join | fork`。端点格式：`node-id:left|right|top|bottom@比例`。若提供 `fromPoint` / `toPoint`，将优先使用显式坐标。

---

## 6. Visiomaster 风格导入

适配器会把 Visiomaster 类型映射到内部协议：

| Visiomaster | 内部 |
| --- | --- |
| `text_block` | `text` |
| `process_box` | `rect` |
| `rounded_process` / `group_container` | `rounded_rect` |
| `ellipse_node` | `ellipse` |
| `operator_node` | `operator` |
| `grid_matrix` | `grid` |
| `feature_map_grid` / `feature_map_banded` | `feature_grid` |
| `bracket` | `bracket` |
| `image_tile` | `image` |

会保留：`x/y/w/h`、`text/symbol`、`style.fill/stroke/text_color`、`rows/cols`、`row_colors`、`column_shades`、`colored_cells`、`cell_labels`、`edges/points`。

> 只有显式声明虚线，容器才会渲染虚线；不会再默认把 `group_container` 视作虚线框。

---

## 7. HTTP API

后端默认监听 `http://localhost:8787`，静态资源挂载在 `/uploads` 与 `/exports`。

### `GET /api/config`

```json
{ "aiReconstructionAvailable": true, "reconstructModel": "gpt-5.4" }
```

### `POST /api/analyze`

启发式图片分析。`multipart/form-data`：`image`（必填）、`title`（可选）。

- 允许 MIME：`image/png`、`image/jpeg`、`image/webp`
- 单文件上限：20 MB（超出返回 413）

响应：

```json
{ "scene": { /* ... */ }, "sourceUrl": "/uploads/<id>.png", "sceneUrl": "/api/scenes/<id>" }
```

### `POST /api/reconstruct`

AI 重建。请求体同上，额外可选 `mode = color | mono`（默认 `color`）。

服务端流程：

```text
1. 写入图片到 data/uploads
2. 调用 OpenAI Responses API
3. 把返回的 Visiomaster 风格 scene 转为内部协议
4. 自动插入锁定的原图底图（ensureReplicaBaseLayer）
5. 持久化 scene 到 data/scenes
```

### `GET /api/scenes/:id`

读取已保存的 scene。`id` 必须只包含 `a-zA-Z0-9_-`，防止路径穿越。

### `POST /api/export/{json|svg|pptx}`

请求体：`{ "scene": Scene }`（最大 20 MB）。响应：`{ "url": "/exports/<file>" }`。

- **SVG 导出** 会尽可能把 `/uploads/...` 的图片内嵌为 data URL，便于 SVG 单独迁移；非本地源或文件不存在时保留原始引用。
- **PPTX 导出** 支持：`text`、`rect`、`rounded_rect`、`ellipse`、`operator`、`line`、`arrow`、`grid`、`feature_grid`、`bracket`、`image`、`edges`。多段折线会拆成多条线段，只在最后一段保留箭头。

### 导出文件名安全

`scene.metadata.id` 会被清洗：

```text
只保留 [a-zA-Z0-9_-]，连续非法字符替换为 -，最大长度 80；
空值自动回退到 UUID。
```

避免任何路径字符或异常文件名写入 `data/exports`。

---

## 8. 开发命令

```powershell
npm run dev          # 同启前后端
npm run typecheck    # tsc --noEmit
npm test             # tsx --test tests/**/*.test.ts
npm run build        # tsc -b && vite build
npm run evaluate     # 批量评估脚本
```

### 当前测试覆盖

```text
上传 MIME 白名单
导出文件名清洗
SVG 文本转义
grid / bracket / 多段折线 SVG 导出
Visiomaster 适配
AI 重建自动复刻底图（ensureReplicaBaseLayer）
PPTX 文件生成
```

### 评估脚本

`npm run evaluate` 会扫描 `data/uploads` 中的 PNG/JPEG/WebP，调用普通分析重新生成 scene 与 SVG，并把原图与导出 SVG 渲染后作像素差对比。

输出指标（写入 `data/evaluation/summary.json`）：

| 字段 | 含义 |
| --- | --- |
| `editable` | 可编辑节点数量 |
| `edges` | 语义连线数量 |
| `meanDiff` | 导出 SVG 与原图的平均像素差，越低越接近原图 |

> 评估目前只覆盖**普通分析**链路，不评估 AI 重建质量；普通分析尚未稳定输出箭头语义，因此 `edges` 通常为 0。

---

## 9. 已知边界

| 问题 | 说明 |
| --- | --- |
| OCR | 普通分析只标记文本区域，不识别真实文字 |
| 箭头检测 | 普通分析暂不稳定输出语义连线 |
| AI 稳定性 | AI 重建质量取决于模型能力与提示词 |
| 数学公式 | 当前以普通文本保存，不做 LaTeX 渲染 |
| PPTX 保真 | 优先保证可编辑，不保证像素级一致 |
| 图层管理 | 暂无显式图层面板，仅依赖节点顺序 |
| 撤销重做 | 暂未实现 |

### 提升 AI 重建质量

如果重建与原图差距较大，依次检查：

```text
1. 使用 color 模式而非 mono 模式
2. 确认 OPENAI_RECONSTRUCT_MODEL 支持图像输入
3. 保留 source-image 底图，不要直接删除
4. 对关键区域手工修正文字与颜色
5. 复杂图先做局部重建，不要依赖一次全图重建
```

当前策略：**先保证视觉保真，再逐步提高可编辑程度。**

---

## 10. 后续方向

- **OCR**：识别真实文字以替换默认 Text
- **箭头检测**：让普通分析稳定生成 `arrow` edges
- **局部重建**：用户框选区域，只让 AI 重建局部
- **差异闭环**：导出 SVG 后反渲染，与原图自动对比
- **图层面板**：控制底图、辅助层、语义层可见性
- **撤销重做**：保存编辑历史
- **协议校验**：导入和导出前做 schema 校验
- **视觉回归**：把 `meanDiff` 接入测试阈值

---

## 11. 常见问题

**AI 重建按钮不可用？** 后端启动时未读取到 `OPENAI_API_KEY`。重新设置环境变量后再启动。

**上传失败？** 检查 MIME（PNG / JPEG / WebP）与体积（≤ 20 MB）。

**SVG 打开后看不到原图？** 正常情况会内嵌 data URL；如果源不是 `/uploads/...` 或文件已被删除，会保留原始引用，迁移时可能丢图。

**PPTX 不是像素一致？** PPTX 优先可编辑性；字体、箭头端点、透明度等在 PowerPoint 里会有差异。

**评估里 `edges` 一直是 0？** `npm run evaluate` 走的是普通分析，目前还没有稳定的箭头语义识别；AI 重建可以生成 edges，但不在评估脚本当前范围内。
