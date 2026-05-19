import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildReconstructionRulesText,
  buildReconstructionSchemaText,
  buildReconstructionVocabularyText
} from "../src/shared/reconstructionPrompt";
import { buildReconstructionPrompt } from "../src/editor/reconstructionPrompt";
import { buildServerReconstructionPrompt } from "../server/src/scene/reconstructionPrompt";

describe("shared reconstruction prompt", () => {
  it("uses one schema, vocabulary, and rules source in both prompt wrappers", () => {
    /*
     * ========================================================================
     * 步骤1：验证重建提示词共享片段
     * ========================================================================
     * 目标：
     *   1) 前端导出提示词和服务端 AI 调用共用协议说明
     *   2) 避免两份提示词 schema 和规则分叉
     */

    // 1.1 构建共享片段和包装提示词
    const schema = buildReconstructionSchemaText(640, 480);
    const vocabulary = buildReconstructionVocabularyText();
    const rules = buildReconstructionRulesText();
    const editorPrompt = buildReconstructionPrompt();
    const serverPrompt = buildServerReconstructionPrompt(640, 480, "color");

    // 1.2 校验包装提示词复用共享片段
    assert.match(schema, /"version": "0\.1"/);
    assert.match(vocabulary, /text_block/);
    assert.match(rules, /JSON must be parseable/);
    assert.ok(editorPrompt.includes(buildReconstructionSchemaText("原图宽", "原图高")));
    assert.ok(editorPrompt.includes(vocabulary));
    assert.ok(editorPrompt.includes(rules));
    assert.ok(serverPrompt.includes(schema));
    assert.ok(serverPrompt.includes(vocabulary));
    assert.ok(serverPrompt.includes(rules));
  });
});
