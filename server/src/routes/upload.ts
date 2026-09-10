import { isAllowedImageMime } from "../storage/imageTypes";
import { randomUUID } from "node:crypto";
import type express from "express";
import multer from "multer";
import { logger } from "../logger";

const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;

export function createUploadImage(uploadDir: string): express.RequestHandler {
  const upload = multer({
    // 用 diskStorage 显式产出带 .tmp 后缀的临时文件名：默认 dest 产出无扩展名文件，
    // 一旦在 rename 落地前进程崩溃便永久残留，且不被保留清理白名单覆盖。
    storage: multer.diskStorage({
      // A string destination makes multer create directories during app construction.
      // Initialization belongs to index.ts; tests provide their own prepared roots.
      destination: (_req, _file, callback) => callback(null, uploadDir),
      filename: (_req, _file, callback) => callback(null, `${randomUUID()}.upload.tmp`)
    }),
    limits: {
      fileSize: MAX_IMAGE_UPLOAD_BYTES,
      files: 1
    },
    fileFilter: (_req, file, callback) => {
      logger.info("开始校验上传图片类型...", { mimeType: file.mimetype });
      if (!isAllowedImageMime(file.mimetype)) {
        logger.warn("上传图片类型不支持", { mimeType: file.mimetype });
        callback(new Error("Unsupported image type. Use PNG, JPEG, or WebP."));
        return;
      }
      logger.info("校验上传图片类型完成", { mimeType: file.mimetype });
      callback(null, true);
    }
  });

  const uploadImage: express.RequestHandler = (req, res, next) => {
    logger.info("开始执行图片上传中间件...");
    upload.single("image")(req, res, (error) => {
      if (!error) {
        logger.info("执行图片上传中间件完成");
        next();
        return;
      }
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        logger.warn("上传图片超过大小限制", { limit: MAX_IMAGE_UPLOAD_BYTES });
        res.status(413).json({ error: "Image is too large. Max size is 20 MB." });
        return;
      }
      logger.warn("图片上传失败", { error: String(error) });
      res.status(400).json({ error: error instanceof Error ? error.message : "Image upload failed." });
    });
  };

  return uploadImage;
}
