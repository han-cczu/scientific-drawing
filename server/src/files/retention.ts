import { promises as fs } from "node:fs";
import path from "node:path";

type RetentionLogger = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
};

type CleanupOptions = {
  directories: string[];
  maxAgeDays: number;
  now?: Date;
  logger: RetentionLogger;
};

const MANAGED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".img", ".svg", ".pptx", ".json"]);

export async function cleanupDataFiles(options: CleanupOptions) {
  /*
   * ========================================================================
   * 步骤1：清理过期运行产物
   * ========================================================================
   * 目标：
   *   1) 只扫描配置的一级目录
   *   2) 删除超过保留期的受管文件
   */
  options.logger.info("开始清理过期运行产物...", { directories: options.directories, maxAgeDays: options.maxAgeDays });

  // 1.1 计算过期时间
  const now = options.now ?? new Date();
  const maxAgeMs = Math.max(0, options.maxAgeDays) * 24 * 60 * 60 * 1000;
  const removed: string[] = [];

  // 1.2 逐目录清理文件
  for (const directory of options.directories) {
    const absoluteDirectory = path.resolve(directory);
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true }).catch((error) => {
      options.logger.warn("读取运行目录失败", { directory: absoluteDirectory, error: String(error) });
      return [];
    });
    for (const entry of entries) {
      if (!entry.isFile() || !isManagedDataFile(entry.name)) {
        continue;
      }
      const filePath = path.join(absoluteDirectory, entry.name);
      const fileStat = await fs.stat(filePath).catch(() => undefined);
      if (!fileStat) {
        continue;
      }
      const ageMs = now.getTime() - fileStat.mtimeMs;
      if (ageMs <= maxAgeMs) {
        continue;
      }
      await fs.unlink(filePath).catch((error) => {
        options.logger.warn("删除过期运行产物失败", { filePath, error: String(error) });
      });
      removed.push(filePath);
    }
  }

  options.logger.info("清理过期运行产物完成", { removed: removed.length });
  return removed;
}

export function isManagedDataFile(name: string) {
  /*
   * ========================================================================
   * 步骤1：判断受管运行文件
   * ========================================================================
   * 目标：
   *   1) 只清理项目生成的产物类型
   *   2) 避免误删 README、txt 等人工文件
   */

  // 1.1 提取扩展名
  const lowerName = name.toLowerCase();
  const extension = path.extname(lowerName);

  // 1.2 返回是否受管
  return MANAGED_EXTENSIONS.has(extension);
}
