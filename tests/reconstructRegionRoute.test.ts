import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
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
