import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
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

  it("keeps endpoint and color helpers centralized", async () => {
    /*
     * ========================================================================
     * 步骤1：验证共享工具集中化
     * ========================================================================
     * 目标：
     *   1) 防止 Canvas/SVG/PPTX 各自复制端点解析
     *   2) 防止网格阴影算法分叉
     */

    // 1.1 扫描源码文件
    const files = await listSourceFiles(["src", "server"]);
    const duplicated: string[] = [];

    // 1.2 查找重复函数定义
    for (const file of files) {
      if (file.replaceAll("\\", "/").endsWith("src/shared/geometry.ts")) {
        continue;
      }
      const content = await readFile(file, "utf-8");
      if (/function resolveEndpoint|function shadeColor/.test(content)) {
        duplicated.push(file);
      }
    }

    assert.deepEqual(duplicated, []);
  });
});

async function listSourceFiles(roots: string[]) {
  /*
   * ========================================================================
   * 步骤1：收集源码文件
   * ========================================================================
   * 目标：
   *   1) 遍历 src 和 server 目录
   *   2) 只返回 TypeScript 源码
   */

  // 1.1 递归读取目录
  const result: string[] = [];
  for (const root of roots) {
    const absolute = path.join(process.cwd(), root);
    await walk(absolute, result);
  }

  // 1.2 返回源码列表
  return result;
}

async function walk(directory: string, result: string[]) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, result);
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      result.push(fullPath);
    }
  }
}
