import { useState } from "react";
import type { Scene, SceneNode, SceneStyle } from "../shared/scene";
import { StyleTab } from "./StyleTab";
import { PropertiesTab } from "./PropertiesTab";
import { ArrangeTab } from "./ArrangeTab";
import { UsageTipsCard } from "./UsageTipsCard";

type TabKey = "style" | "properties" | "arrange";

type RightPanelProps = {
  selectedNode: SceneNode | null;
  scene: Scene;
  selectedIds: string[];
  /** 受控 tab：双击节点可由外部切到属性 tab */
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  applySceneChange: (updater: (current: Scene) => Scene) => void;
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
  scene,
  selectedIds,
  activeTab,
  onTabChange,
  applySceneChange,
  onNodeChange,
  onStyleChange
}: RightPanelProps) {
  const [tipsVisible, setTipsVisible] = useState(true);

  return (
    <aside className="right-panel" aria-label="右侧面板">
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
      <div className="tab-panel" role="tabpanel">
        {activeTab === "style" ? (
          <StyleTab node={selectedNode} onStyleChange={onStyleChange} />
        ) : null}
        {activeTab === "properties" ? (
          <PropertiesTab node={selectedNode} onChange={onNodeChange} onStyleChange={onStyleChange} />
        ) : null}
        {activeTab === "arrange" ? (
          <ArrangeTab scene={scene} selectedIds={selectedIds} applySceneChange={applySceneChange} />
        ) : null}
      </div>
      <UsageTipsCard visible={tipsVisible} onClose={() => setTipsVisible(false)} />
    </aside>
  );
}
