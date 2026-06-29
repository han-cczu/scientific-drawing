import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveLocalAssetPath, resolveUploadedAssetPath, uploadDir, evalSuiteDir } from "../server/src/paths";

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

  it("拒绝白名单目录内的非图片文件", () => {
    /*
     * ========================================================================
     * 步骤1：验证本地资源只解析图片后缀
     * ========================================================================
     * 目标：
     *   1) SVG 导出内嵌图片前不能把 manifest/config 等 JSON 当图片读盘
     *   2) 局部重建上传原图解析同样只接受图片后缀
     */
    assert.equal(resolveLocalAssetPath("/eval-suite/manifest.json"), null);
    assert.equal(resolveLocalAssetPath("/uploads/readme.txt"), null);
    assert.equal(resolveUploadedAssetPath("/uploads/base.json"), null);
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
    assert.equal(resolveLocalAssetPath("https://evil.test/uploads/config.json"), null);
    assert.equal(resolveLocalAssetPath("https://evil.test/eval-suite/sample.png"), null);
    assert.equal(resolveLocalAssetPath("file:///etc/passwd"), null);
    assert.equal(resolveLocalAssetPath(""), null);
    assert.equal(resolveLocalAssetPath(undefined), null);
    assert.equal(resolveLocalAssetPath(123 as unknown as string), null);
  });

  it("上传原图路径解析只接受真正的 /uploads/ 相对 URL", () => {
    /*
     * ========================================================================
     * 步骤1：验证局部重建原图路径解析
     * ========================================================================
     * 目标：
     *   1) /uploads/foo.png 可解析到上传目录
     *   2) 外部 URL 即使包含 /uploads/ 片段也不得冒充本地上传文件
     */
    assert.equal(resolveUploadedAssetPath("/uploads/base.png"), path.resolve(uploadDir, "base.png"));
    assert.equal(resolveUploadedAssetPath("/uploads/nested/base.png"), path.resolve(uploadDir, "nested", "base.png"));
    assert.equal(resolveUploadedAssetPath("https://evil.test/uploads/base.png"), null);
    assert.equal(resolveUploadedAssetPath("/eval-suite/base.png"), null);
    assert.equal(resolveUploadedAssetPath("/uploads/../config.json"), null);
  });
});
