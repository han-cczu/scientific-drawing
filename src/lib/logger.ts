type LogMeta = Record<string, unknown>;

const browserInfoEnabled = Boolean((import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.VITE_ENABLE_INFO_LOGS);

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
