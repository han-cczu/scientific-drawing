import type { Scene } from "../shared/scene";
import type { Notice } from "./model/types";

export function SceneStatus({
  scene,
  notice,
  busy,
  elapsed,
  onCancel,
}: {
  scene: Scene;
  notice: Notice;
  busy: boolean;
  elapsed: number;
  onCancel: () => void;
}) {
  return (
    <div className="canvas-status">
      <div
        className={`status-text status-${notice.tone}`}
        role="status"
        aria-live="polite"
        title={notice.text}
      >
        {notice.text}
      </div>
      {busy ? (
        <div className="status-actions">
          <span className="status-elapsed">{elapsed}s</span>
          <button type="button" className="status-cancel" onClick={onCancel}>
            取消
          </button>
        </div>
      ) : null}
      <div className="scene-meta">
        {scene.page.width} × {scene.page.height}px · {scene.nodes.length} 个对象
      </div>
    </div>
  );
}
