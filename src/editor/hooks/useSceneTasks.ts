import { useEffect, useMemo, useState } from "react";
import {
  analyzeImage,
  exportScene,
  ReconstructApiError,
  reconstructImage,
  reconstructRegion,
  type ReconstructionMode,
  type RegionMergeMode,
} from "../../lib/api";
import { downloadBlob } from "../../lib/download";
import { logger } from "../../lib/logger";
import type { Scene } from "../../shared/scene";
import {
  parseSceneImportFile,
  SceneImportError,
  SCENE_IMPORT_MAX_BYTES,
} from "../sceneImport";
import { buildReconstructionPrompt } from "../reconstructionPrompt";
import { createSceneTaskRunner } from "../model/taskRunner";
import type { EditorSession } from "../model/session";
import type { Notify, TaskKind, TaskToken } from "../model/types";

export function useSceneTasks(
  session: EditorSession,
  taskId: number | undefined,
  notify: Notify,
  config: { available: boolean; mode: ReconstructionMode; model: string },
) {
  const [runner] = useState(() => createSceneTaskRunner(session));
  const [clock, setClock] = useState({ id: taskId, seconds: 0 });
  useEffect(() => () => runner.cancel(), [runner]);
  useEffect(() => {
    if (taskId === undefined) return;
    const started = Date.now();
    const timer = window.setInterval(
      () =>
        setClock({
          id: taskId,
          seconds: Math.floor((Date.now() - started) / 1000),
        }),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [taskId]);

  const actions = useMemo(() => {
    const commit = (scene: Scene, token: TaskToken, replace: boolean) =>
      session.dispatch({ type: "taskResult", scene, token, replace });
    const runScene = (
      kind: TaskKind,
      message: string,
      execute: (scene: Scene, signal: AbortSignal) => Promise<Scene>,
      replace: boolean,
      completed: (scene: Scene) => string,
    ) => {
      if (session.getSnapshot().task) return;
      notify(message);
      return runner.run(
        kind,
        execute,
        (scene, token) => {
          commit(scene, token, replace);
          notify(completed(scene), "success");
        },
        (error) => {
          logger.error("场景任务失败", { kind, error: String(error) });
          notify(describeTaskError(error), "error");
        },
      );
    };
    return {
      analyze: (file: File) =>
        runScene(
          "analyze",
          "正在分析图片...",
          async (_scene, signal) => (await analyzeImage(file, signal)).scene,
          true,
          (scene) =>
            `已生成复刻底图和 ${Math.max(0, scene.nodes.length - 1)} 个辅助对象。`,
        ),
      import: (file: File) =>
        runScene(
          "import",
          "正在导入 scene.json...",
          () => parseSceneImportFile(file),
          true,
          (scene) =>
            `已导入 ${scene.nodes.length} 个节点和 ${scene.edges.length} 条连线。`,
        ),
      reconstruct: (file: File) => {
        if (!config.available) {
          notify("AI 重建不可用：请在右上角设置中配置 API Key。", "error");
          return;
        }
        return runScene(
          "reconstruct",
          "正在调用 AI 重建 scene.json...",
          async (_scene, signal) =>
            (await reconstructImage(file, config.mode, config.model, signal))
              .scene,
          true,
          (scene) =>
            `AI 重建完成：${scene.nodes.length} 个节点，${scene.edges.length} 条连线。`,
        );
      },
      region: (mergeMode: RegionMergeMode) => {
        const region = session.getSnapshot().pendingRegion;
        if (!region || !config.available) return;
        return runScene(
          "region",
          mergeMode === "replace"
            ? "正在替换式局部重建..."
            : "正在叠加式局部重建...",
          async (scene, signal) =>
            (
              await reconstructRegion(
                scene,
                region,
                config.mode,
                config.model,
                mergeMode,
                signal,
              )
            ).scene,
          false,
          (scene) =>
            `局部 AI 重建完成：${scene.nodes.length} 个节点，${scene.edges.length} 条连线。`,
        );
      },
      export: (kind: "svg" | "pptx" | "json") => {
        if (session.getSnapshot().task) return;
        notify(`正在导出 ${kind.toUpperCase()}...`);
        return runner.run(
          "export",
          (scene, signal) => exportScene(scene, kind, signal),
          ({ blob, filename }) => {
            downloadBlob(blob, filename);
            notify(`已下载 ${filename}`, "success");
          },
          () => notify("导出失败。", "error"),
        );
      },
      exportPrompt: () =>
        downloadBlob(
          new Blob([buildReconstructionPrompt()], {
            type: "text/plain;charset=utf-8",
          }),
          "scientific-drawing-reconstruction-prompt.txt",
        ),
      cancel: () => {
        runner.cancel();
        session.dispatch({ type: "cancelInteraction" });
        session.dispatch({ type: "cancelTool" });
        notify("已取消当前操作。");
      },
    };
  }, [session, runner, notify, config.available, config.mode, config.model]);
  return {
    ...actions,
    elapsedSeconds: clock.id === taskId ? clock.seconds : 0,
  };
}

function describeTaskError(error: unknown): string {
  if (error instanceof SceneImportError) {
    if (error.code === "FILE_TOO_LARGE")
      return `导入 scene.json 失败：文件超过 ${SCENE_IMPORT_MAX_BYTES / 1024 / 1024} MB。`;
    const issue = error.issues[0];
    return `导入 scene.json 失败：${issue ? `${issue.path}: ${issue.code}` : error.message}`;
  }
  if (error instanceof ReconstructApiError) {
    const messages: Record<string, string> = {
      AUTH: "AI 重建认证失败：请检查 API Key 是否有效。",
      INVALID_IMAGE: "上传的图片内容无法解析。",
      TIMEOUT: "AI 重建超时。",
      NETWORK: "无法连接模型服务：请检查 Base URL 或网络。",
      BAD_MODEL_OUTPUT: "模型输出无法解析为 scene。",
      INVALID_SCENE: "重建结果不符合 scene 协议。",
      UPSTREAM: "模型服务返回错误。",
    };
    const message = messages[error.code] ?? `AI 重建失败：${error.message}`;
    return error.hint ? `${message}（${error.hint}）` : message;
  }
  return error instanceof Error
    ? error.message
    : "操作失败，请检查输入或服务日志。";
}
