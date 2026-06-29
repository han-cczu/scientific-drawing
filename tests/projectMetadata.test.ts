import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

describe("project metadata", () => {
  it("documents the Node.js version required by the Vite toolchain", async () => {
    /*
     * ========================================================================
     * 步骤1：验证项目 Node 版本声明
     * ========================================================================
     * 目标：
     *   1) package.json 的 engines.node 不低于 Vite 当前实际要求
     *   2) CI 不能用笼统的 Node 20，避免与 package engines 漂移
     *   3) README 与架构文档不能继续笼统写 Node 20+，误导 20.3-20.18 用户
     */
    const packageJson = JSON.parse(await readFile("package.json", "utf-8")) as {
      engines?: { node?: string };
    };
    const ciWorkflow = await readFile(".github/workflows/ci.yml", "utf-8");
    const readme = await readFile("README.md", "utf-8");
    const architecture = await readFile("docs/ARCHITECTURE.md", "utf-8");

    assert.equal(packageJson.engines?.node, "^20.19.0 || >=22.12.0");
    assert.match(ciWorkflow, /node-version: 20\.19\.0/);
    assert.match(readme, /Node\.js \^20\.19\.0 或 >=22\.12\.0/);
    assert.match(architecture, /Node\.js \^20\.19\.0 或 >=22\.12\.0/);
  });
});
