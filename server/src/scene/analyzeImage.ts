import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger";
import type { Scene, SceneNode } from "./types";

type AnalyzeInput = {
  id: string;
  imagePath: string;
  sourceUrl: string;
  title: string;
};

type ComponentBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
};

type ColorSample = {
  r: number;
  g: number;
  b: number;
};

type Segment = {
  orientation: "horizontal" | "vertical";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type AnalysisElement = {
  type: SceneNode["type"];
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  points?: Array<{ x: number; y: number }>;
  style: SceneNode["style"];
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

  // 2.2 转灰度并取原始像素
  const buffer = await resized
    .clone()
    .grayscale()
    .raw()
    .toBuffer();

  // 2.3 读取彩色像素
  const colorBuffer = await resized
    .clone()
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer();

  // 2.4 标记非背景像素
  const mask = buildForegroundMask(buffer, scanWidth, scanHeight);

  // 2.5 标记彩色区域
  const colorMask = buildColorMask(colorBuffer, scanWidth, scanHeight);

  // 2.6 连通域生成候选框
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
  for (const [index, element] of starterElements.entries()) {
    nodes.push({
      id: `${element.type}-${index + 1}-${uuidv4().slice(0, 8)}`,
      type: element.type,
      x: round(element.x),
      y: round(element.y),
      w: round(element.w),
      h: round(element.h),
      text: element.text,
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
        "Text detection marks editable text regions only; OCR content is still an extension point.",
        `Detected ${structuredElements.length} structured elements, ${colorElements.length} color elements, ${textElements.length} text regions, and ${componentElements.length} helper regions.`
      ]
    },
    nodes,
    edges: []
  };

  logger.info("生成可编辑场景完成", { nodes: scene.nodes.length });
  return scene;
}

function buildForegroundMask(buffer: Buffer, width: number, height: number): Uint8Array {
  /*
   * ========================================================================
   * 步骤1：估算背景亮度
   * ========================================================================
   * 目标：
   *   1) 采样边缘像素估算背景
   *   2) 用背景差值提取前景
   */
  logger.info("开始估算背景亮度...", { width, height });

  // 1.1 收集边缘像素
  const samples: number[] = [];
  for (let x = 0; x < width; x += 4) {
    samples.push(buffer[x]);
    samples.push(buffer[(height - 1) * width + x]);
  }
  for (let y = 0; y < height; y += 4) {
    samples.push(buffer[y * width]);
    samples.push(buffer[y * width + width - 1]);
  }

  // 1.2 使用中位数作为背景值
  samples.sort((a, b) => a - b);
  const background = samples[Math.floor(samples.length / 2)] ?? 255;
  logger.info("估算背景亮度完成", { background });

  /*
   * ========================================================================
   * 步骤2：生成前景掩码
   * ========================================================================
   * 目标：
   *   1) 标记和背景差异明显的像素
   *   2) 忽略极浅阴影和压缩噪点
   */
  logger.info("开始生成前景掩码...", { background });

  // 2.1 按阈值提取前景
  const mask = new Uint8Array(width * height);
  const threshold = background > 210 ? 36 : 46;
  for (let index = 0; index < buffer.length; index += 1) {
    const value = buffer[index];
    if (Math.abs(value - background) > threshold && value < 245) {
      mask[index] = 1;
    }
  }

  // 2.2 删除稀疏噪点
  denoiseMask(mask, width, height);
  logger.info("生成前景掩码完成", { threshold });
  return mask;
}

function buildColorMask(buffer: Buffer, width: number, height: number): Uint8Array {
  /*
   * ========================================================================
   * 步骤1：生成彩色区域掩码
   * ========================================================================
   * 目标：
   *   1) 从 RGB 像素中提取高饱和区域
   *   2) 捕获论文图里的彩色编号块和浅色高亮条
   */
  logger.info("开始生成彩色区域掩码...", { width, height });

  // 1.1 初始化掩码
  const mask = new Uint8Array(width * height);

  // 1.2 按饱和度和背景差异提取彩色像素
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 3;
    const r = buffer[offset];
    const g = buffer[offset + 1];
    const b = buffer[offset + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max - min;
    const brightness = (r + g + b) / 3;
    const strongColor = saturation >= 34 && brightness <= 245;
    if (strongColor) {
      mask[pixel] = 1;
    }
  }

  // 1.3 删除孤立噪点
  denoiseMask(mask, width, height);
  logger.info("生成彩色区域掩码完成");
  return mask;
}

function denoiseMask(mask: Uint8Array, width: number, height: number) {
  /*
   * ========================================================================
   * 步骤1：清理孤立噪点
   * ========================================================================
   * 目标：
   *   1) 统计每个前景像素周围的前景邻居
   *   2) 删除邻居过少的孤立像素
   */
  logger.info("开始清理孤立噪点...", { width, height });

  // 1.1 复制原始掩码
  const original = new Uint8Array(mask);

  // 1.2 删除孤立点
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (!original[index]) {
        continue;
      }
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          neighbors += original[(y + dy) * width + x + dx];
        }
      }
      if (neighbors <= 1) {
        mask[index] = 0;
      }
    }
  }
  logger.info("清理孤立噪点完成");
}

function detectColorElements(
  colorBuffer: Buffer,
  colorMask: Uint8Array,
  width: number,
  height: number,
  scale: number
): AnalysisElement[] {
  /*
   * ========================================================================
   * 步骤1：检测彩色图块
   * ========================================================================
   * 目标：
   *   1) 用彩色掩码连通域找到彩色编号块和高亮行
   *   2) 保留颜色作为可编辑矩形填充
   */
  logger.info("开始检测彩色图块...", { width, height, scale });

  // 1.1 提取彩色连通域
  const boxes = findComponents(colorMask, width, height)
    .filter((box) => keepColorBox(box, width, height))
    .map((box) => expandBox(box, 1, width, height));

  // 1.2 转成矩形元素
  const elements = dedupeElements(boxes.map((box) => elementFromColorBox(scaleBox(box, scale), averageColor(colorBuffer, width, height, box))));
  logger.info("检测彩色图块完成", { boxes: boxes.length, elements: elements.length });
  return elements.slice(0, MAX_HELPER_ELEMENTS);
}

function detectTextElements(
  mask: Uint8Array,
  width: number,
  height: number,
  scale: number,
  blockers: AnalysisElement[]
): AnalysisElement[] {
  /*
   * ========================================================================
   * 步骤1：检测文字行候选
   * ========================================================================
   * 目标：
   *   1) 用连通域和邻近合并找文本行区域
   *   2) 排除彩色块内部数字，避免重复覆盖
   */
  logger.info("开始检测文字行候选...", { width, height, scale });

  // 1.1 提取候选笔画连通域
  const glyphBoxes = findRawComponents(mask, width, height)
    .filter((box) => keepTextGlyphBox(box, width, height))
    .filter((box) => !boxOverlapsAnyElement(scaleBox(box, scale), blockers, 0.58));

  // 1.2 合并成文本行或短标签
  const lineBoxes = mergeTextLineBoxes(glyphBoxes, width, height);

  // 1.3 过滤明显不是文字的区域
  const elements = lineBoxes
    .map((box) => scaleBox(expandBox(box, 2, width, height), scale))
    .filter((box) => keepTextBox(box))
    .map(elementFromTextBox)
    .filter((element) => !elementOverlapsAnyElement(element, blockers, 0.58));

  const result = dedupeElements(elements);
  logger.info("检测文字行候选完成", { glyphs: glyphBoxes.length, lines: lineBoxes.length, elements: result.length });
  return result.slice(0, MAX_HELPER_ELEMENTS);
}

function findComponents(mask: Uint8Array, width: number, height: number): ComponentBox[] {
  /*
   * ========================================================================
   * 步骤1：扫描连通域
   * ========================================================================
   * 目标：
   *   1) 遍历前景掩码
   *   2) 用 flood fill 合并相邻像素
   */
  logger.info("开始扫描连通域...", { width, height });

  // 1.1 初始化访问状态
  const visited = new Uint8Array(width * height);
  const boxes: ComponentBox[] = [];

  // 1.2 遍历所有像素
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index] || visited[index]) {
        continue;
      }
      const box = flood(mask, visited, width, height, x, y);
      if (box.area >= 8) {
        boxes.push(box);
      }
    }
  }
  logger.info("扫描连通域完成", { boxes: boxes.length });

  /*
   * ========================================================================
   * 步骤2：合并邻近组件
   * ========================================================================
   * 目标：
   *   1) 把文字笔画和相邻边框合并成区域
   *   2) 降低前端初始节点数量
   */
  logger.info("开始合并邻近组件...", { boxes: boxes.length });

  // 2.1 多轮合并相交或接近的框
  let merged = boxes;
  for (let pass = 0; pass < 2; pass += 1) {
    merged = mergeNearbyBoxes(merged, 4 + pass * 3);
  }

  // 2.2 按面积从大到小排序并限制数量
  merged.sort((a, b) => b.area - a.area);
  logger.info("合并邻近组件完成", { boxes: merged.length });
  return merged.slice(0, 180);
}

function findRawComponents(mask: Uint8Array, width: number, height: number): ComponentBox[] {
  /*
   * ========================================================================
   * 步骤1：扫描原始连通域
   * ========================================================================
   * 目标：
   *   1) 保留未合并的笔画和小组件
   *   2) 给文字行聚类提供基础框
   */
  logger.info("开始扫描原始连通域...", { width, height });

  // 1.1 初始化访问状态
  const visited = new Uint8Array(width * height);
  const boxes: ComponentBox[] = [];

  // 1.2 遍历所有像素
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index] || visited[index]) {
        continue;
      }
      const box = flood(mask, visited, width, height, x, y);
      if (box.area >= 4) {
        boxes.push(box);
      }
    }
  }

  logger.info("扫描原始连通域完成", { boxes: boxes.length });
  return boxes;
}

function detectStructuredElements(mask: Uint8Array, width: number, height: number, scale: number): AnalysisElement[] {
  /*
   * ========================================================================
   * 步骤1：检测结构化图元
   * ========================================================================
   * 目标：
   *   1) 从前景掩码中提取水平线和垂直线
   *   2) 用线段组合出矩形、箭头和辅助线
   */
  logger.info("开始检测结构化图元...", { width, height, scale });

  // 1.1 检测水平和垂直线段
  const horizontal = detectHorizontalSegments(mask, width, height);
  const vertical = detectVerticalSegments(mask, width, height);

  // 1.2 组合高置信矩形
  const rectangles = detectRectangles(horizontal, vertical).map((box) => elementFromRect(scaleBox(box, scale)));

  // 1.3 暂停启发式箭头输出
  const elements = dedupeElements(rectangles);
  logger.info("检测结构化图元完成", {
    horizontal: horizontal.length,
    vertical: vertical.length,
    elements: elements.length
  });
  return elements.slice(0, 180);
}

function detectHorizontalSegments(mask: Uint8Array, width: number, height: number): Segment[] {
  /*
   * ========================================================================
   * 步骤1：扫描水平线段
   * ========================================================================
   * 目标：
   *   1) 逐行找连续前景像素
   *   2) 合并相邻行上的同向线段
   */
  logger.info("开始扫描水平线段...", { width, height });

  // 1.1 逐行提取长 run
  const raw: Segment[] = [];
  const minLength = Math.max(18, Math.round(width * 0.035));
  for (let y = 0; y < height; y += 1) {
    let x = 0;
    while (x < width) {
      while (x < width && !mask[y * width + x]) {
        x += 1;
      }
      const start = x;
      while (x < width && mask[y * width + x]) {
        x += 1;
      }
      const end = x - 1;
      if (end - start + 1 >= minLength) {
        raw.push({ orientation: "horizontal", x1: start, y1: y, x2: end, y2: y });
      }
    }
  }

  // 1.2 合并相邻线段
  const merged = mergeCollinearSegments(raw, 3, 8);
  logger.info("扫描水平线段完成", { raw: raw.length, merged: merged.length });
  return merged;
}

function detectVerticalSegments(mask: Uint8Array, width: number, height: number): Segment[] {
  /*
   * ========================================================================
   * 步骤1：扫描垂直线段
   * ========================================================================
   * 目标：
   *   1) 逐列找连续前景像素
   *   2) 合并相邻列上的同向线段
   */
  logger.info("开始扫描垂直线段...", { width, height });

  // 1.1 逐列提取长 run
  const raw: Segment[] = [];
  const minLength = Math.max(18, Math.round(height * 0.045));
  for (let x = 0; x < width; x += 1) {
    let y = 0;
    while (y < height) {
      while (y < height && !mask[y * width + x]) {
        y += 1;
      }
      const start = y;
      while (y < height && mask[y * width + x]) {
        y += 1;
      }
      const end = y - 1;
      if (end - start + 1 >= minLength) {
        raw.push({ orientation: "vertical", x1: x, y1: start, x2: x, y2: end });
      }
    }
  }

  // 1.2 合并相邻线段
  const merged = mergeCollinearSegments(raw, 3, 8);
  logger.info("扫描垂直线段完成", { raw: raw.length, merged: merged.length });
  return merged;
}

function mergeCollinearSegments(segments: Segment[], axisTolerance: number, gapTolerance: number): Segment[] {
  /*
   * ========================================================================
   * 步骤1：合并共线线段
   * ========================================================================
   * 目标：
   *   1) 把粗线条的多行或多列合并成一条中心线
   *   2) 把小断裂补成连续线段
   */
  logger.info("开始合并共线线段...", { segments: segments.length });

  // 1.1 复制待处理列表
  const remaining = [...segments];
  const merged: Segment[] = [];

  // 1.2 逐条吸收可合并线段
  while (remaining.length) {
    let current = remaining.shift()!;
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        const candidate = remaining[index];
        if (canMergeSegment(current, candidate, axisTolerance, gapTolerance)) {
          current = unionSegment(current, candidate);
          remaining.splice(index, 1);
          changed = true;
        }
      }
    }
    merged.push(current);
  }

  logger.info("合并共线线段完成", { merged: merged.length });
  return merged;
}

function canMergeSegment(a: Segment, b: Segment, axisTolerance: number, gapTolerance: number) {
  if (a.orientation !== b.orientation) {
    return false;
  }
  if (a.orientation === "horizontal") {
    const axisClose = Math.abs(a.y1 - b.y1) <= axisTolerance;
    const overlap = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
    const gap = Math.max(a.x1, b.x1) - Math.min(a.x2, b.x2);
    return axisClose && (overlap >= -gapTolerance || gap <= gapTolerance);
  }
  const axisClose = Math.abs(a.x1 - b.x1) <= axisTolerance;
  const overlap = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  const gap = Math.max(a.y1, b.y1) - Math.min(a.y2, b.y2);
  return axisClose && (overlap >= -gapTolerance || gap <= gapTolerance);
}

function unionSegment(a: Segment, b: Segment): Segment {
  if (a.orientation === "horizontal") {
    const y = Math.round((a.y1 + b.y1) / 2);
    return {
      orientation: "horizontal",
      x1: Math.min(a.x1, b.x1),
      y1: y,
      x2: Math.max(a.x2, b.x2),
      y2: y
    };
  }
  const x = Math.round((a.x1 + b.x1) / 2);
  return {
    orientation: "vertical",
    x1: x,
    y1: Math.min(a.y1, b.y1),
    x2: x,
    y2: Math.max(a.y2, b.y2)
  };
}

function detectRectangles(horizontal: Segment[], vertical: Segment[]): ComponentBox[] {
  /*
   * ========================================================================
   * 步骤1：组合矩形
   * ========================================================================
   * 目标：
   *   1) 找到上下左右四条边
   *   2) 输出论文框图中的常见矩形模块
   */
  logger.info("开始组合矩形...", { horizontal: horizontal.length, vertical: vertical.length });

  // 1.1 枚举水平边对
  const boxes: ComponentBox[] = [];
  for (let topIndex = 0; topIndex < horizontal.length; topIndex += 1) {
    for (let bottomIndex = topIndex + 1; bottomIndex < horizontal.length; bottomIndex += 1) {
      const top = horizontal[topIndex];
      const bottom = horizontal[bottomIndex];
      const y1 = Math.min(top.y1, bottom.y1);
      const y2 = Math.max(top.y1, bottom.y1);
      const h = y2 - y1;
      if (h < 22 || h > 260) {
        continue;
      }
      const x1 = Math.max(Math.min(top.x1, top.x2), Math.min(bottom.x1, bottom.x2));
      const x2 = Math.min(Math.max(top.x1, top.x2), Math.max(bottom.x1, bottom.x2));
      if (x2 - x1 < 35) {
        continue;
      }

      // 1.2 查找左右垂直边
      const left = findVerticalEdge(vertical, x1, y1, y2);
      const right = findVerticalEdge(vertical, x2, y1, y2);
      if (!left || !right) {
        continue;
      }

      const boxX1 = Math.min(left.x1, right.x1);
      const boxX2 = Math.max(left.x1, right.x1);
      const box = {
        x: boxX1,
        y: y1,
        w: boxX2 - boxX1,
        h,
        area: (boxX2 - boxX1) * h
      };
      if (box.w >= 35 && box.h >= 22) {
        boxes.push(box);
      }
    }
  }

  // 1.3 去重
  const deduped = dedupeBoxes(boxes, 10);
  logger.info("组合矩形完成", { boxes: deduped.length });
  return deduped;
}

function findVerticalEdge(vertical: Segment[], targetX: number, y1: number, y2: number) {
  return vertical.find((segment) => {
    const xClose = Math.abs(segment.x1 - targetX) <= 8;
    const coversTop = segment.y1 <= y1 + 8;
    const coversBottom = segment.y2 >= y2 - 8;
    return xClose && coversTop && coversBottom;
  });
}

function detectArrows(
  horizontal: Segment[],
  vertical: Segment[],
  mask: Uint8Array,
  width: number,
  height: number,
  scale: number,
  rectangles: AnalysisElement[]
): AnalysisElement[] {
  /*
   * ========================================================================
   * 步骤1：检测直线箭头
   * ========================================================================
   * 目标：
   *   1) 只有末端存在箭头头部证据时才输出 arrow
   *   2) 避免把矩形边框和普通横线误判成箭头
   */
  logger.info("开始检测直线箭头...", { horizontal: horizontal.length, vertical: vertical.length });

  // 1.1 提取横向箭头
  const arrows = horizontal
    .filter((segment) => segmentLength(segment) * scale >= 90)
    .filter((segment) => !segmentInsideAnyElement(segment, rectangles, scale))
    .filter((segment) => hasArrowHeadEvidence(mask, width, height, segment))
    .map((segment) => elementFromSegment(segment, scale, "arrow"));

  // 1.2 提取纵向箭头
  arrows.push(
    ...vertical
      .filter((segment) => segmentLength(segment) * scale >= 70)
      .filter((segment) => !segmentInsideAnyElement(segment, rectangles, scale))
      .filter((segment) => hasArrowHeadEvidence(mask, width, height, segment))
      .map((segment) => elementFromSegment(segment, scale, "arrow"))
  );

  logger.info("检测直线箭头完成", { arrows: arrows.length });
  return arrows;
}

function hasArrowHeadEvidence(mask: Uint8Array, width: number, height: number, segment: Segment) {
  /*
   * ========================================================================
   * 步骤1：判断箭头头部证据
   * ========================================================================
   * 目标：
   *   1) 检查线段末端附近是否存在扩散的前景像素
   *   2) 用宽度/高度扩散特征过滤普通边框
   */
  logger.info("开始判断箭头头部证据...", { orientation: segment.orientation });

  // 1.1 计算末端采样窗口
  const tipX = segment.x2;
  const tipY = segment.y2;
  const radius = 14;
  let foreground = 0;
  let spreadA = 0;
  let spreadB = 0;

  // 1.2 统计末端窗口前景分布
  for (let y = Math.max(0, tipY - radius); y <= Math.min(height - 1, tipY + radius); y += 1) {
    for (let x = Math.max(0, tipX - radius); x <= Math.min(width - 1, tipX + radius); x += 1) {
      if (!mask[y * width + x]) {
        continue;
      }
      foreground += 1;
      if (segment.orientation === "horizontal") {
        spreadA = Math.max(spreadA, Math.abs(y - tipY));
        spreadB = Math.max(spreadB, Math.max(0, x - tipX + radius));
      } else {
        spreadA = Math.max(spreadA, Math.abs(x - tipX));
        spreadB = Math.max(spreadB, Math.max(0, y - tipY + radius));
      }
    }
  }

  // 1.3 过滤没有明显箭头头部的线段
  const diagonalEvidence = countArrowHeadDiagonalEvidence(mask, width, height, segment);
  const result = foreground >= 24 && spreadA >= 5 && spreadB >= 8 && diagonalEvidence >= 6;
  logger.info("判断箭头头部证据完成", { result, foreground, spreadA, spreadB, diagonalEvidence });
  return result;
}

function countArrowHeadDiagonalEvidence(mask: Uint8Array, width: number, height: number, segment: Segment) {
  /*
   * ========================================================================
   * 步骤1：统计箭头头部斜线证据
   * ========================================================================
   * 目标：
   *   1) 检查线段末端是否存在两条斜向边
   *   2) 过滤普通矩形边框和水平/垂直分隔线
   */
  // 1.1 计算末端和采样方向
  const tipX = segment.x2;
  const tipY = segment.y2;
  let evidence = 0;

  // 1.2 沿两条斜线采样
  for (let offset = 4; offset <= 16; offset += 2) {
    const diagonalPoints = segment.orientation === "horizontal"
      ? [
        { x: tipX - offset, y: tipY - Math.round(offset * 0.65) },
        { x: tipX - offset, y: tipY + Math.round(offset * 0.65) }
      ]
      : [
        { x: tipX - Math.round(offset * 0.65), y: tipY - offset },
        { x: tipX + Math.round(offset * 0.65), y: tipY - offset }
      ];
    for (const point of diagonalPoints) {
      if (hasNearbyForeground(mask, width, height, point.x, point.y, 2)) {
        evidence += 1;
      }
    }
  }

  // 1.3 返回证据数量
  return evidence;
}

function hasNearbyForeground(mask: Uint8Array, width: number, height: number, x: number, y: number, radius: number) {
  /*
   * ========================================================================
   * 步骤1：检查邻近前景像素
   * ========================================================================
   * 目标：
   *   1) 容忍抗锯齿和缩放导致的轻微偏移
   *   2) 给箭头头部斜线采样提供稳定判断
   */
  // 1.1 扫描邻域
  for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy += 1) {
    for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx += 1) {
      if (mask[yy * width + xx]) {
        return true;
      }
    }
  }

  // 1.2 返回未命中
  return false;
}

function elementFromRect(box: ComponentBox): AnalysisElement {
  return {
    type: "rect",
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    style: {
      ...defaultStyleForBox(box),
      fill: "none",
      opacity: 0.3
    }
  };
}

function elementFromColorBox(box: ComponentBox, color: ColorSample): AnalysisElement {
  return {
    type: "rect",
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    style: {
      fill: rgbToHex(color),
      stroke: "#111111",
      strokeWidth: 1,
      color: "#111111",
      fontFamily: "Times New Roman",
      fontSize: Math.max(12, Math.min(28, Math.round(box.h * 0.7))),
      opacity: 0.48
    }
  };
}

function elementFromTextBox(box: ComponentBox): AnalysisElement {
  return {
    type: "text",
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    text: "Text",
    style: {
      fill: "none",
      stroke: "none",
      color: "#111111",
      fontFamily: "Times New Roman",
      fontSize: Math.max(10, Math.min(42, Math.round(box.h * 0.78))),
      opacity: 0.82
    }
  };
}

function componentToElement(box: ComponentBox): AnalysisElement {
  const type = inferNodeType(box);
  return {
    type,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    text: type === "text" ? "Text" : undefined,
    style: defaultStyleForBox(box)
  };
}

function elementFromSegment(segment: Segment, scale: number, type: "line" | "arrow"): AnalysisElement {
  const x1 = segment.x1 * scale;
  const y1 = segment.y1 * scale;
  const x2 = segment.x2 * scale;
  const y2 = segment.y2 * scale;
  return {
    type,
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
    points: [
      { x: x1, y: y1 },
      { x: x2, y: y2 }
    ],
    style: {
      fill: "none",
      stroke: "#111111",
      strokeWidth: 1.6,
      color: "#111111",
      opacity: 0.32
    }
  };
}

function boxOverlapsAnyElement(box: ComponentBox, elements: AnalysisElement[], threshold: number) {
  return elements.some((element) => {
    return overlapArea(box, element) / Math.max(1, Math.min(box.w * box.h, element.w * element.h)) >= threshold;
  });
}

function elementOverlapsAnyElement(element: AnalysisElement, elements: AnalysisElement[], threshold: number) {
  return elements.some((candidate) => {
    return overlapArea(element, candidate) / Math.max(1, Math.min(element.w * element.h, candidate.w * candidate.h)) >= threshold;
  });
}

function overlapArea(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
) {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function segmentInsideAnyBox(segment: Segment, boxes: ComponentBox[]) {
  return boxes.some((box) => {
    const pad = 8;
    return (
      segment.x1 >= box.x - pad &&
      segment.x2 <= box.x + box.w + pad &&
      segment.y1 >= box.y - pad &&
      segment.y2 <= box.y + box.h + pad
    );
  });
}

function segmentInsideAnyElement(segment: Segment, elements: AnalysisElement[], scale: number) {
  /*
   * ========================================================================
   * 步骤1：判断线段是否属于已有图元
   * ========================================================================
   * 目标：
   *   1) 过滤矩形边框内部的水平/垂直边
   *   2) 避免把容器边框误判成箭头
   */
  // 1.1 转换线段坐标
  const x1 = Math.min(segment.x1, segment.x2) * scale;
  const x2 = Math.max(segment.x1, segment.x2) * scale;
  const y1 = Math.min(segment.y1, segment.y2) * scale;
  const y2 = Math.max(segment.y1, segment.y2) * scale;

  // 1.2 检查是否贴近已有矩形边
  const result = elements.some((element) => {
    const pad = 10 * scale;
    const insideX = x1 >= element.x - pad && x2 <= element.x + element.w + pad;
    const insideY = y1 >= element.y - pad && y2 <= element.y + element.h + pad;
    if (!insideX || !insideY) {
      return false;
    }
    const nearHorizontalEdge = Math.abs(y1 - element.y) <= pad || Math.abs(y1 - (element.y + element.h)) <= pad;
    const nearVerticalEdge = Math.abs(x1 - element.x) <= pad || Math.abs(x1 - (element.x + element.w)) <= pad;
    return segment.orientation === "horizontal" ? nearHorizontalEdge : nearVerticalEdge;
  });

  // 1.3 返回判断结果
  return result;
}

function segmentLength(segment: Segment) {
  return Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
}

function dedupeBoxes(boxes: ComponentBox[], tolerance: number): ComponentBox[] {
  const result: ComponentBox[] = [];
  for (const box of boxes) {
    const duplicate = result.some((item) => {
      return (
        Math.abs(item.x - box.x) <= tolerance &&
        Math.abs(item.y - box.y) <= tolerance &&
        Math.abs(item.w - box.w) <= tolerance * 2 &&
        Math.abs(item.h - box.h) <= tolerance * 2
      );
    });
    if (!duplicate) {
      result.push(box);
    }
  }
  return result;
}

function dedupeElements(elements: AnalysisElement[]): AnalysisElement[] {
  const result: AnalysisElement[] = [];
  for (const element of elements) {
    const duplicate = result.some((item) => {
      return (
        item.type === element.type &&
        Math.abs(item.x - element.x) <= 10 &&
        Math.abs(item.y - element.y) <= 10 &&
        Math.abs(item.w - element.w) <= 18 &&
        Math.abs(item.h - element.h) <= 18
      );
    });
    if (!duplicate) {
      result.push(element);
    }
  }
  return result;
}

function flood(
  mask: Uint8Array,
  visited: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number
): ComponentBox {
  // 1.1 初始化队列和边界
  const queue: Array<[number, number]> = [[startX, startY]];
  visited[startY * width + startX] = 1;
  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;
  let area = 0;

  // 1.2 广度优先扩展
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const [x, y] = queue[cursor];
    area += 1;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    const neighbors: Array<[number, number]> = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1]
    ];

    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      const nextIndex = ny * width + nx;
      if (mask[nextIndex] && !visited[nextIndex]) {
        visited[nextIndex] = 1;
        queue.push([nx, ny]);
      }
    }
  }

  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    area
  };
}

function mergeNearbyBoxes(boxes: ComponentBox[], gap: number): ComponentBox[] {
  /*
   * ========================================================================
   * 步骤1：合并接近外框
   * ========================================================================
   * 目标：
   *   1) 判断外框扩张后是否相交
   *   2) 相交则合并成一个更大的候选区域
   */
  logger.info("开始合并接近外框...", { boxes: boxes.length, gap });

  // 1.1 初始化合并状态
  const used = new Array<boolean>(boxes.length).fill(false);
  const result: ComponentBox[] = [];

  // 1.2 逐个吸收邻近框
  for (let index = 0; index < boxes.length; index += 1) {
    if (used[index]) {
      continue;
    }
    let current = boxes[index];
    used[index] = true;
    let changed = true;

    while (changed) {
      changed = false;
      for (let otherIndex = 0; otherIndex < boxes.length; otherIndex += 1) {
        if (used[otherIndex]) {
          continue;
        }
        if (boxesTouch(current, boxes[otherIndex], gap)) {
          current = unionBox(current, boxes[otherIndex]);
          used[otherIndex] = true;
          changed = true;
        }
      }
    }
    result.push(current);
  }

  logger.info("合并接近外框完成", { boxes: result.length });
  return result;
}

function boxesTouch(a: ComponentBox, b: ComponentBox, gap: number) {
  return (
    a.x - gap <= b.x + b.w &&
    a.x + a.w + gap >= b.x &&
    a.y - gap <= b.y + b.h &&
    a.y + a.h + gap >= b.y
  );
}

function unionBox(a: ComponentBox, b: ComponentBox): ComponentBox {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return {
    x: x1,
    y: y1,
    w: x2 - x1,
    h: y2 - y1,
    area: a.area + b.area
  };
}

function scaleBox(box: ComponentBox, scale: number): ComponentBox {
  return {
    x: box.x * scale,
    y: box.y * scale,
    w: box.w * scale,
    h: box.h * scale,
    area: box.area * scale * scale
  };
}

function expandBox(box: ComponentBox, padding: number, width: number, height: number): ComponentBox {
  const x1 = Math.max(0, box.x - padding);
  const y1 = Math.max(0, box.y - padding);
  const x2 = Math.min(width, box.x + box.w + padding);
  const y2 = Math.min(height, box.y + box.h + padding);
  return {
    x: x1,
    y: y1,
    w: x2 - x1,
    h: y2 - y1,
    area: box.area
  };
}

function keepUsefulBox(box: ComponentBox, pageWidth: number, pageHeight: number) {
  const pageArea = pageWidth * pageHeight;
  const area = box.w * box.h;
  if (area < 80) {
    return false;
  }
  if (area > pageArea * 0.72) {
    return false;
  }
  if (box.w < 4 || box.h < 4) {
    return false;
  }
  return true;
}

function keepColorBox(box: ComponentBox, pageWidth: number, pageHeight: number) {
  const pageArea = pageWidth * pageHeight;
  const area = box.w * box.h;
  const fillRatio = box.area / Math.max(1, area);
  if (area < 35 || area > pageArea * 0.18) {
    return false;
  }
  if (box.w < 5 || box.h < 5) {
    return false;
  }
  if (fillRatio < 0.08) {
    return false;
  }
  return true;
}

function keepTextBox(box: ComponentBox) {
  const ratio = box.w / Math.max(1, box.h);
  if (box.w < 12 || box.h < 5) {
    return false;
  }
  if (box.h > 120) {
    return false;
  }
  if (ratio < 1.25) {
    return false;
  }
  return true;
}

function keepTextGlyphBox(box: ComponentBox, pageWidth: number, pageHeight: number) {
  const pageArea = pageWidth * pageHeight;
  const area = box.w * box.h;
  if (area < 6 || area > pageArea * 0.04) {
    return false;
  }
  if (box.w < 2 || box.h < 3) {
    return false;
  }
  if (box.w > pageWidth * 0.42 || box.h > pageHeight * 0.18) {
    return false;
  }
  return true;
}

function mergeTextLineBoxes(boxes: ComponentBox[], pageWidth: number, pageHeight: number) {
  /*
   * ========================================================================
   * 步骤1：聚合文字连通域
   * ========================================================================
   * 目标：
   *   1) 按基线接近和水平距离合并字符
   *   2) 避免跨列、跨箭头、跨容器合并
   */
  logger.info("开始聚合文字连通域...", { boxes: boxes.length });

  // 1.1 从左到右、从上到下稳定排序
  const sorted = [...boxes].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const groups: ComponentBox[] = [];

  // 1.2 逐个并入最近文本组
  for (const box of sorted) {
    const groupIndex = groups.findIndex((group) => canMergeTextBox(group, box, pageWidth, pageHeight));
    if (groupIndex >= 0) {
      groups[groupIndex] = unionBox(groups[groupIndex], box);
    } else {
      groups.push(box);
    }
  }

  // 1.3 二次合并相邻短组
  let merged = groups;
  for (let pass = 0; pass < 2; pass += 1) {
    merged = mergeTextGroupsOnce(merged, pageWidth, pageHeight);
  }

  logger.info("聚合文字连通域完成", { groups: merged.length });
  return merged;
}

function mergeTextGroupsOnce(boxes: ComponentBox[], pageWidth: number, pageHeight: number) {
  const remaining = [...boxes];
  const merged: ComponentBox[] = [];
  while (remaining.length) {
    let current = remaining.shift()!;
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        if (canMergeTextBox(current, remaining[index], pageWidth, pageHeight)) {
          current = unionBox(current, remaining[index]);
          remaining.splice(index, 1);
          changed = true;
        }
      }
    }
    merged.push(current);
  }
  return merged;
}

function canMergeTextBox(a: ComponentBox, b: ComponentBox, pageWidth: number, pageHeight: number) {
  const ay = a.y + a.h / 2;
  const by = b.y + b.h / 2;
  const lineHeight = Math.max(a.h, b.h);
  const verticalClose = Math.abs(ay - by) <= Math.max(4, lineHeight * 0.72);
  if (!verticalClose) {
    return false;
  }

  const left = a.x <= b.x ? a : b;
  const right = left === a ? b : a;
  const gap = right.x - (left.x + left.w);
  const maxGap = Math.max(6, Math.min(pageWidth * 0.05, lineHeight * 2.8));
  if (gap > maxGap) {
    return false;
  }

  const union = unionBox(a, b);
  if (union.w > pageWidth * 0.66 || union.h > pageHeight * 0.16) {
    return false;
  }

  return true;
}

function averageColor(buffer: Buffer, width: number, height: number, box: ComponentBox): ColorSample {
  /*
   * ========================================================================
   * 步骤1：计算区域平均颜色
   * ========================================================================
   * 目标：
   *   1) 采样彩色候选框内部像素
   *   2) 忽略白底和黑色文字边框
   */
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  // 1.1 遍历候选框像素
  for (let y = Math.max(0, box.y); y < Math.min(height, box.y + box.h); y += 1) {
    for (let x = Math.max(0, box.x); x < Math.min(width, box.x + box.w); x += 1) {
      const offset = (y * width + x) * 3;
      const pr = buffer[offset];
      const pg = buffer[offset + 1];
      const pb = buffer[offset + 2];
      const max = Math.max(pr, pg, pb);
      const min = Math.min(pr, pg, pb);
      const brightness = (pr + pg + pb) / 3;
      if (max - min < 18 || brightness < 40 || brightness > 248) {
        continue;
      }
      r += pr;
      g += pg;
      b += pb;
      count += 1;
    }
  }

  // 1.2 返回平均值或兜底蓝色
  if (!count) {
    return { r: 37, g: 99, b: 235 };
  }
  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count)
  };
}

function rgbToHex(color: ColorSample) {
  const toHex = (value: number) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

function inferNodeType(box: ComponentBox): SceneNode["type"] {
  const ratio = box.w / Math.max(1, box.h);
  if (ratio > 4.5 || box.h < 18) {
    return "text";
  }
  if (Math.abs(box.w - box.h) < Math.max(box.w, box.h) * 0.18) {
    return "ellipse";
  }
  return "rect";
}

function defaultStyleForBox(box: ComponentBox) {
  const type = inferNodeType(box);
  if (type === "text") {
    return {
      fill: "none",
      stroke: "none",
      color: "#111111",
      fontFamily: "Times New Roman",
      fontSize: Math.max(12, Math.min(24, Math.round(box.h * 0.82)))
    };
  }
  return {
    fill: "none",
    stroke: "#2563EB",
    strokeWidth: 1.2,
    color: "#111111",
    fontFamily: "Times New Roman",
    fontSize: 14,
    opacity: 0.38
  };
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
