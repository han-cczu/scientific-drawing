import type {
  EvaluationBaselineDelta, EvaluationBaselineEntry, EvaluationFailure,
  EvaluationIssue, EvaluationValidation, SampleResult
} from "./types";

// Preserve the established tolerances; font and renderer differences are reported separately.
export const MAX_NORMALIZED_MEAN_DIFF_DELTA = 0.005;
export const MIN_SSIM_DELTA = -0.005;

const REQUIRED_METRICS = [
  "width", "height", "nodes", "editableNodes", "edges", "lockedNodes", "imageNodes",
  "textNodes", "shapeNodes", "edgeEndpointIssues", "meanDiff", "normalizedMeanDiff",
  "psnr", "ssim", "normalizedMeanDiffDelta", "ssimDelta"
] as const;

export type BaselineValidationOptions = {
  expectedFiles?: string[];
  baseline?: EvaluationBaselineEntry[];
  failures?: EvaluationFailure[];
  inputIssues?: EvaluationIssue[];
  aiEnabled?: boolean;
};

/** Return every violation without logging, mutating input, or terminating the process. */
export function validateEvaluationBaseline(
  results: SampleResult[], options: BaselineValidationOptions = {}
): EvaluationValidation {
  const issues: EvaluationIssue[] = [...(options.inputIssues ?? [])];
  const add = (code: string, message: string, file?: string) => issues.push({ code, message, ...(file ? { file } : {}) });
  const expectedFiles = options.expectedFiles ?? results.map((result) => result.file);
  if (expectedFiles.length === 0) add("empty_manifest", "Expected sample list is empty.");
  if (results.length === 0) add("empty_results", "Evaluation result set is empty.");

  for (const file of duplicates(expectedFiles)) add("duplicate_sample", "Manifest lists the sample more than once.", file);
  for (const file of duplicates(results.map((result) => result.file))) add("duplicate_result", "Sample has multiple evaluation results.", file);

  const resultFiles = new Set(results.map((result) => result.file));
  const expectedSet = new Set(expectedFiles);
  for (const file of expectedSet) {
    if (!resultFiles.has(file)) add("missing_result", "Expected sample has no successful result.", file);
  }
  for (const file of resultFiles) {
    if (!expectedSet.has(file)) add("unexpected_result", "Result does not belong to the expected sample list.", file);
  }

  if (options.baseline) {
    for (const file of duplicates(options.baseline.map((entry) => entry.file))) {
      add("duplicate_baseline", "Sample has multiple baseline entries.", file);
    }
    for (const file of expectedSet) {
      const entry = options.baseline.find((baseline) => baseline.file === file);
      if (!entry) {
        add("missing_baseline", "Expected sample has no baseline entry.", file);
        continue;
      }
      for (const metric of ["normalizedMeanDiff", "ssim"] as const) {
        if (!Number.isFinite(entry[metric])) add("invalid_baseline_metric", `Baseline ${metric} must be a finite number.`, file);
      }
    }
  }

  for (const failure of options.failures ?? []) add("sample_failure", `${failure.stage}: ${failure.error}`, failure.file);
  for (const result of results) {
    for (const metric of REQUIRED_METRICS) {
      if (!Number.isFinite(result[metric])) add("invalid_metric", `${metric} must be a finite number (including baseline deltas).`, result.file);
    }
    for (const mode of result.modeResults) {
      if (!mode.success) add("mode_failure", `${mode.mode}: ${mode.error ?? "Evaluation failed."}`, result.file);
    }
    for (const requiredMode of options.aiEnabled ? ["heuristic", "ai"] : ["heuristic"]) {
      if (!result.modeResults.some((mode) => mode.mode === requiredMode)) {
        add("missing_mode", `Missing ${requiredMode} evaluation result.`, result.file);
      }
    }
    if (result.normalizedMeanDiffDelta != null && result.normalizedMeanDiffDelta > MAX_NORMALIZED_MEAN_DIFF_DELTA) {
      add("visual_regression", `normalizedMeanDiffDelta=${result.normalizedMeanDiffDelta} > ${MAX_NORMALIZED_MEAN_DIFF_DELTA}`, result.file);
    }
    if (result.ssimDelta != null && result.ssimDelta < MIN_SSIM_DELTA) {
      add("visual_regression", `ssimDelta=${result.ssimDelta} < ${MIN_SSIM_DELTA}`, result.file);
    }
  }
  return { ok: issues.length === 0, issues };
}

export class EvaluationBaselineError extends Error {
  constructor(public readonly issues: EvaluationIssue[]) {
    super(`Evaluation baseline assertion failed:\n${issues.map((issue) => `  - ${issue.file ? `${issue.file}: ` : ""}${issue.message}`).join("\n")}`);
    this.name = "EvaluationBaselineError";
  }
}

/** Compatibility assertion: throws a normal error; the CLI alone owns the exit code. */
export function assertEvaluationBaseline(results: SampleResult[], options?: BaselineValidationOptions): void {
  const validation = validateEvaluationBaseline(results, options);
  if (!validation.ok) throw new EvaluationBaselineError(validation.issues);
}

export function deltaFromBaseline(
  result: { file: string; normalizedMeanDiff: number | null; ssim: number | null },
  baseline: EvaluationBaselineEntry[]
): EvaluationBaselineDelta {
  const entry = baseline.find((item) => item.file === result.file);
  return {
    normalizedMeanDiffDelta: roundedDelta(result.normalizedMeanDiff, entry?.normalizedMeanDiff),
    ssimDelta: roundedDelta(result.ssim, entry?.ssim)
  };
}

function roundedDelta(current: number | null, previous: number | null | undefined): number | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return Math.round((current - previous) * 10000) / 10000;
}

function duplicates(files: string[]) {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const file of files) {
    if (seen.has(file)) repeated.add(file);
    seen.add(file);
  }
  return repeated;
}
