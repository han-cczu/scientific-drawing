import { logger } from "../logger";
import {
  buildReconstructionRulesText,
  buildReconstructionSchemaText,
  buildReconstructionVocabularyText
} from "../../../src/shared/reconstructionPrompt";

export type ReconstructionMode = "color" | "mono";

export function buildServerReconstructionPrompt(width: number, height: number, mode: ReconstructionMode) {
  /*
   * ========================================================================
   * 步骤1：生成服务端重建提示词
   * ========================================================================
   * 目标：
   *   1) 约束多模态模型输出严格 JSON
   *   2) 按用户选择控制彩色或黑白样式
   */
  logger.info("开始生成服务端重建提示词...", { width, height, mode });

  // 1.1 生成颜色模式约束
  const colorRules = mode === "color"
    ? `Color mode:
- Preserve the original visual colors as editable style values.
- Colored numbered blocks, highlights, check marks, x marks, and module accents must keep approximate hex colors.
- Use style.fill, style.stroke, style.text_color, row_colors, colored_cells, and cell_labels when color carries meaning.
- Do not convert the figure to grayscale.`
    : `Color mode:
- Reconstruct in black and white only.
- Use "#FFFFFF", "#F3F4F6", "#D1D5DB", "#6B7280", "#111111", and "none" only.
- Replace colored blocks with grayscale fills while keeping their labels and layout.
- Check marks, x marks, arrows, borders, and text should be black or gray.`;

  // 1.2 返回完整提示词
  const prompt = `You are a scientific diagram reconstruction engine.
Return strict JSON only. Do not wrap in markdown.

Task:
Reconstruct the input image as editable scene.json.
Do not describe the image. Do not output SVG.
${colorRules}

Coordinate rules:
- page.width must be ${width}
- page.height must be ${height}
- page.units must be "px"
- origin is top-left
- all x/y/w/h and edge points are pixels

${buildReconstructionSchemaText(width, height)}

${buildReconstructionVocabularyText()}

${buildReconstructionRulesText()}`;

  // 1.3 返回提示词
  logger.info("生成服务端重建提示词完成", { mode, chars: prompt.length });
  return prompt;
}
