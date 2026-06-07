import { resolveEndpoint, shadeColor } from "../shared/geometry";
import type { SceneEdge, SceneNode } from "../shared/scene";
import { ResizeHandles } from "./canvasHandles";
import type { ResizeHandle } from "./sceneOps";

export function NodeView({ node, selected, onPointerDown, onResizePointerDown, onDoubleClick }: {
  node: SceneNode;
  selected: boolean;
  onPointerDown: (event: React.PointerEvent<SVGGElement>) => void;
  onResizePointerDown: (event: React.PointerEvent<SVGElement>, handle: ResizeHandle) => void;
  /** 双击进入文本/属性编辑（可选，由 Canvas 传入） */
  onDoubleClick?: (event: React.MouseEvent<SVGGElement>) => void;
}) {
  /*
   * ========================================================================
   * 步骤1：渲染节点
   * ========================================================================
   * 目标：
   *   1) 根据节点类型绘制 SVG 元素
   *   2) 在选中状态显示外框
   */
  // 1.1 生成节点主体
  const body = renderNodeBody(node);

  // 1.2 生成选中框
  const selection = selected && !node.locked ? (
    <>
      <rect
        x={node.x - 5}
        y={node.y - 5}
        width={node.w + 10}
        height={node.h + 10}
        fill="none"
        stroke="#2563EB"
        strokeWidth={2}
        strokeDasharray="7 5"
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
      <ResizeHandles node={node} onPointerDown={onResizePointerDown} />
    </>
  ) : null;

  return (
    <g className={node.locked ? "node locked" : "node"} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick}>
      {body}
      {selection}
    </g>
  );
}

export function renderNodeBody(node: SceneNode) {
  /*
   * ========================================================================
   * 步骤1：渲染节点主体
   * ========================================================================
   * 目标：
   *   1) 映射 scene 节点到 SVG
   *   2) 保持文本、线条和形状可见
   */
  // 1.1 读取通用样式
  const fill = node.style.fill ?? "none";
  const stroke = node.style.stroke ?? "none";
  const strokeWidth = node.style.strokeWidth ?? 1;
  const opacity = node.style.opacity ?? 1;

  // 1.2 根据类型生成 SVG
  if (node.type === "image") {
    return <image href={node.source} x={node.x} y={node.y} width={node.w} height={node.h} opacity={opacity} />;
  }
  if (node.type === "text") {
    return (
      <text
        x={node.x}
        y={node.y + node.h * 0.78}
        fill={node.style.color ?? "#111111"}
        fontFamily={node.style.fontFamily ?? "Times New Roman"}
        fontSize={node.style.fontSize ?? 16}
        fontWeight={node.style.fontWeight ?? "400"}
        opacity={opacity}
      >
        {node.text}
      </text>
    );
  }
  if (node.type === "ellipse") {
    return (
      <ellipse
        cx={node.x + node.w / 2}
        cy={node.y + node.h / 2}
        rx={node.w / 2}
        ry={node.h / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={node.style.dash}
        opacity={opacity}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  if (node.type === "operator") {
    const size = Math.min(node.w, node.h);
    const cx = node.x + node.w / 2;
    const cy = node.y + node.h / 2;
    return (
      <>
        <ellipse
          cx={cx}
          cy={cy}
          rx={size / 2}
          ry={size / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={node.style.dash}
          opacity={opacity}
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={cx}
          y={cy}
          fill={node.style.color ?? "#111111"}
          fontFamily={node.style.fontFamily ?? "Cambria Math"}
          fontSize={node.style.fontSize ?? 16}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {node.symbol || node.text}
        </text>
      </>
    );
  }
  if (node.type === "grid" || node.type === "feature_grid") {
    return <GridNode node={node} />;
  }
  if (node.type === "bracket") {
    return <BracketNode node={node} />;
  }
  if (node.type === "line" || node.type === "arrow") {
    const points = node.points?.length ? node.points : [{ x: node.x, y: node.y }, { x: node.x + node.w, y: node.y + node.h }];
    return (
      <polyline
        points={points.map((point) => `${point.x},${point.y}`).join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={node.style.dash}
        opacity={opacity}
        markerEnd={node.type === "arrow" ? "url(#arrow-head)" : undefined}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  return (
    <>
      <rect
        x={node.x}
        y={node.y}
        width={node.w}
        height={node.h}
        rx={node.type === "rounded_rect" ? 12 : 3}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={node.style.dash}
        opacity={opacity}
        vectorEffect="non-scaling-stroke"
      />
      {node.text ? (
        <text
          x={node.x + node.w / 2}
          y={node.y + node.h / 2}
          fill={node.style.color ?? "#111111"}
          fontFamily={node.style.fontFamily ?? "Times New Roman"}
          fontSize={node.style.fontSize ?? 14}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {node.text}
        </text>
      ) : null}
    </>
  );
}

export function EdgeView({ edge, nodes }: { edge: SceneEdge; nodes: SceneNode[] }) {
  /*
   * ========================================================================
   * 步骤1：渲染语义连线
   * ========================================================================
   * 目标：
   *   1) 根据 from/to 或显式坐标计算折线
   *   2) 按类型决定是否显示箭头
   */
  // 1.1 解析端点坐标
  const start = edge.fromPoint ?? (edge.from ? resolveEndpoint(edge.from, nodes) : undefined);
  const end = edge.toPoint ?? (edge.to ? resolveEndpoint(edge.to, nodes) : undefined);
  if (!start || !end) {
    return null;
  }

  // 1.2 拼接折线路径
  const points = [start, ...(edge.points ?? []), end];
  return (
    <polyline
      points={points.map((point) => `${point.x},${point.y}`).join(" ")}
      fill="none"
      stroke={edge.style.stroke ?? "#111111"}
      strokeWidth={edge.style.strokeWidth ?? 1.25}
      strokeDasharray={edge.style.dash}
      opacity={edge.style.opacity ?? 1}
      markerEnd={edge.type === "arrow" || edge.type === "fork" ? "url(#arrow-head)" : undefined}
      vectorEffect="non-scaling-stroke"
    />
  );
}

export function GridNode({ node }: { node: SceneNode }) {
  /*
   * ========================================================================
   * 步骤1：渲染矩阵/特征图节点
   * ========================================================================
   * 目标：
   *   1) 用 rows/cols 拆成可视单元格
   *   2) 支持 rowColors、columnShades 和 colored_cells
   */
  // 1.1 计算网格参数
  const rows = node.rows ?? 1;
  const cols = node.cols ?? 1;
  const cellW = node.w / cols;
  const cellH = node.h / rows;
  const cells = [];

  // 1.2 渲染每个单元格
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const explicit = node.cells?.find((cell) => cell.row === row && cell.col === col);
      const base = explicit?.fill ?? node.rowColors?.[row % Math.max(1, node.rowColors.length)] ?? node.style.fill ?? "#FFFFFF";
      const fill = shadeColor(base, node.columnShades?.[col] ?? 0);
      cells.push(
        <rect
          key={`${row}-${col}`}
          x={node.x + col * cellW}
          y={node.y + row * cellH}
          width={cellW}
          height={cellH}
          fill={fill}
          stroke={node.style.stroke ?? "#111111"}
          strokeWidth={node.style.strokeWidth ?? 0.8}
          vectorEffect="non-scaling-stroke"
        />
      );
      if (explicit?.text) {
        cells.push(
          <text
            key={`${row}-${col}-text`}
            x={node.x + col * cellW + cellW / 2}
            y={node.y + row * cellH + cellH / 2}
            fill={explicit.color ?? node.style.color ?? "#111111"}
            fontFamily={node.style.fontFamily ?? "Times New Roman"}
            fontSize={node.style.fontSize ?? Math.max(10, Math.min(28, cellH * 0.62))}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {explicit.text}
          </text>
        );
      }
    }
  }
  return <>{cells}</>;
}

export function BracketNode({ node }: { node: SceneNode }) {
  /*
   * ========================================================================
   * 步骤1：渲染括号节点
   * ========================================================================
   * 目标：
   *   1) 用主干和刻度线表示分组括号
   *   2) 支持 left/right/up/down 四个方向
   */
  // 1.1 计算括号线段
  const ticks = node.tickPositions?.length ? node.tickPositions : [0, 1];
  const segments: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];
  if (node.orientation === "up" || node.orientation === "down") {
    const y = node.orientation === "up" ? node.y : node.y + node.h;
    segments.push([{ x: node.x, y }, { x: node.x + node.w, y }]);
    ticks.forEach((tick) => segments.push([{ x: node.x + node.w * tick, y: node.y }, { x: node.x + node.w * tick, y }]));
  } else {
    const x = node.orientation === "left" ? node.x : node.x + node.w;
    segments.push([{ x, y: node.y }, { x, y: node.y + node.h }]);
    ticks.forEach((tick) => segments.push([{ x: node.x, y: node.y + node.h * tick }, { x, y: node.y + node.h * tick }]));
  }

  // 1.2 输出线段
  return (
    <>
      {segments.map(([start, end], index) => (
        <line
          key={index}
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={node.style.stroke ?? "#111111"}
          strokeWidth={node.style.strokeWidth ?? 1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  );
}
