import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { analyzeImage } from "../server/src/scene/analyzeImage";
import { stripVolatileFields } from "../server/src/evaluate";

describe("analyzeImage determinism", () => {
  it("produces byte-stable scene structure for the same image across runs", async () => {
    /*
     * ========================================================================
     * 步骤1：验证 analyzeImage 输出确定性
     * ========================================================================
     * 目标：
     *   1) 对同一张评估图跑两次启发式分析
     *   2) 比较去除易变字段后的 scene 结构是否完全一致
     *   3) 校验节点 id 是 type+sha1 短摘要而不是 uuid 或带 index 段
     */

    // 1.1 准备最小测试样本
    const imagePath = path.join(process.cwd(), "data", "eval-suite", "module-small-2rect.png");
    const input = {
      id: "module-small-2rect",
      imagePath,
      sourceUrl: "/eval-suite/module-small-2rect.png",
      title: "module-small-2rect.png"
    };

    // 1.2 跑两次启发式分析
    const sceneA = await analyzeImage(input);
    const sceneB = await analyzeImage(input);

    // 1.3 比较去除易变字段后的结果
    const strippedA = stripVolatileFields(sceneA);
    const strippedB = stripVolatileFields(sceneB);
    assert.deepStrictEqual(strippedA, strippedB);
    assert.equal("createdAt" in (strippedA.metadata ?? {}), false);

    // 1.4 校验节点 id 格式：type-<8 位十六进制 sha1 摘要>
    const idPattern = /^(text|rect|line|circle|ellipse|arrow|polyline|polygon|path)-[0-9a-f]{8}$/;
    const candidateNodes = sceneA.nodes.filter((node) => node.id !== "source-image");
    assert.ok(candidateNodes.length > 0, "expected at least one non source-image node");
    const matchedNode = candidateNodes.find((node) => idPattern.test(node.id));
    assert.ok(
      matchedNode,
      `expected at least one node id like type-<sha1[0..8]>, got ${candidateNodes.map((n) => n.id).join(", ")}`
    );

    // 1.5 反向确认：不应再出现 uuid 后缀（带连字符的 8-4-4-4-12 段）也不应有 index 段
    for (const node of candidateNodes) {
      assert.doesNotMatch(node.id, /-[0-9]+-/, `node id should not contain index segment: ${node.id}`);
      assert.doesNotMatch(
        node.id,
        /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        `node id should not contain uuid segment: ${node.id}`
      );
    }
  });
});
