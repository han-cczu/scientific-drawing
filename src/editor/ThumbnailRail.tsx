import { logger } from "../lib/logger";

type ThumbnailRailProps = {
  sourceImage?: string;
  onAdjust?: () => void;
};

export function ThumbnailRail({ sourceImage, onAdjust }: ThumbnailRailProps) {
  /*
   * ========================================================================
   * 步骤1：渲染缩略图浮层
   * ========================================================================
   * 目标：
   *   1) 显示当前 scene 的源图缩略图
   *   2) 没有 sourceImage 时整个组件返回 null
   */
  logger.info("开始渲染缩略图浮层...", { hasSource: Boolean(sourceImage) });

  if (!sourceImage) {
    logger.info("缩略图浮层无 sourceImage，跳过渲染");
    return null;
  }

  // 1.1 点击调整：滚动到底部抽屉
  const handleAdjust = () => {
    if (onAdjust) {
      onAdjust();
      return;
    }
    const drawer = document.querySelector(".bottom-drawer");
    drawer?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  logger.info("渲染缩略图浮层完成");
  return (
    <div className="thumbnail-rail" aria-label="原图缩略图">
      <div className="thumbnail-rail-title">原图</div>
      <div className="thumbnail-rail-image">
        <img src={sourceImage} alt="原图缩略图" />
      </div>
      <button
        type="button"
        className="thumbnail-rail-btn"
        onClick={handleAdjust}
        title="调整矢量化效果"
      >
        调整矢量化效果
      </button>
    </div>
  );
}
