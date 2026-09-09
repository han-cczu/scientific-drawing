import { useEffect, useRef } from "react";
import type { SceneBox } from "./sceneOps";
import type { RegionMergeMode } from "../shared/apiContracts";

export function RegionConfirm({
  region,
  busy,
  onConfirm,
  onCancel,
}: {
  region: SceneBox;
  busy: boolean;
  onConfirm: (mode: RegionMergeMode) => void;
  onCancel: () => void;
}) {
  const firstButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstButton.current?.focus();
  }, []);
  return (
    <div
      className="region-confirm"
      role="dialog"
      aria-modal="true"
      aria-label="局部 AI 重建方式"
    >
      <div>
        <div className="region-confirm-title">局部 AI 重建</div>
        <div className="region-confirm-meta">
          {Math.round(Math.abs(region.w))} × {Math.round(Math.abs(region.h))} px
          · 替换会删除区域内未锁定节点（可撤销）
        </div>
      </div>
      <div className="region-confirm-actions">
        <button
          type="button"
          ref={firstButton}
          disabled={busy}
          onClick={() => onConfirm("replace")}
        >
          替换旧节点
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onConfirm("overlay")}
        >
          叠加新节点
        </button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}
