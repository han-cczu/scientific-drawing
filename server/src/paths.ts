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
export function createDataPaths(root = process.cwd()) {
  const rootDir = path.resolve(root);
  const dataDir = path.join(rootDir, "data");
  return {
    rootDir,
    dataDir,
    uploadDir: path.join(dataDir, "uploads"),
    exportDir: path.join(dataDir, "exports"),
    sceneDir: path.join(dataDir, "scenes"),
    evalSuiteDir: path.join(dataDir, "eval-suite"),
    configPath: path.join(dataDir, "config.json")
  };
}

export type DataPaths = ReturnType<typeof createDataPaths>;
export const defaultDataPaths = createDataPaths();
export const { rootDir, dataDir, uploadDir, exportDir, sceneDir, evalSuiteDir, configPath } = defaultDataPaths;

// 允许被 scene 引用并由服务端读盘内嵌的本地资源目录白名单。
const LOCAL_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export function resolveUploadedAssetPath(source: unknown, paths = defaultDataPaths): string | null {
  /*
   * ========================================================================
   * 步骤1：严格解析上传资源 URL
   * ========================================================================
   * 目标：
   *   1) 只接受项目生成的 /uploads/... 相对 URL
   *   2) 拒绝外部 URL 中夹带的 /uploads/ 片段
   */
  return resolveLocalAssetPathInBucket(source, "uploads", paths.uploadDir);
}

export function resolveLocalAssetPath(source: unknown, paths = defaultDataPaths): string | null {
  /*
   * ========================================================================
   * 步骤1：把 scene 里的本地资源 URL 安全解析为受控目录内的绝对路径
   * ========================================================================
   * 目标：
   *   1) 仅接受 /uploads/ 或 /eval-suite/ 标记的本地资源
   *   2) 用 path.resolve + 包含校验拒绝任何穿越（..）、绝对路径或目录外引用
   *   3) 解析失败一律返回 null，由调用方跳过读盘（防任意文件读取/LFI）
   */

  // 1.1 仅处理字符串来源
  if (typeof source !== "string" || !source) {
    return null;
  }

  // 1.2 逐个白名单目录匹配前缀并做包含校验。必须是以 /uploads/ 或 /eval-suite/
  //     开头的项目相对 URL；不能用 indexOf 匹配任意位置，否则外部 URL
  //     https://evil.test/uploads/x.png 会被误当成本地文件。
  for (const [name, baseDir] of [["uploads", paths.uploadDir], ["eval-suite", paths.evalSuiteDir]]) {
    const resolved = resolveLocalAssetPathInBucket(source, name, baseDir);
    if (resolved) {
      return resolved;
    }
  }

  // 1.3 非受控来源（外部 URL / 绝对路径 / 非法字符串）
  return null;
}

function resolveLocalAssetPathInBucket(source: unknown, name: string, baseDir: string): string | null {
  if (typeof source !== "string" || !source) {
    return null;
  }
  const normalized = source.replaceAll("\\", "/");
  const marker = `/${name}/`;
  if (!normalized.startsWith(marker)) {
    return null;
  }
  const rest = normalized.slice(marker.length);
  if (!rest) {
    return null;
  }
  if (!LOCAL_IMAGE_EXTENSIONS.has(path.extname(rest).toLowerCase())) {
    return null;
  }
  const resolved = path.resolve(baseDir, rest);
  const relative = path.relative(baseDir, resolved);
  // relative 以 '..' 开头或为绝对路径 → 解析结果逃出 baseDir，拒绝
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}

export function ensureDataDirs(logger: { info: (message: string, meta?: Record<string, unknown>) => void }, paths = defaultDataPaths) {
  /*
   * ========================================================================
   * 步骤1：创建运行目录
   * ========================================================================
   * 目标：
   *   1) 创建 data/uploads
   *   2) 创建 data/exports
   *   3) 创建 data/scenes
   */
  const { dataDir, uploadDir, exportDir, sceneDir } = paths;
  logger.info("开始创建运行目录...", { dataDir });

  // 1.1 创建上传目录
  mkdirSync(uploadDir, { recursive: true });

  // 1.2 创建导出目录
  mkdirSync(exportDir, { recursive: true });

  // 1.3 创建 scene 目录
  mkdirSync(sceneDir, { recursive: true });
  logger.info("创建运行目录完成", { uploadDir, exportDir, sceneDir });
}
