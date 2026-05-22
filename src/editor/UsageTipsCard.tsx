import { Lightbulb, X } from "lucide-react";
import { logger } from "../lib/logger";

type UsageTipsCardProps = {
  visible: boolean;
  onClose: () => void;
};

const TIPS = [
  "上传图片后会自动生成可编辑的复刻底图。",
  "选中节点可在右侧属性面板调整样式与位置。",
  "底部抽屉可重新调用 AI 矢量化并替换当前图层。"
];

export function UsageTipsCard({ visible, onClose }: UsageTipsCardProps) {
  /*
   * ========================================================================
   * 步骤1：渲染使用提示卡片
   * ========================================================================
   * 目标：
   *   1) 在右栏底部展示 3 条静态提示
   *   2) 用户关闭后本 session 不再显示
   */
  logger.info("开始渲染使用提示卡片...", { visible });

  if (!visible) {
    return null;
  }

  logger.info("渲染使用提示卡片完成");
  return (
    <div className="usage-tips-card" role="note" aria-label="使用提示">
      <div className="usage-tips-header">
        <div className="usage-tips-title">
          <Lightbulb size={14} />
          <span>使用提示</span>
        </div>
        <button
          type="button"
          className="icon-btn usage-tips-close"
          onClick={onClose}
          aria-label="关闭使用提示"
          title="关闭"
        >
          <X size={14} />
        </button>
      </div>
      <ul className="usage-tips-list">
        {TIPS.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
      <button type="button" className="usage-tips-link" disabled title="教程占位">
        查看教程
      </button>
    </div>
  );
}
