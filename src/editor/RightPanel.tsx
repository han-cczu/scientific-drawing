import { useState } from "react";
import type { SceneNode, SceneStyle } from "../shared/scene";
import { StyleTab } from "./StyleTab";
import { PropertiesTab } from "./PropertiesTab";
import { ArrangeTab } from "./ArrangeTab";
import { UsageTipsCard } from "./UsageTipsCard";

import type { AlignKind } from "./model/types";
import type { LayerMoveDirection } from "./sceneOps";

type TabKey = "style" | "properties" | "arrange";

type RightPanelProps = {
  selectedNode: SceneNode | null;
  disabled?: boolean;
  selectedIds: string[];
  /** 受控 tab：双击节点可由外部切到属性 tab */
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  /** 重新打开分步操作引导（透传给使用提示卡） */
  onShowTour: () => void;
  onAlign: (kind: AlignKind) => void;
  onMoveLayer: (direction: LayerMoveDirection) => void;
  onNodeChange: (patch: Partial<SceneNode>) => void;
  onStyleChange: (patch: SceneStyle) => void;
};

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "style", label: "样式" },
  { key: "properties", label: "属性" },
  { key: "arrange", label: "排列" }
];

export function RightPanel({
  selectedNode,
  disabled = false,
  selectedIds,
  activeTab,
  onTabChange,
  onShowTour,
  onAlign,
  onMoveLayer,
  onNodeChange,
  onStyleChange
}: RightPanelProps) {
  const [tipsVisible, setTipsVisible] = useState(true);

  return (
    <aside className="right-panel" aria-label="右侧面板" data-tour="inspector">
      <div className="tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={activeTab === tab.key ? "tab active" : "tab"}
            onClick={() => onTabChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <fieldset disabled={disabled} className="tab-panel editor-controls" role="tabpanel">
        {activeTab === "style" ? (
          <StyleTab node={selectedNode} onStyleChange={onStyleChange} />
        ) : null}
        {activeTab === "properties" ? (
          <PropertiesTab node={selectedNode} onChange={onNodeChange} onStyleChange={onStyleChange} />
        ) : null}
        {activeTab === "arrange" ? (
          <ArrangeTab selectedIds={selectedIds} onAlign={onAlign} onMoveLayer={onMoveLayer} />
        ) : null}
      </fieldset>
      <UsageTipsCard visible={tipsVisible} onClose={() => setTipsVisible(false)} onShowTour={onShowTour} />
    </aside>
  );
}
