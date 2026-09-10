import { pathToFileURL } from "node:url";
import { runEvaluationCli } from "./evaluation/cli";

// Preserve existing imports while implementation is separated by responsibility.
export * from "./evaluation/types";
export * from "./evaluation/metrics";
export * from "./evaluation/sample";
export * from "./evaluation/samples";
export * from "./evaluation/baseline";
export * from "./evaluation/report";
export * from "./evaluation/run";
export * from "./evaluation/cli";

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) process.exitCode = await runEvaluationCli();
