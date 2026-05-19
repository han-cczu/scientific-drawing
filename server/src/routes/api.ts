import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import { logger } from "../logger";
import { exportDir, sceneDir, uploadDir } from "../paths";
import { analyzeImage } from "../scene/analyzeImage";
import { buildSafeAiProviderConfig, fetchOpenAiCompatibleModels, readAiRuntimeConfig } from "../scene/aiProviderConfig";
import { sceneToPptx } from "../scene/pptx";
import { repairScene } from "../scene/repairScene";
import { reconstructWithOpenAI } from "../scene/reconstructWithOpenAI";
import type { ReconstructionMode } from "../scene/reconstructionPrompt";
import { sceneToSvg } from "../scene/svg";
import type { Scene } from "../scene/types";
import { normalizeImportedScene } from "../scene/visiomasterAdapter";
import { validateScene, type ValidationIssue } from "@shared/sceneValidation";

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

type ExportKind = "svg" | "pptx" | "json";

export const exportKindConfig: Record<ExportKind, {
  ext: string;
  write: (scene: Scene, outputPath: string) => Promise<void>;
}> = {
  svg: {
    ext: "svg",
    write: async (scene, outputPath) => {
      /*
       * ========================================================================
       * 步骤1：写入 SVG 导出文件
       * ========================================================================
       * 目标：
       *   1) 把 scene 转换为 SVG 字符串
       *   2) 用 UTF-8 写入导出目录
       */
      logger.info("开始写入 SVG 导出文件...", { outputPath });

      // 1.1 生成并写入 SVG
      const svg = await sceneToSvg(scene);
      await fs.writeFile(outputPath, svg, "utf-8");

      logger.info("写入 SVG 导出文件完成", { outputPath });
    }
  },
  pptx: {
    ext: "pptx",
    write: async (scene, outputPath) => {
      /*
       * ========================================================================
       * 步骤1：写入 PPTX 导出文件
       * ========================================================================
       * 目标：
       *   1) 把 scene 转换为可编辑 PowerPoint
       *   2) 写入导出目录
       */
      logger.info("开始写入 PPTX 导出文件...", { outputPath });

      // 1.1 生成 PPTX
      await sceneToPptx(scene, outputPath);

      logger.info("写入 PPTX 导出文件完成", { outputPath });
    }
  },
  json: {
    ext: "scene.json",
    write: async (scene, outputPath) => {
      /*
       * ========================================================================
       * 步骤1：写入 JSON 导出文件
       * ========================================================================
       * 目标：
       *   1) 保留 scene 中间协议
       *   2) 用缩进格式便于人工检查
       */
      logger.info("开始写入 JSON 导出文件...", { outputPath });

      // 1.1 写入 JSON
      await fs.writeFile(outputPath, JSON.stringify(scene, null, 2), "utf-8");

      logger.info("写入 JSON 导出文件完成", { outputPath });
    }
  }
};

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
    const rawScene = await analyzeImage({
      id,
      imagePath,
      sourceUrl,
      title: req.body?.title || req.file.originalname || "Scientific Figure"
    });
    const validation = repairAndValidateSceneForPersistence(rawScene, { id, sourceUrl });
    if (!validation.ok) {
      res.status(500).json({ error: "Generated scene is invalid.", issues: validation.issues });
      return;
    }
    const scene = validation.scene;
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

    // 1.3 读取重建模式和模型
    const mode = reconstructionModeValue(req.body?.mode);
    const model = reconstructModelValue(req.body?.model);

    // 1.4 调用 AI 并保存 scene
    const rawScene = await reconstructWithOpenAI({
      imagePath,
      mimeType: req.file.mimetype,
      mode,
      model
    });
    const sourceUrl = `/uploads/${fileName}`;
    const validation = repairAndValidateSceneForPersistence(normalizeImportedScene(rawScene), { id, sourceUrl });
    if (!validation.ok) {
      res.status(500).json({ error: "Generated scene is invalid.", issues: validation.issues });
      return;
    }
    const scene = validation.scene;
    scene.metadata.notes = [...scene.metadata.notes, `Reconstruction mode: ${mode}.`, `Reconstruction model: ${model || "default"}.`];
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

apiRouter.get("/config", async (_req, res) => {
  /*
   * ========================================================================
   * 步骤1：返回前端运行配置
   * ========================================================================
   * 目标：
   *   1) 暴露 AI 重建是否可用
   *   2) 返回 OpenAI 兼容模型列表
   */
  logger.info("开始返回前端运行配置...");

  // 1.1 读取服务端 AI 配置
  const runtimeConfig = readAiRuntimeConfig();

  // 1.2 获取模型列表
  const modelList = await fetchOpenAiCompatibleModels(runtimeConfig);

  // 1.3 返回安全配置
  const config = buildSafeAiProviderConfig({
    apiKey: runtimeConfig.apiKey,
    baseUrl: runtimeConfig.baseUrl,
    defaultModel: runtimeConfig.defaultModel,
    models: modelList.models,
    modelListError: modelList.error
  });
  logger.info("返回前端运行配置完成", {
    aiReconstructionAvailable: config.aiReconstructionAvailable,
    modelCount: config.reconstructModels.length
  });
  res.json(config);
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

apiRouter.post("/export/:kind", express.json({ limit: "20mb" }), async (req, res, next) => {
  /*
   * ========================================================================
   * 步骤1：导出 scene
   * ========================================================================
   * 目标：
   *   1) 按 kind 选择导出器
   *   2) 共用 scene 校验、文件命名和响应逻辑
   */
  logger.info("开始导出 scene...", { kind: req.params.kind });

  try {
    // 1.1 校验导出类型
    const kind = req.params.kind as ExportKind;
    const config = exportKindConfig[kind];
    if (!config) {
      res.status(404).json({ error: "Unsupported export kind." });
      return;
    }

    // 1.2 校验 scene
    const validation = validateSceneForExport(req.body?.scene);
    if (!validation.ok) {
      res.status(400).json({ error: "Invalid scene.", issues: validation.issues });
      return;
    }
    const scene = validation.scene;

    // 1.3 写入导出文件
    const fileName = `${sanitizeFileBase(scene.metadata?.id || randomUUID())}.${config.ext}`;
    const outputPath = path.join(exportDir, fileName);
    await config.write(scene, outputPath);

    logger.info("导出 scene 完成", { kind, outputPath });
    res.json({ url: `/exports/${fileName}` });
  } catch (error) {
    logger.error("导出 scene 失败", { error: String(error), kind: req.params.kind });
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

function reconstructModelValue(value: unknown) {
  /*
   * ========================================================================
   * 步骤1：读取重建模型名
   * ========================================================================
   * 目标：
   *   1) 允许前端从模型列表选择模型
   *   2) 限制异常输入长度和类型
   */
  logger.info("开始读取重建模型名...", { value });

  // 1.1 校验模型名
  const model = typeof value === "string" && value.trim().length > 0 && value.length <= 120
    ? value.trim()
    : undefined;

  logger.info("读取重建模型名完成", { model });
  return model;
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

export function repairAndValidateSceneForPersistence(scene: Scene, options: { id: string; sourceUrl: string }): { ok: true; scene: Scene; issues: [] } | { ok: false; scene?: undefined; issues: ValidationIssue[] } {
  /*
   * ========================================================================
   * 步骤1：修复并校验待持久化 scene
   * ========================================================================
   * 目标：
   *   1) 所有写入 data/scenes 的 scene 都先经过修复层
   *   2) 阻止非法 scene 延迟到导出阶段才暴露
   */
  logger.info("开始修复并校验待持久化 scene...", { id: options.id });

  // 1.1 修复 scene 并覆盖服务端元数据
  const repaired = repairScene(scene);
  repaired.metadata.id = options.id;
  repaired.metadata.sourceImage = options.sourceUrl;
  ensureReplicaBaseLayer(repaired, options.sourceUrl);

  // 1.2 校验修复结果
  const validation = validateScene(repaired);
  if (!validation.ok) {
    logger.warn("待持久化 scene 校验失败", { issues: validation.issues });
    return { ok: false, issues: validation.issues };
  }

  logger.info("修复并校验待持久化 scene 完成", { nodes: repaired.nodes.length });
  return { ok: true, scene: repaired, issues: [] };
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
