import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import sharp from "sharp";
import { logger } from "../logger";
import { sceneDir, uploadDir } from "../paths";
import { analyzeImage } from "../scene/analyzeImage";
import {
  buildSafeAiProviderConfig,
  ConfigValidationError,
  deletePersistedConfig,
  fetchOpenAiCompatibleModels,
  readAiRuntimeConfig,
  readPersistedConfig,
  validateWritableConfig,
  writePersistedConfig
} from "../scene/aiProviderConfig";
import { sceneToPptx } from "../scene/pptx";
import { repairScene } from "../scene/repairScene";
import { mergeRegionReconstruction, sceneRegionToImageExtract, sourceImageUrlFromScene, type RegionMergeMode, type SceneBox } from "../scene/regionReconstruction";
import { ReconstructError, reconstructWithOpenAI, type ReconstructErrorCode } from "../scene/reconstructWithOpenAI";
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
  // 用 diskStorage 显式产出带 .tmp 后缀的临时文件名：默认 dest 产出无扩展名文件，
  // 一旦在 rename 落地前进程崩溃便永久残留，且不被保留清理白名单覆盖。
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, _file, callback) => callback(null, `${randomUUID()}.upload.tmp`)
  }),
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

export const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function isAllowedMutationOrigin(originOrReferer: string, hostHeader: string): boolean {
  /*
   * ========================================================================
   * 步骤1：判定状态变更请求来源是否可信（CSRF 纵深防御）
   * ========================================================================
   * 目标：
   *   1) 无 Origin/Referer：非浏览器客户端（curl/CLI/服务端），CSRF 必经浏览器，放行
   *   2) Origin 为本机回环（含 dev 的 localhost:5173 跨端口）或与 Host 同主机：放行
   *   3) 其余跨站来源（如 evil.com）：拒绝。与“同源、不开 CORS”决策正交，不重新引入 cors()
   */
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

const csrfGuard: express.RequestHandler = (req, res, next) => {
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

export const apiRouter = express.Router();

// CSRF 纵深防御：所有状态变更请求先过来源校验（在路由注册前挂载）
apiRouter.use(csrfGuard);

apiRouter.get("/health", (_req, res) => {
  // 纯本地存活探针：不触发任何出站请求，供 Docker/compose 健康检查使用，
  // 避免把容器存活耦合到外部 LLM 端点的可用性/延迟（详见 /config 会出站拉模型列表）。
  res.json({ ok: true });
});

type ExportKind = "svg" | "pptx" | "json";

//   导出统一走内存渲染 + 附件下发：不再写 data/exports（消除弹窗拦截、
//   SVG/JSON 内联渲染与导出物 14 天保留期过期三类问题）。
export const exportKindConfig: Record<ExportKind, {
  ext: string;
  contentType: string;
  render: (scene: Scene) => Promise<string | Buffer>;
}> = {
  svg: {
    ext: "svg",
    contentType: "image/svg+xml; charset=utf-8",
    render: async (scene) => sceneToSvg(scene)
  },
  pptx: {
    ext: "pptx",
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    render: async (scene) => sceneToPptx(scene)
  },
  json: {
    ext: "scene.json",
    contentType: "application/json; charset=utf-8",
    render: async (scene) => JSON.stringify(scene, null, 2)
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
      // 未生成有效 scene：清理已重命名的孤儿上传图，避免残留到保留期
      await cleanupUpload(undefined, imagePath);
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

//   重建错误信封：路由据 code 映射 HTTP 状态，客户端据 code 给出中文恢复建议。
//   仅两条重建路由使用；其余路径维持旧式 { error: string } 契约。
export function toReconstructEnvelope(error: unknown): {
  status: number;
  code: ReconstructErrorCode | "UNKNOWN";
  message: string;
  hint?: string;
} {
  if (error instanceof ReconstructError) {
    const statusByCode: Record<ReconstructErrorCode, number> = {
      AUTH: 401,
      TIMEOUT: 504,
      BAD_MODEL_OUTPUT: 502,
      INVALID_SCENE: 500,
      NETWORK: 502,
      UPSTREAM: 502
    };
    return { status: statusByCode[error.code], code: error.code, message: error.message, hint: error.hint };
  }
  return { status: 500, code: "UNKNOWN", message: error instanceof Error ? error.message : String(error) };
}

function isClientAbort(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

apiRouter.post("/reconstruct", uploadImage, async (req, res) => {
  /*
   * ========================================================================
   * 步骤1：AI 重建图片
   * ========================================================================
   * 目标：
   *   1) 接收论文图
   *   2) 调用多模态模型生成 Visiomaster 风格 scene
   *   3) 转换为编辑器内部 scene 并保存
   *   4) 客户端断开（取消）时中止上游调用；错误以结构化信封返回
   */
  logger.info("开始 AI 重建图片...");

  // 1.0 客户端断开 → 中止上游 fetch。
  //   注意必须监听 res 而非 req：Node ≥16 在请求体被读完时就会触发 req 'close'
  //   （并非连接断开），multer/express.json 之后挂 req.on('close') 会导致每个
  //   请求自我中止。res 'close' 在响应正常结束时也触发，用 writableEnded 区分。
  const clientAbort = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) {
      clientAbort.abort();
    }
  };
  res.on("close", onClose);

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
      model,
      signal: clientAbort.signal
    });
    const sourceUrl = `/uploads/${fileName}`;
    const validation = repairAndValidateSceneForPersistence(normalizeImportedScene(rawScene), { id, sourceUrl });
    if (!validation.ok) {
      // 未生成有效 scene：清理已重命名的孤儿上传图，避免残留到保留期
      await cleanupUpload(undefined, imagePath);
      res.status(500).json({
        error: { code: "INVALID_SCENE", message: "Generated scene is invalid.", hint: "可重试或更换模型" },
        issues: validation.issues
      });
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
    await cleanupUpload(req.file?.path, imagePath);
    // 客户端取消：连接已断，不写响应
    if (isClientAbort(error)) {
      logger.info("AI 重建已被客户端取消");
      return;
    }
    if (res.writableEnded) {
      return;
    }
    const envelope = toReconstructEnvelope(error);
    logger.error("AI 重建图片失败", { error: String(error), code: envelope.code });
    // 不再 next(error)：错误中间件会用通用文案覆盖结构化信封
    res.status(envelope.status).json({
      error: { code: envelope.code, message: envelope.message, hint: envelope.hint }
    });
  } finally {
    res.off("close", onClose);
  }
});

apiRouter.post("/reconstruct-region", express.json({ limit: "20mb" }), async (req, res) => {
  /*
   * ========================================================================
   * 步骤1：AI 局部重建
   * ========================================================================
   * 目标：
   *   1) 接收当前 scene 和框选区域
   *   2) 从原图裁剪局部图片并调用 AI 重建
   *   3) 按替换或叠加模式合并回 scene
   *   4) 客户端断开（取消）时中止上游调用；错误以结构化信封返回
   */
  logger.info("开始 AI 局部重建...");

  // 1.0 客户端断开 → 中止上游 fetch（同 /reconstruct：必须监听 res 而非 req）
  const clientAbort = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) {
      clientAbort.abort();
    }
  };
  res.on("close", onClose);

  let regionImagePath: string | undefined;
  try {
    // 1.1 校验当前 scene
    const sceneValidation = validateSceneForExport(req.body?.scene);
    if (!sceneValidation.ok) {
      res.status(400).json({ error: "Invalid scene.", issues: sceneValidation.issues });
      return;
    }
    const scene = sceneValidation.scene;

    // 1.2 校验区域和原图来源
    const region = sceneBoxValue(req.body?.region);
    if (!region) {
      res.status(400).json({ error: "Invalid region." });
      return;
    }
    const sourceUrl = sourceImageUrlFromScene(scene);
    if (!sourceUrl) {
      res.status(400).json({ error: "Scene does not contain a source image." });
      return;
    }
    const sourcePath = uploadPathFromSourceUrl(sourceUrl);

    // 1.3 裁剪局部图片
    const sourceMetadata = await sharp(sourcePath).metadata();
    const imageWidth = sourceMetadata.width ?? scene.page.width;
    const imageHeight = sourceMetadata.height ?? scene.page.height;
    const extract = sceneRegionToImageExtract(region, scene.page, { width: imageWidth, height: imageHeight });
    const id = sanitizeFileBase(scene.metadata.id || randomUUID());
    regionImagePath = path.join(uploadDir, `${randomUUID()}.region.png`);
    await sharp(sourcePath).extract(extract).png().toFile(regionImagePath);

    // 1.4 调用 AI 重建并合并结果
    const mode = reconstructionModeValue(req.body?.mode);
    const model = reconstructModelValue(req.body?.model);
    const mergeMode = regionMergeModeValue(req.body?.mergeMode);
    const rawScene = await reconstructWithOpenAI({
      imagePath: regionImagePath,
      mimeType: "image/png",
      mode,
      model,
      signal: clientAbort.signal
    });
    const repairedRegionScene = repairScene(normalizeImportedScene(rawScene));
    const mergedScene = mergeRegionReconstruction(scene, repairedRegionScene, region, mergeMode);
    const validation = repairAndValidateSceneForPersistence(mergedScene, { id, sourceUrl });
    if (!validation.ok) {
      res.status(500).json({
        error: { code: "INVALID_SCENE", message: "Generated scene is invalid.", hint: "可重试或更换模型" },
        issues: validation.issues
      });
      return;
    }

    // 1.5 保存并返回新 scene
    const nextScene = validation.scene;
    nextScene.metadata.notes = [
      ...nextScene.metadata.notes,
      `Region reconstruction mode: ${mode}.`,
      `Region reconstruction model: ${model || "default"}.`
    ];
    const scenePath = path.join(sceneDir, `${id}.scene.json`);
    await fs.writeFile(scenePath, JSON.stringify(nextScene, null, 2), "utf-8");

    logger.info("AI 局部重建完成", { id, mergeMode, nodes: nextScene.nodes.length, edges: nextScene.edges.length });
    res.json({
      scene: nextScene,
      sourceUrl,
      sceneUrl: `/api/scenes/${id}`
    });
  } catch (error) {
    // 客户端取消：连接已断，不写响应
    if (isClientAbort(error)) {
      logger.info("AI 局部重建已被客户端取消");
      return;
    }
    if (res.writableEnded) {
      return;
    }
    const envelope = toReconstructEnvelope(error);
    logger.error("AI 局部重建失败", { error: String(error), code: envelope.code });
    res.status(envelope.status).json({
      error: { code: envelope.code, message: envelope.message, hint: envelope.hint }
    });
  } finally {
    res.off("close", onClose);
    await cleanupUpload(undefined, regionImagePath);
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
   *   3) 永不返回 apiKey 明文
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
    source: runtimeConfig.source,
    modelListError: modelList.error
  });
  logger.info("返回前端运行配置完成", {
    aiReconstructionAvailable: config.aiReconstructionAvailable,
    source: config.source,
    modelCount: config.reconstructModels.length
  });
  res.json(config);
});

apiRouter.post("/config", express.json({ limit: "16kb" }), async (req, res) => {
  /*
   * ========================================================================
   * 步骤1：保存 AI 配置到 data/config.json
   * ========================================================================
   * 目标：
   *   1) 接收 UI 写入的 apiKey/baseUrl/reconstructModel
   *   2) 校验白名单字段后落盘，文件权限 0o600
   *   3) 表单 apiKey 留空且已有 saved key 时复用 saved（用户只改 baseUrl/model 不必重贴）
   *   4) 写入后立即返回新的安全配置（包括 hasApiKey/source/maskedTail）
   */
  logger.info("开始保存 AI 配置...");

  try {
    // 1.1 读取 saved 配置（用于空 apiKey 时的 fallback）
    const savedConfig = readPersistedConfig();
    const savedKey = savedConfig?.apiKey ?? "";
    const savedBaseUrl = savedConfig?.baseUrl ?? "";

    // 1.2 用 allowEmptyKey 软校验，apiKey 可空，其余字段严格
    const validation = validateWritableConfig(req.body, { allowEmptyKey: Boolean(savedKey) });
    if (!validation.ok) {
      logger.warn("保存 AI 配置失败，字段非法", { error: validation.error });
      res.status(400).json({ error: validation.error });
      return;
    }

    // 1.3 合成 effectiveKey：表单非空 → 表单值；空且 baseUrl 未变 → 复用 saved。
    //   改 baseUrl 必须重填 key，防止把已落盘密钥重放到调用方临时指定的任意 URL（密钥外泄）。
    const sameBaseUrl = validation.value.baseUrl === savedBaseUrl;
    const effectiveKey = validation.value.apiKey || (sameBaseUrl ? savedKey : "");
    if (!effectiveKey) {
      logger.warn("保存 AI 配置失败，缺少 apiKey（或 baseUrl 变更但未重填 key）");
      res.status(400).json({ error: "apiKey is required when changing baseUrl." });
      return;
    }

    // 1.4 用合成后的完整字段写盘（writePersistedConfig 内部仍严格校验，但此时 apiKey 必非空）
    writePersistedConfig({
      apiKey: effectiveKey,
      baseUrl: validation.value.baseUrl,
      reconstructModel: validation.value.reconstructModel
    });

    // 1.5 立刻读回，构造安全响应
    const runtimeConfig = readAiRuntimeConfig();
    const modelList = await fetchOpenAiCompatibleModels(runtimeConfig);
    const config = buildSafeAiProviderConfig({
      apiKey: runtimeConfig.apiKey,
      baseUrl: runtimeConfig.baseUrl,
      defaultModel: runtimeConfig.defaultModel,
      models: modelList.models,
      source: runtimeConfig.source,
      modelListError: modelList.error
    });
    logger.info("保存 AI 配置完成", { source: config.source });
    res.json(config);
  } catch (error) {
    // 1.6 字段非法返回 400
    if (error instanceof ConfigValidationError) {
      logger.warn("保存 AI 配置失败，字段非法", { error: error.message });
      res.status(400).json({ error: error.message });
      return;
    }
    // 1.7 落盘失败返回 500
    logger.error("保存 AI 配置失败", { error: String(error) });
    res.status(500).json({ error: "Failed to persist config." });
  }
});

apiRouter.delete("/config", async (_req, res) => {
  /*
   * ========================================================================
   * 步骤1：清空 UI 写入的 AI 配置
   * ========================================================================
   * 目标：
   *   1) 删除 data/config.json，让运行时 fallback env
   *   2) 返回清空后新的安全配置
   */
  logger.info("开始清空 AI 配置...");

  try {
    // 1.1 删除持久化文件
    const removed = deletePersistedConfig();

    // 1.2 读回 fallback 后的配置
    const runtimeConfig = readAiRuntimeConfig();
    const modelList = await fetchOpenAiCompatibleModels(runtimeConfig);
    const config = buildSafeAiProviderConfig({
      apiKey: runtimeConfig.apiKey,
      baseUrl: runtimeConfig.baseUrl,
      defaultModel: runtimeConfig.defaultModel,
      models: modelList.models,
      source: runtimeConfig.source,
      modelListError: modelList.error
    });
    logger.info("清空 AI 配置完成", { removed, source: config.source });
    res.json(config);
  } catch (error) {
    logger.error("清空 AI 配置失败", { error: String(error) });
    res.status(500).json({ error: "Failed to delete config." });
  }
});

apiRouter.post("/config/test", express.json({ limit: "16kb" }), async (req, res) => {
  /*
   * ========================================================================
   * 步骤1：测试未保存的 AI 配置
   * ========================================================================
   * 目标：
   *   1) 接收表单值不落盘，调 /v1/models 验证
   *   2) 表单 apiKey 留空且已有 saved key 时复用 saved
   *   3) 返回 models 列表（成功）或空数组（失败）给前端 datalist
   *   4) 区分 AUTH / NETWORK / INVALID_RESPONSE / UNKNOWN 错误码
   */
  logger.info("开始测试 AI 配置...");

  // 1.1 读 saved 配置用于空 apiKey fallback
  const savedConfig = readPersistedConfig();
  const savedKey = savedConfig?.apiKey ?? "";
  const savedBaseUrl = savedConfig?.baseUrl ?? "";

  // 1.2 软校验：apiKey 允许空
  const validation = validateWritableConfig(req.body, { allowEmptyKey: Boolean(savedKey) });
  if (!validation.ok) {
    logger.warn("测试 AI 配置失败，字段非法", { error: validation.error });
    res.status(400).json({ ok: false, code: "VALIDATION", error: validation.error, models: [] });
    return;
  }

  // 1.3 合成 effectiveKey：仅当 baseUrl 与已保存值一致时才复用 saved key。
  //   否则"留空 apiKey + 改 baseUrl 指向攻击者"会把已落盘密钥以 Bearer 重放到任意 URL（密钥外泄）。
  const sameBaseUrl = validation.value.baseUrl === savedBaseUrl;
  const effectiveKey = validation.value.apiKey || (sameBaseUrl ? savedKey : "");
  if (!effectiveKey) {
    logger.warn("测试 AI 配置失败，缺少 apiKey（或 baseUrl 变更但未重填 key）");
    res.status(400).json({ ok: false, code: "VALIDATION", error: "apiKey is required when changing baseUrl.", models: [] });
    return;
  }

  // 1.4 调模型列表
  try {
    const result = await fetchOpenAiCompatibleModels({
      apiKey: effectiveKey,
      baseUrl: validation.value.baseUrl
    });
    if (result.error) {
      // 1.5 错误码分类优先级：INVALID_RESPONSE (status=-1) → AUTH (401/403) → AUTH (text) → UNKNOWN
      const isInvalidResponse = result.status === -1;
      const isAuthByStatus = result.status === 401 || result.status === 403;
      const isAuthByText = /401|403|unauthorized|forbidden|invalid[\s_-]?api[\s_-]?key|authentication/i.test(result.error);
      let code: "INVALID_RESPONSE" | "AUTH" | "UNKNOWN";
      if (isInvalidResponse) {
        code = "INVALID_RESPONSE";
      } else if (isAuthByStatus || isAuthByText) {
        code = "AUTH";
      } else {
        code = "UNKNOWN";
      }
      logger.warn("测试 AI 配置失败", { code, status: result.status, error: result.error });
      res.json({ ok: false, code, error: result.error, models: [] });
      return;
    }
    logger.info("测试 AI 配置完成", { modelCount: result.models.length });
    res.json({ ok: true, modelCount: result.models.length, models: result.models });
  } catch (error) {
    // 1.6 网络层失败（fetch 抛异常）
    logger.warn("测试 AI 配置失败，网络错误", { error: String(error) });
    res.json({ ok: false, code: "NETWORK", error: String(error), models: [] });
  }
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
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      res.status(404).json({ error: "Scene not found." });
      return;
    }
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

    // 1.3 内存渲染并以附件下发（中文标题走 RFC 5987 filename*，ASCII 名兜底）
    const asciiBase = sanitizeFileBase(scene.metadata?.title || scene.metadata?.id || randomUUID());
    const asciiName = `${asciiBase}.${config.ext}`;
    const unicodeBase = sanitizeUnicodeFileBase(scene.metadata?.title);
    const downloadName = unicodeBase ? `${unicodeBase}.${config.ext}` : asciiName;
    const content = await config.render(scene);

    res.setHeader("Content-Type", config.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
    );
    logger.info("导出 scene 完成", { kind, downloadName, bytes: typeof content === "string" ? content.length : content.byteLength });
    res.send(content);
  } catch (error) {
    logger.error("导出 scene 失败", { error: String(error), kind: req.params.kind });
    next(error);
  }
});

export function sanitizeUnicodeFileBase(value: unknown) {
  /*
   * ========================================================================
   * 步骤1：清洗 Unicode 下载文件名
   * ========================================================================
   * 目标：
   *   1) 保留中文等非 ASCII 标题字符（sanitizeFileBase 会全部剥掉）
   *   2) 剥除路径分隔符、引号和控制字符，防止头注入与路径歧义
   */

  // 1.1 归一化并剥除危险字符
  const raw = typeof value === "string" ? value.trim() : "";
  const sanitized = raw
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  // 1.2 返回结果（可为空串，由调用方回退 ASCII 名）
  return sanitized;
}

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

function regionMergeModeValue(value: unknown): RegionMergeMode {
  /*
   * ========================================================================
   * 步骤1：读取局部重建合并模式
   * ========================================================================
   * 目标：
   *   1) 支持替换旧节点
   *   2) 支持叠加新节点
   */
  logger.info("开始读取局部重建合并模式...", { value });

  // 1.1 读取合法模式
  const mode = value === "overlay" ? "overlay" : "replace";

  logger.info("读取局部重建合并模式完成", { mode });
  return mode;
}

function sceneBoxValue(value: unknown): SceneBox | null {
  /*
   * ========================================================================
   * 步骤1：读取 scene 区域
   * ========================================================================
   * 目标：
   *   1) 校验 x/y/w/h 是有限数字
   *   2) 拒绝过小区域
   */
  logger.info("开始读取 scene 区域...", { value });

  // 1.1 校验对象结构
  if (!isRecord(value)) {
    logger.warn("读取 scene 区域失败，结构非法");
    return null;
  }

  // 1.2 校验数字字段
  const box = {
    x: value.x,
    y: value.y,
    w: value.w,
    h: value.h
  };
  if (!Object.values(box).every((item) => typeof item === "number" && Number.isFinite(item))) {
    logger.warn("读取 scene 区域失败，字段非法");
    return null;
  }
  const region = box as SceneBox;
  if (Math.abs(region.w) < 4 || Math.abs(region.h) < 4) {
    logger.warn("读取 scene 区域失败，区域过小");
    return null;
  }

  logger.info("读取 scene 区域完成", region);
  return region;
}

function uploadPathFromSourceUrl(sourceUrl: string) {
  /*
   * ========================================================================
   * 步骤1：解析上传文件路径
   * ========================================================================
   * 目标：
   *   1) 只允许 /uploads/ 下的运行产物
   *   2) 使用 basename 防止路径穿越
   */
  logger.info("开始解析上传文件路径...", { sourceUrl });

  // 1.1 校验上传 URL
  const normalized = sourceUrl.replaceAll("\\", "/");
  const marker = "/uploads/";
  const index = normalized.indexOf(marker);
  if (index < 0) {
    throw new Error("Source image must be a local upload.");
  }

  // 1.2 返回本地路径
  const fileName = path.basename(normalized.slice(index + marker.length));
  const filePath = path.join(uploadDir, fileName);
  logger.info("解析上传文件路径完成", { filePath });
  return filePath;
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
