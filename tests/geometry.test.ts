import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { endpointReferencesNode, normalizeHexColor, resolveEndpoint, shadeColor } from "../src/shared/geometry";
import type { SceneNode } from "../src/shared/scene";

const node: SceneNode = {
  id: "box",
  type: "rect",
  x: 10,
  y: 20,
  w: 100,
  h: 40,
  style: { fill: "#FFFFFF", stroke: "#111111" }
};

describe("shared geometry", () => {
  it("resolves endpoint references consistently", () => {
    /*
     * ========================================================================
     * 步骤1：验证端点解析
     * ========================================================================
     * 目标：
     *   1) 支持 node:side@ratio 写法
     *   2) 缺省端点回到中心点
     */

    // 1.1 解析右侧中点
    assert.deepEqual(resolveEndpoint("box:right@0.5", [node]), { x: 110, y: 40 });

    // 1.2 解析中心点
    assert.deepEqual(resolveEndpoint("box", [node]), { x: 60, y: 40 });
  });

  it("checks endpoint ownership without false positives", () => {
    /*
     * ========================================================================
     * 步骤1：验证端点归属
     * ========================================================================
     * 目标：
     *   1) 删除节点时精准判断边引用
     *   2) 避免 node-1 误匹配 node-10
     */

    // 1.1 命中同名节点
    assert.equal(endpointReferencesNode("node-1:right@0.5", "node-1"), true);

    // 1.2 排除前缀相似节点
    assert.equal(endpointReferencesNode("node-10:right@0.5", "node-1"), false);
  });

  it("normalizes and shades colors", () => {
    /*
     * ========================================================================
     * 步骤1：验证颜色工具
     * ========================================================================
     * 目标：
     *   1) 统一十六进制颜色格式
     *   2) 非法颜色保留原值
     */

    // 1.1 规范化颜色
    assert.equal(normalizeHexColor("#abc"), "#AABBCC");
    assert.equal(normalizeHexColor("112233"), "#112233");

    // 1.2 计算阴影色
    assert.equal(shadeColor("#808080", 0.5), "#404040");
    assert.equal(shadeColor("none", 0.5), "none");
  });
});
