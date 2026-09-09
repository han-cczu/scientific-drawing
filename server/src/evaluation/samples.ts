import { promises as fs } from "node:fs";
import path from "node:path";
import { EvaluationBaselineError } from "./baseline";
import type { EvaluationBaselineEntry, EvaluationIssue } from "./types";

const SAMPLE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export type EvaluationPaths = {
  rootDir: string;
  suiteDir: string;
  fallbackDir: string;
  manifestPath: string;
  baselinePath: string;
  reportDir: string;
};

export function resolveEvaluationPaths(options: Partial<EvaluationPaths> = {}): EvaluationPaths {
  const rootDir = options.rootDir ?? process.cwd();
  const suiteDir = options.suiteDir ?? path.join(rootDir, "data", "eval-suite");
  return {
    rootDir, suiteDir,
    fallbackDir: options.fallbackDir ?? path.join(rootDir, "data", "uploads"),
    manifestPath: options.manifestPath ?? path.join(suiteDir, "manifest.json"),
    baselinePath: options.baselinePath ?? path.join(suiteDir, "baseline.json"),
    reportDir: options.reportDir ?? path.join(rootDir, "data", "evaluation")
  };
}

export async function loadEvaluationSamples(paths: EvaluationPaths, ci: boolean) {
  const issues: EvaluationIssue[] = [];
  const payload = await readJson(paths.manifestPath, "manifest", issues);
  const files: string[] = [];
  if (payload) {
    if (!Array.isArray(payload.samples)) {
      issues.push({ code: "invalid_manifest", message: "Manifest must contain a samples array." });
    } else {
      for (const [index, sample] of payload.samples.entries()) {
        const file = sample?.file;
        if (!isSampleFile(file)) {
          issues.push({ code: "invalid_manifest_sample", message: `Manifest sample ${index} must name an image directly inside the suite directory.` });
        } else {
          files.push(file);
        }
      }
    }
  }
  if (files.length > 0) {
    return {
      source: "manifest" as const, expectedFiles: files,
      samples: [...new Set(files)].sort().map((file) => path.join(paths.suiteDir, file)), issues
    };
  }
  issues.push({ code: "empty_manifest", message: "Manifest contains no valid samples." });
  if (ci) return { source: "manifest" as const, expectedFiles: [], samples: [], issues };

  // Local exploration may use uploads, but an invalid benchmark stays visible in the report.
  let samples: string[] = [];
  try {
    samples = await listSamples(paths.fallbackDir);
  } catch (error) {
    issues.push({ code: "uploads_unavailable", message: `Could not read fallback samples: ${errorMessage(error)}` });
  }
  return { source: "uploads" as const, expectedFiles: samples.map((sample) => path.basename(sample)), samples, issues };
}

export async function readEvaluationBaseline(baselinePath: string) {
  const issues: EvaluationIssue[] = [];
  const payload = await readJson(baselinePath, "baseline", issues);
  const results: EvaluationBaselineEntry[] = [];
  if (payload) {
    if (!Array.isArray(payload.results)) {
      issues.push({ code: "invalid_baseline", message: "Baseline must contain a results array." });
    } else {
      for (const [index, entry] of payload.results.entries()) {
        if (!isRecord(entry) || !isSampleFile(entry.file)) {
          issues.push({ code: "invalid_baseline_entry", message: `Baseline entry ${index} must name a suite image.` });
          continue;
        }
        results.push({ file: entry.file, normalizedMeanDiff: entry.normalizedMeanDiff as number | null, ssim: entry.ssim as number | null });
      }
    }
  }
  return { version: 1, results, issues };
}

export async function listEvaluationSamples(
  rootDir: string, options: { suiteDir?: string; fallbackDir?: string; ci?: boolean } = {}
) {
  const ci = options.ci ?? process.env.CI === "true";
  const loaded = await loadEvaluationSamples(resolveEvaluationPaths({ rootDir, ...options }), ci);
  if (ci && loaded.issues.length) throw new EvaluationBaselineError(loaded.issues);
  return loaded.samples;
}

export async function listSamples(directory: string) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && SAMPLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(directory, entry.name)).sort((a, b) => a.localeCompare(b));
}

async function readJson(file: string, kind: string, issues: EvaluationIssue[]): Promise<Record<string, unknown> | null> {
  try {
    const payload: unknown = JSON.parse(await fs.readFile(file, "utf-8"));
    if (!isRecord(payload)) throw new Error("Root JSON value must be an object.");
    return payload;
  } catch (error) {
    issues.push({ code: `${kind}_unavailable`, message: `Could not read ${kind}: ${errorMessage(error)}` });
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSampleFile(file: unknown): file is string {
  return typeof file === "string" && file.length > 0 && !file.includes("/") && !file.includes("\\")
    && !file.includes(":") && SAMPLE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
