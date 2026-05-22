export function Logo() {
  /*
   * ========================================================================
   * 步骤1：渲染 SciDraw 品牌标识
   * ========================================================================
   * 目标：
   *   1) 提供内联 SVG 几何 mark
   *   2) 两行品牌文字（英文加粗 + 中文灰色小字）
   */

  // 1.1 输出 logo
  return (
    <div className="logo">
      <svg className="logo-mark" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="4" y="4" width="18" height="18" rx="4" fill="var(--color-accent)" />
        <rect x="11" y="11" width="17" height="17" rx="4" fill="var(--color-accent-soft)" stroke="var(--color-accent)" strokeWidth="1.5" />
        <path d="M14 22 L22 14" stroke="var(--color-accent)" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <div className="logo-text">
        <span className="logo-text-main">SciDraw</span>
        <span className="logo-text-sub">抖研绘图</span>
      </div>
    </div>
  );
}
