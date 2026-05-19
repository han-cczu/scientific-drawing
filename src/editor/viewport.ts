import { logger } from "../lib/logger";

export type Viewport = {
  scale: number;
  offset: {
    x: number;
    y: number;
  };
};

export type ClientPointInput = {
  clientX: number;
  clientY: number;
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  page: {
    width: number;
    height: number;
  };
  viewport: Viewport;
};

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

export function clampViewportScale(value: number) {
  /*
   * ========================================================================
   * 步骤1：限制视图缩放比例
   * ========================================================================
   * 目标：
   *   1) 防止画布缩到不可操作
   *   2) 防止过度放大造成交互失真
   */
  logger.info("开始限制视图缩放比例...", { value });

  // 1.1 处理非法数字
  if (!Number.isFinite(value)) {
    logger.info("限制视图缩放比例完成", { scale: 1 });
    return 1;
  }

  // 1.2 限制缩放范围
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
  logger.info("限制视图缩放比例完成", { scale });
  return scale;
}

export function clientPointToScene(input: ClientPointInput) {
  /*
   * ========================================================================
   * 步骤1：浏览器坐标转 scene 坐标
   * ========================================================================
   * 目标：
   *   1) 统一拖拽、框选和绘制的坐标换算
   *   2) 同时考虑 SVG 尺寸、视图缩放和平移
   */
  logger.info("开始转换浏览器坐标...");

  // 1.1 换算到未变换的 scene 坐标
  const rawX = ((input.clientX - input.rect.left) / input.rect.width) * input.page.width;
  const rawY = ((input.clientY - input.rect.top) / input.rect.height) * input.page.height;

  // 1.2 还原 viewport 变换
  const point = {
    x: (rawX - input.viewport.offset.x) / input.viewport.scale,
    y: (rawY - input.viewport.offset.y) / input.viewport.scale
  };

  logger.info("转换浏览器坐标完成", point);
  return point;
}

export function zoomViewportAt(viewport: Viewport, scenePoint: { x: number; y: number }, nextScaleValue: number): Viewport {
  /*
   * ========================================================================
   * 步骤1：按指针位置缩放视图
   * ========================================================================
   * 目标：
   *   1) 缩放时保持指针下的 scene 坐标不跳动
   *   2) 返回新的 scale 和 offset
   */
  logger.info("开始按指针位置缩放视图...", { scenePoint, nextScaleValue });

  // 1.1 限制目标缩放值
  const nextScale = clampViewportScale(nextScaleValue);

  // 1.2 计算保持锚点稳定的新偏移
  const next = {
    scale: nextScale,
    offset: {
      x: viewport.offset.x + scenePoint.x * viewport.scale - scenePoint.x * nextScale,
      y: viewport.offset.y + scenePoint.y * viewport.scale - scenePoint.y * nextScale
    }
  };

  logger.info("按指针位置缩放视图完成", next);
  return next;
}

export function panViewport(viewport: Viewport, delta: { x: number; y: number }): Viewport {
  /*
   * ========================================================================
   * 步骤1：平移视图
   * ========================================================================
   * 目标：
   *   1) 保持缩放比例不变
   *   2) 只更新 viewport offset
   */
  logger.info("开始平移视图...", { delta });

  // 1.1 叠加偏移量
  const next = {
    scale: viewport.scale,
    offset: {
      x: viewport.offset.x + delta.x,
      y: viewport.offset.y + delta.y
    }
  };

  logger.info("平移视图完成", next);
  return next;
}
