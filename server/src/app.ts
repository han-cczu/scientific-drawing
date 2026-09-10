import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import express from "express";
import { httpErrorHandler } from "./httpErrorHandler";
import { createApiRouter } from "./routes";
import { createServices, type ServiceOptions } from "./services";

export type AppOptions = ServiceOptions & { distDir?: string | false };

/** Construction only: no directory creation, retention jobs, listeners or signal handlers. */
export function createApp(options: AppOptions = {}) {
  const services = createServices(options);
  const app = express();
  app.use("/uploads", express.static(services.paths.uploadDir));
  app.use("/exports", express.static(services.paths.exportDir, {
    setHeaders: (res) => res.setHeader("Content-Disposition", "attachment")
  }));
  app.use("/api", createApiRouter(services));
  const distDir = options.distDir === undefined ? fileURLToPath(new URL("../../dist", import.meta.url)) : options.distDir;
  if (distDir && existsSync(path.join(distDir, "index.html"))) {
    const distIndex = path.resolve(distDir, "index.html");
    app.use(express.static(distDir));
    app.get(/^\/(?!api\/|uploads\/|exports\/).*/, (_req, res) => {
      res.sendFile(distIndex, (error) => {
        if (error && !res.headersSent) res.status(404).send("Not Found");
      });
    });
  }
  app.use(httpErrorHandler);
  return app;
}
