import type { SceneNode } from "../shared/scene";
import type { ResizeHandle } from "./sceneOps";

export function ResizeHandles({ node, onPointerDown }: {
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
