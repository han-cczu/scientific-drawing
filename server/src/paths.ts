import { mkdirSync } from "node:fs";
import path from "node:path";

/*
 * ========================================================================
 * 步骤1：定义数据目录
 * ========================================================================
 * 目标：
 *   1) 统一上传文件、导出文件和 scene 文件的位置
 *   2) 保证服务启动前目录已经存在
 */
export const rootDir = process.cwd();
export const dataDir = path.join(rootDir, "data");
export const uploadDir = path.join(dataDir, "uploads");
export const exportDir = path.join(dataDir, "exports");
export const sceneDir = path.join(dataDir, "scenes");

export function ensureDataDirs(logger: { info: (message: string, meta?: Record<string, unknown>) => void }) {
  /*
   * ========================================================================
   * 步骤1：创建运行目录
   * ========================================================================
   * 目标：
   *   1) 创建 data/uploads
   *   2) 创建 data/exports
   *   3) 创建 data/scenes
   */
  logger.info("开始创建运行目录...", { dataDir });

  // 1.1 创建上传目录
  mkdirSync(uploadDir, { recursive: true });

  // 1.2 创建导出目录
  mkdirSync(exportDir, { recursive: true });

  // 1.3 创建 scene 目录
  mkdirSync(sceneDir, { recursive: true });
  logger.info("创建运行目录完成", { uploadDir, exportDir, sceneDir });
}
