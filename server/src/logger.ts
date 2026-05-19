type LogMeta = Record<string, unknown>;

const infoEnabled = isServerInfoLogEnabled(process.env);

export const logger = {
  info(message: string, meta?: LogMeta) {
    if (!infoEnabled) {
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

export function isServerInfoLogEnabled(env: { LOG_LEVEL?: string }) {
  /*
   * ========================================================================
   * 步骤1：判断后端 info 日志开关
   * ========================================================================
   * 目标：
   *   1) 只在 LOG_LEVEL=info 时启用 info
   *   2) 让 logger.info 在 warn/error 级别下直接早退
   */

  // 1.1 判断明确开启值
  return env.LOG_LEVEL === "info";
}
