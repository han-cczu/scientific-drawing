import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "./editor/Canvas";
import { type Tool } from "./editor/Toolbar";
import { SideNav } from "./editor/SideNav";
import { TopBar } from "./editor/TopBar";
import { RightPanel } from "./editor/RightPanel";
import { BottomDrawer } from "./editor/BottomDrawer";
import { CanvasViewTabs, type CanvasViewMode } from "./editor/CanvasViewTabs";
import { ThumbnailRail } from "./editor/ThumbnailRail";
import { SelectionFloatingBar } from "./editor/SelectionFloatingBar";
import { resetEditorState, selectedIdFromIds } from "./editor/appState";
import { canRedoHistory, canUndoHistory, commitHistoryPresent, createHistoryState, pushHistory, redoHistory, replaceHistoryPresent, undoHistory } from "./editor/history";
import { getEditorShortcutAction, isEditableKeyboardTarget } from "./editor/keyboardShortcuts";
import { createBlankScene, createEdgeBetweenNodes, createNode, duplicateNode, moveNodeLayer, moveNodes, removeNode, resizeNodeFromHandle, selectNodesInRect, setNodeHidden, setNodeLocked, updateNode, updateNodeStyle, type LayerMoveDirection, type ResizeHandle, type SceneBox } from "./editor/sceneOps";
import { clampViewportScale, clientPointToScene, type Viewport } from "./editor/viewport";
import { buildReconstructionPrompt } from "./editor/reconstructionPrompt";
import { normalizeImportedScene } from "./editor/visiomasterAdapter";
import { analyzeImage, exportScene, loadAppConfig, reconstructImage, reconstructRegion, type ReconstructionMode, type RegionMergeMode } from "./lib/api";
import { logger } from "./lib/logger";
import type { Scene } from "./shared/scene";
import { validateScene } from "./shared/sceneValidation";
import "./styles.css";

export default function App() {
  /*
   * ========================================================================
   * 步骤1：初始化应用状态
   * ========================================================================
   * 目标：
   *   1) 维护当前 scene、工具和选中对象
   *   2) 维护上传和导出状态
   */

  // 1.1 初始化核心状态
  const [history, setHistory] = useState(() => createHistoryState<Scene>(createBlankScene()));
  const scene = history.present;
  const interactionBaselineRef = useRef<Scene | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedId = selectedIdFromIds(selectedIds);
  const [tool, setTool] = useState<Tool>("select");
  const [busy, setBusy] = useState(false);
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, offset: { x: 0, y: 0 } });
  const [pendingEdgeFromId, setPendingEdgeFromId] = useState<string | null>(null);
  const [pendingRegion, setPendingRegion] = useState<SceneBox | null>(null);
  const [aiReconstructionAvailable, setAiReconstructionAvailable] = useState(false);
  const [reconstructionMode, setReconstructionMode] = useState<ReconstructionMode>("color");
  const [reconstructionModel, setReconstructionModel] = useState("");
  const [reconstructionModels, setReconstructionModels] = useState<string[]>([]);
  const [message, setMessage] = useState("上传论文图，先生成高保真复刻底图，再叠加可编辑辅助层。");
  const [viewMode, setViewMode] = useState<CanvasViewMode>("result");

  // 1.2 计算选中节点
  const selectedNode = useMemo(
    () => scene.nodes.find((node) => selectedIds.includes(node.id) && !node.locked && !node.hidden) ?? null,
    [scene.nodes, selectedIds]
  );
  const canUndo = canUndoHistory(history);
  const canRedo = canRedoHistory(history);

  /*
   * ========================================================================
   * 步骤2：读取后端能力配置
   * ========================================================================
   * 目标：
   *   1) 判断 AI 重建是否可用
   *   2) 把不可用原因反馈到工具栏
   */

  // 2.1 加载配置
  useEffect(() => {
    let cancelled = false;
    loadAppConfig()
      .then((config) => {
        if (cancelled) {
          return;
        }
        setAiReconstructionAvailable(config.aiReconstructionAvailable);
        setReconstructionModel(config.reconstructModel);
        setReconstructionModels(config.reconstructModels);
        if (config.modelListError) {
          logger.warn("读取模型列表失败", { error: config.modelListError });
        }
        if (!config.aiReconstructionAvailable) {
          setMessage("普通分析可用。AI 重建需要先设置 OPENAI_API_KEY。");
        }
      })
      .catch((error) => {
        logger.warn("读取后端能力配置失败", { error: String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 2.2 完成配置读取绑定

  useEffect(() => {
    /*
     * ========================================================================
     * 步骤1：同步选择状态
     * ========================================================================
     * 目标：
     *   1) 撤销、重做或删除后移除失效选中项
     *   2) 保持 Inspector 指向真实可编辑节点
     */

    // 1.1 过滤已不存在或锁定节点
    setSelectedIds((current) => {
      const next = current.filter((id) => scene.nodes.some((node) => node.id === id && !node.locked && !node.hidden));
      return next.length === current.length ? current : next;
    });
  }, [scene.nodes]);

  /*
   * ========================================================================
   * 步骤3：绑定业务动作
   * ========================================================================
   * 目标：
   *   1) 支持图片分析、节点编辑和导出
   *   2) 保证所有修改都回写 scene
   */

  const applyEditorReset = () => {
    /*
     * ========================================================================
     * 步骤1：复位编辑器临时状态
     * ========================================================================
     * 目标：
     *   1) 上传、AI 重建、导入后统一清理交互状态
     *   2) 防止选择、视图和连线中间态遗漏
     */

    // 1.1 读取复位状态
    const next = resetEditorState();

    // 1.2 应用复位状态
    setSelectedIds(next.selectedIds);
    setTool(next.tool);
    setViewport(next.viewport);
    setPendingEdgeFromId(next.pendingEdgeFromId);
    setPendingRegion(null);
  };

  const replaceSceneHistory = (nextScene: Scene) => {
    /*
     * ========================================================================
     * 步骤1：替换 scene 历史
     * ========================================================================
     * 目标：
     *   1) 上传、导入或整图 AI 重建后重置撤销栈
     *   2) 避免跨文件撤销污染当前画布
     */

    // 1.1 创建新的历史状态
    setHistory(createHistoryState(nextScene));
    interactionBaselineRef.current = null;
  };

  const applySceneChange = (updater: (current: Scene) => Scene) => {
    /*
     * ========================================================================
     * 步骤1：提交普通 scene 修改
     * ========================================================================
     * 目标：
     *   1) 把一次业务动作记为一个撤销点
     *   2) 清理重做栈
     */

    // 1.1 推入历史快照
    setHistory((current) => pushHistory(current, updater(current.present)));
  };

  const resetAfterRegionReconstruction = () => {
    /*
     * ========================================================================
     * 步骤1：清理局部重建状态
     * ========================================================================
     * 目标：
     *   1) 关闭确认弹层
     *   2) 回到选择工具并清空选择
     */

    // 1.1 清理临时状态
    setPendingRegion(null);
    setTool("select");
    setPendingEdgeFromId(null);
    setSelectedIds([]);
  };

  const replaceSceneDuringInteraction = (updater: (current: Scene) => Scene) => {
    /*
     * ========================================================================
     * 步骤1：更新连续交互预览
     * ========================================================================
     * 目标：
     *   1) 拖拽和缩放时实时刷新画布
     *   2) 暂不产生逐帧撤销记录
     */

    // 1.1 记录交互开始前快照
    if (!interactionBaselineRef.current) {
      interactionBaselineRef.current = scene;
    }

    // 1.2 替换当前快照
    setHistory((current) => replaceHistoryPresent(current, updater(current.present)));
  };

  const commitSceneInteraction = () => {
    /*
     * ========================================================================
     * 步骤1：提交连续交互历史
     * ========================================================================
     * 目标：
     *   1) 拖拽或缩放结束后只生成一个撤销点
     *   2) 保留最终位置或尺寸
     */

    // 1.1 提交交互基线
    const baseline = interactionBaselineRef.current;
    setHistory((current) => commitHistoryPresent(current, baseline));
    interactionBaselineRef.current = null;
  };

  // 2.1 上传并分析图片
  const handleFile = async (file: File) => {
    setBusy(true);
    setMessage("正在分析图片...");
    try {
      const payload = await analyzeImage(file);
      replaceSceneHistory(payload.scene);
      applyEditorReset();
      setMessage(`已生成复刻底图和 ${Math.max(0, payload.scene.nodes.length - 1)} 个辅助对象。`);
    } catch (error) {
      logger.error("图片分析失败", { error: String(error) });
      setMessage("图片分析失败。");
    } finally {
      setBusy(false);
    }
  };

  // 2.2 上传并 AI 重建图片
  const handleReconstruct = async (file: File) => {
    if (!aiReconstructionAvailable) {
      setMessage("AI 重建不可用：请在启动后端前设置 OPENAI_API_KEY。");
      return;
    }
    setBusy(true);
    setMessage("正在调用 AI 重建 scene.json...");
    try {
      const payload = await reconstructImage(file, reconstructionMode, reconstructionModel);
      replaceSceneHistory(payload.scene);
      applyEditorReset();
      setMessage(`AI 重建完成：${payload.scene.nodes.length} 个节点，${payload.scene.edges.length} 条连线。`);
    } catch (error) {
      logger.error("AI 重建失败", { error: String(error) });
      setMessage("AI 重建失败。请检查 OPENAI_API_KEY 或服务日志。");
    } finally {
      setBusy(false);
    }
  };

  // 2.3 请求 AI 局部重建
  const handleRegionReconstruct = async (mergeMode: RegionMergeMode) => {
    if (!pendingRegion) {
      return;
    }
    if (!aiReconstructionAvailable) {
      setMessage("AI 局部重建不可用：请在启动后端前设置 OPENAI_API_KEY。");
      return;
    }
    setBusy(true);
    setMessage(mergeMode === "replace" ? "正在替换式局部重建..." : "正在叠加式局部重建...");
    try {
      const payload = await reconstructRegion(scene, pendingRegion, reconstructionMode, reconstructionModel, mergeMode);
      applySceneChange(() => payload.scene);
      resetAfterRegionReconstruction();
      setMessage(`局部 AI 重建完成：${payload.scene.nodes.length} 个节点，${payload.scene.edges.length} 条连线。`);
    } catch (error) {
      logger.error("AI 局部重建失败", { error: String(error) });
      setMessage("AI 局部重建失败。请检查原图是否仍在 data/uploads，或查看服务日志。");
    } finally {
      setBusy(false);
    }
  };

  // 2.4 导入 Visiomaster 风格 scene
  const handleSceneImport = async (file: File) => {
    setBusy(true);
    setMessage("正在导入 scene.json...");
    try {
      const content = await file.text();
      const imported = normalizeImportedScene(JSON.parse(content));
      const validation = validateScene(imported);
      if (!validation.ok) {
        logger.warn("导入 scene 协议校验失败", { issues: validation.issues });
        setMessage("导入 scene.json 失败：协议不合法。");
        return;
      }
      replaceSceneHistory(imported);
      applyEditorReset();
      setMessage(`已导入 ${imported.nodes.length} 个节点和 ${imported.edges.length} 条连线。`);
    } catch (error) {
      logger.error("导入 scene 失败", { error: String(error) });
      setMessage("导入 scene.json 失败。");
    } finally {
      setBusy(false);
    }
  };

  // 2.5 导出重建提示词
  const handlePromptExport = () => {
    const blob = new Blob([buildReconstructionPrompt()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "scientific-drawing-reconstruction-prompt.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // 2.6 移动画布节点
  const handleMove = (nodeIds: string[], dx: number, dy: number) => {
    replaceSceneDuringInteraction((current) => moveNodes(current, nodeIds, dx, dy));
  };

  // 2.7 调整节点尺寸
  const handleResize = (nodeId: string, handle: ResizeHandle, startBox: SceneBox, dx: number, dy: number) => {
    replaceSceneDuringInteraction((current) => resizeNodeFromHandle(current, nodeId, handle, startBox, dx, dy));
  };

  // 2.8 更新选中节点
  const handleSelect = (ids: string[]) => {
    setSelectedIds(ids);
  };

  // 2.9 框选画布节点
  const handleBoxSelect = (box: SceneBox) => {
    if (tool === "region-reconstruct") {
      if (!aiReconstructionAvailable) {
        setMessage("AI 局部重建不可用：请在启动后端前设置 OPENAI_API_KEY。");
        return;
      }
      if (Math.abs(box.w) < 4 || Math.abs(box.h) < 4) {
        setMessage("局部重建区域太小。");
        return;
      }
      setPendingRegion(box);
      setSelectedIds([]);
      setMessage("选择局部重建方式。");
      return;
    }
    const ids = selectNodesInRect(scene, box);
    handleSelect(ids);
  };

  // 2.10 点击节点处理语义连线
  const handleNodeActivate = (nodeId: string) => {
    if (tool !== "connector") {
      return;
    }
    if (!pendingEdgeFromId) {
      setPendingEdgeFromId(nodeId);
      handleSelect([nodeId]);
      setMessage("请选择连线目标节点。");
      return;
    }
    applySceneChange((current) => createEdgeBetweenNodes(current, pendingEdgeFromId, nodeId));
    setPendingEdgeFromId(null);
    setTool("select");
    handleSelect([nodeId]);
    setMessage("已创建语义连线。");
  };

  // 2.11 点击画布添加节点
  const handleCanvasClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (tool === "select" || tool === "connector" || tool === "region-reconstruct") {
      return;
    }
    if (event.target !== event.currentTarget && !(event.target instanceof SVGSVGElement)) {
      return;
    }
    const target = event.currentTarget.querySelector("svg");
    if (!target) {
      return;
    }
    const rect = target.getBoundingClientRect();
    const point = clientPointToScene({
      clientX: event.clientX,
      clientY: event.clientY,
      rect,
      page: scene.page,
      viewport
    });
    const x = point.x;
    const y = point.y;
    const node = createNode(tool, x, y);
    applySceneChange((current) => ({ ...current, nodes: [...current.nodes, node] }));
    handleSelect([node.id]);
    setTool("select");
  };

  // 2.12 导出当前场景
  const handleExport = async (kind: "svg" | "pptx" | "json") => {
    setBusy(true);
    setMessage(`正在导出 ${kind.toUpperCase()}...`);
    try {
      const url = await exportScene(scene, kind);
      setMessage(`导出完成：${url}`);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      logger.error("导出失败", { error: String(error), kind });
      setMessage("导出失败。");
    } finally {
      setBusy(false);
    }
  };

  // 2.13 删除选中节点
  const handleDelete = () => {
    if (selectedIds.length === 0) {
      return;
    }
    applySceneChange((current) => selectedIds.reduce((next, id) => removeNode(next, id), current));
    handleSelect([]);
  };

  // 2.14 复制选中节点
  const handleDuplicate = () => {
    if (selectedIds.length === 0) {
      return;
    }
    const copies = selectedIds
      .map((id) => duplicateNode(scene, id))
      .filter((node) => node !== null);
    if (copies.length === 0) {
      return;
    }
    applySceneChange((current) => ({ ...current, nodes: [...current.nodes, ...copies] }));
    handleSelect(copies.map((node) => node.id));
  };

  // 2.15 切换图层可见性
  const handleLayerHiddenToggle = (nodeId: string) => {
    const node = scene.nodes.find((item) => item.id === nodeId);
    if (!node) {
      return;
    }
    applySceneChange((current) => setNodeHidden(current, nodeId, !node.hidden));
    if (!node.hidden) {
      handleSelect(selectedIds.filter((id) => id !== nodeId));
    }
  };

  // 2.16 切换图层锁定状态
  const handleLayerLockedToggle = (nodeId: string) => {
    const node = scene.nodes.find((item) => item.id === nodeId);
    if (!node) {
      return;
    }
    applySceneChange((current) => setNodeLocked(current, nodeId, !node.locked));
    if (!node.locked) {
      handleSelect(selectedIds.filter((id) => id !== nodeId));
    }
  };

  // 2.17 调整图层顺序
  const handleLayerMove = (nodeId: string, direction: LayerMoveDirection) => {
    applySceneChange((current) => moveNodeLayer(current, nodeId, direction));
  };

  // 2.18 撤销上一项修改
  const handleUndo = () => {
    if (!canUndo) {
      return;
    }
    setHistory((current) => undoHistory(current));
    setPendingEdgeFromId(null);
    setMessage("已撤销。");
  };

  // 2.19 重做上一项修改
  const handleRedo = () => {
    if (!canRedo) {
      return;
    }
    setHistory((current) => redoHistory(current));
    setPendingEdgeFromId(null);
    setMessage("已重做。");
  };

  useEffect(() => {
    /*
     * ========================================================================
     * 步骤1：绑定编辑器快捷键
     * ========================================================================
     * 目标：
     *   1) Delete 删除选中对象
     *   2) Ctrl+D 复制选中对象
     *   3) Escape 取消语义连线中间态并回到选择工具
     */

    // 1.1 处理键盘事件
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = getEditorShortcutAction({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        editable: isEditableKeyboardTarget(event.target)
      });
      if (!action) {
        return;
      }
      event.preventDefault();
      if (action === "delete") {
        handleDelete();
      }
      if (action === "duplicate") {
        handleDuplicate();
      }
      if (action === "cancel") {
        setPendingEdgeFromId(null);
        setTool("select");
        setMessage("已取消当前操作。");
      }
      if (action === "undo") {
        handleUndo();
      }
      if (action === "redo") {
        handleRedo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIds, scene, pendingEdgeFromId, canUndo, canRedo]);

  // 2.20 计算原图模式下的过滤 scene（仅保留锁定底图）
  const displayScene = useMemo(
    () => viewMode === "original"
      ? { ...scene, nodes: scene.nodes.filter((node) => node.type === "image" && node.locked) }
      : scene,
    [scene, viewMode]
  );

  // 2.21 切到原图模式时清空选择和挂起状态
  useEffect(() => {
    if (viewMode === "original") {
      setSelectedIds([]);
      setPendingEdgeFromId(null);
      setPendingRegion(null);
    }
  }, [viewMode]);

  // 2.22 计算 displayScene 派生的 selectedId
  const displaySelectedId = viewMode === "original" ? null : selectedId;

  return (
    <div className="app-shell">
      <TopBar
        title="Scientific Drawing"
        busy={busy}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        zoom={viewport.scale}
        onZoomChange={(next) => setViewport({ scale: clampViewportScale(next), offset: viewport.offset })}
        isSelectMode={tool === "select"}
        isPanMode={false}
        onActivateSelect={() => {
          setTool("select");
          setPendingEdgeFromId(null);
          setPendingRegion(null);
        }}
        onActivatePan={() => {
          /* 平移 chip 当前为占位：通过空格/中键拖拽空白处可平移画布 */
        }}
        onImportImage={handleFile}
        onExport={handleExport}
        onResetView={() => setViewport({ scale: 1, offset: { x: 0, y: 0 } })}
        onSceneImport={handleSceneImport}
        onPromptExport={handlePromptExport}
      />
      <SideNav
        isSelectMode={tool === "select"}
        isRegionMode={tool === "region-reconstruct"}
        aiReconstructionAvailable={aiReconstructionAvailable}
        onActivateSelect={() => {
          setTool("select");
          setPendingEdgeFromId(null);
          setPendingRegion(null);
        }}
        onActivateRegionReconstruct={() => {
          setTool("region-reconstruct");
          setPendingEdgeFromId(null);
          setPendingRegion(null);
        }}
        nodes={scene.nodes}
        selectedIds={selectedIds}
        onSelectNodes={handleSelect}
        onToggleHidden={handleLayerHiddenToggle}
        onToggleLocked={handleLayerLockedToggle}
        onMoveLayer={handleLayerMove}
      />
      <main className="canvas-area">
        <CanvasViewTabs
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          hasSourceImage={Boolean(scene.metadata.sourceImage)}
        />
        <div className="canvas-status">
          <div className="status-text">{message}</div>
          <div className="scene-meta">{scene.page.width} × {scene.page.height}px · {scene.nodes.length} objects</div>
        </div>
        <div className={tool === "select" ? "canvas-hit-area" : "canvas-hit-area drawing"} onClick={handleCanvasClick}>
          <Canvas
            scene={displayScene}
            selectedId={displaySelectedId}
            selectedIds={viewMode === "original" ? [] : selectedIds}
            viewport={viewport}
            onSelect={handleSelect}
            onMove={handleMove}
            onResize={handleResize}
            onSceneInteractionCommit={commitSceneInteraction}
            onBoxSelect={handleBoxSelect}
            onNodeActivate={handleNodeActivate}
            onViewportChange={setViewport}
          />
        </div>
        <ThumbnailRail sourceImage={scene.metadata.sourceImage} />
        <SelectionFloatingBar
          visible={viewMode === "result" && selectedIds.length > 0}
          onDuplicate={handleDuplicate}
          onToggleLock={() => {
            if (selectedIds.length === 0) {
              return;
            }
            selectedIds.forEach((id) => handleLayerLockedToggle(id));
          }}
          onDelete={handleDelete}
        />
      </main>
      <BottomDrawer
        busy={busy}
        aiReconstructionAvailable={aiReconstructionAvailable}
        reconstructionMode={reconstructionMode}
        onReconstructionModeChange={setReconstructionMode}
        onReconstructImage={handleReconstruct}
      />
      <RightPanel
        selectedNode={selectedNode}
        scene={scene}
        selectedIds={selectedIds}
        applySceneChange={applySceneChange}
        onNodeChange={(patch) => selectedId && applySceneChange((current) => updateNode(current, selectedId, patch))}
        onStyleChange={(patch) => selectedId && applySceneChange((current) => updateNodeStyle(current, selectedId, patch))}
      />
      {pendingRegion ? (
        <div className="region-confirm" role="dialog" aria-label="局部 AI 重建方式">
          <div>
            <div className="region-confirm-title">局部 AI 重建</div>
            <div className="region-confirm-meta">
              {Math.round(Math.abs(pendingRegion.w))} × {Math.round(Math.abs(pendingRegion.h))} px
            </div>
          </div>
          <div className="region-confirm-actions">
            <button type="button" onClick={() => handleRegionReconstruct("replace")} disabled={busy}>
              替换旧节点
            </button>
            <button type="button" onClick={() => handleRegionReconstruct("overlay")} disabled={busy}>
              叠加新节点
            </button>
            <button type="button" onClick={() => setPendingRegion(null)} disabled={busy}>
              取消
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
