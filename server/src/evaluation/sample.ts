import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "../logger";
import { analyzeImage } from "../scene/analyzeImage";
import { repairScene } from "../scene/repairScene";
import { sceneToSvg } from "../scene/svg";
import type { Scene } from "../scene/types";
import { normalizeImportedScene } from "../scene/visiomasterAdapter";
import { validateScene } from "@shared/sceneValidation";
import { computeSceneComplexity, countEditableNodes, measureVisualMetrics, summarizeTypes } from "./metrics";
import type { EvaluationMode, EvaluationModeResult, SampleResult } from "./types";
// Resolve a sourceUrl that sceneToSvg.localPathFromUrl can map back to disk.
// imagePath under data/<dir>/foo.png becomes /<dir>/foo.png; anything else
// falls back to /uploads/<basename> for compatibility with older callers.
export function sourceUrlFromImagePath(imagePath: string) {
  const normalized = imagePath.replaceAll("\\", "/");
  const match = normalized.match(/\/data\/([^/]+)\/([^/]+)$/);
  if (match) {
    return `/${match[1]}/${match[2]}`;
  }
  return `/uploads/${path.basename(imagePath)}`;
}

export function stripVolatileFields(scene: Scene): Scene {

  const cloned = JSON.parse(JSON.stringify(scene)) as Scene;

  if (cloned.metadata && "createdAt" in cloned.metadata) {
    delete (cloned.metadata as { createdAt?: string }).createdAt;
  }

  return cloned;
}

export type SampleEvaluationOptions = {
  aiEnabled?: boolean;
  aiRunner?: (imagePath: string, reportDir: string) => Promise<EvaluationModeResult>;
  resolveAssetPath?: (source: unknown) => string | null;
};

export async function evaluateSample(
  imagePath: string, reportDir: string, options: SampleEvaluationOptions = {}
): Promise<SampleResult> {
  logger.info("开始评估单张图片...", { imagePath });

  const heuristicStartedAt = Date.now();
  const id = path.basename(imagePath, path.extname(imagePath));
  const scene = await analyzeImage({
    id,
    imagePath,
    sourceUrl: sourceUrlFromImagePath(imagePath),
    title: path.basename(imagePath)
  });

  // scene.json 写入前去除易变字段（如 metadata.createdAt），便于结构性 diff；svg 渲染仍用原 scene
  const scenePath = path.join(reportDir, `${id}.scene.json`);
  const svgPath = path.join(reportDir, `${id}.svg`);
  // Analyze produces a single source image. Resolve that asset against this sample so
  // injected suites render independently of the server's process-wide data directory.
  const sourceUrl = sourceUrlFromImagePath(imagePath);
  const resolveAssetPath = options.resolveAssetPath ?? ((source: unknown) => source === sourceUrl ? imagePath : null);
  const svg = await sceneToSvg(scene, resolveAssetPath);
  await fs.writeFile(scenePath, JSON.stringify(stripVolatileFields(scene), null, 2), "utf-8");
  await fs.writeFile(svgPath, svg, "utf-8");

  const modeResults: EvaluationModeResult[] = [
    createEvaluationModeResult({
      mode: "heuristic",
      file: path.basename(imagePath),
      startedAt: heuristicStartedAt,
      endedAt: Date.now()
    })
  ];
  const aiResult = await evaluateAiModeIfEnabled(imagePath, reportDir, options);
  if (aiResult) {
    modeResults.push(aiResult);
  }
  const visualMetrics = await measureVisualMetrics(imagePath, Buffer.from(svg));
  const complexity = computeSceneComplexity(scene);
  const result: SampleResult = {
    file: path.basename(imagePath),
    width: scene.page.width,
    height: scene.page.height,
    nodes: scene.nodes.length,
    editableNodes: countEditableNodes(scene),
    edges: scene.edges.length,
    typeSummary: summarizeTypes(scene),
    ...visualMetrics,
    normalizedMeanDiffDelta: null,
    ssimDelta: null,
    modeResults,
    ...complexity
  };

  logger.info("评估单张图片完成", result);
  return result;
}

export function createEvaluationModeResult(input: {
  mode: EvaluationMode;
  file: string;
  startedAt: number;
  endedAt: number;
  error?: string;
}): EvaluationModeResult {
  logger.info("开始创建评估链路结果...", { mode: input.mode, file: input.file });

  const result: EvaluationModeResult = {
    mode: input.mode,
    file: input.file,
    latencyMs: input.endedAt - input.startedAt,
    success: !input.error,
    error: input.error,
    estimatedCostUsd: null
  };

  logger.info("创建评估链路结果完成", result);
  return result;
}

export async function evaluateAiModeIfEnabled(imagePath: string, reportDir: string, options: SampleEvaluationOptions = {}) {
  logger.info("开始按需评估 AI 重建链路...", { imagePath, enabled: process.env.EVALUATE_AI });

  if (!(options.aiEnabled ?? process.env.EVALUATE_AI === "1")) {
    logger.info("按需评估 AI 重建链路完成", { enabled: false });
    return null;
  }

  const file = path.basename(imagePath);
  const startedAt = Date.now();
  try {
    if (options.aiRunner) return await options.aiRunner(imagePath, reportDir);
    const [{ readAiRuntimeConfig }, { reconstructWithOpenAI }] = await Promise.all([
      import("../scene/aiProviderConfig"), import("../scene/reconstructWithOpenAI")
    ]);
    const runtimeConfig = readAiRuntimeConfig();
    if (!runtimeConfig.apiKey) throw new Error("OPENAI_API_KEY is not set.");
    const rawScene = await reconstructWithOpenAI({
      imagePath,
      mimeType: mimeTypeFromImagePath(imagePath),
      mode: "color",
      model: runtimeConfig.defaultModel
    });
    const scene = repairScene(normalizeImportedScene(rawScene));
    const validation = validateScene(scene);
    if (!validation.ok) {
      throw new Error(`AI scene invalid: ${validation.issues.map((issue) => issue.code).join(", ")}`);
    }

    const id = path.basename(imagePath, path.extname(imagePath));
    const aiScenePath = path.join(reportDir, `${id}.ai.scene.json`);
    await fs.writeFile(aiScenePath, JSON.stringify(scene, null, 2), "utf-8");

    const result = createEvaluationModeResult({
      mode: "ai",
      file,
      startedAt,
      endedAt: Date.now()
    });
    logger.info("按需评估 AI 重建链路完成", result);
    return result;
  } catch (error) {
    const result = createEvaluationModeResult({
      mode: "ai",
      file,
      startedAt,
      endedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error)
    });
    logger.warn("按需评估 AI 重建链路失败", result);
    return result;
  }
}

function mimeTypeFromImagePath(imagePath: string) {

  const extension = path.extname(imagePath).toLowerCase();

  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  return "image/png";
}
