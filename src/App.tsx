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
import { SettingsDialog } from "./editor/SettingsDialog";
import { OnboardingTour } from "./editor/OnboardingTour";
import { hasSeenOnboarding, markOnboardingSeen } from "./lib/onboarding";
import { resetEditorState, selectedIdFromIds } from "./editor/appState";
import { canRedoHistory, canUndoHistory, commitHistoryPresent, createHistoryState, pushHistory, redoHistory, replaceHistoryPresent, undoHistory } from "./editor/history";
import { getEditorShortcutAction, isEditableKeyboardTarget } from "./editor/keyboardShortcuts";
import { createBlankScene, createEdgeBetweenNodes, createNode, duplicateNode, moveNodeLayer, moveNodes, removeNode, resizeNodeFromHandle, selectNodesInRect, setNodeHidden, setNodeLocked, updateNode, updateNodeStyle, type LayerMoveDirection, type ResizeHandle, type SceneBox } from "./editor/sceneOps";
import { parseSceneImportFile, SceneImportError, SCENE_IMPORT_MAX_BYTES } from "./editor/sceneImport";
import { clampViewportScale, clientPointToScene, type Viewport } from "./editor/viewport";
import { buildReconstructionPrompt } from "./editor/reconstructionPrompt";
import { analyzeImage, deleteAppConfig, exportScene, loadAppConfig, ReconstructApiError, reconstructImage, reconstructRegion, saveAppConfig, testAppConfig, type AppConfig, type ReconstructionMode, type RegionMergeMode } from "./lib/api";
import { clearStoredScene, isSceneWorthPersisting, loadStoredScene, saveStoredScene } from "./lib/sceneStore";
import { logger } from "./lib/logger";
import type { Scene } from "./shared/scene";
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

  // 1.1 初始化核心状态（启动时静默恢复本地草稿：validateScene 已在 loadStoredScene 内门控）
  const restoredSceneRef = useRef<Scene | null | undefined>(undefined);
  if (restoredSceneRef.current === undefined) {
    const stored = loadStoredScene();
    restoredSceneRef.current = stored && isSceneWorthPersisting(stored) ? stored : null;
  }
  const [history, setHistory] = useState(() =>
    createHistoryState<Scene>(restoredSceneRef.current ?? createBlankScene())
  );
  const scene = history.present;
  const interactionBaselineRef = useRef<Scene | null>(null);
  // 保存状态：saved=已落盘 / editing=有未落盘修改 / restored=本次会话自本地草稿恢复
  const [saveStatus, setSaveStatus] = useState<"saved" | "editing" | "restored">(
    restoredSceneRef.current ? "restored" : "saved"
  );
  const autosaveSkipFirstRef = useRef(true);
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
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsAutoOpenedRef = useRef(false);
  // 新手引导：首跑（未看过当前版本引导）自动启动；引导期间设置弹窗让位
  const [tourOpen, setTourOpen] = useState(() => !hasSeenOnboarding());
  const pendingSettingsAutoOpenRef = useRef(false);
  const tourOpenRef = useRef(tourOpen);
  tourOpenRef.current = tourOpen;

  const handleShowTour = () => {
    // 重建/导出进行中不开引导：遮罩会盖住状态行的取消按钮
    if (busy) {
      setMessage("当前有任务进行中，结束后再查看操作引导。");
      setMessageTone("info");
      return;
    }
    setTourOpen(true);
  };

  const handleTourClose = (completed: boolean) => {
    markOnboardingSeen();
    setTourOpen(false);
    if (pendingSettingsAutoOpenRef.current) {
      pendingSettingsAutoOpenRef.current = false;
      setSettingsOpen(true);
      return;
    }
    if (completed) {
      setMessage("引导完成。上传论文图开始使用吧。");
      setMessageTone("success");
    }
  };
  const [message, setMessage] = useState("上传论文图，先生成高保真复刻底图，再叠加可编辑辅助层。");
  const [messageTone, setMessageTone] = useState<"info" | "success" | "error">("info");
  const [viewMode, setViewMode] = useState<CanvasViewMode>("result");
  const [panMode, setPanMode] = useState(false);

  // 1.1.1 统一的状态行通知入口：tone 区分中性/成功/失败，缺省回落 info
  const notify = (text: string, tone: "info" | "success" | "error" = "info") => {
    setMessage(text);
    setMessageTone(tone);
  };

  // 1.1.2 AI 重建执行期状态：取消控制器（state 驱动取消按钮显隐）+ 已等待秒数
  const [reconstructAbort, setReconstructAbort] = useState<AbortController | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (!reconstructAbort) {
      setElapsedSeconds(0);
      return;
    }
    const timer = setInterval(() => setElapsedSeconds((current) => current + 1), 1000);
    return () => clearInterval(timer);
  }, [reconstructAbort]);

  // 1.1.3 重建错误 → 中文恢复建议（复刻 SettingsDialog describeTestError 模式）
  const describeReconstructError = (error: unknown) => {
    if (error instanceof ReconstructApiError) {
      const withHint = (text: string) => (error.hint ? `${text}（${error.hint}）` : text);
      switch (error.code) {
        case "AUTH":
          return withHint("AI 重建认证失败：请检查 API Key 是否有效。");
        case "INVALID_IMAGE":
          return withHint("上传的图片内容无法解析。");
        case "TIMEOUT":
          return withHint("AI 重建超时。");
        case "NETWORK":
          return withHint("无法连接模型服务：请检查 Base URL 或网络。");
        case "BAD_MODEL_OUTPUT":
          return withHint("模型输出无法解析为 scene。");
        case "INVALID_SCENE":
          return withHint("重建结果不符合 scene 协议。");
        case "UPSTREAM":
          return withHint("模型服务返回错误。");
        default:
          return `AI 重建失败：${error.message}`;
      }
    }
    return "AI 重建失败。请检查网络或服务日志。";
  };

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

  // 2.1 把后端返回的 AppConfig 同步到本地 state
  const applyAppConfig = (config: AppConfig) => {
    /*
     * ========================================================================
     * 步骤1：应用后端配置
     * ========================================================================
     * 目标：
     *   1) 刷新 AI 能力开关与默认模型
     *   2) 把 AppConfig 缓存到 state 供 SettingsDialog 读取（来源/末四位）
     */
    setAppConfig(config);
    setAiReconstructionAvailable(config.aiReconstructionAvailable);
    setReconstructionModel(config.reconstructModel);
    if (config.modelListError) {
      logger.warn("读取模型列表失败", { error: config.modelListError });
    }
  };

  // 2.2 加载配置 + 首次未配置自动弹出设置对话框
  useEffect(() => {
    let cancelled = false;
    loadAppConfig()
      .then((config) => {
        if (cancelled) {
          return;
        }
        applyAppConfig(config);
        if (!config.aiReconstructionAvailable) {
          notify("普通分析可用。AI 重建需要先在右上角配置 API Key。");
          if (!settingsAutoOpenedRef.current && config.source === "none") {
            settingsAutoOpenedRef.current = true;
            // 引导进行中则先挂起，引导结束后再弹设置，避免双弹窗叠加
            if (tourOpenRef.current) {
              pendingSettingsAutoOpenRef.current = true;
            } else {
              setSettingsOpen(true);
            }
          }
        }
      })
      .catch((error) => {
        logger.warn("读取后端能力配置失败", { error: String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 2.3 保存/清空配置后热刷新
  const handleSettingsSave = async (payload: { apiKey: string; baseUrl: string; reconstructModel: string }) => {
    const next = await saveAppConfig(payload);
    applyAppConfig(next);
    notify(
      next.aiReconstructionAvailable ? "AI 配置已更新，立即生效。" : "AI 配置已保存但仍不可用。",
      next.aiReconstructionAvailable ? "success" : "info"
    );
    return next;
  };

  const handleSettingsClear = async () => {
    const next = await deleteAppConfig();
    applyAppConfig(next);
    notify(
      next.aiReconstructionAvailable
        ? "已回退到环境变量配置，AI 重建仍可用。"
        : "已清空 UI 配置，AI 重建当前不可用。"
    );
    return next;
  };

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

  useEffect(() => {
    /*
     * ========================================================================
     * 步骤1：自动保存当前 scene 到本地
     * ========================================================================
     * 目标：
     *   1) scene（history.present）是所有提交路径的唯一汇聚点，单一依赖全覆盖
     *   2) 800ms 去抖避免拖拽过程中逐帧写盘
     *   3) 写盘失败时保持 editing 状态，不向用户谎报已保存
     */

    // 1.1 首挂载跳过：数据要么是空白要么刚从盘上恢复，无需回写
    if (autosaveSkipFirstRef.current) {
      autosaveSkipFirstRef.current = false;
      return;
    }

    // 1.2 标记未落盘并去抖写入（只有真落盘 'ok' 才算已保存；
    //     'memory'（隐私模式等存储不可用，刷新即丢）与 'failed' 都保持未保存，
    //     让指示器诚实并保住 beforeunload 守卫）
    setSaveStatus("editing");
    const timer = setTimeout(() => {
      if (isSceneWorthPersisting(scene)) {
        const result = saveStoredScene(scene);
        if (result === "ok") {
          setSaveStatus("saved");
        }
      } else {
        clearStoredScene();
        setSaveStatus("saved");
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [scene]);

  useEffect(() => {
    /*
     * ========================================================================
     * 步骤1：离开页面前守卫未保存工作
     * ========================================================================
     * 目标：
     *   1) busy（分析/重建/导出进行中）或有内容未落盘时拦截刷新/关闭
     *   2) 已落盘后不再骚扰用户
     */

    // 1.1 注册 beforeunload 守卫
    const handler = (event: BeforeUnloadEvent) => {
      if (busy || (isSceneWorthPersisting(scene) && saveStatus === "editing")) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [scene, busy, saveStatus]);

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
    setPanMode(false);
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
    notify("正在分析图片...");
    try {
      const payload = await analyzeImage(file);
      replaceSceneHistory(payload.scene);
      applyEditorReset();
      notify(`已生成复刻底图和 ${Math.max(0, payload.scene.nodes.length - 1)} 个辅助对象。`, "success");
    } catch (error) {
      logger.error("图片分析失败", { error: String(error) });
      notify("图片分析失败。", "error");
    } finally {
      setBusy(false);
    }
  };

  // 2.2 上传并 AI 重建图片
  const handleReconstruct = async (file: File) => {
    if (!aiReconstructionAvailable) {
      notify("AI 重建不可用：请在右上角设置中配置 API Key。", "error");
      return;
    }
    const abortController = new AbortController();
    setReconstructAbort(abortController);
    setBusy(true);
    notify("正在调用 AI 重建 scene.json...");
    try {
      const payload = await reconstructImage(file, reconstructionMode, reconstructionModel, abortController.signal);
      replaceSceneHistory(payload.scene);
      applyEditorReset();
      notify(`AI 重建完成：${payload.scene.nodes.length} 个节点，${payload.scene.edges.length} 条连线。`, "success");
    } catch (error) {
      if (abortController.signal.aborted) {
        notify("已取消 AI 重建。");
      } else {
        logger.error("AI 重建失败", { error: String(error) });
        notify(describeReconstructError(error), "error");
      }
    } finally {
      setReconstructAbort(null);
      setBusy(false);
    }
  };

  // 2.3 请求 AI 局部重建
  const handleRegionReconstruct = async (mergeMode: RegionMergeMode) => {
    if (!pendingRegion) {
      return;
    }
    if (!aiReconstructionAvailable) {
      notify("AI 局部重建不可用：请在右上角设置中配置 API Key。", "error");
      return;
    }
    const abortController = new AbortController();
    setReconstructAbort(abortController);
    setBusy(true);
    notify(mergeMode === "replace" ? "正在替换式局部重建..." : "正在叠加式局部重建...");
    try {
      const payload = await reconstructRegion(scene, pendingRegion, reconstructionMode, reconstructionModel, mergeMode, abortController.signal);
      applySceneChange(() => payload.scene);
      resetAfterRegionReconstruction();
      notify(`局部 AI 重建完成：${payload.scene.nodes.length} 个节点，${payload.scene.edges.length} 条连线。`, "success");
    } catch (error) {
      if (abortController.signal.aborted) {
        notify("已取消局部 AI 重建。");
      } else {
        logger.error("AI 局部重建失败", { error: String(error) });
        notify(describeReconstructError(error), "error");
      }
    } finally {
      setReconstructAbort(null);
      setBusy(false);
    }
  };

  // 2.4 导入 Visiomaster 风格 scene
  const handleSceneImport = async (file: File) => {
    setBusy(true);
    notify("正在导入 scene.json...");
    try {
      const imported = await parseSceneImportFile(file);
      replaceSceneHistory(imported);
      applyEditorReset();
      notify(`已导入 ${imported.nodes.length} 个节点和 ${imported.edges.length} 条连线。`, "success");
    } catch (error) {
      if (error instanceof SceneImportError) {
        if (error.code === "FILE_TOO_LARGE") {
          notify(`导入 scene.json 失败：文件超过 ${Math.floor(SCENE_IMPORT_MAX_BYTES / 1024 / 1024)} MB。`, "error");
          return;
        }
        if (error.code === "INVALID_SCENE") {
          logger.warn("导入 scene 协议校验失败", { issues: error.issues });
          const first = error.issues[0];
          notify(`导入 scene.json 失败：协议不合法（${first ? `${first.path}: ${first.code}` : "未知问题"}）。`, "error");
          return;
        }
      }
      logger.error("导入 scene 失败", { error: String(error) });
      notify("导入 scene.json 失败。", "error");
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
    // 延后释放，避免个别浏览器在下载真正开始前 revoke 导致下载被取消
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
        notify("AI 局部重建不可用：请在右上角设置中配置 API Key。", "error");
        return;
      }
      if (Math.abs(box.w) < 4 || Math.abs(box.h) < 4) {
        notify("局部重建区域太小。", "error");
        return;
      }
      setPendingRegion(box);
      setSelectedIds([]);
      notify("选择局部重建方式。");
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
      notify("请选择连线目标节点。");
      return;
    }
    // 起终点相同：createEdgeBetweenNodes 会静默跳过，这里如实提示而非谎报成功
    if (pendingEdgeFromId === nodeId) {
      setPendingEdgeFromId(null);
      setTool("select");
      notify("起点与终点相同，未创建连线。");
      return;
    }
    applySceneChange((current) => createEdgeBetweenNodes(current, pendingEdgeFromId, nodeId));
    setPendingEdgeFromId(null);
    setTool("select");
    handleSelect([nodeId]);
    notify("已创建语义连线。", "success");
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

  // 2.12 导出当前场景（blob + <a download> 直接落盘，复用提示词导出的下载模式）
  const handleExport = async (kind: "svg" | "pptx" | "json") => {
    setBusy(true);
    notify(`正在导出 ${kind.toUpperCase()}...`);
    try {
      const { blob, filename } = await exportScene(scene, kind);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      // 延后释放，避免个别浏览器在下载真正开始前 revoke 导致下载被取消
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify(`已下载 ${filename}`, "success");
    } catch (error) {
      logger.error("导出失败", { error: String(error), kind });
      notify("导出失败。", "error");
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
    applySceneChange((current) => {
      const target = current.nodes.find((item) => item.id === nodeId);
      return setNodeHidden(current, nodeId, !target?.hidden);
    });
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
    applySceneChange((current) => {
      const target = current.nodes.find((item) => item.id === nodeId);
      return setNodeLocked(current, nodeId, !target?.locked);
    });
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
    notify("已撤销。");
  };

  // 2.19 重做上一项修改
  const handleRedo = () => {
    if (!canRedo) {
      return;
    }
    setHistory((current) => redoHistory(current));
    setPendingEdgeFromId(null);
    notify("已重做。");
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

    // 1.1 处理键盘事件（设置弹窗/引导打开时让位给它们自己的键盘处理，避免双触发）
    const handleKeyDown = (event: KeyboardEvent) => {
      if (settingsOpen || tourOpen) {
        return;
      }
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
        // 在途 AI 重建一并中止：Escape 的“取消”必须包含真实的请求取消
        reconstructAbort?.abort();
        setPendingEdgeFromId(null);
        setPendingRegion(null);
        setPanMode(false);
        setTool("select");
        notify("已取消当前操作。");
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
  }, [selectedIds, scene, pendingEdgeFromId, canUndo, canRedo, settingsOpen, tourOpen, reconstructAbort]);

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

  // 2.21.1 区域确认弹层出现时聚焦首个操作按钮（Escape 由全局 cancel 分支关闭）
  const regionConfirmFirstButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (pendingRegion) {
      regionConfirmFirstButtonRef.current?.focus();
    }
  }, [pendingRegion]);

  // 2.21.2 右栏 tab 受控：双击节点跳转属性 tab 并聚焦文本编辑框
  const [rightPanelTab, setRightPanelTab] = useState<"style" | "properties" | "arrange">("properties");
  const handleNodeDoubleClick = (nodeId: string) => {
    setSelectedIds([nodeId]);
    setRightPanelTab("properties");
    // 等右栏切换渲染完成后聚焦文本框（无文本节点时为 no-op）
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>(".right-panel .props-section textarea")?.focus();
    }, 0);
  };

  // 2.22 计算 displayScene 派生的 selectedId
  const displaySelectedId = viewMode === "original" ? null : selectedId;

  return (
    <div className="app-shell">
      <TopBar
        title="Scientific Drawing"
        saveStatus={saveStatus}
        busy={busy}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        zoom={viewport.scale}
        onZoomChange={(next) => setViewport((prev) => ({ scale: clampViewportScale(next), offset: prev.offset }))}
        isSelectMode={tool === "select" && !panMode}
        isPanMode={panMode}
        onActivateSelect={() => {
          setTool("select");
          setPanMode(false);
          setPendingEdgeFromId(null);
          setPendingRegion(null);
        }}
        onActivatePan={() => {
          // 平移模式与选择/区域工具互斥；Canvas 内与空格/中键共用同一套 pan 路径
          setPanMode((current) => !current);
          setTool("select");
          setPendingEdgeFromId(null);
          setPendingRegion(null);
        }}
        onImportImage={handleFile}
        onExport={handleExport}
        onResetView={() => setViewport({ scale: 1, offset: { x: 0, y: 0 } })}
        onSceneImport={handleSceneImport}
        onPromptExport={handlePromptExport}
        onShowTour={handleShowTour}
        onOpenSettings={() => setSettingsOpen(true)}
        settingsAttention={appConfig ? !appConfig.aiReconstructionAvailable : false}
      />
      <SideNav
        isSelectMode={tool === "select" && !panMode}
        isRegionMode={tool === "region-reconstruct"}
        aiReconstructionAvailable={aiReconstructionAvailable}
        tool={tool}
        onActivateSelect={() => {
          setTool("select");
          setPanMode(false);
          setPendingEdgeFromId(null);
          setPendingRegion(null);
        }}
        onActivateRegionReconstruct={() => {
          setTool("region-reconstruct");
          setPanMode(false);
          setPendingEdgeFromId(null);
          setPendingRegion(null);
        }}
        onActivateTool={(next) => {
          setTool(next);
          setPanMode(false);
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
          <div className={`status-text status-${messageTone}`} role="status" aria-live="polite" title={message}>
            {message}
          </div>
          {reconstructAbort ? (
            <div className="status-actions">
              <span className="status-elapsed">{elapsedSeconds}s</span>
              <button
                type="button"
                className="status-cancel"
                onClick={() => {
                  // 同时关闭区域确认弹层，避免取消后弹层悬置
                  reconstructAbort.abort();
                  setPendingRegion(null);
                }}
              >
                取消
              </button>
            </div>
          ) : null}
          <div className="scene-meta">{scene.page.width} × {scene.page.height}px · {scene.nodes.length} 个对象</div>
        </div>
        <div className={tool === "select" ? "canvas-hit-area" : "canvas-hit-area drawing"} onClick={handleCanvasClick} data-tour="canvas">
          <Canvas
            scene={displayScene}
            selectedId={displaySelectedId}
            selectedIds={viewMode === "original" ? [] : selectedIds}
            viewport={viewport}
            panMode={panMode}
            dragEnabled={tool === "select"}
            onSelect={handleSelect}
            onMove={handleMove}
            onResize={handleResize}
            onSceneInteractionCommit={commitSceneInteraction}
            onBoxSelect={handleBoxSelect}
            onNodeActivate={handleNodeActivate}
            onNodeDoubleClick={handleNodeDoubleClick}
            onViewportChange={setViewport}
          />
          {scene.nodes.length === 0 && viewMode === "result" ? (
            <div className="canvas-empty-cta" aria-hidden="true">
              <div className="canvas-empty-title">从上传论文图开始</div>
              <div className="canvas-empty-hint">把图片拖到下方「AI 矢量化」区域，或点右上角「导入」做普通分析</div>
            </div>
          ) : null}
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
        activeTab={rightPanelTab}
        onTabChange={setRightPanelTab}
        onShowTour={handleShowTour}
        applySceneChange={applySceneChange}
        onNodeChange={(patch) => selectedId && applySceneChange((current) => updateNode(current, selectedId, patch))}
        onStyleChange={(patch) => {
          // 样式补丁广播到全部选中的可编辑节点（单次 applySceneChange = 单条撤销记录）；
          // 锁定/隐藏节点过滤掉——选区可能经 Shift 点选短暂包含它们；
          // onNodeChange（文本/几何）保持单节点语义，不广播
          if (selectedIds.length === 0) {
            return;
          }
          applySceneChange((current) => selectedIds
            .filter((id) => current.nodes.some((node) => node.id === id && !node.locked && !node.hidden))
            .reduce((next, id) => updateNodeStyle(next, id, patch), current));
        }}
      />
      <SettingsDialog
        open={settingsOpen}
        busy={busy}
        config={appConfig}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSettingsSave}
        onClear={handleSettingsClear}
        onTest={testAppConfig}
        onSkip={() => {
          setSettingsOpen(false);
          notify("已跳过 AI 配置，普通分析可用；随时可在右上角设置中启用 AI 重建。");
        }}
      />
      <OnboardingTour open={tourOpen} onClose={handleTourClose} />
      {pendingRegion ? (
        <div className="region-confirm" role="dialog" aria-modal="true" aria-label="局部 AI 重建方式">
          <div>
            <div className="region-confirm-title">局部 AI 重建</div>
            <div className="region-confirm-meta">
              {Math.round(Math.abs(pendingRegion.w))} × {Math.round(Math.abs(pendingRegion.h))} px ·
              替换会删除区域内未锁定节点（可撤销）
            </div>
          </div>
          <div className="region-confirm-actions">
            <button
              type="button"
              ref={regionConfirmFirstButtonRef}
              onClick={() => handleRegionReconstruct("replace")}
              disabled={busy}
            >
              替换旧节点
            </button>
            <button type="button" onClick={() => handleRegionReconstruct("overlay")} disabled={busy}>
              叠加新节点
            </button>
            <button
              type="button"
              onClick={() => {
                // 取消永远可点：重建进行中先中止请求，再关闭弹层
                reconstructAbort?.abort();
                setPendingRegion(null);
              }}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
