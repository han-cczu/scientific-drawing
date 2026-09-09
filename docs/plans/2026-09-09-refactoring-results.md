# 2026-09-09 重构实施与验收记录

对应：[主计划](./2026-09-09-refactoring.md)、[验收矩阵](./2026-09-09-refactoring-validation.md)。

基准提交：`c69d5bf73f87b226f51259021110bcfcd4693ba1`。实施分支：`codex/refactor-scientific-drawing`。验收后按用户指令统一提交代码、测试和文档，保留此前 README 和计划文档修改。最终提交标识以 Git 历史为准；没有推送、部署或改写用户运行数据。

## 1. 已落地的结构

| 计划范围 | 实现与结果 | 主要入口 |
| --- | --- | --- |
| R1 / R2：回归保护、共享导入与契约 | 所有原生节点、旧草稿、外部格式共用识别与转换；入口差异通过 ID、时间和来源参数表达；API DTO 与错误码集中定义，响应仍执行运行时检查。 | [sceneImport](../../src/shared/sceneImport.ts)、[apiContracts](../../src/shared/apiContracts.ts)、[API 模块](../../src/lib/api/index.ts) |
| R3：编辑器状态与副作用 | `App` 负责页面组合；session + reducer + commands 管理历史和写入规则，hooks 管理任务、保存、快捷键与配置。 | [App](../../src/App.tsx)、[reducer](../../src/editor/model/reducer.ts)、[taskRunner](../../src/editor/model/taskRunner.ts)、[场景任务](../../src/editor/hooks/useSceneTasks.ts) |
| R4：后端分层 | `createApp` 注入路径、配置、文件操作与模型能力；index 只启动；路由、业务与存储分开；场景写入使用同目录临时文件和 rename。 | [应用工厂](../../server/src/app.ts)、[路由装配](../../server/src/routes/index.ts)、[服务装配](../../server/src/services/index.ts)、[场景存储](../../server/src/storage/sceneStore.ts) |
| R5：评估与工程整理 | 评估拆为样本、指标、判定、报告和 CLI；CSS 按原顺序拆分；删除旧 Toolbar；测试、Hooks 与依赖边界进入类型检查和 CI。 | [evaluation](../../server/src/evaluation/run.ts)、[样式入口](../../src/styles.css)、[CI](../../.github/workflows/ci.yml) |

实现保留 scene 0.1、React、Express、现有图像检测算法及导出能力。普通分析对未 OCR 文字的占位展示在验收中作了下述修正。未引入新的运行时状态管理框架。同步 session 由 React `useSyncExternalStore` 订阅，使同一事件内的多次请求申请也可立即互斥。编辑修订号属于运行时状态，不写入场景协议。

旧前后端 `visiomasterAdapter.ts`、`lib/api.ts`、`routes/api.ts` 与 `evaluate.ts` 保留兼容入口，核心实现只有一份。面板不再接收任意场景 updater，所有内容修改通过明确命令提交。

## 2. 明确修复的行为

| 问题 | 当前行为 | 回归证据 |
| --- | --- | --- |
| 原生椭圆被转换为矩形 | 格式识别不依赖首节点，11 类节点及空场景正确处理；未知版本、混合词汇明确拒绝。 | `sceneImportFormats.test.ts` 的最初导入用例有失败结果，修复后与旧导入测试通过。 |
| 批量锁定产生多个撤销点 | 一次操作只提交一次；撤销/重做恢复整批。 | 旧逐节点调用函数复现 2 个提交；session 和浏览器回归通过。 |
| AI 等待时内容被修改、迟到响应覆盖 | 任务期间统一暂停内容编辑；取消传递 AbortSignal，提交同时验证任务 ID、文档 ID 和修订号。旧任务成功、失败和 finally 均不能影响新任务。 | 可控 Promise 与浏览器慢响应、取消后新任务用例；原问题属于静态风险路径，未声称旧版浏览器已复现。 |
| 多选属性显示和写入对象不同 | 面板和编辑动作共用主选择 selector。 | 浏览器先选择 beta 再 Shift 选择 alpha 的用例先失败，修复后通过。 |
| 多选调整层级受点击顺序影响 | 以场景堆叠顺序移动整组选区，保留内部顺序及锁定底图位置。 | session 和浏览器验证相邻两层整体上移、一次撤销。 |
| 拖拽/resize 中撤销后残留手势继续写入 | 历史导航递增 interactionEpoch；旧指针手势与旧预览不能继续修改场景。 | 两类浏览器用例先失败，修复后撤销保持、重做完整恢复。 |
| 草稿清空失败仍显示已保存 | 存储明确返回成功、内存回退或失败；仅实际成功更新保存状态，空文档失败仍触发离页保护。 | sceneStore 失败注入与浏览器配额失败/恢复检查。 |
| 配置重复提交、等待时 Esc 关闭 | 保存与清空共享同步互斥锁；等待时表单、关闭按钮和 Esc 一致遵守 busy。 | configWriter 竞态/重试用例、浏览器等待保存用例先红后绿。 |
| 评估空结果、漏样本仍可通过 | manifest、结果、基线、失败项逐项核对；无效指标与启用后的 AI 失败进入报告；CLI 在 CI 以非零退出。 | evaluationIntegrity、CLI 临时目录测试；空结果、缺失 delta、NaN 用例曾实际失败。 |
| SVG 默认文字不可见、普通分析占位文字叠印 | 文字采用 color 绘制并兼容仅 fill 的旧样式；普通分析保留检测区域和可编辑样式，未做 OCR 时内容为空。用户输入或导入的合法“Text”继续显示。 | 默认文字导出用例先失败后通过；占位处理和合法文字导入/导出回归、真实 SVG 截图与原基线复核通过。 |
| 缩略图遮挡、窄屏按钮断字、SVG 原生文字选中 | 缩略图定位到画布内容区；操作按钮保持完整文本；画布关闭浏览器原生文字选择。 | 四种布局截图人工查看及缩略图边界断言。 |

文字相关修复是验收中增加的行为调整：单独修正 SVG 文字颜色时，三张普通分析样本因固定“Text”覆盖原图而越过 SSIM 门禁。查看产物确认了叠印，再只调整普通分析的未 OCR 占位内容，保留文字区域及可编辑性，严格评估恢复通过。没有全局过滤“Text”、隐藏真实用户内容或重录基线。此前保存的旧分析场景仍按其实际文本渲染；其中已有的占位词可在属性面板清空。

## 3. 自动检查与运行证据

下面是同一实施工作区的实际结果，不把最终计数写作每阶段都独立运行过。重构前分析基准为 223 项测试通过。

| 检查 | 结果 | 范围与产物 |
| --- | --- | --- |
| `npm run typecheck` | 退出 0 | client / server / tests 三套 TypeScript，含 Playwright 与测试依赖。 |
| `npm run lint` | 退出 0 | React Hooks 规则与 TypeScript 模块解析的依赖边界检查。 |
| `npm test` | 322/322 通过，失败/跳过/取消均 0 | [本地完整日志](../../data/evaluation/refactor-tests.log)。 |
| `npm run build` | 退出 0 | 前后端类型检查与 Vite 生产构建；[日志](../../data/evaluation/refactor-build.log)。 |
| `npm run test:browser` | 14/14 通过 | Chromium；编辑、任务、保存、设置、布局及全图元 Canvas/SVG。已重验默认文字颜色。 |
| `CI=true EVALUATE_AI=0 npm run evaluate` | Windows 7/7，失败 0，validation.ok=true | 两项 delta 均 0；[summary](../../data/evaluation/summary.json)；文字修复与分析占位处理后已重跑通过。 |
| 隔离目录生产启动 | 页面、构建 JS、配置接口均 HTTP 200，启动目录创建正确 | 实际导入 `index.ts`，触发 SIGTERM 处理器后自然退出 0；[证据](../../data/evaluation/refactor-startup.json)。Windows 未模拟操作系统发送的 POSIX 信号。 |
| Git 空白差异检查 | 通过 | 提交前执行 `git diff --check`。 |

HTTP 测试使用真实 Express 路由、临时目录及注入依赖。浏览器任务响应使用可控模拟，验证编辑器接线和异步状态；没有付费模型调用。Playwright 已接入 CI，但本地运行不能证明远端 GitHub Actions 已通过。

## 4. 全图元、SVG 与 PowerPoint

人工构造 [gallery fixture](../../tests/fixtures/refactor-gallery.scene.json)，包含 22 个节点、11 类原生图元、4 条语义连线、表格、中文英文和受控 PNG。此样本用于渲染验收，不是新的图像识别真值，也未加入启发式基线。

可复现生成命令：`npx tsx scripts/render-refactor-gallery.ts`。脚本在隔离产物目录内生成图片，再使用真实 `sceneToSvg` / `sceneToPptx` 渲染。

| 产物 | 实际检查 |
| --- | --- |
| [Canvas 截图](../../data/evaluation/refactor-browser/gallery-canvas.png) | 真实 UI 导入 fixture，图元、表格、中文英文、图片和连线可见。 |
| [SVG](../../data/evaluation/refactor-gallery/refactor-gallery.svg) / [浏览器截图](../../data/evaluation/refactor-browser/gallery-svg.png) | 浏览器打开服务端渲染器的实际输出字节。 |
| [PPTX](../../data/evaluation/refactor-gallery/refactor-gallery.pptx) / [PowerPoint 渲染](../../data/evaluation/refactor-gallery/powerpoint-slide.png) | 已用本机 PowerPoint 16.0 无窗口只读打开并渲染，1 页、80 个对象、29 个文本对象及 1 张图片。 |
| [PPTX XML 检查](../../data/evaluation/refactor-gallery/pptx-xml-inspection.json) / [Office 对象检查](../../data/evaluation/refactor-gallery/powerpoint-inspection.json) | ZIP 内 20 个 XML/rels 可解析，79 个 `p:sp` 与 1 个 `p:pic`；包含中文英文。文档保留独立可编辑对象。 |

主编辑区、设置、980px 窄窗口与局部重建确认截图保存在 `data/evaluation/refactor-browser/`。截图已人工检查；PPTX 与 Canvas/SVG 使用不同文本布局引擎，不以可编辑对象和正常打开推断像素完全一致。

## 5. 环境、确定性与未完成项

- Windows x64，Node 24.15.0、sharp 0.34.5、libvips 8.17.3。7 张输入的大小、MD5、SHA256 与报告校验值见 [环境证据](../../data/evaluation/refactor-environment.json)。全部输入匹配 manifest 的 MD5 前缀。
- 原 baseline SHA256 为 `4e873823dc93feb7e12411d9c2aada0031f02276b69ff704685d387ff2752119`，本次没有修改基线或放宽 `0.005/-0.005` 阈值。
- Windows 字体文件与注册项已盘点；最终评估 SVG 声明 Times New Roman，但 70 个文字区域内容为空，不能用字体声明证明实际绘制了字形。Sharp 实际匹配到的字体文件未捕获；字体已安装不能证明渲染时实际使用。
- 重构中多次执行严格评估。最终结果的生成时间和 SHA 见环境证据；SVG 单独修复造成的中间失败报告保存在 `data/evaluation/history/2026-09-09-133259-intermediate-summary.json`，供核对修复原因。单张固定样本的两次场景深比较由确定性测试覆盖，没有把各次行为调整前后的 scene 宣称为字节完全一致。
- **Linux/Ubuntu 跨平台验收尚未完成。** WSL Ubuntu 24.04 中独立下载的 Node 20.19.0 经官方 SHASUM 校验，但隔离目录 `npm ci` 停滞约 235 秒后终止，没有 Linux 指标；[限制记录](../../data/evaluation/linux/blocked.txt) 和日志保留。未改系统字体或复用 Windows node_modules。R5.5 因这一项保持部分完成。
- 真实 AI 质量、费用和供应商兼容性未验收。`EVALUATE_AI=1` 当前检查执行与场景有效性，尚无 AI 专属结构/视觉指标，费用字段是 `null`。
- 保存交互使用实际 800ms 去抖和条件等待；尚未增加独立虚拟时钟 hook 测试。外部请求竞态采用可控制完成顺序的 Promise/路由测试。

## 6. 审查与后续执行

建议按共享导入/契约 → 编辑模型与 hooks → 后端路由/服务/存储 → 评估与工程脚本 → 样式/文档查看差异。缺陷用例和行为变化对应第 2 节，避免只看文件数量判断重构效果。

若需要回退，先保留当前工作区及用户既有文档差异，再按上述依赖顺序的反方向处理各单元；没有场景协议迁移或批量数据重写需要逆转换。本次使用统一重构提交，未创建阶段提交；回退时保留后来产生的工作区内容，不能把整仓强制重置当作无损回退。

剩余验收的下一步是在 Ubuntu CI 成功安装依赖后运行同一清单，记录实际字体和每样本 delta；只有取得平台产物并解释差异后再关闭 R5.5。其他产品能力边界继续见 [架构文档](../ARCHITECTURE.md)。
