import { useCallback, useMemo, useState } from "react";
import { Canvas } from "./editor/Canvas";
import { SideNav } from "./editor/SideNav";
import { TopBar } from "./editor/TopBar";
import { RightPanel } from "./editor/RightPanel";
import { BottomDrawer } from "./editor/BottomDrawer";
import { CanvasViewTabs } from "./editor/CanvasViewTabs";
import { ThumbnailRail } from "./editor/ThumbnailRail";
import { SelectionFloatingBar } from "./editor/SelectionFloatingBar";
import { SettingsDialog } from "./editor/SettingsDialog";
import { OnboardingTour } from "./editor/OnboardingTour";
import { SceneStatus } from "./editor/SceneStatus";
import { RegionConfirm } from "./editor/RegionConfirm";
import { useEditorSession } from "./editor/hooks/useEditorSession";
import { useEditorActions } from "./editor/hooks/useEditorActions";
import { useEditorShortcuts } from "./editor/hooks/useEditorShortcuts";
import { useSceneTasks } from "./editor/hooks/useSceneTasks";
import { useScenePersistence } from "./editor/hooks/useScenePersistence";
import { useWorkspaceSettings } from "./features/settings/useWorkspaceSettings";
import type { Notice } from "./editor/model/types";
import { primarySelectedNode } from "./editor/model/selection";
import type { ReconstructionMode } from "./shared/apiContracts";
import "./styles.css";

export default function App() {
  const { session, state, restored } = useEditorSession();
  const {
    history,
    selectedIds,
    tool,
    viewMode,
    viewport,
    panMode,
    pendingRegion,
  } = state;
  const scene = history.present;
  const busy = state.task !== null;
  const readOnly = busy || viewMode === "original";
  const [notice, setNotice] = useState<Notice>({
    text: "上传论文图，先生成高保真复刻底图，再叠加可编辑辅助层。",
    tone: "info",
  });
  const notify = useCallback(
    (text: string, tone: Notice["tone"] = "info") => setNotice({ text, tone }),
    [],
  );
  const settings = useWorkspaceSettings(notify);
  const [reconstructionMode, setReconstructionMode] =
    useState<ReconstructionMode>("color");
  const tasks = useSceneTasks(session, state.task?.id, notify, {
    available: settings.available,
    mode: reconstructionMode,
    model: settings.model,
  });
  const actions = useEditorActions(session, settings.available, notify);
  const saveStatus = useScenePersistence(scene, busy, restored);
  const shortcuts = useMemo(
    () => ({
      delete: actions.delete,
      duplicate: actions.duplicate,
      undo: actions.undo,
      redo: actions.redo,
      cancel: tasks.cancel,
    }),
    [actions, tasks.cancel],
  );
  useEditorShortcuts(settings.settingsOpen || settings.tourOpen, shortcuts);
  const [rightPanelTab, setRightPanelTab] = useState<
    "style" | "properties" | "arrange"
  >("properties");
  const selectedNode = primarySelectedNode(scene, selectedIds);
  const displayScene = useMemo(
    () =>
      viewMode === "original"
        ? {
            ...scene,
            nodes: scene.nodes.filter((n) => n.type === "image" && n.locked),
            edges: [],
          }
        : scene,
    [scene, viewMode],
  );
  const showTour = () => {
    if (busy) notify("当前有任务进行中，结束后再查看操作引导。");
    else settings.showTour();
  };
  const onNodeDoubleClick = (id: string) => {
    if (readOnly) return;
    actions.select([id]);
    setRightPanelTab("properties");
    window.setTimeout(
      () =>
        document
          .querySelector<HTMLTextAreaElement>(
            ".right-panel .props-section textarea",
          )
          ?.focus(),
      0,
    );
  };

  return (
    <div className="app-shell">
      <TopBar
        title="Scientific Drawing"
        saveStatus={saveStatus}
        busy={busy}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onUndo={actions.undo}
        onRedo={actions.redo}
        zoom={viewport.scale}
        onZoomChange={actions.zoom}
        isSelectMode={tool === "select" && !panMode}
        isPanMode={panMode}
        onActivateSelect={() => actions.tool("select")}
        onActivatePan={() => actions.tool("select", !panMode)}
        onImportImage={tasks.analyze}
        onExport={tasks.export}
        onResetView={actions.resetView}
        onSceneImport={tasks.import}
        onPromptExport={tasks.exportPrompt}
        onShowTour={showTour}
        onOpenSettings={settings.openSettings}
        settingsAttention={settings.config ? !settings.available : false}
      />
      <SideNav
        isSelectMode={tool === "select" && !panMode}
        isRegionMode={tool === "region-reconstruct"}
        aiReconstructionAvailable={settings.available}
        tool={tool}
        disabled={readOnly}
        onActivateSelect={() => actions.tool("select")}
        onActivateRegionReconstruct={() => actions.tool("region-reconstruct")}
        onActivateTool={actions.tool}
        nodes={scene.nodes}
        selectedIds={selectedIds}
        onSelectNodes={actions.select}
        onToggleHidden={actions.toggleHidden}
        onToggleLocked={actions.toggleLocked}
        onMoveLayer={actions.moveLayer}
      />
      <main className="canvas-area">
        <CanvasViewTabs
          viewMode={viewMode}
          onViewModeChange={(mode) => session.dispatch({ type: "view", mode })}
          hasSourceImage={Boolean(scene.metadata.sourceImage)}
        />
        <SceneStatus
          scene={scene}
          notice={notice}
          busy={busy}
          elapsed={tasks.elapsedSeconds}
          onCancel={tasks.cancel}
        />
        <div
          className={
            tool === "select" ? "canvas-hit-area" : "canvas-hit-area drawing"
          }
          onClick={actions.canvasClick}
          data-tour="canvas"
        >
          <ThumbnailRail sourceImage={scene.metadata.sourceImage} />
          <Canvas
            scene={displayScene}
            interactionEpoch={state.interactionEpoch}
            selectedId={
              viewMode === "original" ? null : (selectedIds[0] ?? null)
            }
            selectedIds={viewMode === "original" ? [] : selectedIds}
            viewport={viewport}
            panMode={panMode}
            readOnly={readOnly}
            dragEnabled={tool === "select" && !readOnly}
            onSelect={actions.select}
            onMove={actions.move}
            onResize={actions.resize}
            onSceneInteractionCommit={actions.commit}
            onSceneInteractionCancel={actions.cancelInteraction}
            onBoxSelect={actions.boxSelect}
            onNodeActivate={actions.activateNode}
            onNodeDoubleClick={onNodeDoubleClick}
            onViewportChange={actions.viewport}
          />
          {scene.nodes.length === 0 && viewMode === "result" ? (
            <div className="canvas-empty-cta" aria-hidden="true">
              <div className="canvas-empty-title">从上传论文图开始</div>
              <div className="canvas-empty-hint">
                把图片拖到下方「AI 矢量化」区域，或点右上角「导入」做普通分析
              </div>
            </div>
          ) : null}
        </div>
        <SelectionFloatingBar
          visible={viewMode === "result" && selectedIds.length > 0}
          disabled={readOnly}
          onDuplicate={actions.duplicate}
          onToggleLock={actions.lockSelection}
          onDelete={actions.delete}
        />
      </main>
      <BottomDrawer
        busy={busy}
        aiReconstructionAvailable={settings.available}
        reconstructionMode={reconstructionMode}
        onReconstructionModeChange={setReconstructionMode}
        onReconstructImage={tasks.reconstruct}
      />
      <RightPanel
        selectedNode={selectedNode}
        selectedIds={selectedIds}
        disabled={readOnly}
        activeTab={rightPanelTab}
        onTabChange={setRightPanelTab}
        onShowTour={showTour}
        onAlign={actions.align}
        onMoveLayer={actions.arrangeLayer}
        onNodeChange={actions.nodeChange}
        onStyleChange={actions.styleChange}
      />
      <SettingsDialog
        open={settings.settingsOpen}
        busy={busy || settings.saving}
        config={settings.config}
        onClose={settings.closeSettings}
        onSave={settings.save}
        onClear={settings.clear}
        onTest={settings.test}
        onSkip={() => {
          settings.closeSettings();
          notify(
            "已跳过 AI 配置，普通分析可用；随时可在右上角设置中启用 AI 重建。",
          );
        }}
      />
      <OnboardingTour open={settings.tourOpen} onClose={settings.closeTour} />
      {pendingRegion ? (
        <RegionConfirm
          region={pendingRegion}
          busy={busy}
          onConfirm={tasks.region}
          onCancel={tasks.cancel}
        />
      ) : null}
    </div>
  );
}
