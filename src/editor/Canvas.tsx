import { useMemo, useRef, useState } from "react";
import { logger } from "../lib/logger";
import { resolveEndpoint, shadeColor } from "../shared/geometry";
import type { Scene, SceneEdge, SceneNode } from "../shared/scene";

type CanvasProps = {
  scene: Scene;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (nodeId: string, dx: number, dy: number) => void;
};

type DragState = {
  nodeId: string;
  startX: number;
  startY: number;
};

export function Canvas({ scene, selectedId, onSelect, onMove }: CanvasProps) {
  /*
   * ========================================================================
   * 步骤1：初始化画布交互
   * ========================================================================
   * 目标：
   *   1) 维护拖拽状态
   *   2) 把浏览器坐标转换成 scene 坐标
   */
  logger.info("开始初始化画布交互...", { selectedId });

  // 1.1 准备 SVG 引用和拖拽状态
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  // 1.2 计算画布样式
  const aspectRatio = useMemo(() => `${scene.page.width} / ${scene.page.height}`, [scene.page.width, scene.page.height]);
  logger.info("初始化画布交互完成", { aspectRatio });

  /*
   * ========================================================================
   * 步骤2：处理指针事件
   * ========================================================================
   * 目标：
   *   1) 支持选中节点
   *   2) 支持拖拽移动节点
   */

  // 2.1 转换指针坐标
  const pointFromEvent = (event: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) {
      return { x: 0, y: 0 };
    }
    const rect = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * scene.page.width,
      y: ((event.clientY - rect.top) / rect.height) * scene.page.height
    };
  };

  // 2.2 启动拖拽
  const handlePointerDown = (event: React.PointerEvent, node: SceneNode) => {
    event.stopPropagation();
    onSelect(node.id);
    if (node.locked) {
      return;
    }
    const point = pointFromEvent(event);
    setDrag({ nodeId: node.id, startX: point.x, startY: point.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  // 2.3 移动节点
  const handlePointerMove = (event: React.PointerEvent) => {
    if (!drag) {
      return;
    }
    const point = pointFromEvent(event);
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    onMove(drag.nodeId, dx, dy);
    setDrag({ ...drag, startX: point.x, startY: point.y });
  };

  // 2.4 结束拖拽
  const handlePointerUp = () => {
    setDrag(null);
  };

  return (
    <div className="canvas-shell">
      <svg
        ref={svgRef}
        className="scene-canvas"
        viewBox={`0 0 ${scene.page.width} ${scene.page.height}`}
        style={{ aspectRatio }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onPointerDown={() => onSelect(null)}
      >
        <defs>
          <marker id="arrow-head" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="context-stroke" />
          </marker>
        </defs>
        <rect x="0" y="0" width={scene.page.width} height={scene.page.height} fill={scene.page.background} />
        {scene.edges.map((edge) => (
          <EdgeView key={edge.id} edge={edge} nodes={scene.nodes} />
        ))}
        {scene.nodes.map((node) => (
          <NodeView
            key={node.id}
            node={node}
            selected={node.id === selectedId}
            onPointerDown={(event) => handlePointerDown(event, node)}
          />
        ))}
      </svg>
    </div>
  );
}

function NodeView({ node, selected, onPointerDown }: {
  node: SceneNode;
  selected: boolean;
  onPointerDown: (event: React.PointerEvent<SVGGElement>) => void;
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
  ) : null;

  return (
    <g className={node.locked ? "node locked" : "node"} onPointerDown={onPointerDown}>
      {body}
      {selection}
    </g>
  );
}

function renderNodeBody(node: SceneNode) {
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

function EdgeView({ edge, nodes }: { edge: SceneEdge; nodes: SceneNode[] }) {
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

function GridNode({ node }: { node: SceneNode }) {
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

function BracketNode({ node }: { node: SceneNode }) {
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
