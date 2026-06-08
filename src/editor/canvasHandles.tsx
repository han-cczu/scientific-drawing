import type { SceneNode } from "../shared/scene";
import type { ResizeHandle } from "./sceneOps";

// 手柄屏幕目标尺寸（scene 单位会被 viewport.scale 放大，故除以 scale 反补偿，保持屏幕像素恒定）
const LINE_HANDLE_RADIUS = 5;
const BOX_HANDLE_SIZE = 8;

export function ResizeHandles({ node, scale, onPointerDown }: {
  node: SceneNode;
  /** 当前视图缩放（viewport.scale）：用于把手柄几何反补偿为屏幕恒定尺寸 */
  scale: number;
  onPointerDown: (event: React.PointerEvent<SVGElement>, handle: ResizeHandle) => void;
}) {
  /*
   * ========================================================================
   * 步骤1：渲染尺寸手柄
   * ========================================================================
   * 目标：
   *   1) 形状节点显示八方向手柄
   *   2) 线条和箭头显示两个端点手柄
   *   3) 手柄随视图缩放反补偿，低缩放下仍可点中
   */

  // 1.0 反补偿缩放（scale 已被 viewport 钳到 [0.25,4]，恒为正）
  const safeScale = scale > 0 ? scale : 1;
  const radius = LINE_HANDLE_RADIUS / safeScale;
  const size = BOX_HANDLE_SIZE / safeScale;
  const half = size / 2;

  // 1.1 渲染线条端点手柄
  if (node.type === "line" || node.type === "arrow") {
    const points = node.points?.length ? node.points : [{ x: node.x, y: node.y }, { x: node.x + node.w, y: node.y + node.h }];
    const start = points[0];
    const end = points[points.length - 1];
    return (
      <>
        <circle className="resize-handle" cx={start.x} cy={start.y} r={radius} onPointerDown={(event) => onPointerDown(event, "line-start")} />
        <circle className="resize-handle" cx={end.x} cy={end.y} r={radius} onPointerDown={(event) => onPointerDown(event, "line-end")} />
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
          x={item.x - half}
          y={item.y - half}
          width={size}
          height={size}
          onPointerDown={(event) => onPointerDown(event, item.handle)}
        />
      ))}
    </>
  );
}
