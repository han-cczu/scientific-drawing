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
  applySceneChange,
  onNodeChange,
  onStyleChange
}: RightPanelProps) {
  const [active, setActive] = useState<TabKey>("properties");
  const [tipsVisible, setTipsVisible] = useState(true);

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
        {active === "style" ? (
          <StyleTab node={selectedNode} onStyleChange={onStyleChange} />
        ) : null}
        {active === "properties" ? (
          <PropertiesTab node={selectedNode} onChange={onNodeChange} onStyleChange={onStyleChange} />
        ) : null}
        {active === "arrange" ? (
          <ArrangeTab scene={scene} selectedIds={selectedIds} applySceneChange={applySceneChange} />
        ) : null}
      </div>
      <UsageTipsCard visible={tipsVisible} onClose={() => setTipsVisible(false)} />
    </aside>
  );
}
