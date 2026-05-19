import { logger } from "../lib/logger";
import {
  buildReconstructionRulesText,
  buildReconstructionSchemaText,
  buildReconstructionVocabularyText
} from "../shared/reconstructionPrompt";

export function buildReconstructionPrompt() {
  /*
   * ========================================================================
   * 步骤1：生成重建提示词
   * ========================================================================
   * 目标：
   *   1) 让多模态模型按 Visiomaster 方法输出 scene.json
   *   2) 约束组件词表和坐标格式
   */
  logger.info("开始生成重建提示词...");

  // 1.1 拼接共享提示词片段
  const prompt = `你是论文图重建助手。请观察输入图片，输出严格 JSON，不要输出解释。

目标：把图片重建成可编辑 scene.json。不要只描述图片。不要输出 SVG。

坐标规则：
- page.units 必须是 "px"
- page.width/page.height 使用原图像素宽高
- 原点是左上角
- 所有 x/y/w/h 都用像素

${buildReconstructionSchemaText("原图宽", "原图高")}

${buildReconstructionVocabularyText()}

${buildReconstructionRulesText()}

输出必须是合法 JSON，不能有 markdown 代码围栏。`;

  logger.info("生成重建提示词完成", { chars: prompt.length });
  return prompt;
}
