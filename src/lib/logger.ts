type LogMeta = Record<string, unknown>;

const browserInfoEnabled = isBrowserInfoLogEnabled((import.meta as ImportMeta & { env?: Record<string, unknown> }).env);

export const logger = {
  info(message: string, meta?: LogMeta) {
    if (!browserInfoEnabled) {
      return;
    }
    console.info(format("info", message, meta));
  },
  warn(message: string, meta?: LogMeta) {
    console.warn(format("warn", message, meta));
  },
  error(message: string, meta?: LogMeta) {
    console.error(format("error", message, meta));
  }
};

function format(level: string, message: string, meta?: LogMeta) {
  const payload = meta ? ` ${JSON.stringify(meta)}` : "";
  return `[${new Date().toISOString()}] [${level}] ${message}${payload}`;
}

export function isBrowserInfoLogEnabled(env: Record<string, unknown> | undefined) {
  /*
   * ========================================================================
   * 步骤1：判断前端 info 日志开关
   * ========================================================================
   * 目标：
   *   1) 只在 VITE_ENABLE_INFO_LOGS=1 时启用 info
   *   2) 避免字符串 0 被误判为启用
   */

  // 1.1 判断明确开启值
  return env?.VITE_ENABLE_INFO_LOGS === "1";
}
