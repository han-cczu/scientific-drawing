import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { logger } from "./logger";
import { analyzeImage } from "./scene/analyzeImage";
import { readAiRuntimeConfig } from "./scene/aiProviderConfig";
import { repairScene } from "./scene/repairScene";
import { reconstructWithOpenAI } from "./scene/reconstructWithOpenAI";
import { sceneToSvg } from "./scene/svg";
import type { Scene } from "./scene/types";
import { normalizeImportedScene } from "./scene/visiomasterAdapter";
import { validateScene } from "@shared/sceneValidation";

export type SampleResult = {
  file: string;
  width: number;
  height: number;
  nodes: number;
  editableNodes: number;
  edges: number;
  typeSummary: string;
  meanDiff: number | null;
  normalizedMeanDiff: number | null;
  psnr: number | null;
  ssim: number | null;
  normalizedMeanDiffDelta: number | null;
  ssimDelta: number | null;
  lockedNodes: number;
  imageNodes: number;
  textNodes: number;
  shapeNodes: number;
  edgeEndpointIssues: number;
  modeResults: EvaluationModeResult[];
};

export type SceneComplexity = {
  lockedNodes: number;
  imageNodes: number;
  textNodes: number;
  shapeNodes: number;
  edgeEndpointIssues: number;
};

type EvaluationManifest = {
  version: number;
  samples: Array<{
    file: string;
    category?: string;
    expectedNodes?: number;
    expectedEdges?: number;
  }>;
};

export type EvaluationBaselineEntry = {
  file: string;
  normalizedMeanDiff?: number | null;
  ssim?: number | null;
};

type EvaluationBaseline = {
  version: number;
  results: EvaluationBaselineEntry[];
};

export type EvaluationBaselineDelta = {
  normalizedMeanDiffDelta: number | null;
  ssimDelta: number | null;
};

export type EvaluationMode = "heuristic" | "ai";

export type EvaluationModeResult = {
  mode: EvaluationMode;
  file: string;
  latencyMs: number;
  success: boolean;
  error?: string;
  estimatedCostUsd: number | null;
};

const SAMPLE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_EVAL_WIDTH = 900;

export async function runEvaluation() {
  /*
   * ========================================================================
   * 步骤1：运行实验评估
   * ========================================================================
   * 目标：
   *   1) 扫描 data/uploads 中的样例图片
   *   2) 重新生成 scene 并计算视觉和结构指标
   *   3) 输出可复现的评估报告
   */
  logger.info("开始运行实验评估...");

  // 1.1 解析样例目录和输出目录
  const rootDir = process.cwd();
  const uploadDir = path.join(rootDir, "data", "uploads");
  const suiteDir = path.join(rootDir, "data", "eval-suite");
  const baselinePath = path.join(suiteDir, "baseline.json");
  const reportDir = path.join(rootDir, "data", "evaluation");
  await fs.mkdir(reportDir, { recursive: true });

  // 1.2 执行样例评估
  const baseline = await readEvaluationBaseline(baselinePath);
  const samples = await listEvaluationSamples(rootDir, { suiteDir, fallbackDir: uploadDir });
  const results: SampleResult[] = [];
  for (const sample of samples) {
    const result = await evaluateSample(sample, reportDir);
    const delta = deltaFromBaseline(result, baseline.results);
    results.push({ ...result, ...delta });
  }

  // 1.3 写入报告
  const reportPath = path.join(reportDir, "summary.json");
  await fs.writeFile(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), "utf-8");
  logger.info("运行实验评估完成", { samples: results.length, reportPath });
  printSummary(results);
}

export async function listEvaluationSamples(rootDir: string, options?: { suiteDir?: string; fallbackDir?: string }) {
  /*
   * ========================================================================
   * 步骤1：读取评估样本入口
   * ========================================================================
   * 目标：
   *   1) 优先使用 data/eval-suite/manifest.json
   *   2) manifest 为空时兼容旧的 data/uploads 评估方式
   */
  logger.info("开始读取评估样本入口...", { rootDir });

  // 1.1 解析目录
  const suiteDir = options?.suiteDir ?? path.join(rootDir, "data", "eval-suite");
  const fallbackDir = options?.fallbackDir ?? path.join(rootDir, "data", "uploads");
  const manifestPath = path.join(suiteDir, "manifest.json");

  // 1.2 读取 manifest 样本
  const manifest = await readEvaluationManifest(manifestPath);
  if (manifest.samples.length > 0) {
    const samples = manifest.samples
      .map((sample) => path.join(suiteDir, sample.file))
      .sort((a, b) => a.localeCompare(b));
    logger.info("读取评估样本入口完成", { source: "eval-suite", samples: samples.length });
    return samples;
  }

  // 1.3 回退运行上传目录
  const samples = await listSamples(fallbackDir);
  logger.info("读取评估样本入口完成", { source: "uploads", samples: samples.length });
  return samples;
}

async function readEvaluationManifest(manifestPath: string): Promise<EvaluationManifest> {
  /*
   * ========================================================================
   * 步骤1：读取评估清单
   * ========================================================================
   * 目标：
   *   1) 支持缺失 manifest 时平滑回退
   *   2) 只接受 file 为字符串的样本
   */
  logger.info("开始读取评估清单...", { manifestPath });

  try {
    // 1.1 读取并解析 JSON
    const content = await fs.readFile(manifestPath, "utf-8");
    const payload = JSON.parse(content) as Partial<EvaluationManifest>;

    // 1.2 归一化样本列表
    const samples = Array.isArray(payload.samples)
      ? payload.samples.filter((sample): sample is EvaluationManifest["samples"][number] => typeof sample?.file === "string" && sample.file.length > 0)
      : [];

    logger.info("读取评估清单完成", { samples: samples.length });
    return { version: 1, samples };
  } catch (error) {
    logger.warn("读取评估清单失败，使用上传目录回退", { error: String(error) });
    return { version: 1, samples: [] };
  }
}

async function readEvaluationBaseline(baselinePath: string): Promise<EvaluationBaseline> {
  /*
   * ========================================================================
   * 步骤1：读取评估基线
   * ========================================================================
   * 目标：
   *   1) 支持 data/eval-suite/baseline.json 可选输入
   *   2) 只读取可用于 delta 的视觉指标
   */
  logger.info("开始读取评估基线...", { baselinePath });

  try {
    // 1.1 读取并解析 JSON
    const content = await fs.readFile(baselinePath, "utf-8");
    const payload = JSON.parse(content) as Partial<EvaluationBaseline>;

    // 1.2 归一化基线记录
    const results = Array.isArray(payload.results)
      ? payload.results.filter((result): result is EvaluationBaselineEntry => typeof result?.file === "string" && result.file.length > 0)
      : [];

    logger.info("读取评估基线完成", { results: results.length });
    return { version: 1, results };
  } catch (error) {
    logger.warn("读取评估基线失败，跳过基线对比", { error: String(error) });
    return { version: 1, results: [] };
  }
}

export async function listSamples(directory: string) {
  /*
   * ========================================================================
   * 步骤1：收集样例图片
   * ========================================================================
   * 目标：
   *   1) 只读取常见图片格式
   *   2) 按文件名稳定排序，保证评估可复现
   */
  logger.info("开始收集样例图片...", { directory });

  // 1.1 读取目录文件
  const entries = await fs.readdir(directory, { withFileTypes: true });

  // 1.2 过滤图片文件
  const samples = entries
    .filter((entry) => entry.isFile() && SAMPLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(directory, entry.name))
    .sort((a, b) => a.localeCompare(b));

  logger.info("收集样例图片完成", { samples: samples.length });
  return samples;
}

export async function evaluateSample(imagePath: string, reportDir: string): Promise<SampleResult> {
  /*
   * ========================================================================
   * 步骤1：评估单张图片
   * ========================================================================
   * 目标：
   *   1) 生成 scene 和 SVG
   *   2) 渲染 SVG 后和原图计算平均像素差
   *   3) 汇总可编辑对象和结构质量指标
   */
  logger.info("开始评估单张图片...", { imagePath });

  // 1.1 生成 scene
  const heuristicStartedAt = Date.now();
  const id = path.basename(imagePath, path.extname(imagePath));
  const scene = await analyzeImage({
    id,
    imagePath,
    sourceUrl: `/uploads/${path.basename(imagePath)}`,
    title: path.basename(imagePath)
  });

  // 1.2 导出评估产物
  const scenePath = path.join(reportDir, `${id}.scene.json`);
  const svgPath = path.join(reportDir, `${id}.svg`);
  const svg = await sceneToSvg(scene);
  await fs.writeFile(scenePath, JSON.stringify(scene, null, 2), "utf-8");
  await fs.writeFile(svgPath, svg, "utf-8");

  // 1.3 计算视觉差异和对象统计
  const modeResults: EvaluationModeResult[] = [
    createEvaluationModeResult({
      mode: "heuristic",
      file: path.basename(imagePath),
      startedAt: heuristicStartedAt,
      endedAt: Date.now()
    })
  ];
  const aiResult = await evaluateAiModeIfEnabled(imagePath, reportDir);
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
  /*
   * ========================================================================
   * 步骤1：创建评估链路结果
   * ========================================================================
   * 目标：
   *   1) 统一记录启发式和 AI 链路状态
   *   2) 保留耗时、失败原因和成本占位字段
   */
  logger.info("开始创建评估链路结果...", { mode: input.mode, file: input.file });

  // 1.1 生成链路结果
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

async function evaluateAiModeIfEnabled(imagePath: string, reportDir: string) {
  /*
   * ========================================================================
   * 步骤1：按需评估 AI 重建链路
   * ========================================================================
   * 目标：
   *   1) 默认不调用外部模型
   *   2) EVALUATE_AI=1 时记录 AI 耗时、成功率和校验状态
   */
  logger.info("开始按需评估 AI 重建链路...", { imagePath, enabled: process.env.EVALUATE_AI });

  // 1.1 未启用时跳过
  if (process.env.EVALUATE_AI !== "1") {
    logger.info("按需评估 AI 重建链路完成", { enabled: false });
    return null;
  }

  // 1.2 缺少 API Key 时记录失败
  const file = path.basename(imagePath);
  const startedAt = Date.now();
  const runtimeConfig = readAiRuntimeConfig();
  if (!runtimeConfig.apiKey) {
    const result = createEvaluationModeResult({
      mode: "ai",
      file,
      startedAt,
      endedAt: Date.now(),
      error: "OPENAI_API_KEY is not set."
    });
    logger.info("按需评估 AI 重建链路完成", result);
    return result;
  }

  try {
    // 1.3 调用 AI 重建并校验结果
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

    // 1.4 写入 AI 链路产物
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
    // 1.5 捕获 AI 失败并继续评估主链路
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
  /*
   * ========================================================================
   * 步骤1：根据文件扩展名推断 MIME
   * ========================================================================
   * 目标：
   *   1) 给 AI 重建 data URL 提供 MIME
   *   2) 未识别时回退 PNG
   */

  // 1.1 读取扩展名
  const extension = path.extname(imagePath).toLowerCase();

  // 1.2 返回 MIME
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  return "image/png";
}

export async function measureMeanDiff(imagePath: string, svgBytes: Buffer) {
  /*
   * ========================================================================
   * 步骤1：计算平均像素差
   * ========================================================================
   * 目标：
   *   1) 把原图和导出 SVG 统一缩放到评估尺寸
   *   2) 用 RGB 绝对差均值判断复刻保真度
   */
  logger.info("开始计算平均像素差...", { imagePath });

  // 1.1 复用视觉指标管线
  const metrics = await measureVisualMetrics(imagePath, svgBytes);

  // 1.2 返回旧接口字段
  logger.info("计算平均像素差完成", { result: metrics.meanDiff });
  return metrics.meanDiff;
}

export type VisualMetrics = {
  meanDiff: number | null;
  normalizedMeanDiff: number | null;
  psnr: number | null;
  ssim: number | null;
};

export async function measureVisualMetrics(imagePath: string, svgBytes: Buffer): Promise<VisualMetrics> {
  /*
   * ========================================================================
   * 步骤1：计算视觉评估指标
   * ========================================================================
   * 目标：
   *   1) 保留原始 meanDiff
   *   2) 补充归一化误差、PSNR 和近似 SSIM
   */
  logger.info("开始计算视觉评估指标...", { imagePath });

  try {
    // 1.1 读取原图尺寸并计算评估尺寸
    const metadata = await sharp(imagePath).metadata();
    const width = metadata.width ?? 1;
    const height = metadata.height ?? 1;
    const scale = width > MAX_EVAL_WIDTH ? MAX_EVAL_WIDTH / width : 1;
    const evalWidth = Math.max(1, Math.round(width * scale));
    const evalHeight = Math.max(1, Math.round(height * scale));

    // 1.2 渲染原图和 SVG
    const [source, rendered] = await Promise.all([
      sharp(imagePath)
        .resize(evalWidth, evalHeight, { fit: "fill" })
        .removeAlpha()
        .raw()
        .toBuffer(),
      sharp(svgBytes, { density: 96 })
        .resize(evalWidth, evalHeight, { fit: "fill" })
        .removeAlpha()
        .raw()
        .toBuffer()
    ]);

    // 1.3 汇总视觉指标
    let absoluteDiffTotal = 0;
    let squaredDiffTotal = 0;
    const length = Math.min(source.length, rendered.length);
    for (let index = 0; index < length; index += 1) {
      const diff = source[index] - rendered[index];
      absoluteDiffTotal += Math.abs(diff);
      squaredDiffTotal += diff * diff;
    }
    const safeLength = Math.max(1, length);
    const meanDiff = Math.round((absoluteDiffTotal / safeLength) * 100) / 100;
    const mse = squaredDiffTotal / safeLength;
    const result: VisualMetrics = {
      meanDiff,
      normalizedMeanDiff: normalizeMeanDiff(meanDiff),
      psnr: computePsnr(mse),
      ssim: computeSsimApprox(source, rendered)
    };

    logger.info("计算视觉评估指标完成", result);
    return result;
  } catch (error) {
    logger.warn("计算视觉评估指标失败", { imagePath, error: String(error) });
    return { meanDiff: null, normalizedMeanDiff: null, psnr: null, ssim: null };
  }
}

export function normalizeMeanDiff(meanDiff: number | null) {
  /*
   * ========================================================================
   * 步骤1：归一化平均像素差
   * ========================================================================
   * 目标：
   *   1) 把 0..255 通道误差压到 0..1
   *   2) 保留 null 失败状态
   */
  logger.info("开始归一化平均像素差...", { meanDiff });

  // 1.1 处理失败状态
  if (meanDiff === null) {
    logger.info("归一化平均像素差完成", { result: null });
    return null;
  }

  // 1.2 返回四位小数指标
  const result = Math.round((meanDiff / 255) * 10000) / 10000;
  logger.info("归一化平均像素差完成", { result });
  return result;
}

export function computePsnr(mse: number) {
  /*
   * ========================================================================
   * 步骤1：计算 PSNR
   * ========================================================================
   * 目标：
   *   1) 用均方误差衡量像素级保真度
   *   2) 零误差返回 Infinity
   */
  logger.info("开始计算 PSNR...", { mse });

  // 1.1 处理零误差
  if (mse === 0) {
    logger.info("计算 PSNR 完成", { result: Infinity });
    return Infinity;
  }

  // 1.2 计算并保留两位小数
  const result = Math.round(10 * Math.log10((255 * 255) / mse) * 100) / 100;
  logger.info("计算 PSNR 完成", { result });
  return result;
}

export function computeSsimApprox(source: Buffer, rendered: Buffer) {
  /*
   * ========================================================================
   * 步骤1：计算近似 SSIM
   * ========================================================================
   * 目标：
   *   1) 用全图亮度统计补充平均像素差
   *   2) 输出限制在 SSIM 合法范围内
   */
  logger.info("开始计算近似 SSIM...", { sourceLength: source.length, renderedLength: rendered.length });

  // 1.1 处理空输入
  const length = Math.min(source.length, rendered.length);
  if (length === 0) {
    logger.info("计算近似 SSIM 完成", { result: 0 });
    return 0;
  }

  // 1.2 计算均值
  let meanX = 0;
  let meanY = 0;
  for (let index = 0; index < length; index += 1) {
    meanX += source[index];
    meanY += rendered[index];
  }
  meanX /= length;
  meanY /= length;

  // 1.3 计算方差和协方差
  let varianceX = 0;
  let varianceY = 0;
  let covariance = 0;
  for (let index = 0; index < length; index += 1) {
    const dx = source[index] - meanX;
    const dy = rendered[index] - meanY;
    varianceX += dx * dx;
    varianceY += dy * dy;
    covariance += dx * dy;
  }
  varianceX /= length;
  varianceY /= length;
  covariance /= length;

  // 1.4 计算并限制范围
  const c1 = 6.5025;
  const c2 = 58.5225;
  const rawValue = ((2 * meanX * meanY + c1) * (2 * covariance + c2)) / ((meanX * meanX + meanY * meanY + c1) * (varianceX + varianceY + c2));
  const result = Math.max(-1, Math.min(1, Math.round(rawValue * 10000) / 10000));
  logger.info("计算近似 SSIM 完成", { result });
  return result;
}

export function deltaFromBaseline(
  result: { file: string; normalizedMeanDiff: number | null; ssim: number | null },
  baseline: EvaluationBaselineEntry[]
): EvaluationBaselineDelta {
  /*
   * ========================================================================
   * 步骤1：计算相对基线差异
   * ========================================================================
   * 目标：
   *   1) 按文件名匹配历史评估结果
   *   2) 输出当前视觉指标相对基线的变化
   */
  logger.info("开始计算相对基线差异...", { file: result.file });

  // 1.1 查找同名基线记录
  const baselineResult = baseline.find((item) => item.file === result.file);
  if (!baselineResult) {
    const emptyDelta = { normalizedMeanDiffDelta: null, ssimDelta: null };
    logger.info("计算相对基线差异完成", emptyDelta);
    return emptyDelta;
  }

  // 1.2 计算指标差值
  const delta: EvaluationBaselineDelta = {
    normalizedMeanDiffDelta: roundedDelta(result.normalizedMeanDiff, baselineResult.normalizedMeanDiff ?? null),
    ssimDelta: roundedDelta(result.ssim, baselineResult.ssim ?? null)
  };

  logger.info("计算相对基线差异完成", delta);
  return delta;
}

function roundedDelta(current: number | null, previous: number | null) {
  /*
   * ========================================================================
   * 步骤1：计算四位小数差值
   * ========================================================================
   * 目标：
   *   1) 任一侧缺失时保留 null
   *   2) 避免浮点尾差污染报告
   */
  logger.info("开始计算四位小数差值...", { current, previous });

  // 1.1 处理缺失指标
  if (current === null || previous === null) {
    logger.info("计算四位小数差值完成", { result: null });
    return null;
  }

  // 1.2 返回四位小数差值
  const result = Math.round((current - previous) * 10000) / 10000;
  logger.info("计算四位小数差值完成", { result });
  return result;
}

export function summarizeTypes(scene: Scene) {
  /*
   * ========================================================================
   * 步骤1：汇总节点类型
   * ========================================================================
   * 目标：
   *   1) 统计每类节点数量
   *   2) 生成短文本，便于报告阅读
   */
  logger.info("开始汇总节点类型...", { nodes: scene.nodes.length });

  // 1.1 统计类型数量
  const counts = new Map<string, number>();
  for (const node of scene.nodes) {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  }

  // 1.2 拼接摘要
  const result = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${type}=${count}`)
    .join(", ");
  logger.info("汇总节点类型完成", { result });
  return result;
}

export function countEditableNodes(scene: Scene) {
  /*
   * ========================================================================
   * 步骤1：统计可编辑节点
   * ========================================================================
   * 目标：
   *   1) 排除锁定底图
   *   2) 作为评估摘要的核心可编辑性指标
   */

  // 1.1 过滤未锁定节点
  return scene.nodes.filter((node) => !node.locked).length;
}

export function computeSceneComplexity(scene: Scene): SceneComplexity {
  /*
   * ========================================================================
   * 步骤1：计算结构复杂度
   * ========================================================================
   * 目标：
   *   1) 统计关键节点类别
   *   2) 捕获连线端点引用问题
   */

  // 1.1 统计节点类型
  const nodeIds = new Set(scene.nodes.map((node) => node.id));
  const lockedNodes = scene.nodes.filter((node) => node.locked).length;
  const imageNodes = scene.nodes.filter((node) => node.type === "image").length;
  const textNodes = scene.nodes.filter((node) => node.type === "text").length;
  const shapeNodes = scene.nodes.filter((node) => node.type !== "image" && node.type !== "text").length;

  // 1.2 统计坏端点
  const edgeEndpointIssues = scene.edges.reduce((count, edge) => {
    const fromIssue = edge.from ? Number(!nodeIds.has(edge.from.split(":")[0])) : 0;
    const toIssue = edge.to ? Number(!nodeIds.has(edge.to.split(":")[0])) : 0;
    return count + fromIssue + toIssue;
  }, 0);

  return { lockedNodes, imageNodes, textNodes, shapeNodes, edgeEndpointIssues };
}

export function formatSummaryLine(result: SampleResult) {
  /*
   * ========================================================================
   * 步骤1：格式化评估摘要行
   * ========================================================================
   * 目标：
   *   1) 输出视觉差异和结构指标
   *   2) 保持命令行报告短而稳定
   */

  // 1.1 拼接摘要字段
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
  /*
   * ========================================================================
   * 步骤1：打印评估摘要
   * ========================================================================
   * 目标：
   *   1) 输出每张样例的关键指标
   *   2) 保持命令行报告短而稳定
   */
  logger.info("开始打印评估摘要...", { samples: results.length });

  // 1.1 生成报告行
  const lines = results.map(formatSummaryLine);

  // 1.2 输出到控制台
  console.log(lines.join("\n"));
  logger.info("打印评估摘要完成");
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  await runEvaluation();
}
