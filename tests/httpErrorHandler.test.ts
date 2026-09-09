import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../server/src/app";
import { createDataPaths, ensureDataDirs, type DataPaths } from "../server/src/paths";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";

let server: Server | undefined;
let paths: DataPaths;

beforeEach(async () => {
  paths = createDataPaths(await mkdtemp(path.join(os.tmpdir(), "scientific-drawing-http-")));
  ensureDataDirs({ info: () => undefined }, paths);
});

afterEach(async () => {
  const current = server;
  server = undefined;
  await new Promise<void>((resolve, reject) => {
    if (current) current.close((error) => error ? reject(error) : resolve());
    else resolve();
  });
  assert.equal(path.dirname(paths.rootDir), path.resolve(os.tmpdir()));
  assert.match(path.basename(paths.rootDir), /^scientific-drawing-http-/);
  await rm(paths.rootDir, { recursive: true, force: true });
});

async function startTestServer() {
  const app = createApp({
    paths, env: {}, distDir: false,
    reconstruct: async () => { throw new Error("Unexpected model call in an input-validation test."); },
    fetchModels: async () => ({ models: [], error: null, status: 200 })
  });
  server = app.listen(0);
  await new Promise<void>((resolve) => server?.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("HTTP error handling", () => {
  it("maps malformed JSON parser errors to 400 instead of generic 500", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/api/config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{"
    });

    const body = await response.json() as { error: string };
    assert.equal(response.status, 400);
    assert.match(body.error, /invalid json/i);
    assert.doesNotMatch(body.error, /internal server error/i);
  });

  it("maps JSON body size limit errors to 413", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/api/config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKey: "sk-test",
        baseUrl: "https://api.example.com",
        reconstructModel: "gpt-test",
        padding: "x".repeat(20 * 1024)
      })
    });

    const body = await response.json() as { error: string };
    assert.equal(response.status, 413);
    assert.match(body.error, /too large/i);
  });
});
