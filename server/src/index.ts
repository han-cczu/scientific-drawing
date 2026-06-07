import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import express from "express";
import { logger } from "./logger";
import { apiRouter } from "./routes/api";
import { cleanupDataFiles, DEFAULT_RETENTION_DAYS } from "./files/retention";
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
  maxAgeDays: Number(process.env.DATA_RETENTION_DAYS || DEFAULT_RETENTION_DAYS),
  logger
}).catch((error) => {
  logger.warn("清理过期运行产物失败", { error: String(error) });
});

// 1.3 注册中间件和路由
//   前后端同源（dev 经 vite proxy，prod 由本服务同时托管前端与 API），无需开放 CORS；
//   不再使用 cors()（默认 Access-Control-Allow-Origin: * 会让任意站点跨域读取本服务响应）。
const app = express();
app.use("/uploads", express.static(uploadDir));
app.use("/exports", express.static(exportDir));
app.use("/api", apiRouter);

// 1.4 注册前端静态资源（生产形态）
//   runtime 时 server/src/index.ts 位于 /app/server/src/，dist/ 位于 /app/dist/
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, "../../dist");
const distIndex = path.join(distDir, "index.html");
const distAvailable = existsSync(distIndex);
logger.info("前端静态资源目录检测完成", { distDir, distAvailable });

if (distAvailable) {
  // 必须放在 /api /uploads /exports 中间件之后，避免拦截 API
  app.use(express.static(distDir));
  // SPA fallback：非 API 路径全部回退到 index.html
  app.get(/^\/(?!api\/|uploads\/|exports\/).*/, (_req, res) => {
    try {
      res.sendFile(distIndex);
    } catch (error) {
      logger.warn("发送前端 index.html 失败", { error: String(error) });
      res.status(404).send("Not Found");
    }
  });
}

// 1.5 注册错误处理
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // 内部错误细节只写日志，对外统一返回通用文案，避免泄露上游响应/内部异常信息
  logger.error("HTTP 请求处理失败", { error: String(error) });
  res.status(500).json({ error: "Internal server error." });
});

// 1.6 启动监听
const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  logger.info("HTTP 服务启动完成", { port });
});
