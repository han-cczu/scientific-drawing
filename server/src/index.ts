import express from "express";
import cors from "cors";
import { logger } from "./logger";
import { apiRouter } from "./routes/api";
import { cleanupDataFiles } from "./files/retention";
import { ensureDataDirs, exportDir, sceneDir, uploadDir } from "./paths";

/*
 * ========================================================================
 * 步骤1：启动 HTTP 服务
 * ========================================================================
 * 目标：
 *   1) 初始化运行目录
 *   2) 注册静态资源和 API 路由
 *   3) 监听本地端口
 */
logger.info("开始启动 HTTP 服务...");

// 1.1 初始化数据目录
ensureDataDirs(logger);

// 1.2 清理过期运行产物
cleanupDataFiles({
  directories: [uploadDir, exportDir, sceneDir],
  maxAgeDays: Number(process.env.DATA_RETENTION_DAYS || 14),
  logger
}).catch((error) => {
  logger.warn("清理过期运行产物失败", { error: String(error) });
});

// 1.3 注册中间件和路由
const app = express();
app.use(cors());
app.use("/uploads", express.static(uploadDir));
app.use("/exports", express.static(exportDir));
app.use("/api", apiRouter);

// 1.4 注册错误处理
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("HTTP 请求处理失败", { error: String(error) });
  const message = error instanceof Error ? error.message : "Internal server error.";
  res.status(500).json({ error: message });
});

// 1.5 启动监听
const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  logger.info("HTTP 服务启动完成", { port });
});
