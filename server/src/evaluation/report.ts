import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "../logger";
import type { SampleResult, EvaluationReport } from "./types";

export async function writeEvaluationReport(reportDir: string, report: EvaluationReport) {
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, "summary.json");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
  return reportPath;
}

export function formatEvaluationIssues(report: EvaluationReport) {
  return report.validation.issues.map((issue) =>
    `  - [${issue.code}] ${issue.file ? `${issue.file}: ` : ""}${issue.message}`
  ).join("\n");
}
export function formatSummaryLine(result: SampleResult) {

  return [
    result.file,
    `${result.width}x${result.height}`,
    `editable=${result.editableNodes}`,
    `edges=${result.edges}`,
    `locked=${result.lockedNodes}`,
    `images=${result.imageNodes}`,
    `texts=${result.textNodes}`,
    `shapes=${result.shapeNodes}`,
    `endpointIssues=${result.edgeEndpointIssues}`,
    `meanDiff=${result.meanDiff ?? "n/a"}`,
    `normalized=${result.normalizedMeanDiff ?? "n/a"}`,
    `normalizedDelta=${result.normalizedMeanDiffDelta ?? "n/a"}`,
    `psnr=${result.psnr ?? "n/a"}`,
    `ssim=${result.ssim ?? "n/a"}`,
    `ssimDelta=${result.ssimDelta ?? "n/a"}`,
    result.typeSummary
  ].join(" | ");
}

export function printSummary(results: SampleResult[]) {
  logger.info("开始打印评估摘要...", { samples: results.length });

  const lines = results.map(formatSummaryLine);

  console.log(lines.join("\n"));
  logger.info("打印评估摘要完成");
}
