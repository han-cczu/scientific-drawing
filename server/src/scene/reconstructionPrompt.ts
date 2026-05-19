import { logger } from "../logger";

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

Output schema:
{
  "version": "0.1",
  "metadata": {
    "title": "short title",
    "created_by": "openai_vision_reconstruction",
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
}

Allowed node types:
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
- boundary_arrow

Rules:
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

  // 1.3 返回提示词
  logger.info("生成服务端重建提示词完成", { mode, chars: prompt.length });
  return prompt;
}
