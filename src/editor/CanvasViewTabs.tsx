export type CanvasViewMode = "original" | "result";

type CanvasViewTabsProps = {
  viewMode: CanvasViewMode;
  onViewModeChange: (mode: CanvasViewMode) => void;
  hasSourceImage: boolean;
};

export function CanvasViewTabs({ viewMode, onViewModeChange, hasSourceImage }: CanvasViewTabsProps) {
  /*
   * ========================================================================
   * 步骤1：渲染画布上方 tab
   * ========================================================================
   * 目标：
   *   1) 提供"原图 / 矢量化结果"切换
   *   2) 没有 sourceImage 时禁用"原图"
   */

  return (
    <div className="canvas-view-tabs" role="tablist" aria-label="画布视图">
      <button
        type="button"
        role="tab"
        aria-selected={viewMode === "original"}
        className={viewMode === "original" ? "canvas-view-tab canvas-view-tab-active" : "canvas-view-tab"}
        onClick={() => onViewModeChange("original")}
        disabled={!hasSourceImage}
        title={hasSourceImage ? "查看原图" : "暂无原图"}
      >
        原图
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={viewMode === "result"}
        className={viewMode === "result" ? "canvas-view-tab canvas-view-tab-active" : "canvas-view-tab"}
        onClick={() => onViewModeChange("result")}
      >
        矢量化结果
      </button>
    </div>
  );
}
