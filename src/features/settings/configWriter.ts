import type { AppConfig, WritableAppConfig } from "../../shared/apiContracts";

type ConfigApi = {
  save: (payload: WritableAppConfig) => Promise<AppConfig>;
  clear: () => Promise<AppConfig>;
};

/** Acquire synchronously so two submissions in one event cannot race on disk. */
export function createConfigWriter(
  api: ConfigApi,
  onPending: (pending: boolean) => void,
) {
  let pending = false;
  const write = async (operation: () => Promise<AppConfig>) => {
    if (pending) throw new Error("配置正在保存，请稍候。");
    pending = true;
    onPending(true);
    try {
      return await operation();
    } finally {
      pending = false;
      onPending(false);
    }
  };
  return {
    save: (payload: WritableAppConfig) => write(() => api.save(payload)),
    clear: () => write(api.clear),
  };
}
