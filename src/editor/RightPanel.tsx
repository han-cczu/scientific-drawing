import { useState, type ReactNode } from "react";
import { logger } from "../lib/logger";
import { UsageTipsCard } from "./UsageTipsCard";

type TabKey = "style" | "properties" | "arrange";

type RightPanelProps = {
  children: ReactNode;
};

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "style", label: "样式" },
  { key: "properties", label: "属性" },
  { key: "arrange", label: "排列" }
];

export function RightPanel({ children }: RightPanelProps) {
  /*
   * ========================================================================
   * 步骤1：渲染右侧多 tab 容器
   * ========================================================================
   * 目标：
   *   1) 提供"样式 / 属性 / 排列"三 tab 切换
   *   2) 默认选中"属性"并展示完整 Inspector（children）
   *   3) 底部展示使用提示卡片，可关闭
   */
  logger.info("开始渲染右栏...");

  // 1.1 维护当前激活 tab 与使用提示可见状态
  const [active, setActive] = useState<TabKey>("properties");
  const [tipsVisible, setTipsVisible] = useState(true);

  // 1.2 输出右栏
  logger.info("渲染右栏完成", { active, tipsVisible });
  return (
    <aside className="right-panel" aria-label="右侧面板">
      <div className="tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            className={active === tab.key ? "tab active" : "tab"}
            onClick={() => setActive(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="tab-panel" role="tabpanel">
        {active === "properties" ? children : (
          <div className="tab-placeholder">（P3 阶段实装）</div>
        )}
      </div>
      <UsageTipsCard visible={tipsVisible} onClose={() => setTipsVisible(false)} />
    </aside>
  );
}
