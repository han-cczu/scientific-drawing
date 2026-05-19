import { useEffect, useMemo, useRef, useState } from "react";
import { logger } from "../lib/logger";
import type { Scene, SceneNode } from "../shared/scene";
import type { BoxSelectState, DragState, PanState, ResizeState } from "./canvasPointer";
import { EdgeView, NodeView } from "./canvasRender";
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
