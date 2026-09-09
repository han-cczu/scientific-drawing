import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteAppConfig,
  loadAppConfig,
  saveAppConfig,
  testAppConfig,
  type AppConfig,
  type WritableAppConfig,
} from "../../lib/api";
import { logger } from "../../lib/logger";
import { hasSeenOnboarding, markOnboardingSeen } from "../../lib/onboarding";
import type { Notify } from "../../editor/model/types";
import { createConfigWriter } from "./configWriter";

type DialogState = {
  tour: boolean;
  settings: boolean;
  pendingSettings: boolean;
};

export function useWorkspaceSettings(notify: Notify) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [dialogs, setDialogs] = useState<DialogState>(() => ({
    tour: !hasSeenOnboarding(),
    settings: false,
    pendingSettings: false,
  }));
  const requestVersion = useRef(0);
  const active = useRef(true);
  const [saving, setSaving] = useState(false);
  const [writer] = useState(() =>
    createConfigWriter(
      { save: saveAppConfig, clear: deleteAppConfig },
      (pending) => {
        if (active.current) setSaving(pending);
      },
    ),
  );
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    const version = requestVersion.current;
    loadAppConfig()
      .then((next) => {
        if (cancelled || version !== requestVersion.current) return;
        setConfig(next);
        if (!next.aiReconstructionAvailable) {
          notify("普通分析可用。AI 重建需要先在右上角配置 API Key。");
          if (next.source === "none")
            setDialogs((current) =>
              current.tour
                ? { ...current, pendingSettings: true }
                : { ...current, settings: true },
            );
        }
      })
      .catch((error) =>
        logger.warn("读取后端能力配置失败", { error: String(error) }),
      );
    return () => {
      cancelled = true;
      active.current = false;
    };
  }, [notify]);
  const save = useCallback(
    async (payload: WritableAppConfig) => {
      ++requestVersion.current;
      const next = await writer.save(payload);
      if (!active.current) return next;
      setConfig(next);
      notify(
        next.aiReconstructionAvailable
          ? "AI 配置已更新，立即生效。"
          : "AI 配置已保存但仍不可用。",
        next.aiReconstructionAvailable ? "success" : "info",
      );
      return next;
    },
    [notify, writer],
  );
  const clear = useCallback(async () => {
    ++requestVersion.current;
    const next = await writer.clear();
    if (!active.current) return next;
    setConfig(next);
    notify(
      next.aiReconstructionAvailable
        ? "已回退到环境变量配置，AI 重建仍可用。"
        : "已清空 UI 配置，AI 重建当前不可用。",
    );
    return next;
  }, [notify, writer]);
  return {
    config,
    available: config?.aiReconstructionAvailable ?? false,
    model: config?.reconstructModel ?? "",
    tourOpen: dialogs.tour,
    settingsOpen: dialogs.settings,
    saving,
    save,
    clear,
    test: testAppConfig,
    openSettings: () =>
      setDialogs((current) => ({ ...current, settings: true })),
    closeSettings: () =>
      setDialogs((current) => ({ ...current, settings: false })),
    showTour: () => setDialogs((current) => ({ ...current, tour: true })),
    closeTour: (completed: boolean) => {
      markOnboardingSeen();
      setDialogs((current) => ({
        ...current,
        tour: false,
        settings: current.pendingSettings || current.settings,
        pendingSettings: false,
      }));
      if (completed) notify("引导完成。上传论文图开始使用吧。", "success");
    },
  };
}
