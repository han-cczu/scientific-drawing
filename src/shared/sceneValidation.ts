import { isNormalizedHexColor, normalizeHexColor } from "./geometry";
import type { Scene, SceneEdge, SceneEdgeType, SceneNode, SceneNodeType, SceneStyle } from "./scene";

// 网格行列上界：与 repairScene 的钳制共用，校验层兜底防止超大网格在
// 不经 repair 的导出/区域路径上触发 rows*cols 级渲染循环（DoS）。
export const MAX_GRID_DIMENSION = 256;

// 单个网格 cells 数组长度上界：等于最大网格的单元格总数，超出即视为畸形输入，
// 防止超长 cells 数组放大解析/内存开销（渲染侧已用 indexGridCells 改 O(1) 查表）。
export const MAX_GRID_CELLS = MAX_GRID_DIMENSION * MAX_GRID_DIMENSION;

export type ValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
};

const NODE_TYPES = new Set<SceneNodeType>([
  "text",
  "rect",
  "rounded_rect",
  "ellipse",
  "line",
  "arrow",
  "image",
  "grid",
  "feature_grid",
  "bracket",
  "operator"
]);

const EDGE_TYPES = new Set<SceneEdgeType>(["arrow", "line", "join", "fork"]);

export function validateScene(value: unknown): ValidationResult {
  /*
   * ========================================================================
   * 步骤1：校验 scene 根结构
   * ========================================================================
   * 目标：
   *   1) 确认导入和导出对象满足运行时协议
   *   2) 返回可读错误列表，不抛出不透明异常
   */

  // 1.1 校验根对象
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "$", code: "scene_not_object", message: "Scene must be an object." }] };
  }

  // 1.2 校验 page、metadata、nodes、edges
  validateVersion(value.version, issues);
  validatePage(value.page, issues);
  validateMetadata(value.metadata, issues);
  const nodes = validateNodeList(value.nodes, issues);
  validateEdges(value.edges, nodes, issues);
  return { ok: issues.length === 0, issues };
}

export function assertScene(value: unknown): Scene {
  /*
   * ========================================================================
   * 步骤1：断言 scene 合法
   * ========================================================================
   * 目标：
   *   1) 给 API 路由提供简单入口
   *   2) 把校验错误转成异常文本
   */

  // 1.1 执行校验
  const result = validateScene(value);
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => `${issue.path} ${issue.code}: ${issue.message}`).join("; "));
  }

  // 1.2 返回类型化 scene
  return value as Scene;
}

function validateVersion(value: unknown, issues: ValidationIssue[]) {
  /*
   * ========================================================================
   * 步骤1：校验协议版本
   * ========================================================================
   * 目标：
   *   1) 限定当前支持的 scene 版本
   *   2) 避免未知协议静默进入渲染链路
   */

  // 1.1 检查版本号
  if (value !== "0.1") {
    addIssue(issues, "$.version", "invalid_version", "Scene version must be 0.1.");
  }
}

function validatePage(value: unknown, issues: ValidationIssue[]) {
  /*
   * ========================================================================
   * 步骤1：校验页面字段
   * ========================================================================
   * 目标：
   *   1) 保证画布尺寸有效
   *   2) 保证背景颜色可渲染
   */

  // 1.1 校验 page 对象
  if (!isRecord(value)) {
    addIssue(issues, "$.page", "page_not_object", "Page must be an object.");
    return;
  }

  // 1.2 校验尺寸、单位和背景
  if (!isPositiveNumber(value.width)) {
    addIssue(issues, "$.page.width", "invalid_page_width", "Page width must be positive.");
  }
  if (!isPositiveNumber(value.height)) {
    addIssue(issues, "$.page.height", "invalid_page_height", "Page height must be positive.");
  }
  if (value.units !== "px") {
    addIssue(issues, "$.page.units", "invalid_page_units", "Page units must be px.");
  }
  validateColor(value.background, "$.page.background", issues, "#FFFFFF");
}

function validateMetadata(value: unknown, issues: ValidationIssue[]) {
  /*
   * ========================================================================
   * 步骤1：校验元数据字段
   * ========================================================================
   * 目标：
   *   1) 保证导出文件名和标题有基础来源
   *   2) 保证 notes 是数组
   */

  // 1.1 校验 metadata 对象
  if (!isRecord(value)) {
    addIssue(issues, "$.metadata", "metadata_not_object", "Metadata must be an object.");
    return;
  }

  // 1.2 校验必要字段
  if (typeof value.id !== "string" || !value.id.trim()) {
    addIssue(issues, "$.metadata.id", "invalid_metadata_id", "Metadata id must be a non-empty string.");
  }
  if (typeof value.title !== "string") {
    addIssue(issues, "$.metadata.title", "invalid_metadata_title", "Metadata title must be a string.");
  }
  if (typeof value.createdAt !== "string") {
    addIssue(issues, "$.metadata.createdAt", "invalid_metadata_created_at", "Metadata createdAt must be a string.");
  }
  if (typeof value.engine !== "string") {
    addIssue(issues, "$.metadata.engine", "invalid_metadata_engine", "Metadata engine must be a string.");
  }
  if (!Array.isArray(value.notes) || !value.notes.every((item) => typeof item === "string")) {
    addIssue(issues, "$.metadata.notes", "invalid_metadata_notes", "Metadata notes must be a string array.");
  }
}

function validateNodeList(value: unknown, issues: ValidationIssue[]) {
  /*
   * ========================================================================
   * 步骤1：校验节点列表
   * ========================================================================
   * 目标：
   *   1) 捕获重复 id 和非法图元
   *   2) 返回可供边校验使用的合法节点数组
   */

  // 1.1 校验数组结构
  if (!Array.isArray(value)) {
    addIssue(issues, "$.nodes", "nodes_not_array", "Nodes must be an array.");
    return [];
  }

  // 1.2 校验单个节点
  const seen = new Set<string>();
  const nodes: SceneNode[] = [];
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      addIssue(issues, `$.nodes[${index}]`, "node_not_object", "Node must be an object.");
      return;
    }
    const node = item as unknown as SceneNode;
    validateNode(node, index, seen, issues);
    nodes.push(node);
  });
  return nodes;
}

function validateNode(node: SceneNode, index: number, seen: Set<string>, issues: ValidationIssue[]) {
  /*
   * ========================================================================
   * 步骤1：校验单个节点
   * ========================================================================
   * 目标：
   *   1) 保证节点可被 Canvas/SVG/PPTX 渲染
   *   2) 保证样式和网格字段不破坏导出
   */

  // 1.1 校验 id 和类型
  const path = `$.nodes[${index}]`;
  if (typeof node.id !== "string" || !node.id.trim()) {
    addIssue(issues, `${path}.id`, "invalid_node_id", "Node id must be a non-empty string.");
  } else if (seen.has(node.id)) {
    addIssue(issues, `${path}.id`, "duplicate_node_id", "Node id must be unique.");
  } else {
    seen.add(node.id);
  }
  if (!NODE_TYPES.has(node.type)) {
    addIssue(issues, `${path}.type`, "invalid_node_type", "Node type is not supported.");
  }

  // 1.2 校验几何和样式
  validateFiniteNumber(node.x, `${path}.x`, "invalid_node_x", issues);
  validateFiniteNumber(node.y, `${path}.y`, "invalid_node_y", issues);
  if (!isPositiveNumber(node.w)) {
    addIssue(issues, `${path}.w`, "invalid_node_width", "Node width must be positive.");
  }
  if (!isNonNegativeNumber(node.h)) {
    addIssue(issues, `${path}.h`, "invalid_node_height", "Node height must be non-negative.");
  }
  validateStyle(node.style, `${path}.style`, issues);
  validateOptionalBoolean(node.locked, `${path}.locked`, "invalid_node_locked", issues);
  validateOptionalBoolean(node.hidden, `${path}.hidden`, "invalid_node_hidden", issues);
  validateNodeCollections(node, path, issues);
}

function validateNodeCollections(node: SceneNode, path: string, issues: ValidationIssue[]) {
  /*
   * ========================================================================
   * 步骤1：校验节点集合字段
   * ========================================================================
   * 目标：
   *   1) 保证 points、cells 等数组结构可用
   *   2) 捕获网格行列非法值
   */

  // 1.1 校验线段点和网格行列
  if (node.points !== undefined) {
    validatePoints(node.points, `${path}.points`, issues);
  }
  if (node.rows !== undefined && (!Number.isInteger(node.rows) || node.rows < 1 || node.rows > MAX_GRID_DIMENSION)) {
    addIssue(issues, `${path}.rows`, "invalid_grid_rows", `Grid rows must be an integer between 1 and ${MAX_GRID_DIMENSION}.`);
  }
  if (node.cols !== undefined && (!Number.isInteger(node.cols) || node.cols < 1 || node.cols > MAX_GRID_DIMENSION)) {
    addIssue(issues, `${path}.cols`, "invalid_grid_cols", `Grid cols must be an integer between 1 and ${MAX_GRID_DIMENSION}.`);
  }

  // 1.2 校验单元格
  if (node.cells !== undefined) {
    if (!Array.isArray(node.cells)) {
      addIssue(issues, `${path}.cells`, "invalid_grid_cells", "Grid cells must be an array.");
      return;
    }
    if (node.cells.length > MAX_GRID_CELLS) {
      addIssue(issues, `${path}.cells`, "too_many_grid_cells", `Grid cells must not exceed ${MAX_GRID_CELLS}.`);
      return;
    }
    node.cells.forEach((cell, index) => {
      // 先守卫 null/原始值元素：直接访问 cell.row 会抛 TypeError，违反“只返错误列表不抛异常”契约
      if (!isRecord(cell)) {
        addIssue(issues, `${path}.cells[${index}]`, "invalid_grid_cell", "Grid cell must be an object.");
        return;
      }
      if (!Number.isInteger(cell.row) || cell.row < 0 || !Number.isInteger(cell.col) || cell.col < 0) {
        addIssue(issues, `${path}.cells[${index}]`, "invalid_grid_cell_position", "Grid cell row and col must be non-negative integers.");
      }
      if (cell.fill !== undefined) {
        validateColor(cell.fill, `${path}.cells[${index}].fill`, issues, "#FFFFFF");
      }
      if (cell.color !== undefined) {
        validateColor(cell.color, `${path}.cells[${index}].color`, issues, "#111111");
      }
    });
  }
}

function validateEdges(value: unknown, nodes: SceneNode[], issues: ValidationIssue[]) {
  /*
   * ========================================================================
   * 步骤1：校验连线列表
   * ========================================================================
   * 目标：
   *   1) 捕获重复 edge id 和非法类型
   *   2) 捕获引用不存在节点的端点
   */

  // 1.1 校验数组结构
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    addIssue(issues, "$.edges", "edges_not_array", "Edges must be an array.");
    return;
  }

  // 1.2 校验单条边
  const seen = new Set<string>();
  const nodeIds = new Set(nodes.map((node) => node.id));
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      addIssue(issues, `$.edges[${index}]`, "edge_not_object", "Edge must be an object.");
      return;
    }
    validateEdge(item as unknown as SceneEdge, index, seen, nodeIds, issues);
  });
}

function validateEdge(edge: SceneEdge, index: number, seen: Set<string>, nodeIds: Set<string>, issues: ValidationIssue[]) {
  /*
   * ========================================================================
   * 步骤1：校验单条连线
   * ========================================================================
   * 目标：
   *   1) 保证边可解析为 SVG/PPTX 线段
   *   2) 保证端点引用存在
   */

  // 1.1 校验基础字段
  const path = `$.edges[${index}]`;
  if (typeof edge.id !== "string" || !edge.id.trim()) {
    addIssue(issues, `${path}.id`, "invalid_edge_id", "Edge id must be a non-empty string.");
  } else if (seen.has(edge.id)) {
    addIssue(issues, `${path}.id`, "duplicate_edge_id", "Edge id must be unique.");
  } else {
    seen.add(edge.id);
  }
  if (!EDGE_TYPES.has(edge.type)) {
    addIssue(issues, `${path}.type`, "invalid_edge_type", "Edge type is not supported.");
  }
  validateStyle(edge.style, `${path}.style`, issues);

  // 1.2 校验端点和折线点
  validateEndpoint(edge.from, nodeIds, `${path}.from`, "missing_edge_source", issues);
  validateEndpoint(edge.to, nodeIds, `${path}.to`, "missing_edge_target", issues);
  if (edge.fromPoint !== undefined) {
    validatePoint(edge.fromPoint, `${path}.fromPoint`, issues);
  }
  if (edge.toPoint !== undefined) {
    validatePoint(edge.toPoint, `${path}.toPoint`, issues);
  }
  if (edge.points !== undefined) {
    validatePoints(edge.points, `${path}.points`, issues);
  }
}

function validateStyle(value: unknown, path: string, issues: ValidationIssue[]) {
  /*
   * ========================================================================
   * 步骤1：校验样式对象
   * ========================================================================
   * 目标：
   *   1) 防止非法颜色进入导出器
   *   2) 防止非法字号、线宽和透明度进入渲染
   */

  // 1.1 校验 style 对象
  if (!isRecord(value)) {
    addIssue(issues, path, "style_not_object", "Style must be an object.");
    return;
  }
  const style = value as SceneStyle;

  // 1.2 校验样式字段
  validateColor(style.fill, `${path}.fill`, issues, "none");
  validateColor(style.stroke, `${path}.stroke`, issues, "none");
  validateColor(style.color, `${path}.color`, issues, "#111111");
  if (style.strokeWidth !== undefined && !isNonNegativeNumber(style.strokeWidth)) {
    addIssue(issues, `${path}.strokeWidth`, "invalid_stroke_width", "Stroke width must be non-negative.");
  }
  if (style.fontSize !== undefined && !isPositiveNumber(style.fontSize)) {
    addIssue(issues, `${path}.fontSize`, "invalid_font_size", "Font size must be positive.");
  }
  if (style.opacity !== undefined && (!isNonNegativeNumber(style.opacity) || style.opacity > 1)) {
    addIssue(issues, `${path}.opacity`, "invalid_opacity", "Opacity must be between 0 and 1.");
  }
}

function validateEndpoint(
  endpoint: unknown,
  nodeIds: Set<string>,
  path: string,
  code: string,
  issues: ValidationIssue[]
) {
  /*
   * ========================================================================
   * 步骤1：校验端点引用
   * ========================================================================
   * 目标：
   *   1) 支持省略端点的显式坐标边
   *   2) 捕获引用不存在节点的边
   */

  // 1.1 跳过空端点
  if (endpoint === undefined) {
    return;
  }

  // 1.2 守卫非字符串端点：from/to 来自不可信 JSON，直接 .split 会抛 TypeError，
  //     违反“只返错误列表不抛不透明异常”契约（与 cells 元素守卫同理）
  if (typeof endpoint !== "string") {
    addIssue(issues, path, code, "Endpoint must be a string.");
    return;
  }

  // 1.3 校验端点节点存在
  const nodeId = endpoint.split(":")[0];
  if (!nodeIds.has(nodeId)) {
    addIssue(issues, path, code, `Endpoint node ${nodeId} does not exist.`);
  }
}

function validatePoints(value: unknown, path: string, issues: ValidationIssue[]) {
  /*
   * ========================================================================
   * 步骤1：校验点数组
   * ========================================================================
   * 目标：
   *   1) 保证折线点数组结构正确
   *   2) 捕获非法坐标
   */

  // 1.1 校验数组
  if (!Array.isArray(value)) {
    addIssue(issues, path, "points_not_array", "Points must be an array.");
    return;
  }

  // 1.2 校验每个点
  value.forEach((point, index) => validatePoint(point, `${path}[${index}]`, issues));
}

function validatePoint(value: unknown, path: string, issues: ValidationIssue[]) {
  if (!isRecord(value)) {
    addIssue(issues, path, "point_not_object", "Point must be an object.");
    return;
  }
  validateFiniteNumber(value.x, `${path}.x`, "invalid_point_x", issues);
  validateFiniteNumber(value.y, `${path}.y`, "invalid_point_y", issues);
}

function validateColor(value: unknown, path: string, issues: ValidationIssue[], fallback: string) {
  if (value === undefined || value === fallback) {
    return;
  }
  if (typeof value !== "string") {
    addIssue(issues, path, "invalid_color", "Color must be a string.");
    return;
  }
  if (value === "none") {
    return;
  }
  // 必须带 # 前缀：裸 hex（如 "AABBCC"）虽可被 normalizeHexColor 规范化，
  // 但校验只判不改值，放行会让非法 CSS paint 值直达 SVG 渲染端。
  if (!value.startsWith("#") || !isNormalizedHexColor(normalizeHexColor(value))) {
    addIssue(issues, path, "invalid_color", "Color must be a #RGB/#RRGGBB hex color or none.");
  }
}

function validateFiniteNumber(value: unknown, path: string, code: string, issues: ValidationIssue[]) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    addIssue(issues, path, code, "Value must be a finite number.");
  }
}

function validateOptionalBoolean(value: unknown, path: string, code: string, issues: ValidationIssue[]) {
  if (value !== undefined && typeof value !== "boolean") {
    addIssue(issues, path, code, "Value must be a boolean.");
  }
}

function isPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addIssue(issues: ValidationIssue[], path: string, code: string, message: string) {
  issues.push({ path, code, message });
}
