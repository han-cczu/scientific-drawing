import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, type TestContext } from "node:test";
import {
  assertEvaluationBaseline, evaluateAiModeIfEnabled, evaluateSample, runEvaluation, runEvaluationCli,
  validateEvaluationBaseline, type SampleResult
} from "../server/src/evaluate";

function successfulResult(file = "a.png"): SampleResult {
  return {
    file, width: 10, height: 10, nodes: 1, editableNodes: 1, edges: 0,
    typeSummary: "rect=1", meanDiff: 1, normalizedMeanDiff: 0.01, psnr: 35,
    ssim: 0.95, normalizedMeanDiffDelta: 0, ssimDelta: 0,
    lockedNodes: 0, imageNodes: 0, textNodes: 0, shapeNodes: 1,
    edgeEndpointIssues: 0,
    modeResults: [{ mode: "heuristic", file, latencyMs: 1, success: true, estimatedCostUsd: null }]
  };
}

describe("evaluation integrity", () => {
  it("rejects an empty result set", () => {
    assert.throws(() => assertEvaluationBaseline([]), /empty/i);
  });

  it("rejects absent baseline metrics instead of silently skipping the sample", () => {
    assert.throws(() => assertEvaluationBaseline([
      { ...successfulResult(), normalizedMeanDiffDelta: null, ssimDelta: null }
    ]), /normalizedMeanDiffDelta|baseline/i);
  });

  it("rejects non-finite required metrics", () => {
    for (const value of [null, undefined, Number.NaN, Infinity, -Infinity]) {
      assert.throws(() => assertEvaluationBaseline([
        { ...successfulResult(), normalizedMeanDiff: value } as SampleResult
      ]), /normalizedMeanDiff/i);
    }
  });

  it("collects duplicate, missing and unexpected results and missing baseline entries", () => {
    const validation = validateEvaluationBaseline([successfulResult(), successfulResult(), successfulResult("extra.png")], {
      expectedFiles: ["a.png", "a.png", "b.png"], baseline: []
    });
    assert.equal(validation.ok, false);
    const codes = new Set(validation.issues.map((issue) => issue.code));
    for (const code of ["duplicate_sample", "duplicate_result", "missing_result", "unexpected_result", "missing_baseline"]) {
      assert.ok(codes.has(code), `expected ${code}`);
    }
  });

  it("rejects incomplete and duplicate baseline records and missing evaluation modes", () => {
    const validation = validateEvaluationBaseline([{ ...successfulResult(), modeResults: [] }], {
      baseline: [{ file: "a.png", ssim: 0.95 }, { file: "a.png", normalizedMeanDiff: Infinity, ssim: 0.95 }],
      aiEnabled: true
    });
    const codes = validation.issues.map((issue) => issue.code);
    assert.ok(codes.includes("duplicate_baseline"));
    assert.ok(codes.includes("invalid_baseline_metric"));
    assert.equal(codes.filter((code) => code === "missing_mode").length, 2);
  });

  it("collects every regression without terminating the host process", () => {
    const exitCode = process.exitCode;
    const results = [
      { ...successfulResult(), normalizedMeanDiffDelta: 0.006 },
      { ...successfulResult("b.png"), ssimDelta: -0.006 }
    ];
    const validation = validateEvaluationBaseline(results);
    assert.equal(validation.issues.filter((issue) => issue.code === "visual_regression").length, 2);
    assert.throws(() => assertEvaluationBaseline(results), /a\.png[\s\S]*b\.png/);
    assert.equal(process.exitCode, exitCode);
    assert.doesNotThrow(() => assertEvaluationBaseline([
      { ...successfulResult(), normalizedMeanDiffDelta: 0.005, ssimDelta: -0.005 }
    ]));
  });
});

async function temporarySuite(t: TestContext, files = ["a.png", "b.png"]) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-evaluation-"));
  t.after(async () => {
    const target = path.resolve(rootDir);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith("drawing-evaluation-"));
    await fs.rm(target, { recursive: true, force: true });
  });
  const suiteDir = path.join(rootDir, "data", "eval-suite");
  const reportDir = path.join(rootDir, "reports");
  await fs.mkdir(suiteDir, { recursive: true });
  const manifestPath = path.join(suiteDir, "manifest.json");
  const baselinePath = path.join(suiteDir, "baseline.json");
  await fs.writeFile(manifestPath, JSON.stringify({ version: 1, samples: files.map((file) => ({ file })) }));
  await fs.writeFile(baselinePath, JSON.stringify({ version: 1, results: files.map((file) => ({ file, normalizedMeanDiff: 0.01, ssim: 0.95 })) }));
  return { rootDir, suiteDir, reportDir, manifestPath, baselinePath };
}

describe("evaluation run and CLI", () => {
  it("renders a real sample from an isolated directory with its source image embedded", async (t) => {
    const paths = await temporarySuite(t, ["a.png"]);
    const samplePath = path.join(paths.suiteDir, "a.png");
    await fs.copyFile(path.join(process.cwd(), "data", "eval-suite", "module-small-2rect.png"), samplePath);
    await fs.mkdir(paths.reportDir, { recursive: true });
    const result = await evaluateSample(samplePath, paths.reportDir, { aiEnabled: false });
    assert.ok(Number.isFinite(result.normalizedMeanDiff));
    assert.ok(Number.isFinite(result.ssim));
    assert.match(await fs.readFile(path.join(paths.reportDir, "a.svg"), "utf-8"), /href="data:image\/png;base64,/);
  });

  it("records every missing image using the real offline runner", async (t) => {
    const paths = await temporarySuite(t);
    const report = await runEvaluation({ paths, ci: true, aiEnabled: false });
    assert.equal(report.validation.ok, false);
    assert.equal(report.results.length, 0);
    assert.deepEqual(report.failures.map((failure) => failure.file), ["a.png", "b.png"]);
    assert.ok(report.failures.every((failure) => failure.error.length > 0));
  });

  it("keeps every failing sample and continues producing a complete report", async (t) => {
    const paths = await temporarySuite(t, ["a.png", "b.png", "c.png"]);
    const calls: string[] = [];
    const exitCode = process.exitCode;
    const report = await runEvaluation({
      paths, ci: true, aiEnabled: false,
      sampleRunner: async (file, _reportDir, options) => {
        assert.equal(options.aiEnabled, false);
        const name = path.basename(file);
        calls.push(name);
        if (name !== "b.png") throw new Error(`failure in ${name}`);
        return successfulResult(name);
      }
    });
    assert.deepEqual(calls, ["a.png", "b.png", "c.png"]);
    assert.deepEqual(report.results.map((result) => result.file), ["b.png"]);
    assert.deepEqual(report.failures.map((failure) => failure.file), ["a.png", "c.png"]);
    assert.equal(report.validation.ok, false);
    assert.equal(report.validation.issues.filter((issue) => issue.code === "missing_result").length, 2);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(paths.reportDir, "summary.json"), "utf-8")), report);
    assert.equal(process.exitCode, exitCode);
  });

  for (const manifestCase of ["missing", "empty", "invalid", "duplicates"] as const) {
    it(`fails CI for a ${manifestCase} manifest without falling back to uploads`, async (t) => {
      const paths = await temporarySuite(t);
      if (manifestCase === "missing") await fs.unlink(paths.manifestPath);
      if (manifestCase === "empty") await fs.writeFile(paths.manifestPath, '{"samples":[]}');
      if (manifestCase === "invalid") await fs.writeFile(paths.manifestPath, '{"samples":[{"file":"../outside.png"},{"file":4}]}');
      if (manifestCase === "duplicates") await fs.writeFile(paths.manifestPath, '{"samples":[{"file":"a.png"},{"file":"a.png"}]}');
      let count = 0;
      const report = await runEvaluation({ paths, ci: true, aiEnabled: false, sampleRunner: async (file) => {
        count += 1;
        return successfulResult(path.basename(file));
      } });
      assert.equal(report.validation.ok, false);
      assert.equal(report.source, "manifest");
      assert.equal(count, manifestCase === "duplicates" ? 1 : 0);
    });
  }

  it("records missing baseline files, incomplete baseline coverage, and invalid metrics", async (t) => {
    const paths = await temporarySuite(t);
    await fs.unlink(paths.baselinePath);
    const missing = await runEvaluation({ paths, ci: true, aiEnabled: false, sampleRunner: async (file) => successfulResult(path.basename(file)) });
    assert.equal(missing.validation.ok, false);
    assert.ok(missing.validation.issues.some((issue) => issue.code === "baseline_unavailable"));
    assert.equal(missing.validation.issues.filter((issue) => issue.code === "missing_baseline").length, 2);
    await fs.writeFile(paths.baselinePath, '{"results":[{"file":"a.png","normalizedMeanDiff":0.01,"ssim":null}]}');
    const incomplete = await runEvaluation({ paths, ci: true, aiEnabled: false, sampleRunner: async (file) => successfulResult(path.basename(file)) });
    assert.ok(incomplete.validation.issues.some((issue) => issue.code === "invalid_baseline_metric"));
    assert.ok(incomplete.validation.issues.some((issue) => issue.code === "missing_baseline" && issue.file === "b.png"));
  });

  it("reports local fallback and its benchmark failure instead of hiding it", async (t) => {
    const paths = await temporarySuite(t, []);
    const fallbackDir = path.join(paths.rootDir, "data", "uploads");
    await fs.mkdir(fallbackDir, { recursive: true });
    await fs.writeFile(path.join(fallbackDir, "local.png"), "test image placeholder");
    const options = { paths, ci: false, aiEnabled: false, sampleRunner: async () => successfulResult("local.png") };
    const report = await runEvaluation(options);
    assert.equal(report.source, "uploads");
    assert.equal(report.validation.ok, false);
    assert.equal(report.results.length, 1);
    assert.equal(await runEvaluationCli(options), 0);
  });

  it("rejects a runner result attributed to the wrong sample", async (t) => {
    const paths = await temporarySuite(t, ["a.png"]);
    const report = await runEvaluation({ paths, ci: true, aiEnabled: false, sampleRunner: async () => successfulResult("wrong.png") });
    assert.ok(report.validation.issues.some((issue) => issue.code === "mismatched_result"));
    assert.ok(report.validation.issues.some((issue) => issue.code === "missing_result" && issue.file === "a.png"));
  });

  it("keeps AI disabled without calling an injected runner, and records enabled failures", async (t) => {
    let calls = 0;
    const aiRunner = async () => { calls += 1; throw new Error("simulated AI unavailable"); };
    assert.equal(await evaluateAiModeIfEnabled("a.png", "unused", { aiEnabled: false, aiRunner }), null);
    assert.equal(calls, 0);
    const ai = await evaluateAiModeIfEnabled("a.png", "unused", { aiEnabled: true, aiRunner });
    assert.equal(calls, 1);
    assert.equal(ai?.success, false);
    assert.equal(ai?.error, "simulated AI unavailable");
    assert.ok(ai);
    const paths = await temporarySuite(t, ["a.png"]);
    const report = await runEvaluation({ paths, ci: true, aiEnabled: true, sampleRunner: async () => {
      const result = successfulResult();
      return { ...result, modeResults: [...result.modeResults, ai] };
    } });
    assert.equal(report.validation.ok, false);
    assert.deepEqual(report.failures.map((failure) => failure.stage), ["ai"]);
    assert.ok(report.validation.issues.some((issue) => issue.code === "mode_failure"));
  });

  it("passes a complete suite and returns the CLI status without changing process.exitCode", async (t) => {
    const paths = await temporarySuite(t);
    const options = { paths, ci: true, aiEnabled: false, sampleRunner: async (file: string) => successfulResult(path.basename(file)) };
    const report = await runEvaluation(options);
    assert.equal(report.validation.ok, true);
    assert.deepEqual(report.failures, []);
    assert.equal(await runEvaluationCli(options), 0);
    assert.equal(await runEvaluationCli({ ...options, sampleRunner: async () => { throw new Error("sample failed"); } }), 1);
  });

  it("sets a nonzero process exit code in the real CLI after writing the failed report", async (t) => {
    const paths = await temporarySuite(t, []);
    const rootDir = process.cwd();
    const child = spawnSync(process.execPath, [
      path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs"),
      "--tsconfig", path.join(rootDir, "tsconfig.json"), path.join(rootDir, "server", "src", "evaluate.ts")
    ], { cwd: paths.rootDir, env: { ...process.env, CI: "true", EVALUATE_AI: "0" }, encoding: "utf-8" });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 1, child.stderr);
    const report = JSON.parse(await fs.readFile(path.join(paths.rootDir, "data", "evaluation", "summary.json"), "utf-8"));
    assert.equal(report.validation.ok, false);
    assert.deepEqual(report.expectedFiles, []);
  });
});
