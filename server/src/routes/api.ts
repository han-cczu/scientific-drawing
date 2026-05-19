import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import { logger } from "../logger";
import { exportDir, sceneDir, uploadDir } from "../paths";
import { analyzeImage } from "../scene/analyzeImage";
import { sceneToPptx } from "../scene/pptx";
import { reconstructWithOpenAI } from "../scene/reconstructWithOpenAI";
import type { ReconstructionMode } from "../scene/reconstructionPrompt";
import { sceneToSvg } from "../scene/svg";
import type { Scene } from "../scene/types";
import { normalizeImportedScene } from "../scene/visiomasterAdapter";
import { validateScene, type ValidationIssue } from "../../../src/shared/sceneValidation";

const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;
const IMAGE_EXTENSIONS_BY_MIME = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"]
]);

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: MAX_IMAGE_UPLOAD_BYTES,
    files: 1
  },
  fileFilter: (_req, file, callback) => {
    /*
     * ========================================================================
     * 步骤1：校验上传图片类型
     * ========================================================================
     * 目标：
     *   1) 只允许 PNG/JPEG/WebP
     *   2) 在写入业务文件前拒绝异常类型
     */
    logger.info("开始校验上传图片类型...", { mimeType: file.mimetype });

    // 1.1 判断 MIME 是否受支持
    if (!isAllowedImageMime(file.mimetype)) {
      logger.warn("上传图片类型不支持", { mimeType: file.mimetype });
      callback(new Error("Unsupported image type. Use PNG, JPEG, or WebP."));
      return;
    }

    // 1.2 放行合法图片
    logger.info("校验上传图片类型完成", { mimeType: file.mimetype });
    callback(null, true);
  }
});

const uploadImage: express.RequestHandler = (req, res, next) => {
  /*
   * ========================================================================
   * 步骤1：执行图片上传中间件
   * ========================================================================
   * 目标：
   *   1) 统一处理 multer 上传错误
   *   2) 给前端返回明确状态码
   */
  logger.info("开始执行图片上传中间件...");

  // 1.1 调用单文件上传
  upload.single("image")(req, res, (error) => {
    if (!error) {
      logger.info("执行图片上传中间件完成");
      next();
      return;
    }

    // 1.2 转换上传错误响应
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      logger.warn("上传图片超过大小限制", { limit: MAX_IMAGE_UPLOAD_BYTES });
      res.status(413).json({ error: "Image is too large. Max size is 20 MB." });
      return;
    }
    logger.warn("图片上传失败", { error: String(error) });
    res.status(400).json({ error: error instanceof Error ? error.message : "Image upload failed." });
  });
};

export const apiRouter = express.Router();

apiRouter.post("/analyze", uploadImage, async (req, res, next) => {
  /*
   * ========================================================================
   * 步骤1：接收图片并生成 scene
   * ========================================================================
   * 目标：
   *   1) 保存上传图片
   *   2) 调用图片分析器生成可编辑场景
   *   3) 返回 scene 和资源地址
   */
  logger.info("开始接收图片并生成 scene...");

  let imagePath: string | undefined;
  try {
    // 1.1 校验上传文件
    if (!req.file) {
      res.status(400).json({ error: "Missing image file." });
      return;
    }

    // 1.2 移动上传文件到稳定文件名
    const id = randomUUID();
    const extension = extensionFromMime(req.file.mimetype);
    const fileName = `${id}${extension}`;
    imagePath = path.join(uploadDir, fileName);
    await fs.rename(req.file.path, imagePath);

    // 1.3 生成 scene 文件
    const sourceUrl = `/uploads/${fileName}`;
    const scene = await analyzeImage({
      id,
      imagePath,
      sourceUrl,
      title: req.body?.title || req.file.originalname || "Scientific Figure"
    });
    const scenePath = path.join(sceneDir, `${id}.scene.json`);
    await fs.writeFile(scenePath, JSON.stringify(scene, null, 2), "utf-8");

    logger.info("接收图片并生成 scene 完成", { id, scenePath });
    res.json({
      scene,
      sourceUrl,
      sceneUrl: `/api/scenes/${id}`
    });
  } catch (error) {
    logger.error("接收图片并生成 scene 失败", { error: String(error) });
    await cleanupUpload(req.file?.path, imagePath);
    next(error);
  }
});

apiRouter.post("/reconstruct", uploadImage, async (req, res, next) => {
  /*
   * ========================================================================
   * 步骤1：AI 重建图片
   * ========================================================================
   * 目标：
   *   1) 接收论文图
   *   2) 调用多模态模型生成 Visiomaster 风格 scene
   *   3) 转换为编辑器内部 scene 并保存
   */
  logger.info("开始 AI 重建图片...");

  let imagePath: string | undefined;
  try {
    // 1.1 校验上传文件
    if (!req.file) {
      res.status(400).json({ error: "Missing image file." });
      return;
    }

    // 1.2 保存上传图片
    const id = randomUUID();
    const extension = extensionFromMime(req.file.mimetype);
    const fileName = `${id}${extension}`;
    imagePath = path.join(uploadDir, fileName);
    await fs.rename(req.file.path, imagePath);

    // 1.3 读取重建模式
    const mode = reconstructionModeValue(req.body?.mode);

    // 1.4 调用 AI 并保存 scene
    const rawScene = await reconstructWithOpenAI({
      imagePath,
      mimeType: req.file.mimetype,
      mode
    });
    const scene = normalizeImportedScene(rawScene);
    scene.metadata.id = id;
    scene.metadata.sourceImage = `/uploads/${fileName}`;
    scene.metadata.notes = [...scene.metadata.notes, `Reconstruction mode: ${mode}.`];
    ensureReplicaBaseLayer(scene, `/uploads/${fileName}`);
    const scenePath = path.join(sceneDir, `${id}.scene.json`);
    await fs.writeFile(scenePath, JSON.stringify(scene, null, 2), "utf-8");

    logger.info("AI 重建图片完成", { id, mode, nodes: scene.nodes.length, edges: scene.edges.length });
    res.json({
      scene,
      sourceUrl: `/uploads/${fileName}`,
      sceneUrl: `/api/scenes/${id}`
    });
  } catch (error) {
    logger.error("AI 重建图片失败", { error: String(error) });
    await cleanupUpload(req.file?.path, imagePath);
    next(error);
  }
});

apiRouter.get("/config", (_req, res) => {
  /*
   * ========================================================================
   * 步骤1：返回前端运行配置
   * ========================================================================
   * 目标：
   *   1) 暴露 AI 重建是否可用
   *   2) 避免前端在缺少 API Key 时盲目调用重建接口
   */
  logger.info("开始返回前端运行配置...");

  // 1.1 读取服务端环境变量
  const aiReconstructionAvailable = Boolean(process.env.OPENAI_API_KEY);

  // 1.2 返回安全配置
  logger.info("返回前端运行配置完成", { aiReconstructionAvailable });
  res.json({
    aiReconstructionAvailable,
    reconstructModel: process.env.OPENAI_RECONSTRUCT_MODEL || "gpt-5.4"
  });
});

apiRouter.get("/scenes/:id", async (req, res, next) => {
  /*
   * ========================================================================
   * 步骤1：读取 scene 文件
   * ========================================================================
   * 目标：
   *   1) 根据 id 定位 scene.json
   *   2) 返回可编辑场景
   */
  logger.info("开始读取 scene 文件...", { id: req.params.id });

  try {
    // 1.1 读取文件内容
    const id = safeSceneId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid scene id." });
      return;
    }
    const scenePath = path.join(sceneDir, `${id}.scene.json`);
    const content = await fs.readFile(scenePath, "utf-8");

    // 1.2 返回 JSON
    logger.info("读取 scene 文件完成", { scenePath });
    res.type("json").send(content);
  } catch (error) {
    logger.error("读取 scene 文件失败", { error: String(error) });
    next(error);
  }
});

apiRouter.post("/export/svg", express.json({ limit: "20mb" }), async (req, res, next) => {
  /*
   * ========================================================================
   * 步骤1：导出 SVG
   * ========================================================================
   * 目标：
   *   1) 接收前端当前 scene
   *   2) 转换为 SVG 字符串
   *   3) 保存并返回下载地址
   */
  logger.info("开始导出 SVG...");

  try {
    // 1.1 获取 scene
    const validation = validateSceneForExport(req.body?.scene);
    if (!validation.ok) {
      res.status(400).json({ error: "Invalid scene.", issues: validation.issues });
      return;
    }
    const scene = validation.scene;

    // 1.2 生成并保存 SVG
    const svg = await sceneToSvg(scene);
    const fileName = `${sanitizeFileBase(scene.metadata?.id || randomUUID())}.svg`;
    const outputPath = path.join(exportDir, fileName);
    await fs.writeFile(outputPath, svg, "utf-8");

    logger.info("导出 SVG 完成", { outputPath });
    res.json({ url: `/exports/${fileName}` });
  } catch (error) {
    logger.error("导出 SVG 失败", { error: String(error) });
    next(error);
  }
});

apiRouter.post("/export/pptx", express.json({ limit: "20mb" }), async (req, res, next) => {
  /*
   * ========================================================================
   * 步骤1：导出 PPTX
   * ========================================================================
   * 目标：
   *   1) 接收前端当前 scene
   *   2) 转换成可编辑 PowerPoint
   *   3) 返回下载地址
   */
  logger.info("开始导出 PPTX...");

  try {
    // 1.1 获取 scene
    const validation = validateSceneForExport(req.body?.scene);
    if (!validation.ok) {
      res.status(400).json({ error: "Invalid scene.", issues: validation.issues });
      return;
    }
    const scene = validation.scene;

    // 1.2 生成 PPTX
    const fileName = `${sanitizeFileBase(scene.metadata?.id || randomUUID())}.pptx`;
    const outputPath = path.join(exportDir, fileName);
    await sceneToPptx(scene, outputPath);

    logger.info("导出 PPTX 完成", { outputPath });
    res.json({ url: `/exports/${fileName}` });
  } catch (error) {
    logger.error("导出 PPTX 失败", { error: String(error) });
    next(error);
  }
});

apiRouter.post("/export/json", express.json({ limit: "20mb" }), async (req, res, next) => {
  /*
   * ========================================================================
   * 步骤1：导出 JSON
   * ========================================================================
   * 目标：
   *   1) 接收前端当前 scene
   *   2) 保存为中间协议文件
   *   3) 返回下载地址
   */
  logger.info("开始导出 JSON...");

  try {
    // 1.1 获取 scene
    const validation = validateSceneForExport(req.body?.scene);
    if (!validation.ok) {
      res.status(400).json({ error: "Invalid scene.", issues: validation.issues });
      return;
    }
    const scene = validation.scene;

    // 1.2 保存 JSON
    const fileName = `${sanitizeFileBase(scene.metadata?.id || randomUUID())}.scene.json`;
    const outputPath = path.join(exportDir, fileName);
    await fs.writeFile(outputPath, JSON.stringify(scene, null, 2), "utf-8");

    logger.info("导出 JSON 完成", { outputPath });
    res.json({ url: `/exports/${fileName}` });
  } catch (error) {
    logger.error("导出 JSON 失败", { error: String(error) });
    next(error);
  }
});

function extensionFromMime(mime: string) {
  return IMAGE_EXTENSIONS_BY_MIME.get(mime) ?? ".png";
}

function reconstructionModeValue(value: unknown): ReconstructionMode {
  if (value === "mono") {
    return "mono";
  }
  return "color";
}

export function isAllowedImageMime(mime: string) {
  /*
   * ========================================================================
   * 步骤1：判断图片 MIME 白名单
   * ========================================================================
   * 目标：
   *   1) 限制上传格式
   *   2) 避免未知类型进入后续 sharp 处理
   */
  logger.info("开始判断图片 MIME 白名单...", { mime });

  // 1.1 查询白名单
  const result = IMAGE_EXTENSIONS_BY_MIME.has(mime);

  // 1.2 返回判断结果
  logger.info("判断图片 MIME 白名单完成", { result });
  return result;
}

export function sanitizeFileBase(value: unknown) {
  /*
   * ========================================================================
   * 步骤1：清洗导出文件名
   * ========================================================================
   * 目标：
   *   1) 移除路径字符和控制字符
   *   2) 保留稳定可读的文件名前缀
   */
  logger.info("开始清洗导出文件名...", { value });

  // 1.1 归一化原始值
  const raw = typeof value === "string" ? value.trim() : "";
  const sanitized = raw
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  // 1.2 返回安全文件名前缀
  const result = sanitized || randomUUID();
  logger.info("清洗导出文件名完成", { result });
  return result;
}

function safeSceneId(value: unknown) {
  /*
   * ========================================================================
   * 步骤1：校验 scene id
   * ========================================================================
   * 目标：
   *   1) 只接受服务端生成的安全文件名片段
   *   2) 防止读取 data/scenes 外部路径
   */
  logger.info("开始校验 scene id...", { value });

  // 1.1 判断 id 字符集
  const result = typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value) ? value : "";

  // 1.2 返回安全 id
  logger.info("校验 scene id 完成", { valid: Boolean(result) });
  return result;
}

export function validateSceneForExport(value: unknown): { ok: true; scene: Scene; issues: [] } | { ok: false; scene?: undefined; issues: ValidationIssue[] } {
  /*
   * ========================================================================
   * 步骤1：校验导出 scene 请求体
   * ========================================================================
   * 目标：
   *   1) 执行 scene 运行时深校验
   *   2) 避免无效对象进入 SVG/PPTX/JSON 导出器
   */
  logger.info("开始校验导出 scene 请求体...");

  // 1.1 执行深校验
  const result = validateScene(value);
  if (!result.ok) {
    logger.warn("导出 scene 请求体无效", { issues: result.issues });
    return { ok: false, issues: result.issues };
  }

  // 1.2 返回合法 scene
  const scene = value as Scene;
  logger.info("校验导出 scene 请求体完成", { nodes: scene.nodes.length });
  return { ok: true, scene, issues: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function cleanupUpload(tempPath?: string, savedPath?: string) {
  /*
   * ========================================================================
   * 步骤1：清理失败上传文件
   * ========================================================================
   * 目标：
   *   1) 删除 multer 临时文件
   *   2) 删除已经重命名但业务处理失败的图片
   */
  logger.info("开始清理失败上传文件...", { tempPath, savedPath });

  // 1.1 收集候选路径
  const paths = [...new Set([tempPath, savedPath].filter((item): item is string => Boolean(item)))];

  // 1.2 尝试删除存在的文件
  for (const filePath of paths) {
    await fs.unlink(filePath).catch(() => undefined);
  }

  logger.info("清理失败上传文件完成", { files: paths.length });
}

export function ensureReplicaBaseLayer(scene: Scene, sourceUrl: string) {
  /*
   * ========================================================================
   * 步骤1：补充复刻底图
   * ========================================================================
   * 目标：
   *   1) AI 重建结果保留原图作为锁定底图
   *   2) 语义节点作为可编辑覆盖层，避免视觉差距过大
   */
  logger.info("开始补充复刻底图...", { sourceUrl });

  // 1.1 检查是否已有同源底图
  const hasBaseLayer = scene.nodes.some((node) => node.type === "image" && node.source === sourceUrl);
  if (hasBaseLayer) {
    logger.info("补充复刻底图完成，已存在");
    return;
  }

  // 1.2 插入锁定底图
  scene.nodes.unshift({
    id: "source-image",
    type: "image",
    x: 0,
    y: 0,
    w: scene.page.width,
    h: scene.page.height,
    source: sourceUrl,
    locked: true,
    style: {
      opacity: 1
    }
  });

  logger.info("补充复刻底图完成", { nodes: scene.nodes.length });
}
