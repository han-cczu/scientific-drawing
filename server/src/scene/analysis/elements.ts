import { logger } from "../../logger";
import type { SceneNode } from "../types";
import {
  dedupeBoxes,
  expandBox,
  findComponents,
  findRawComponents,
  overlapArea,
  scaleBox,
  unionBox
} from "./components";
import type { AnalysisElement, ColorSample, ComponentBox, Segment } from "./types";

const MAX_HELPER_ELEMENTS = 260;

export function detectColorElements(
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

export function detectTextElements(
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

export function detectStructuredElements(mask: Uint8Array, width: number, height: number, scale: number): AnalysisElement[] {
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

export function componentToElement(box: ComponentBox): AnalysisElement {
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

export function boxOverlapsAnyElement(box: ComponentBox, elements: AnalysisElement[], threshold: number) {
  return elements.some((element) => {
    return overlapArea(box, element) / Math.max(1, Math.min(box.w * box.h, element.w * element.h)) >= threshold;
  });
}

export function elementOverlapsAnyElement(element: AnalysisElement, elements: AnalysisElement[], threshold: number) {
  return elements.some((candidate) => {
    return overlapArea(element, candidate) / Math.max(1, Math.min(element.w * element.h, candidate.w * candidate.h)) >= threshold;
  });
}

export function dedupeElements(elements: AnalysisElement[]): AnalysisElement[] {
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

export function keepUsefulBox(box: ComponentBox, pageWidth: number, pageHeight: number) {
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

export function round(value: number) {
  return Math.round(value * 10) / 10;
}

function detectHorizontalSegments(mask: Uint8Array, width: number, height: number): Segment[] {
  logger.info("开始扫描水平线段...", { width, height });
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
  const merged = mergeCollinearSegments(raw, 3, 8);
  logger.info("扫描水平线段完成", { raw: raw.length, merged: merged.length });
  return merged;
}

function detectVerticalSegments(mask: Uint8Array, width: number, height: number): Segment[] {
  logger.info("开始扫描垂直线段...", { width, height });
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
  const merged = mergeCollinearSegments(raw, 3, 8);
  logger.info("扫描垂直线段完成", { raw: raw.length, merged: merged.length });
  return merged;
}

function mergeCollinearSegments(segments: Segment[], axisTolerance: number, gapTolerance: number): Segment[] {
  logger.info("开始合并共线线段...", { segments: segments.length });
  const remaining = [...segments];
  const merged: Segment[] = [];
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
  logger.info("开始组合矩形...", { horizontal: horizontal.length, vertical: vertical.length });
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
  logger.info("开始聚合文字连通域...", { boxes: boxes.length });
  const sorted = [...boxes].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const groups: ComponentBox[] = [];
  for (const box of sorted) {
    const groupIndex = groups.findIndex((group) => canMergeTextBox(group, box, pageWidth, pageHeight));
    if (groupIndex >= 0) {
      groups[groupIndex] = unionBox(groups[groupIndex], box);
    } else {
      groups.push(box);
    }
  }
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
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
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
