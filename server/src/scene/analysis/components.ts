import { logger } from "../../logger";
import type { ComponentBox } from "./types";

export function findComponents(mask: Uint8Array, width: number, height: number): ComponentBox[] {
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
      if (box.area >= 1) {
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

export function findRawComponents(mask: Uint8Array, width: number, height: number): ComponentBox[] {
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

export function flood(
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

export function mergeNearbyBoxes(boxes: ComponentBox[], gap: number): ComponentBox[] {
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

export function boxesTouch(a: ComponentBox, b: ComponentBox, gap: number) {
  return (
    a.x - gap <= b.x + b.w &&
    a.x + a.w + gap >= b.x &&
    a.y - gap <= b.y + b.h &&
    a.y + a.h + gap >= b.y
  );
}

export function unionBox(a: ComponentBox, b: ComponentBox): ComponentBox {
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

export function scaleBox(box: ComponentBox, scale: number): ComponentBox {
  return {
    x: box.x * scale,
    y: box.y * scale,
    w: box.w * scale,
    h: box.h * scale,
    area: box.area * scale * scale
  };
}

export function expandBox(box: ComponentBox, padding: number, width: number, height: number): ComponentBox {
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

export function overlapArea(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
) {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

export function dedupeBoxes(boxes: ComponentBox[], tolerance: number): ComponentBox[] {
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
