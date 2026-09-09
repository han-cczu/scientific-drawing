# Evaluation Suite

Put stable evaluation images in this directory and register them in `manifest.json`.

Each sample should include:

- `file`: image file name under this directory.
- `category`: one of `paper_figure`, `flowchart`, `table`, `module`.
- `expectedNodes`: expected approximate editable node count.
- `expectedEdges`: expected approximate semantic edge count.
- `sourceMd5` (optional): short md5 prefix of the source image for traceability.
- `notes` (optional): human-readable provenance / context.

Runtime uploads under `data/uploads` are not a stable benchmark. Local runs may
fall back to uploads when the manifest is unavailable or empty, but record the
manifest failure in `summary.json`. CI requires a valid nonempty manifest and
never falls back. Sample names must refer directly to image files in this folder;
duplicate names, invalid entries, and missing image files fail the checks.

## baseline.json

`baseline.json` is the **heuristic snapshot** used to compute regression deltas
(`normalizedMeanDiffDelta`, `ssimDelta`) in summary reports. Each entry records:

```json
{ "file": "<sample>", "normalizedMeanDiff": <number>, "ssim": <number> }
```

**This is not ground truth.** The values are simply the output of the current
heuristic pipeline at the time the baseline was captured. Use it to detect
regressions ("did this PR make samples worse than before?"), not to judge
absolute correctness.

When intentionally changing heuristics, compare the visual output and explain the
metric differences before updating the affected entries. Keep baseline changes
separate from structural refactoring. AI evaluation records execution state and
does not currently replace the heuristic visual baseline.

## expected* fields

`expectedNodes` / `expectedEdges` are **approximate** targets used for sanity
checks, not strict assertions. The current values were seeded from heuristic
output and have not been hand-verified — they may not represent the true
optimum reconstruction.

## Coverage gaps

The current suite covers `image + rect + text` compositions only. There are
no `flowchart` (edges > 0), no `table`, and no failure-mode samples. These
should be added before drawing any confident "robustness" conclusions.

## CI 集成

`npm run evaluate` 通过 `server/src/evaluate.ts` 进入评估 CLI。GitHub Actions
默认注入 `CI=true`，此时以下任何问题均返回非零退出码：

- manifest 缺失、格式错误、为空、包含重复或非法样本；
- 预期样本缺失、执行失败、结果重复或结果文件名错配；
- 基线文件缺失、样本无基线、基线重复或缺少必需指标；
- 必需视觉和结构指标、基线 delta 不是有限数值；
- 必需评估链路缺失或失败（显式启用的 AI 链路也必须成功）；
- 下述视觉回归阈值任一超出：

- `normalizedMeanDiffDelta > MAX_NORMALIZED_MEAN_DIFF_DELTA`（视觉差异比基线变大），或
- `ssimDelta < MIN_SSIM_DELTA`（结构相似度比基线下降）

阈值常量定义在 `server/src/evaluation/baseline.ts`
（`MAX_NORMALIZED_MEAN_DIFF_DELTA = 0.005`，`MIN_SSIM_DELTA = -0.005`），
非 0 是因为 sharp/libvips 在 Windows 开发机与 Ubuntu CI 上栅格化 SVG 时
可能存在抗锯齿与字体差异。重构保留这些既有阈值，不通过放宽阈值掩盖回归。

单样本失败不会中止其余样本。`summary.json` 保留 `expectedFiles`、成功的
`results`、执行失败的 `failures` 和完整的 `validation.issues`。
先写报告，再由 CLI 设置退出码；纯判定 `validateEvaluationBaseline` 返回结果，
兼容入口 `assertEvaluationBaseline` 抛出普通异常，两者均不终止调用进程。

本地（非 CI）会打印同样的失败清单并保存 `validation.ok: false`，以便探索样本；
指标检查失败不设置非零退出码，报告本身无法写出等运行错误仍返回非零退出码。

报告记录系统、架构、Node、sharp/libvips 及字体相关库版本、Fontconfig 环境路径。
实际被系统选中的字体文件尚未捕获，不能把版本记录视为跨平台视觉一致性的保证。
若平台或字体替代产生稳定差异，应先在对应平台复现并审阅 SVG 与实际指标，再决定
是否建立有说明的平台基线，不能直接用当前输出覆盖基线。

实现职责：`samples.ts` 加载输入与解析路径，`metrics.ts` 计算指标，`sample.ts`
运行单样本，`baseline.ts` 纯判定，`report.ts` 格式化与写报告，`run.ts` 编排，
`cli.ts` 决定退出码。`runEvaluation({ paths, ci, aiEnabled, sampleRunner })`
支持临时目录及模拟样本执行器；默认执行器也能直接渲染临时目录中的真实图片。

## 确定性输出

`analyzeImage` 已硬化为确定性输出：

- 节点 `id` 改为 `${type}-${sha1(\`${type}:${x}:${y}:${w}:${h}\`).slice(0,8)}`，
  使用类型 + 几何坐标的 SHA1 短摘要，不再含 `uuidv4` 随机段或 index 序号。
  同图任意次运行节点 id 完全一致；几何唯一性由现有 `dedupeElements` 保证。
- `metadata.createdAt` 在 `evaluateSample` 写入 `.scene.json` 前由
  `stripVolatileFields` 移除，确保评估产物字节级稳定。业务路径（用户上传 →
  分析 → 编辑）仍保留 `createdAt` 作为产物溯源字段，不受影响。

校验方式：连续两次跑 `npm run evaluate`，对 `data/evaluation/*.scene.json` 取
`md5sum` 应当完全一致；`tests/analyzeImageDeterminism.test.ts` 也对此做了 e2e 覆盖。

## AI evaluation

The AI reconstruction lane is skipped unless `EVALUATE_AI=1` is explicitly set
(or `aiEnabled: true` is passed to the runner). It uses the configured AI provider.
Missing credentials and request/validation failures are retained in mode results
and the report's failure list; enabled AI failures also fail CI checks. The
`estimatedCostUsd` field is reserved and is not populated by any provider.

Offline validation on 2026-09-09: all seven manifest samples passed in CI mode on
Windows x64, Node 24.15.0, sharp 0.34.5 and libvips 8.17.3. Both regression deltas
were zero for every sample. The existing baseline and thresholds were unchanged;
this run did not make AI requests and does not establish Linux or model quality.
