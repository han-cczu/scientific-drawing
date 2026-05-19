import { useEffect, useMemo, useRef, useState } from "react";
import { logger } from "../lib/logger";
import { resolveEndpoint, shadeColor } from "../shared/geometry";
import type { Scene, SceneEdge, SceneNode } from "../shared/scene";
import type { ResizeHandle, SceneBox } from "./sceneOps";
import { clientPointToScene, panViewport, zoomViewportAt, type Viewport } from "./viewport";

type CanvasProps = {
  scene: Scene;
  selectedId: string | null;
  selectedIds: string[];
  viewport: Viewport;
  onSelect: (ids: string[]) => void;
  onMove: (nodeIds: string[], dx: number, dy: number) => void;
  onResize: (nodeId: string, handle: ResizeHandle, startBox: SceneBox, dx: number, dy: number) => void;
  onBoxSelect: (box: SceneBox) => void;
  onNodeActivate: (nodeId: string) => void;
  onViewportChange: (viewport: Viewport) => void;
};

type DragState = {
  nodeIds: string[];
  startX: number;
  startY: number;
};

type ResizeState = {
  nodeId: string;
  handle: ResizeHandle;
  startBox: SceneBox;
  startX: number;
  startY: number;
};

type BoxSelectState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type PanState = {
  clientX: number;
  clientY: number;
};

export function Canvas({ scene, selectedId, selectedIds, viewport, onSelect, onMove, onResize, onBoxSelect, onNodeActivate, onViewportChange }: CanvasProps) {
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
  const [resize, setResize] = useState<ResizeState | null>(null);
  const [boxSelect, setBoxSelect] = useState<BoxSelectState | null>(null);
  const [pan, setPan] = useState<PanState | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);

  // 1.2 计算画布样式
  const aspectRatio = useMemo(() => `${scene.page.width} / ${scene.page.height}`, [scene.page.width, scene.page.height]);
  logger.info("初始化画布交互完成", { aspectRatio });

  // 1.3 监听空格平移模式
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setSpacePressed(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setSpacePressed(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  /*
   * ========================================================================
   * 步骤2：处理指针事件
   * ========================================================================
   * 目标：
   *   1) 支持选中节点
   *   2) 支持拖拽移动节点
   */

  // 2.1 转换指针坐标
  const pointFromEvent = (event: React.PointerEvent | React.WheelEvent) => {
    const svg = svgRef.current;
    if (!svg) {
      return { x: 0, y: 0 };
    }
    const rect = svg.getBoundingClientRect();
    return clientPointToScene({
      clientX: event.clientX,
      clientY: event.clientY,
      rect,
      page: scene.page,
      viewport
    });
  };

  // 2.2 启动拖拽
  const handlePointerDown = (event: React.PointerEvent, node: SceneNode) => {
    event.stopPropagation();
    if (event.button === 1 || spacePressed) {
      setPan({ clientX: event.clientX, clientY: event.clientY });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const activeIds = selectedIds.includes(node.id) ? selectedIds : [node.id];
    onSelect(activeIds);
    onNodeActivate(node.id);
    if (node.locked) {
      return;
    }
    const point = pointFromEvent(event);
    setDrag({ nodeIds: activeIds, startX: point.x, startY: point.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  // 2.3 移动节点
  const handlePointerMove = (event: React.PointerEvent) => {
    if (resize) {
      const point = pointFromEvent(event);
      onResize(resize.nodeId, resize.handle, resize.startBox, point.x - resize.startX, point.y - resize.startY);
      return;
    }
    if (!drag) {
      return;
    }
    const point = pointFromEvent(event);
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    onMove(drag.nodeIds, dx, dy);
    setDrag({ ...drag, startX: point.x, startY: point.y });
  };

  // 2.4 结束拖拽
  const handlePointerUp = () => {
    setResize(null);
    setDrag(null);
  };

  // 2.5 启动空白区域框选
  const handleCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.button === 1 || spacePressed) {
      setPan({ clientX: event.clientX, clientY: event.clientY });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const point = pointFromEvent(event);
    onSelect([]);
    setBoxSelect({ startX: point.x, startY: point.y, currentX: point.x, currentY: point.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  // 2.6 更新框选区域
  const handleCanvasPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (pan) {
      const svg = svgRef.current;
      const rect = svg?.getBoundingClientRect();
      const delta = rect ? {
        x: ((event.clientX - pan.clientX) / rect.width) * scene.page.width,
        y: ((event.clientY - pan.clientY) / rect.height) * scene.page.height
      } : { x: 0, y: 0 };
      onViewportChange(panViewport(viewport, delta));
      setPan({ clientX: event.clientX, clientY: event.clientY });
      return;
    }
    if (boxSelect) {
      const point = pointFromEvent(event);
      setBoxSelect({ ...boxSelect, currentX: point.x, currentY: point.y });
      return;
    }
    handlePointerMove(event);
  };

  // 2.7 结束框选
  const handleCanvasPointerUp = () => {
    if (pan) {
      setPan(null);
      return;
    }
    if (boxSelect) {
      onBoxSelect({
        x: boxSelect.startX,
        y: boxSelect.startY,
        w: boxSelect.currentX - boxSelect.startX,
        h: boxSelect.currentY - boxSelect.startY
      });
      setBoxSelect(null);
      return;
    }
    handlePointerUp();
  };

  // 2.8 启动尺寸手柄拖拽
  const handleResizePointerDown = (event: React.PointerEvent<SVGElement>, node: SceneNode, handle: ResizeHandle) => {
    event.stopPropagation();
    const point = pointFromEvent(event);
    setResize({
      nodeId: node.id,
      handle,
      startBox: { x: node.x, y: node.y, w: node.w, h: node.h },
      startX: point.x,
      startY: point.y
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  // 2.9 生成框选可视矩形
  const selectionRect = boxSelect ? {
    x: Math.min(boxSelect.startX, boxSelect.currentX),
    y: Math.min(boxSelect.startY, boxSelect.currentY),
    w: Math.abs(boxSelect.currentX - boxSelect.startX),
    h: Math.abs(boxSelect.currentY - boxSelect.startY)
  } : null;

  // 2.10 处理滚轮缩放
  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    if (!event.ctrlKey) {
      return;
    }
    event.preventDefault();
    const point = pointFromEvent(event);
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    onViewportChange(zoomViewportAt(viewport, point, viewport.scale * factor));
  };

  return (
    <div className="canvas-shell">
      <svg
        ref={svgRef}
        className="scene-canvas"
        viewBox={`0 0 ${scene.page.width} ${scene.page.height}`}
        style={{ aspectRatio }}
        onWheel={handleWheel}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerLeave={handleCanvasPointerUp}
        onPointerDown={handleCanvasPointerDown}
      >
        <defs>
          <marker id="arrow-head" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="context-stroke" />
          </marker>
        </defs>
        <g transform={`translate(${viewport.offset.x} ${viewport.offset.y}) scale(${viewport.scale})`}>
          <rect x="0" y="0" width={scene.page.width} height={scene.page.height} fill={scene.page.background} pointerEvents="none" />
          {scene.edges.map((edge) => (
            <EdgeView key={edge.id} edge={edge} nodes={scene.nodes} />
          ))}
          {scene.nodes.map((node) => (
            <NodeView
              key={node.id}
              node={node}
              selected={node.id === selectedId || selectedIds.includes(node.id)}
              onPointerDown={(event) => handlePointerDown(event, node)}
              onResizePointerDown={(event, handle) => handleResizePointerDown(event, node, handle)}
            />
          ))}
          {selectionRect ? (
            <rect
              x={selectionRect.x}
              y={selectionRect.y}
              width={selectionRect.w}
              height={selectionRect.h}
              className="selection-rect"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </g>
      </svg>
    </div>
  );
}

function NodeView({ node, selected, onPointerDown, onResizePointerDown }: {
  node: SceneNode;
  selected: boolean;
  onPointerDown: (event: React.PointerEvent<SVGGElement>) => void;
  onResizePointerDown: (event: React.PointerEvent<SVGElement>, handle: ResizeHandle) => void;
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
    <g className={node.locked ? "node locked" : "node"} onPointerDown={onPointerDown}>
      {body}
      {selection}
    </g>
  );
}

function ResizeHandles({ node, onPointerDown }: {
  node: SceneNode;
  onPointerDown: (event: React.PointerEvent<SVGElement>, handle: ResizeHandle) => void;
}) {
  /*
   * ========================================================================
   * 步骤1：渲染尺寸手柄
   * ========================================================================
   * 目标：
   *   1) 形状节点显示八方向手柄
   *   2) 线条和箭头显示两个端点手柄
   */

  // 1.1 渲染线条端点手柄
  if (node.type === "line" || node.type === "arrow") {
    const points = node.points?.length ? node.points : [{ x: node.x, y: node.y }, { x: node.x + node.w, y: node.y + node.h }];
    const start = points[0];
    const end = points[points.length - 1];
    return (
      <>
        <circle className="resize-handle" cx={start.x} cy={start.y} r={5} onPointerDown={(event) => onPointerDown(event, "line-start")} />
        <circle className="resize-handle" cx={end.x} cy={end.y} r={5} onPointerDown={(event) => onPointerDown(event, "line-end")} />
      </>
    );
  }

  // 1.2 渲染八方向手柄
  const x0 = node.x;
  const x1 = node.x + node.w / 2;
  const x2 = node.x + node.w;
  const y0 = node.y;
  const y1 = node.y + node.h / 2;
  const y2 = node.y + node.h;
  const handles: Array<{ handle: ResizeHandle; x: number; y: number }> = [
    { handle: "nw", x: x0, y: y0 },
    { handle: "n", x: x1, y: y0 },
    { handle: "ne", x: x2, y: y0 },
    { handle: "e", x: x2, y: y1 },
    { handle: "se", x: x2, y: y2 },
    { handle: "s", x: x1, y: y2 },
    { handle: "sw", x: x0, y: y2 },
    { handle: "w", x: x0, y: y1 }
  ];
  return (
    <>
      {handles.map((item) => (
        <rect
          key={item.handle}
          className="resize-handle"
          x={item.x - 4}
          y={item.y - 4}
          width={8}
          height={8}
          onPointerDown={(event) => onPointerDown(event, item.handle)}
        />
      ))}
    </>
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
