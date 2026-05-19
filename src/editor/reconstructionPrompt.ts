export function buildReconstructionPrompt() {
  /*
   * ========================================================================
   * 步骤1：生成重建提示词
   * ========================================================================
   * 目标：
   *   1) 让多模态模型按 Visiomaster 方法输出 scene.json
   *   2) 约束组件词表和坐标格式
   */
  return `你是论文图重建助手。请观察输入图片，输出严格 JSON，不要输出解释。

目标：把图片重建成可编辑 scene.json。不要只描述图片。不要输出 SVG。

坐标规则：
- page.units 必须是 "px"
- page.width/page.height 使用原图像素宽高
- 原点是左上角
- 所有 x/y/w/h 都用像素

输出格式：
{
  "version": "0.1",
  "metadata": {
    "title": "...",
    "created_by": "ai_reconstruction",
    "style_profile": "paper_white",
    "fidelity": "exact",
    "notes": []
  },
  "page": {
    "width": 原图宽,
    "height": 原图高,
    "units": "px",
    "origin": "top-left",
    "background": "#FFFFFF"
  },
  "nodes": [],
  "edges": []
}

允许的节点类型：
- text_block：所有标题、标签、公式、淡灰文字
- group_container：大框、模块框
- rounded_process：普通圆角矩形块
- process_box：普通矩形块
- operator_node：圆形算子、加号、乘号、勾叉等符号
- grid_matrix：规则小方格矩阵
- feature_map_grid：彩色条块、热力图、带列阴影的特征图
- bracket：括号、U形分组
- boundary_port：框边界上的输入输出锚点
- junction_point：不可见连线汇合点

允许的边类型：
- arrow_connector：带箭头连线
- line_segment：无箭头视觉线段
- join_connector：汇入点的无箭头连线
- fork_connector：从汇合点发出的箭头
- boundary_arrow：从模块边界发出的箭头

要求：
1. 先识别大容器和标题，再识别内部图元。
2. 论文图中的淡灰文字也必须作为 text_block 输出。
3. 彩色序号块必须保留数字。grid_matrix 用 cell_labels 或 cells[].text 写入数字。
4. 投票行里的 “1 2 votes ✓” 这类内容必须保留数字、票数文字和勾叉。
5. 原图是实线圆角容器时不要输出虚线。只有原图可见虚线时才用 line_dash。
6. 箭头必须用 edges，不要用细长矩形伪造。粗箭头要写较大的 line_weight_pt。
7. 复杂多段箭头必须写 points。
8. 大框不要作为连线终点，使用 boundary_port 或 junction_point。
9. 只在无法编辑且不是核心信息时才用 image_tile。
10. 输出必须是合法 JSON，不能有 markdown 代码围栏。`;
}
