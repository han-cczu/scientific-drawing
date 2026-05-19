import { logger } from "../../logger";

export function buildForegroundMask(buffer: Buffer, width: number, height: number): Uint8Array {
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

export function buildColorMask(buffer: Buffer, width: number, height: number): Uint8Array {
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

export function denoiseMask(mask: Uint8Array, width: number, height: number) {
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
