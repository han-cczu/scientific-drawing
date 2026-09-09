import { formatEvaluationIssues, printSummary } from "./report";
import { runEvaluation, type RunEvaluationOptions } from "./run";
import { errorMessage } from "./samples";

export async function runEvaluationCli(options: RunEvaluationOptions = {}): Promise<number> {
  try {
    const report = await runEvaluation(options);
    printSummary(report.results);
    if (!report.validation.ok) {
      console.error(`Evaluation checks failed:\n${formatEvaluationIssues(report)}`);
      return (options.ci ?? process.env.CI === "true") ? 1 : 0;
    }
    return 0;
  } catch (error) {
    console.error(`Evaluation could not finish: ${errorMessage(error)}`);
    return 1;
  }
}
