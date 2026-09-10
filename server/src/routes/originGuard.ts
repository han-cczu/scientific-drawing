import type express from "express";
import { logger } from "../logger";

export const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function isAllowedMutationOrigin(originOrReferer: string, hostHeader: string): boolean {
  if (!originOrReferer) {
    return true;
  }
  let originHostname: string;
  try {
    originHostname = new URL(originOrReferer).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  if (LOOPBACK_HOSTS.has(originHostname)) {
    return true;
  }
  const hostHostname = hostHeader.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return Boolean(hostHostname) && originHostname === hostHostname;
}

export const csrfGuard: express.RequestHandler = (req, res, next) => {
  // 仅拦截状态变更方法；GET/HEAD/OPTIONS 为安全方法，放行
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }
  const source =
    (typeof req.headers.origin === "string" && req.headers.origin) ||
    (typeof req.headers.referer === "string" && req.headers.referer) ||
    "";
  const hostHeader = typeof req.headers.host === "string" ? req.headers.host : "";
  if (isAllowedMutationOrigin(source, hostHeader)) {
    next();
    return;
  }
  logger.warn("拒绝跨站状态变更请求", { method, path: req.path, origin: req.headers.origin, host: hostHeader });
  res.status(403).json({ error: "Cross-site request blocked." });
};
