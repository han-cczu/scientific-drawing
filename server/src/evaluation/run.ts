import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { deltaFromBaseline, validateEvaluationBaseline } from "./baseline";
import { writeEvaluationReport } from "./report";
import { evaluateSample, type SampleEvaluationOptions } from "./sample";
import { errorMessage, loadEvaluationSamples, readEvaluationBaseline, resolveEvaluationPaths, type EvaluationPaths } from "./samples";
import type { EvaluationFailure, EvaluationIssue, EvaluationReport, SampleResult } from "./types";

export type RunEvaluationOptions = {
  paths?: Partial<EvaluationPaths>;
  ci?: boolean;
  aiEnabled?: boolean;
  sampleRunner?: (imagePath: string, reportDir: string, options: SampleEvaluationOptions) => Promise<SampleResult>;
};

/** Run all available samples, persist failures, and return a report. Only the CLI sets exitCode. */
export async function runEvaluation(options: RunEvaluationOptions = {}): Promise<EvaluationReport> {
  const paths = resolveEvaluationPaths(options.paths);
  const ci = options.ci ?? process.env.CI === "true";
  const aiEnabled = options.aiEnabled ?? process.env.EVALUATE_AI === "1";
  const sampleRunner = options.sampleRunner ?? evaluateSample;
  const [loaded, baseline] = await Promise.all([
    loadEvaluationSamples(paths, ci), readEvaluationBaseline(paths.baselinePath)
  ]);
  await fs.mkdir(paths.reportDir, { recursive: true });
  const inputIssues: EvaluationIssue[] = [...loaded.issues, ...baseline.issues];
  const results: SampleResult[] = [];
  const failures: EvaluationFailure[] = [];
  for (const sample of loaded.samples) {
    const file = path.basename(sample);
    try {
      const result = await sampleRunner(sample, paths.reportDir, { aiEnabled });
      if (result.file !== file) {
        inputIssues.push({ code: "mismatched_result", file, message: `Sample runner returned a result for ${result.file}.` });
      }
      results.push({ ...result, ...deltaFromBaseline(result, baseline.results) });
      for (const mode of result.modeResults) {
        if (!mode.success && mode.mode === "ai") failures.push({ file, stage: "ai", error: mode.error ?? "AI evaluation failed." });
      }
    } catch (error) {
      failures.push({ file, stage: "sample", error: errorMessage(error) });
    }
  }
  const report: EvaluationReport = {
    generatedAt: new Date().toISOString(),
    environment: {
      platform: process.platform, arch: process.arch, node: process.version,
      renderer: sharp.versions,
      fonts: {
        configFile: process.env.FONTCONFIG_FILE ?? null,
        configPath: process.env.FONTCONFIG_PATH ?? null,
        selection: "Renderer system font resolution; exact resolved font files are not captured."
      }
    },
    source: loaded.source, expectedFiles: loaded.expectedFiles, aiEnabled, results, failures,
    validation: validateEvaluationBaseline(results, {
      expectedFiles: loaded.expectedFiles, baseline: baseline.results, failures, inputIssues, aiEnabled
    })
  };
  await writeEvaluationReport(paths.reportDir, report);
  return report;
}
