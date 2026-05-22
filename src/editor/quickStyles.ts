/*
 * ============================================================================
 * 快速样式预设
 * ============================================================================
 * 目标：
 *   1) 提供 9 个常用 {fill, stroke} 色彩搭配，覆盖论文配图常见调性
 *   2) 配色取自参考图：浅蓝/浅绿/浅紫/浅粉/浅橙/中蓝/中绿/灰白/深紫
 *
 * 注意：
 *   这里的 hex 是矢量节点的样式色（fill/stroke），属于业务数据而非主题 token；
 *   主题 token 用于 UI 框架（背景/边框/文字），互不冲突。
 */

export type QuickStylePreset = {
  name: string;
  fill: string;
  stroke: string;
};

export const QUICK_STYLE_PRESETS: QuickStylePreset[] = [
  { name: "浅蓝", fill: "#DBEAFE", stroke: "#1D4ED8" },
  { name: "浅绿", fill: "#DCFCE7", stroke: "#15803D" },
  { name: "浅紫", fill: "#EDE9FE", stroke: "#6D28D9" },
  { name: "浅粉", fill: "#FCE7F3", stroke: "#BE185D" },
  { name: "浅橙", fill: "#FFEDD5", stroke: "#C2410C" },
  { name: "中蓝", fill: "#3B82F6", stroke: "#1E3A8A" },
  { name: "中绿", fill: "#22C55E", stroke: "#14532D" },
  { name: "灰白", fill: "#F1F5F9", stroke: "#475569" },
  { name: "深紫", fill: "#7C3AED", stroke: "#3B0764" }
];
