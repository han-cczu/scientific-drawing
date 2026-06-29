import type express from "express";
import { logger } from "./logger";

type HttpErrorLike = Error & {
  status?: number;
  statusCode?: number;
  type?: string;
};

export const httpErrorHandler: express.ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const httpError = error as HttpErrorLike;
  const status = httpError.status ?? httpError.statusCode;
  if (status === 413 || httpError.type === "entity.too.large") {
    logger.warn("HTTP 请求体过大", { error: String(error) });
    res.status(413).json({ error: "Request body is too large." });
    return;
  }
  if (status === 400 && httpError.type === "entity.parse.failed") {
    logger.warn("HTTP JSON 请求体解析失败", { error: String(error) });
    res.status(400).json({ error: "Invalid JSON request body." });
    return;
  }
  if (typeof status === "number" && status >= 400 && status < 500) {
    logger.warn("HTTP 客户端请求错误", { status, error: String(error) });
    res.status(status).json({ error: "Invalid request." });
    return;
  }

  // 内部错误细节只写日志，对外统一返回通用文案，避免泄露上游响应/内部异常信息
  logger.error("HTTP 请求处理失败", { error: String(error) });
  res.status(500).json({ error: "Internal server error." });
};
