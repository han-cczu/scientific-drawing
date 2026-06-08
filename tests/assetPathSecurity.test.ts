import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveLocalAssetPath, uploadDir, evalSuiteDir } from "../server/src/paths";

describe("resolveLocalAssetPath (导出图片来源防路径穿越)", () => {
  it("解析 /uploads/ 与 /eval-suite/ 下的合法文件到受控目录内", () => {
    /*
     * ========================================================================
     * 步骤1：验证白名单目录内的合法解析
     * ========================================================================
     */
    assert.equal(resolveLocalAssetPath("/uploads/abc.png"), path.resolve(uploadDir, "abc.png"));
    assert.equal(resolveLocalAssetPath("/eval-suite/sample.jpg"), path.resolve(evalSuiteDir, "sample.jpg"));
    // 目录内嵌套子路径允许（仍在 baseDir 内）
    assert.equal(resolveLocalAssetPath("/uploads/sub/x.png"), path.resolve(uploadDir, "sub", "x.png"));
  });

  it("拒绝逃出受控目录的路径穿越（LFI 根因）", () => {
    /*
     * ========================================================================
     * 步骤1：验证 .. 穿越被拒
     * ========================================================================
     * 目标：
     *   1) /uploads/../config.json 不得解析到 data/config.json（含明文 API Key）
     *   2) 任意层级 ../ 逃逸一律返回 null
     */
    assert.equal(resolveLocalAssetPath("/uploads/../config.json"), null);
    assert.equal(resolveLocalAssetPath("/uploads/../../package.json"), null);
    assert.equal(resolveLocalAssetPath("/uploads/../../../../etc/passwd"), null);
    assert.equal(resolveLocalAssetPath("/uploads/..\\..\\config.json"), null);
    assert.equal(resolveLocalAssetPath("/eval-suite/../config.json"), null);
  });

  it("拒绝非白名单 / 绝对路径 / 外部 URL / 空值", () => {
    /*
     * ========================================================================
     * 步骤1：验证非受控来源不读盘
     * ========================================================================
     */
    assert.equal(resolveLocalAssetPath("/etc/passwd"), null);
    assert.equal(resolveLocalAssetPath("C:/Windows/win.ini"), null);
    assert.equal(resolveLocalAssetPath("https://example.com/x.png"), null);
    assert.equal(resolveLocalAssetPath("file:///etc/passwd"), null);
    assert.equal(resolveLocalAssetPath(""), null);
    assert.equal(resolveLocalAssetPath(undefined), null);
    assert.equal(resolveLocalAssetPath(123 as unknown as string), null);
  });
});
