import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clientPointToScene, clampViewportScale, panViewport, zoomViewportAt } from "../src/editor/viewport";

describe("editor viewport", () => {
  it("converts browser points into scene coordinates with scale and offset", () => {
    /*
     * ========================================================================
     * 步骤1：验证坐标转换
     * ========================================================================
     * 目标：
     *   1) 使用 SVG 显示区域换算基础 scene 坐标
     *   2) 再应用 viewport 的缩放和平移
     */

    // 1.1 转换浏览器坐标
    const point = clientPointToScene({
      clientX: 500,
      clientY: 240,
      rect: { left: 100, top: 40, width: 800, height: 400 },
      page: { width: 400, height: 200 },
      viewport: { scale: 2, offset: { x: -40, y: 20 } }
    });

    // 1.2 校验 scene 坐标
    assert.deepEqual(point, { x: 120, y: 40 });
  });

  it("zooms around the pointer without changing the pointed scene coordinate", () => {
    /*
     * ========================================================================
     * 步骤1：验证指针定点缩放
     * ========================================================================
     * 目标：
     *   1) 缩放后指针下的 scene 坐标保持不变
     *   2) 缩放比例受边界限制
     */

    // 1.1 执行指针定点缩放
    const viewport = { scale: 1, offset: { x: 0, y: 0 } };
    const next = zoomViewportAt(viewport, { x: 100, y: 50 }, 2);

    // 1.2 校验缩放和坐标稳定性
    assert.deepEqual(next, { scale: 2, offset: { x: -100, y: -50 } });
    assert.equal((100 - next.offset.x) / next.scale, 100);
    assert.equal((50 - next.offset.y) / next.scale, 50);
  });

  it("clamps scale and pans offsets", () => {
    /*
     * ========================================================================
     * 步骤1：验证缩放边界和平移
     * ========================================================================
     * 目标：
     *   1) 防止视图缩放过小或过大
     *   2) 平移只修改 viewport offset
     */

    // 1.1 校验缩放边界
    assert.equal(clampViewportScale(0.01), 0.25);
    assert.equal(clampViewportScale(8), 4);

    // 1.2 校验平移
    assert.deepEqual(panViewport({ scale: 1.5, offset: { x: 10, y: -5 } }, { x: 3, y: 4 }), {
      scale: 1.5,
      offset: { x: 13, y: -1 }
    });
  });
});
