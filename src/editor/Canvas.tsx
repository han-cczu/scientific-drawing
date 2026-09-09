import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logger } from "../lib/logger";
import { isEditableKeyboardTarget } from "./keyboardShortcuts";
import type { Scene, SceneNode } from "../shared/scene";
import type { BoxSelectState, DragState, PanState, ResizeState } from "./canvasPointer";
import { EdgeView, NodeView } from "./canvasRender";
import type { ResizeHandle, SceneBox } from "./sceneOps";
import { clientPointToScene, panViewport, zoomViewportAt, type Viewport } from "./viewport";
import { visibleSceneEdges, visibleSceneNodes } from "../shared/sceneVisibility";

type CanvasProps = {
  readOnly?: boolean;
  interactionEpoch: number;
  onSceneInteractionCancel: () => void;
  scene: Scene;
  selectedId: string | null;
  selectedIds: string[];
  viewport: Viewport;
  /** 平移模式：与空格/中键共用同一套 pan 手势路径 */
  panMode: boolean;
  /** 仅选择工具下允许拖拽节点；连线/区域/绘制工具下点击节点只做选择/激活，不启动拖拽 */
  dragEnabled: boolean;
  onSelect: (ids: string[]) => void;
  onMove: (nodeIds: string[], dx: number, dy: number, interactionEpoch: number) => void;
  onResize: (nodeId: string, handle: ResizeHandle, startBox: SceneBox, dx: number, dy: number, interactionEpoch: number) => void;
  onSceneInteractionCommit: () => void;
  onBoxSelect: (box: SceneBox) => void;
  onNodeActivate: (nodeId: string) => void;
  /** 双击节点进入文本/属性编辑（锁定节点不触发） */
  onNodeDoubleClick: (nodeId: string) => void;
  // 支持函数式更新：滚轮缩放需基于最新 viewport 计算，避免高频事件读到旧闭包值
  onViewportChange: (viewport: Viewport | ((previous: Viewport) => Viewport)) => void;
};

type PointerGesture<T> = T & { epoch: number };

export function Canvas({ readOnly = false, interactionEpoch, onSceneInteractionCancel, scene, selectedId, selectedIds, viewport, panMode, dragEnabled, onSelect, onMove, onResize, onSceneInteractionCommit, onBoxSelect, onNodeActivate, onNodeDoubleClick, onViewportChange }: CanvasProps) {
  logger.info("开始初始化画布交互...", { selectedId });

  // 1.1 准备 SVG 引用和拖拽状态
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [storedDrag, setDrag] = useState<PointerGesture<DragState> | null>(null);
  const [storedResize, setResize] = useState<PointerGesture<ResizeState> | null>(null);
  const [storedBoxSelect, setBoxSelect] = useState<PointerGesture<BoxSelectState> | null>(null);
  const [storedPan, setPan] = useState<PointerGesture<PanState> | null>(null);
  // Undo/redo invalidates the geometry captured at pointer-down without waiting
  // for a pointer-up event or remounting the canvas. The reducer also rejects
  // stale preview callbacks carrying the previous epoch.
  const drag = storedDrag?.epoch === interactionEpoch ? storedDrag : null;
  const resize = storedResize?.epoch === interactionEpoch ? storedResize : null;
  const boxSelect = storedBoxSelect?.epoch === interactionEpoch ? storedBoxSelect : null;
  const pan = storedPan?.epoch === interactionEpoch ? storedPan : null;
  const [spacePressed, setSpacePressed] = useState(false);

  // 1.2 计算画布样式
  const aspectRatio = useMemo(() => `${scene.page.width} / ${scene.page.height}`, [scene.page.width, scene.page.height]);
  const visibleNodes = useMemo(() => visibleSceneNodes(scene.nodes), [scene.nodes]);
  const visibleEdges = useMemo(() => visibleSceneEdges(scene.edges, scene.nodes), [scene.edges, scene.nodes]);
  logger.info("初始化画布交互完成", { aspectRatio });

  // 1.3 监听空格平移模式
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space" && !isEditableKeyboardTarget(event.target)) {
        setSpacePressed(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setSpacePressed(false);
      }
    };
    const cancelGesture = () => { setDrag(null); setResize(null); setBoxSelect(null); setPan(null); setSpacePressed(false); onSceneInteractionCancel(); };
    const escapeGesture = (event: KeyboardEvent) => { if (event.key === "Escape" && !isEditableKeyboardTarget(event.target)) cancelGesture(); };
    window.addEventListener("blur", cancelGesture);
    window.addEventListener("keydown", escapeGesture);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("blur", cancelGesture);
      window.removeEventListener("keydown", escapeGesture);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [onSceneInteractionCancel]);


  // 2.1 转换指针坐标
  //   结构化参数同时兼容 React 合成事件与原生 WheelEvent；
  //   activeViewport 供函数式更新场景传入最新值，默认用当前渲染的 viewport
  const pointFromEvent = useCallback((event: { clientX: number; clientY: number }, activeViewport: Viewport) => {
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
      viewport: activeViewport
    });
  }, [scene.page]);

  // 2.2 启动拖拽
  const handlePointerDown = (event: React.PointerEvent, node: SceneNode) => {
    event.stopPropagation();
    if (event.button === 1 || spacePressed || panMode) {
      setPan({ clientX: event.clientX, clientY: event.clientY, epoch: interactionEpoch });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    // Shift 点选：在选区中增删该节点，不启动拖拽；
    // 锁定节点不可加选（与框选规则一致）；不调 onNodeActivate——
    // 加减选区是选择操作，不应推进语义连线流程
    if (event.shiftKey) {
      if (!selectedIds.includes(node.id) && node.locked) {
        return;
      }
      const next = selectedIds.includes(node.id)
        ? selectedIds.filter((id) => id !== node.id)
        : [...selectedIds, node.id];
      onSelect(next);
      return;
    }
    const activeIds = selectedIds.includes(node.id) ? selectedIds : [node.id];
    onSelect(activeIds);
    onNodeActivate(node.id);
    // 锁定节点、或非选择工具（连线/区域/绘制）下不启动拖拽：避免连线时轻微位移误移端点节点
    if (node.locked || !dragEnabled) {
      return;
    }
    const point = pointFromEvent(event, viewport);
    setDrag({ nodeIds: activeIds, startX: point.x, startY: point.y, epoch: interactionEpoch });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  // 2.3 移动节点
  const handlePointerMove = (event: React.PointerEvent) => {
    if (resize) {
      const point = pointFromEvent(event, viewport);
      onResize(resize.nodeId, resize.handle, resize.startBox, point.x - resize.startX, point.y - resize.startY, resize.epoch);
      return;
    }
    if (!drag) {
      return;
    }
    const point = pointFromEvent(event, viewport);
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    onMove(drag.nodeIds, dx, dy, drag.epoch);
    setDrag({ ...drag, startX: point.x, startY: point.y });
  };

  // 2.4 结束拖拽
  const handlePointerUp = () => {
    const shouldCommit = Boolean(resize || drag);
    setResize(null);
    setDrag(null);
    if (shouldCommit) {
      onSceneInteractionCommit();
    }
  };

  // 2.5 启动空白区域框选
  const handleCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.button === 1 || spacePressed || panMode) {
      setPan({ clientX: event.clientX, clientY: event.clientY, epoch: interactionEpoch });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const point = pointFromEvent(event, viewport);
    onSelect([]);
    setBoxSelect({ startX: point.x, startY: point.y, currentX: point.x, currentY: point.y, epoch: interactionEpoch });
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
      setPan({ clientX: event.clientX, clientY: event.clientY, epoch: interactionEpoch });
      return;
    }
    if (boxSelect) {
      const point = pointFromEvent(event, viewport);
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
    if (readOnly || !dragEnabled) return;
    const point = pointFromEvent(event, viewport);
    setResize({
      nodeId: node.id,
      handle,
      startBox: { x: node.x, y: node.y, w: node.w, h: node.h },
      startX: point.x,
      startY: point.y,
      epoch: interactionEpoch
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
  //   React 对 onWheel 默认以 passive 方式注册，event.preventDefault() 会被忽略并告警；
  //   改用原生非被动监听器，确保 Ctrl+滚轮缩放时阻止页面原生滚动。
  //   缩放走函数式更新：高频滚轮/捏合在同一帧内连发多次时，每次都基于
  //   最新 viewport（previous）计算锚点与倍率，避免旧闭包值导致档位塌缩
  //   与锚点漂移；依赖数组因此无需 viewport，不在手势进行中反复拆装监听器。
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }
    const handleWheelNative = (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      onViewportChange((previous) => {
        const point = pointFromEvent(event, previous);
        return zoomViewportAt(previous, point, previous.scale * factor);
      });
    };
    svg.addEventListener("wheel", handleWheelNative, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheelNative);
    // pointFromEvent 每次渲染新建，刻意不列入依赖：其闭包仅依赖 scene.page
    // （已在依赖中）与 svgRef；viewport 经 previous 显式传入，不走闭包。
  }, [pointFromEvent, onViewportChange]);

  return (
    <div className="canvas-shell">
      <svg
        ref={svgRef}
        className="scene-canvas"
        viewBox={`0 0 ${scene.page.width} ${scene.page.height}`}
        style={{ aspectRatio, cursor: pan ? "grabbing" : panMode ? "grab" : undefined }}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={() => { setDrag(null); setResize(null); setPan(null); setBoxSelect(null); onSceneInteractionCancel(); }}
        onPointerDown={handleCanvasPointerDown}
      >
        <defs>
          <marker id="arrow-head" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="context-stroke" />
          </marker>
        </defs>
        <g transform={`translate(${viewport.offset.x} ${viewport.offset.y}) scale(${viewport.scale})`}>
          <rect x="0" y="0" width={scene.page.width} height={scene.page.height} fill={scene.page.background} pointerEvents="none" />
          {visibleEdges.map((edge) => (
            <EdgeView key={edge.id} edge={edge} nodes={visibleNodes} />
          ))}
          {visibleNodes.map((node) => (
            <NodeView
              key={node.id}
              node={node}
              selected={!readOnly && (node.id === selectedId || selectedIds.includes(node.id))}
              scale={viewport.scale}
              onPointerDown={(event) => handlePointerDown(event, node)}
              onResizePointerDown={(event, handle) => handleResizePointerDown(event, node, handle)}
              onDoubleClick={(event) => {
                event.stopPropagation();
                // 平移模式下双击属于手势误触，不进入属性编辑
                if (!readOnly && !node.locked && !panMode) {
                  onNodeDoubleClick(node.id);
                }
              }}
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
