import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { logger } from "./logger";
import { analyzeImage } from "./scene/analyzeImage";
import { sceneToSvg } from "./scene/svg";
import type { Scene } from "./scene/types";

type SampleResult = {
  file: string;
  width: number;
  height: number;
  nodes: number;
  editableNodes: number;
  edges: number;
  typeSummary: string;
  meanDiff: number | null;
};

const SAMPLE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_EVAL_WIDTH = 900;

/*
 * ========================================================================
 * 步骤1：运行实验评估
 * ========================================================================
 * 目标：
 *   1) 扫描 data/uploads 中的样例图片
 *   2) 重新生成 scene 并计算基础质量指标
 *   3) 输出可复现的评估报告
 */
logger.info("开始运行实验评估...");

// 1.1 解析样例目录和输出目录
const rootDir = process.cwd();
const uploadDir = path.join(rootDir, "data", "uploads");
const reportDir = path.join(rootDir, "data", "evaluation");
await fs.mkdir(reportDir, { recursive: true });

// 1.2 执行样例评估
const samples = await listSamples(uploadDir);
const results: SampleResult[] = [];
for (const sample of samples) {
  results.push(await evaluateSample(sample, reportDir));
}

// 1.3 写入报告
const reportPath = path.join(reportDir, "summary.json");
await fs.writeFile(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), "utf-8");
logger.info("运行实验评估完成", { samples: results.length, reportPath });
printSummary(results);

async function listSamples(directory: string) {
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

async function evaluateSample(imagePath: string, reportDir: string): Promise<SampleResult> {
  /*
   * ========================================================================
   * 步骤1：评估单张图片
   * ========================================================================
   * 目标：
   *   1) 生成 scene 和 SVG
   *   2) 渲染 SVG 后和原图计算平均像素差
   *   3) 汇总可编辑对象数量
   */
  logger.info("开始评估单张图片...", { imagePath });

  // 1.1 生成 scene
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
  const meanDiff = await measureMeanDiff(imagePath, Buffer.from(svg));
  const result: SampleResult = {
    file: path.basename(imagePath),
    width: scene.page.width,
    height: scene.page.height,
    nodes: scene.nodes.length,
    editableNodes: scene.nodes.filter((node) => !node.locked).length,
    edges: scene.edges.length,
    typeSummary: summarizeTypes(scene),
    meanDiff
  };

  logger.info("评估单张图片完成", result);
  return result;
}

async function measureMeanDiff(imagePath: string, svgBytes: Buffer) {
  /*
   * ========================================================================
   * 步骤1：计算平均像素差
   * ========================================================================
   * 目标：
   *   1) 把原图和导出 SVG 统一缩放到评估尺寸
   *   2) 用 RGB 绝对差均值判断复刻保真度
   */
  logger.info("开始计算平均像素差...", { imagePath });

  try {
    // 1.1 读取原图尺寸并计算评估尺寸
    const metadata = await sharp(imagePath).metadata();
    const width = metadata.width ?? 1;
    const height = metadata.height ?? 1;
    const scale = width > MAX_EVAL_WIDTH ? MAX_EVAL_WIDTH / width : 1;
    const evalWidth = Math.max(1, Math.round(width * scale));
    const evalHeight = Math.max(1, Math.round(height * scale));

    // 1.2 渲染原图和 SVG
    const source = await sharp(imagePath)
      .resize(evalWidth, evalHeight, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer();
    const rendered = await sharp(svgBytes, { density: 96 })
      .resize(evalWidth, evalHeight, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer();

    // 1.3 计算平均差异
    let total = 0;
    const length = Math.min(source.length, rendered.length);
    for (let index = 0; index < length; index += 1) {
      total += Math.abs(source[index] - rendered[index]);
    }
    const result = Math.round((total / Math.max(1, length)) * 100) / 100;
    logger.info("计算平均像素差完成", { result });
    return result;
  } catch (error) {
    logger.warn("计算平均像素差失败", { imagePath, error: String(error) });
    return null;
  }
}

function summarizeTypes(scene: Scene) {
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

function printSummary(results: SampleResult[]) {
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
  const lines = results.map((result) => {
    return [
      result.file,
      `${result.width}x${result.height}`,
      `editable=${result.editableNodes}`,
      `edges=${result.edges}`,
      `meanDiff=${result.meanDiff ?? "n/a"}`,
      result.typeSummary
    ].join(" | ");
  });

  // 1.2 输出到控制台
  console.log(lines.join("\n"));
  logger.info("打印评估摘要完成");
}
