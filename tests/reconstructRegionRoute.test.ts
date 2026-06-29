import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import path from "node:path";
import express from "express";
import sharp from "sharp";
import { apiRouter } from "../server/src/routes/api";
import { httpErrorHandler } from "../server/src/httpErrorHandler";
import { sceneDir, uploadDir } from "../server/src/paths";
import type { Scene } from "../src/shared/scene";

let server: Server | undefined;

afterEach(async () => {
  if (!server) {
    return;
  }
  const current = server;
  server = undefined;
  await new Promise<void>((resolve, reject) => {
    current.close((error) => error ? reject(error) : resolve());
  });
});

async function startTestServer() {
  await mkdir(uploadDir, { recursive: true });
  await mkdir(sceneDir, { recursive: true });
  const app = express();
  app.use("/api", apiRouter);
  app.use(httpErrorHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server?.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function sceneWithMissingSourceImage(): Scene {
  return {
    version: "0.1",
    page: { width: 400, height: 200, background: "#FFFFFF", units: "px" },
    metadata: {
      id: "stale-scene",
      title: "Stale Scene",
      sourceImage: "/uploads/missing-source.png",
      createdAt: "2026-06-29T00:00:00.000Z",
      engine: "test",
      notes: []
    },
    nodes: [
      {
        id: "source-image",
        type: "image",
        x: 0,
        y: 0,
        w: 400,
        h: 200,
        source: "/uploads/missing-source.png",
        locked: true,
        style: { opacity: 1 }
      },
      {
        id: "editable-node",
        type: "rect",
        x: 100,
        y: 50,
        w: 80,
        h: 40,
        style: { fill: "#FFFFFF", stroke: "#111111" }
      }
    ],
    edges: []
  };
}

function sceneWithSourceImage(sourceImage: string): Scene {
  return {
    version: "0.1",
    page: { width: 400, height: 200, background: "#FFFFFF", units: "px" },
    metadata: {
      id: "region-scene",
      title: "Region Scene",
      sourceImage,
      createdAt: "2026-06-29T00:00:00.000Z",
      engine: "test",
      notes: []
    },
    nodes: [
      {
        id: "source-image",
        type: "image",
        x: 0,
        y: 0,
        w: 400,
        h: 200,
        source: sourceImage,
        locked: true,
        style: { opacity: 1 }
      }
    ],
    edges: []
  };
}

describe("reconstruct-region route", () => {
  it("returns a client error when the local source image referenced by the scene is missing", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/api/reconstruct-region`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scene: sceneWithMissingSourceImage(),
        region: { x: 90, y: 40, w: 120, h: 80 },
        mode: "color",
        mergeMode: "replace"
      })
    });

    const body = await response.json() as { error: string };
    assert.equal(response.status, 400);
    assert.match(body.error, /source image.*not found/i);
    assert.doesNotMatch(body.error, /internal server error/i);
  });

  it("returns an INVALID_IMAGE envelope when the local source image is corrupt", async () => {
    /*
     * ========================================================================
     * 步骤1：验证局部重建原图内容校验
     * ========================================================================
     * 目标：
     *   1) /uploads 下文件存在不代表图片内容有效
     *   2) sharp 读取损坏原图失败时应返回客户端可恢复错误，而不是 UNKNOWN 500
     */
    const imageName = `${randomUUID()}.png`;
    const imagePath = path.join(uploadDir, imageName);
    try {
      const baseUrl = await startTestServer();
      await writeFile(imagePath, "not a real png", "utf-8");

      const response = await fetch(`${baseUrl}/api/reconstruct-region`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scene: sceneWithSourceImage(`/uploads/${imageName}`),
          region: { x: 40, y: 30, w: 120, h: 80 },
          mode: "color",
          mergeMode: "replace"
        })
      });

      const body = await response.json() as { error: { code?: string; message?: string; hint?: string } };
      assert.equal(response.status, 400);
      assert.equal(body.error.code, "INVALID_IMAGE");
      assert.match(body.error.message ?? "", /invalid image/i);
      assert.match(body.error.hint ?? "", /PNG|JPEG|WebP/i);
    } finally {
      await unlink(imagePath).catch(() => undefined);
    }
  });

  it("returns a client error when the region does not overlap the scene page", async () => {
    const imageName = `${randomUUID()}.png`;
    const imagePath = path.join(uploadDir, imageName);
    try {
      const baseUrl = await startTestServer();
      await sharp({
        create: {
          width: 16,
          height: 16,
          channels: 3,
          background: "#ffffff"
        }
      }).png().toFile(imagePath);

      const response = await fetch(`${baseUrl}/api/reconstruct-region`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scene: sceneWithSourceImage(`/uploads/${imageName}`),
          region: { x: 500, y: 50, w: 20, h: 20 },
          mode: "color",
          mergeMode: "replace"
        })
      });

      const body = await response.json() as { error: string | { code?: string; message?: string } };
      assert.equal(response.status, 400);
      assert.match(typeof body.error === "string" ? body.error : body.error.message ?? "", /invalid region/i);
    } finally {
      await unlink(imagePath).catch(() => undefined);
    }
  });
});

describe("scene read route", () => {
  it("rejects overlong scene ids before touching the filesystem", async () => {
    const baseUrl = await startTestServer();
    const id = "a".repeat(160);

    const response = await fetch(`${baseUrl}/api/scenes/${id}`);
    const body = await response.json() as { error: string };

    assert.equal(response.status, 400);
    assert.match(body.error, /invalid scene id/i);
  });

  it("rejects persisted scene files that do not match the scene schema", async () => {
    const id = `invalid-${randomUUID()}`;
    const scenePath = path.join(sceneDir, `${id}.scene.json`);
    try {
      const baseUrl = await startTestServer();
      await writeFile(scenePath, JSON.stringify({ version: "0.1", metadata: { id }, nodes: [] }), "utf-8");

      const response = await fetch(`${baseUrl}/api/scenes/${id}`);
      const body = await response.json() as { error: string; issues?: unknown[] };

      assert.equal(response.status, 409);
      assert.match(body.error, /invalid/i);
      assert.ok(Array.isArray(body.issues));
      assert.ok(body.issues.length > 0);
    } finally {
      await unlink(scenePath).catch(() => undefined);
    }
  });

  it("rejects persisted scene files that are not parseable JSON", async () => {
    const id = `corrupt-${randomUUID()}`;
    const scenePath = path.join(sceneDir, `${id}.scene.json`);
    try {
      const baseUrl = await startTestServer();
      await writeFile(scenePath, "{ not json", "utf-8");

      const response = await fetch(`${baseUrl}/api/scenes/${id}`);
      const body = await response.json() as { error: string };

      assert.equal(response.status, 409);
      assert.match(body.error, /invalid/i);
    } finally {
      await unlink(scenePath).catch(() => undefined);
    }
  });

  it("rejects oversized persisted scene files before parsing", async () => {
    const id = `oversized-${randomUUID()}`;
    const scenePath = path.join(sceneDir, `${id}.scene.json`);
    try {
      const baseUrl = await startTestServer();
      await writeFile(scenePath, "x".repeat(21 * 1024 * 1024), "utf-8");

      const response = await fetch(`${baseUrl}/api/scenes/${id}`);
      const body = await response.json() as { error: string };

      assert.equal(response.status, 413);
      assert.match(body.error, /too large/i);
    } finally {
      await unlink(scenePath).catch(() => undefined);
    }
  });
});

describe("analyze route", () => {
  it("returns a client error when image bytes do not match an allowed MIME type", async () => {
    const baseUrl = await startTestServer();
    const form = new FormData();
    form.append("image", new Blob([Buffer.from("not a real png")], { type: "image/png" }), "fake.png");

    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      body: form
    });

    const body = await response.json() as { error: string };
    assert.equal(response.status, 400);
    assert.match(body.error, /invalid image/i);
    assert.doesNotMatch(body.error, /internal server error/i);
  });
});

describe("reconstruct route", () => {
  it("returns a client error envelope when image bytes do not match an allowed MIME type", async () => {
    const baseUrl = await startTestServer();
    const form = new FormData();
    form.append("image", new Blob([Buffer.from("not a real png")], { type: "image/png" }), "fake.png");
    form.append("mode", "color");
    form.append("model", "gpt-test");

    const response = await fetch(`${baseUrl}/api/reconstruct`, {
      method: "POST",
      body: form
    });

    const body = await response.json() as { error: { code: string; message: string; hint?: string } };
    assert.equal(response.status, 400);
    assert.equal(body.error.code, "INVALID_IMAGE");
    assert.match(body.error.message, /invalid image/i);
    assert.match(body.error.hint ?? "", /PNG|JPEG|WebP/i);
  });
});
