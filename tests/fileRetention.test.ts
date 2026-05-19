import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cleanupDataFiles, isManagedDataFile } from "../server/src/files/retention";

describe("file retention", () => {
  it("removes only old managed files from configured directories", async () => {
    /*
     * ========================================================================
     * 步骤1：验证运行产物清理
     * ========================================================================
     * 目标：
     *   1) 删除过期的受管文件
     *   2) 保留新文件、非受管文件和子目录
     */

    // 1.1 准备临时目录和文件
    const root = path.join(os.tmpdir(), `scientific-drawing-retention-${Date.now()}`);
    const uploadDir = path.join(root, "uploads");
    await mkdir(uploadDir, { recursive: true });
    const oldFile = path.join(uploadDir, "old.png");
    const freshFile = path.join(uploadDir, "fresh.svg");
    const ignoredFile = path.join(uploadDir, "notes.txt");
    const nestedDir = path.join(uploadDir, "nested");
    await mkdir(nestedDir);
    await writeFile(oldFile, "old");
    await writeFile(freshFile, "fresh");
    await writeFile(ignoredFile, "ignored");
    await utimes(oldFile, new Date("2026-04-01T00:00:00.000Z"), new Date("2026-04-01T00:00:00.000Z"));

    try {
      // 1.2 执行清理
      const now = new Date("2026-05-19T00:00:00.000Z");
      await cleanupDataFiles({
        directories: [uploadDir],
        maxAgeDays: 14,
        now,
        logger: { info() {}, warn() {} }
      });

      // 1.3 校验清理结果
      await assertMissing(oldFile);
      assert.ok((await stat(freshFile)).isFile());
      assert.ok((await stat(ignoredFile)).isFile());
      assert.ok((await stat(nestedDir)).isDirectory());
    } finally {
      // 1.4 清理测试目录
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies managed data files by extension", () => {
    /*
     * ========================================================================
     * 步骤1：验证受管文件类型
     * ========================================================================
     * 目标：
     *   1) 只清理项目产生的常见文件
     *   2) 避免误删说明文件
     */

    // 1.1 校验受管扩展名
    assert.equal(isManagedDataFile("a.png"), true);
    assert.equal(isManagedDataFile("a.scene.json"), true);
    assert.equal(isManagedDataFile("a.pptx"), true);

    // 1.2 校验非受管文件
    assert.equal(isManagedDataFile("README.md"), false);
    assert.equal(isManagedDataFile("notes.txt"), false);
  });
});

async function assertMissing(filePath: string) {
  /*
   * ========================================================================
   * 步骤1：断言文件不存在
   * ========================================================================
   * 目标：
   *   1) 区分文件确实被删和其他 IO 错误
   *   2) 让测试失败信息明确
   */

  // 1.1 尝试读取文件状态
  try {
    await stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  // 1.2 文件仍存在则失败
  assert.fail(`${filePath} should have been removed`);
}
