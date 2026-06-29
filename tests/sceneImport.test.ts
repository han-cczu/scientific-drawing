import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSceneImportFile, SCENE_IMPORT_MAX_BYTES, SceneImportError } from "../src/editor/sceneImport";

describe("scene import file parsing", () => {
  it("rejects oversized scene files before reading their contents", async () => {
    /*
     * ========================================================================
     * 步骤1：验证前端 scene.json 导入大小上限
     * ========================================================================
     * 目标：
     *   1) 本地 File 仍是不可信输入，不能无上限 file.text() + JSON.parse
     *   2) 超过上限时必须在读取内容前拒绝，避免浏览器主线程解析超大 JSON
     */
    let readCalled = false;
    const file = {
      size: SCENE_IMPORT_MAX_BYTES + 1,
      text: async () => {
        readCalled = true;
        return "{}";
      }
    } as File;

    await assert.rejects(
      () => parseSceneImportFile(file),
      (error) => {
        assert.ok(error instanceof SceneImportError);
        assert.equal(error.code, "FILE_TOO_LARGE");
        return true;
      }
    );
    assert.equal(readCalled, false);
  });
});
