# Evaluation Suite

Put stable evaluation images in this directory and register them in `manifest.json`.

Each sample should include:

- `file`: image file name under this directory.
- `category`: one of `paper_figure`, `flowchart`, `table`, `module`.
- `expectedNodes`: expected approximate editable node count.
- `expectedEdges`: expected approximate semantic edge count.
- `sourceMd5` (optional): short md5 prefix of the source image for traceability.
- `notes` (optional): human-readable provenance / context.

Runtime uploads under `data/uploads` are not a stable benchmark; if `manifest.json`
is empty, `evaluate.ts` falls back to uploads with a `logger.warn` and the resulting
sample set may contain duplicates (the original `uploads/` had the same image stored
under multiple UUID file names).

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

When you intentionally change heuristics or AI prompts and improve a sample, you
should re-capture the baseline by running `npm run evaluate` and copying the
relevant `normalizedMeanDiff` / `ssim` from `data/evaluation/summary.json` here.

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

`.github/workflows/ci.yml` 在 `npm test` 之后、`npm run build` 之前执行
`npm run evaluate`。GitHub Actions 默认会注入 `CI=true`，`evaluate.ts` 在该环境下
会调用 `assertEvaluationBaseline`：对每个样本如果

- `normalizedMeanDiffDelta > 0`（视觉差异比基线变大），或
- `ssimDelta < 0`（结构相似度比基线下降）

任一成立，则收集所有违规项后 `console.error` 并 `process.exit(1)`，使 PR 状态变红。
delta 为 `null`（基线无对应项）只 `logger.warn`，不视为违规。

阈值常量定义在 `server/src/evaluate.ts` 顶部
（`MAX_NORMALIZED_MEAN_DIFF_DELTA = 0`，`MIN_SSIM_DELTA = 0`），未来要放宽阈值
集中改这一处即可。

本地（非 CI）跑 `npm run evaluate` 不会触发断言，仅打印 summary 摘要，便于开发者
快速迭代。

首次接入或 `sharp` / 字体替代行为变化导致 CI Linux 与本地 Windows 出现稳定差异时，
需要在 CI 上跑一次拿到 Linux 实际指标后，回填到 `baseline.json` 再合并。

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

The AI reconstruction lane is skipped unless `EVALUATE_AI=1` is set in the
environment. When enabled, an `OPENAI_API_KEY` must also be configured; otherwise
the AI run is recorded as a failure entry without raising. The `estimatedCostUsd`
field is reserved in the schema but not yet populated by any provider.
