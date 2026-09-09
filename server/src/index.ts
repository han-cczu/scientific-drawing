import { createApp } from "./app";
import { logger } from "./logger";
import { cleanupDataFiles, DEFAULT_RETENTION_DAYS } from "./files/retention";
import { defaultDataPaths, ensureDataDirs } from "./paths";

ensureDataDirs(logger, defaultDataPaths);
cleanupDataFiles({
  directories: [defaultDataPaths.uploadDir, defaultDataPaths.exportDir, defaultDataPaths.sceneDir],
  maxAgeDays: Number(process.env.DATA_RETENTION_DAYS || DEFAULT_RETENTION_DAYS),
  logger
}).catch((error) => logger.warn("清理过期运行产物失败", { error: String(error) }));

const port = Number(process.env.PORT || 8787);
const server = createApp({ paths: defaultDataPaths }).listen(port, () => {
  logger.info("HTTP 服务启动完成", { port });
});

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("收到退出信号，开始优雅关闭", { signal });
  server.close(() => {
    logger.info("HTTP 服务已关闭");
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn("优雅关闭超时，强制退出");
    process.exit(0);
  }, 10_000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
