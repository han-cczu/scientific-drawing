import { useEffect, useMemo, useState } from "react";
import { Canvas } from "./editor/Canvas";
import { Inspector } from "./editor/Inspector";
import { Toolbar, type Tool } from "./editor/Toolbar";
import { createBlankScene, createNode, duplicateNode, removeNode, updateNode, updateNodeStyle } from "./editor/sceneOps";
import { buildReconstructionPrompt } from "./editor/reconstructionPrompt";
import { normalizeImportedScene } from "./editor/visiomasterAdapter";
import { analyzeImage, exportScene, loadAppConfig, reconstructImage, type ReconstructionMode } from "./lib/api";
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
  logger.info("开始初始化应用状态...");

  // 1.1 初始化核心状态
  const [scene, setScene] = useState<Scene>(() => createBlankScene());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [busy, setBusy] = useState(false);
  const [aiReconstructionAvailable, setAiReconstructionAvailable] = useState(false);
  const [reconstructionMode, setReconstructionMode] = useState<ReconstructionMode>("color");
  const [message, setMessage] = useState("上传论文图，先生成高保真复刻底图，再叠加可编辑辅助层。");

  // 1.2 计算选中节点
  const selectedNode = useMemo(
    () => scene.nodes.find((node) => node.id === selectedId) ?? null,
    [scene.nodes, selectedId]
  );
  logger.info("初始化应用状态完成", { selectedId, tool });

  /*
   * ========================================================================
   * 步骤2：读取后端能力配置
   * ========================================================================
   * 目标：
   *   1) 判断 AI 重建是否可用
   *   2) 把不可用原因反馈到工具栏
   */
  logger.info("开始读取后端能力配置...");

  // 2.1 加载配置
  useEffect(() => {
    let cancelled = false;
    loadAppConfig()
      .then((config) => {
        if (cancelled) {
          return;
        }
        setAiReconstructionAvailable(config.aiReconstructionAvailable);
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
  logger.info("读取后端能力配置完成", { aiReconstructionAvailable });

  /*
   * ========================================================================
   * 步骤3：绑定业务动作
   * ========================================================================
   * 目标：
   *   1) 支持图片分析、节点编辑和导出
   *   2) 保证所有修改都回写 scene
   */
  logger.info("开始绑定业务动作...");

  // 2.1 上传并分析图片
  const handleFile = async (file: File) => {
    setBusy(true);
    setMessage("正在分析图片...");
    try {
      const payload = await analyzeImage(file);
      setScene(payload.scene);
      setSelectedId(null);
      setTool("select");
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
      const payload = await reconstructImage(file, reconstructionMode);
      setScene(payload.scene);
      setSelectedId(null);
      setTool("select");
      setMessage(`AI 重建完成：${payload.scene.nodes.length} 个节点，${payload.scene.edges.length} 条连线。`);
    } catch (error) {
      logger.error("AI 重建失败", { error: String(error) });
      setMessage("AI 重建失败。请检查 OPENAI_API_KEY 或服务日志。");
    } finally {
      setBusy(false);
    }
  };

  // 2.3 导入 Visiomaster 风格 scene
  const handleSceneImport = async (file: File) => {
    setBusy(true);
    setMessage("正在导入 scene.json...");
    try {
      const content = await file.text();
      const imported = normalizeImportedScene(JSON.parse(content));
      setScene(imported);
      setSelectedId(null);
      setTool("select");
      setMessage(`已导入 ${imported.nodes.length} 个节点和 ${imported.edges.length} 条连线。`);
    } catch (error) {
      logger.error("导入 scene 失败", { error: String(error) });
      setMessage("导入 scene.json 失败。");
    } finally {
      setBusy(false);
    }
  };

  // 2.4 导出重建提示词
  const handlePromptExport = () => {
    const blob = new Blob([buildReconstructionPrompt()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "scientific-drawing-reconstruction-prompt.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // 2.5 移动画布节点
  const handleMove = (nodeId: string, dx: number, dy: number) => {
    setScene((current) => {
      const node = current.nodes.find((item) => item.id === nodeId);
      if (!node || node.locked) {
        return current;
      }
      const points = node.points?.map((point) => ({ x: point.x + dx, y: point.y + dy }));
      return updateNode(current, nodeId, { x: node.x + dx, y: node.y + dy, points });
    });
  };

  // 2.6 点击画布添加节点
  const handleCanvasClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (tool === "select") {
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
    const x = ((event.clientX - rect.left) / rect.width) * scene.page.width;
    const y = ((event.clientY - rect.top) / rect.height) * scene.page.height;
    const node = createNode(tool, x, y);
    setScene((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedId(node.id);
    setTool("select");
  };

  // 2.7 导出当前场景
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

  // 2.8 删除选中节点
  const handleDelete = () => {
    if (!selectedId) {
      return;
    }
    setScene((current) => removeNode(current, selectedId));
    setSelectedId(null);
  };

  // 2.9 复制选中节点
  const handleDuplicate = () => {
    if (!selectedId) {
      return;
    }
    const copy = duplicateNode(scene, selectedId);
    if (!copy) {
      return;
    }
    setScene((current) => ({ ...current, nodes: [...current.nodes, copy] }));
    setSelectedId(copy.id);
  };
  logger.info("绑定业务动作完成");

  return (
    <div className="app-shell">
      <Toolbar
        tool={tool}
        busy={busy}
        hasSelection={Boolean(selectedNode && !selectedNode.locked)}
        onToolChange={setTool}
        onFileChange={handleFile}
        aiReconstructionAvailable={aiReconstructionAvailable}
        reconstructionMode={reconstructionMode}
        onModeChange={setReconstructionMode}
        onReconstruct={handleReconstruct}
        onSceneImport={handleSceneImport}
        onPromptExport={handlePromptExport}
        onExport={handleExport}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
      />
      <main className="workspace">
        <header className="topbar">
          <div>
            <div className="app-title">Scientific Drawing</div>
            <div className="status-line">{message}</div>
          </div>
          <div className="scene-meta">{scene.page.width} × {scene.page.height}px · {scene.nodes.length} objects</div>
        </header>
        <div className={tool === "select" ? "canvas-hit-area" : "canvas-hit-area drawing"} onClick={handleCanvasClick}>
          <Canvas scene={scene} selectedId={selectedId} onSelect={setSelectedId} onMove={handleMove} />
        </div>
      </main>
      <Inspector
        node={selectedNode}
        onChange={(patch) => selectedId && setScene((current) => updateNode(current, selectedId, patch))}
        onStyleChange={(patch) => selectedId && setScene((current) => updateNodeStyle(current, selectedId, patch))}
      />
    </div>
  );
}
