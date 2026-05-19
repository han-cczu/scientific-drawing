import { logger } from "../lib/logger";

export type ReconstructionPromptDimension = number | string;

export function buildReconstructionSchemaText(width: ReconstructionPromptDimension, height: ReconstructionPromptDimension) {
  /*
   * ========================================================================
   * 步骤1：构建共享 scene schema 文本
   * ========================================================================
   * 目标：
   *   1) 前端提示词导出和服务端 AI 调用共用同一份协议说明
   *   2) 避免两份 prompt schema 分叉
   */
  logger.info("开始构建共享 scene schema 文本...", { width, height });

  // 1.1 生成 schema 文本
  const schema = `Output schema:
{
  "version": "0.1",
  "metadata": {
    "title": "short title",
    "created_by": "ai_reconstruction",
    "style_profile": "paper_white",
    "fidelity": "exact",
    "notes": []
  },
  "page": {
    "width": ${width},
    "height": ${height},
    "units": "px",
    "origin": "top-left",
    "background": "#FFFFFF"
  },
  "nodes": [],
  "edges": []
}`;

  logger.info("构建共享 scene schema 文本完成", { chars: schema.length });
  return schema;
}

export function buildReconstructionVocabularyText() {
  /*
   * ========================================================================
   * 步骤1：构建共享节点和边词表
   * ========================================================================
   * 目标：
   *   1) 统一前后端提示词允许的 Visiomaster 类型
   *   2) 降低新类型补充时的分叉风险
   */
  logger.info("开始构建共享节点和边词表...");

  // 1.1 生成词表文本
  const vocabulary = `Allowed node types:
- text_block: titles, labels, formulas, gray text
- group_container: big frames and module boxes
- rounded_process: rounded or colored blocks
- process_box: rectangular blocks
- operator_node: circle operators, check marks, x marks, locks when editable as symbols
- grid_matrix: repeated colored square blocks and voting tables
- feature_map_grid: heatmap-like feature blocks
- bracket: U brackets or grouping brackets
- boundary_port: frame-edge input/output anchors
- junction_point: invisible merge/fan points
- image_tile: only for tiny icons that are not worth reconstructing

Allowed edge types:
- arrow_connector
- line_segment
- join_connector
- fork_connector
- boundary_arrow`;

  logger.info("构建共享节点和边词表完成", { chars: vocabulary.length });
  return vocabulary;
}

export function buildReconstructionRulesText() {
  /*
   * ========================================================================
   * 步骤1：构建共享重建规则
   * ========================================================================
   * 目标：
   *   1) 统一视觉还原、文字保留和连线约束
   *   2) 让前端导出提示词和服务端调用提示词保持一致
   */
  logger.info("开始构建共享重建规则...");

  // 1.1 生成规则文本
  const rules = `Rules:
1. Rebuild the main structure as editable nodes and edges.
2. Include all visible text, including low-contrast gray labels.
3. Colored numbered blocks must include the visible number as cell_labels or text. Do not output empty grids for numbered blocks.
4. Vote rows such as "1 2 votes ✓" should preserve the number, vote text, and ✓/✕ as editable text or labeled cells.
5. Solid rounded containers in the source must stay solid. Use style.line_dash only when the source border is visibly dashed.
6. Use thick edges for large arrows. Use explicit points for multi-segment arrows.
7. Do not use group_container as an edge endpoint. Use boundary_port or junction_point.
8. Preserve the visual layout and follow the selected color mode exactly.
9. Prefer fewer semantic composite nodes over hundreds of tiny unrelated boxes.
10. JSON must be parseable.`;

  logger.info("构建共享重建规则完成", { chars: rules.length });
  return rules;
}
