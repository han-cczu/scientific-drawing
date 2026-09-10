import { createHash } from "node:crypto";
import sharp from "sharp";
import { logger } from "../logger";
import { findComponents, scaleBox } from "./analysis/components";
import {
  boxOverlapsAnyElement,
  componentToElement,
  dedupeElements,
  detectColorElements,
  detectStructuredElements,
  detectTextElements,
  keepUsefulBox,
  round
} from "./analysis/elements";
import { buildColorMask, buildForegroundMask } from "./analysis/mask";
import type { Scene, SceneNode } from "./types";

type AnalyzeInput = {
  id: string;
  imagePath: string;
  sourceUrl: string;
  title: string;
};

const MAX_SCAN_WIDTH = 900;
const MAX_HELPER_ELEMENTS = 260;

export async function analyzeImage(input: AnalyzeInput): Promise<Scene> {
  /*
   * ========================================================================
   * 步骤1：读取图片元数据
   * ========================================================================
   * 目标：
   *   1) 获取原始宽高，作为 scene 页面尺寸
   *   2) 生成缩略灰度图，降低后续扫描成本
   */
  logger.info("开始读取图片元数据...", { imagePath: input.imagePath });

  // 1.1 读取图片宽高
  const metadata = await sharp(input.imagePath).metadata();
  const width = metadata.width ?? 1200;
  const height = metadata.height ?? 800;

  // 1.2 计算扫描尺寸
  const scale = width > MAX_SCAN_WIDTH ? MAX_SCAN_WIDTH / width : 1;
  const scanWidth = Math.max(1, Math.round(width * scale));
  const scanHeight = Math.max(1, Math.round(height * scale));
  logger.info("读取图片元数据完成", { width, height, scanWidth, scanHeight });

  /*
   * ========================================================================
   * 步骤2：抽取高对比组件
   * ========================================================================
   * 目标：
   *   1) 用灰度阈值找出可能的文字、线条和图形区域
   *   2) 合并相邻像素，得到候选组件外框
   */
  logger.info("开始抽取高对比组件...", { scanWidth, scanHeight });

  // 2.1 生成缩放图管线
  const resized = sharp(input.imagePath).resize(scanWidth, scanHeight, { fit: "fill" });

  // 2.2 并行读取灰度和彩色像素
  const [buffer, colorBuffer] = await Promise.all([
    resized
      .clone()
      .grayscale()
      .raw()
      .toBuffer(),
    resized
      .clone()
      .toColourspace("srgb")
      .removeAlpha()
      .raw()
      .toBuffer()
  ]);

  // 2.3 标记非背景像素和彩色区域
  const mask = buildForegroundMask(buffer, scanWidth, scanHeight);
  const colorMask = buildColorMask(colorBuffer, scanWidth, scanHeight);

  // 2.4 连通域生成候选框
  const components = findComponents(mask, scanWidth, scanHeight)
    .map((box) => scaleBox(box, 1 / scale))
    .filter((box) => keepUsefulBox(box, width, height));
  const structuredElements = detectStructuredElements(mask, scanWidth, scanHeight, 1 / scale);
  const colorElements = detectColorElements(colorBuffer, colorMask, scanWidth, scanHeight, 1 / scale);
  const textElements = detectTextElements(mask, scanWidth, scanHeight, 1 / scale, colorElements);
  logger.info("抽取高对比组件完成", {
    components: components.length,
    structuredElements: structuredElements.length,
    colorElements: colorElements.length,
    textElements: textElements.length
  });

  /*
   * ========================================================================
   * 步骤3：生成可编辑场景
   * ========================================================================
   * 目标：
   *   1) 保留原图作为高保真锁定底图
   *   2) 把可靠候选组件作为低透明编辑辅助层
   */
  logger.info("开始生成可编辑场景...", { id: input.id });

  // 3.1 创建锁定背景图层
  const nodes: SceneNode[] = [
    {
      id: "source-image",
      type: "image",
      x: 0,
      y: 0,
      w: width,
      h: height,
      source: input.sourceUrl,
      locked: true,
      style: {
        opacity: 1
      }
    }
  ];

  // 3.2 创建结构化编辑节点和候选辅助节点
  const primaryElements = [...structuredElements, ...colorElements, ...textElements];
  const componentElements = components
    .filter((box) => !boxOverlapsAnyElement(box, primaryElements, 0.62))
    .map(componentToElement);
  const starterElements = dedupeElements([...primaryElements, ...componentElements]).slice(0, MAX_HELPER_ELEMENTS);

  // 3.3 写入候选节点
  for (const element of starterElements) {
    // 节点 id 使用类型 + 几何 SHA1 短摘要，保证同图多次运行 scene.json 字节级一致
    const x = round(element.x);
    const y = round(element.y);
    const w = round(element.w);
    const h = round(element.h);
    const idDigest = createHash("sha1")
      .update(`${element.type}:${x}:${y}:${w}:${h}`)
      .digest("hex")
      .slice(0, 8);
    nodes.push({
      id: `${element.type}-${idDigest}`,
      type: element.type,
      x,
      y,
      w,
      h,
      // Detection locates text boxes but does not run OCR. Keep the box editable
      // without painting a fabricated "Text" label over the original lettering.
      text: element.type === "text" && element.text === "Text" ? "" : element.text,
      points: element.points?.map((point) => ({ x: round(point.x), y: round(point.y) })),
      style: element.style
    });
  }

  // 3.4 组装 scene 协议
  const scene: Scene = {
    version: "0.1",
    page: {
      width,
      height,
      background: "#FFFFFF",
      units: "px"
    },
    metadata: {
      id: input.id,
      title: input.title,
      sourceImage: input.sourceUrl,
      createdAt: new Date().toISOString(),
      engine: "scientific-drawing.heuristic-v1",
      notes: [
        "Replica-first mode: the source image is kept as a locked full-opacity base layer.",
        "Detected regions are low-opacity editable helper nodes.",
        "Text detection provides empty editable regions; OCR content is still an extension point.",
        `Detected ${structuredElements.length} structured elements, ${colorElements.length} color elements, ${textElements.length} text regions, and ${componentElements.length} helper regions.`
      ]
    },
    nodes,
    edges: []
  };

  logger.info("生成可编辑场景完成", { nodes: scene.nodes.length });
  return scene;
}
