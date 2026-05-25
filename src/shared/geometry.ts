import type { SceneNode } from "./scene";

export function resolveEndpoint(endpoint: string, nodes: SceneNode[]) {
  /*
   * ========================================================================
   * 步骤1：解析连线端点
   * ========================================================================
   * 目标：
   *   1) 支持 node:right@0.5 写法
   *   2) 给 Canvas、SVG、PPTX 共用同一套坐标规则
   */

  // 1.1 拆解节点和边位
  const [id, rawSide] = endpoint.split(":");
  const node = nodes.find((item) => item.id === id);
  if (!node) {
    return undefined;
  }

  // 1.2 计算端点坐标
  const [side, rawRatio] = (rawSide ?? "center").split("@");
  const parsedRatio = rawRatio === undefined || rawRatio === "" ? 0.5 : Number(rawRatio);
  const ratio = clampNumber(Number.isNaN(parsedRatio) ? 0.5 : parsedRatio, 0, 1);
  if (side === "left") {
    return { x: node.x, y: node.y + node.h * ratio };
  }
  if (side === "right") {
    return { x: node.x + node.w, y: node.y + node.h * ratio };
  }
  if (side === "top") {
    return { x: node.x + node.w * ratio, y: node.y };
  }
  if (side === "bottom") {
    return { x: node.x + node.w * ratio, y: node.y + node.h };
  }
  return { x: node.x + node.w / 2, y: node.y + node.h / 2 };
}

export function endpointReferencesNode(endpoint: string | undefined, nodeId: string) {
  /*
   * ========================================================================
   * 步骤1：判断端点归属
   * ========================================================================
   * 目标：
   *   1) 删除节点时清理依赖边
   *   2) 只比较端点冒号前的节点 id
   */

  // 1.1 读取端点节点 id
  const endpointNodeId = endpoint?.split(":")[0];

  // 1.2 返回归属判断
  return endpointNodeId === nodeId;
}

export function normalizeHexColor(value: string) {
  /*
   * ========================================================================
   * 步骤1：规范化十六进制颜色
   * ========================================================================
   * 目标：
   *   1) 支持 #RGB 和 RRGGBB
   *   2) 非法颜色保持原值
   */

  // 1.1 清理输入
  const raw = value.trim();
  const body = raw.startsWith("#") ? raw.slice(1) : raw;

  // 1.2 转换短颜色
  if (/^[0-9a-fA-F]{3}$/.test(body)) {
    return `#${body.split("").map((item) => item + item).join("").toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(body)) {
    return `#${body.toUpperCase()}`;
  }
  return value;
}

export function shadeColor(color: string, amount: number) {
  /*
   * ========================================================================
   * 步骤1：计算阴影色
   * ========================================================================
   * 目标：
   *   1) 把基础颜色按比例混合到黑色
   *   2) 统一 Canvas、SVG、PPTX 网格渲染
   */

  // 1.1 校验颜色格式
  const normalized = normalizeHexColor(color);
  const body = normalized.startsWith("#") ? normalized.slice(1) : normalized;
  if (!/^[0-9A-F]{6}$/.test(body)) {
    return color;
  }

  // 1.2 混合到黑色
  const factor = clampNumber(amount, 0, 1);
  const red = Math.round(parseInt(body.slice(0, 2), 16) * (1 - factor));
  const green = Math.round(parseInt(body.slice(2, 4), 16) * (1 - factor));
  const blue = Math.round(parseInt(body.slice(4, 6), 16) * (1 - factor));
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

export function clampNumber(value: number, min: number, max: number) {
  /*
   * ========================================================================
   * 步骤1：限制数字范围
   * ========================================================================
   * 目标：
   *   1) 防止 NaN 进入几何计算
   *   2) 把比例和透明度限制在合法范围
   */

  // 1.1 处理非法数字
  if (!Number.isFinite(value)) {
    return min;
  }

  // 1.2 返回范围内数值
  return Math.max(min, Math.min(max, value));
}

function toHex(value: number) {
  return clampNumber(value, 0, 255).toString(16).padStart(2, "0").toUpperCase();
}
