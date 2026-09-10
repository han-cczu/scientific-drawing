import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { createApp, type AppOptions } from "../server/src/app";
import { createDataPaths, ensureDataDirs, type DataPaths } from "../server/src/paths";
import { createServices } from "../server/src/services";
import { createSceneStore, type SceneFileSystem } from "../server/src/storage/sceneStore";
import { readPersistedConfig, writePersistedConfig } from "../server/src/storage/aiConfigStore";
import { ReconstructError } from "../server/src/scene/reconstructWithOpenAI";
import type { Scene } from "../src/shared/scene";
import type { SceneResponse, SafeAiProviderConfig } from "../src/shared/apiContracts";

let paths: DataPaths;
const servers: Server[] = [];

beforeEach(async () => {
  paths = createDataPaths(await fs.mkdtemp(path.join(os.tmpdir(), "scientific-drawing-service-")));
  ensureDataDirs({ info: () => undefined }, paths);
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
  assert.equal(path.dirname(paths.rootDir), path.resolve(os.tmpdir()));
  assert.match(path.basename(paths.rootDir), /^scientific-drawing-service-/);
  await fs.rm(paths.rootDir, { recursive: true, force: true });
});

function scene(id = "test-scene", sourceImage?: string): Scene {
  return {
    version: "0.1",
    page: { width: 64, height: 64, units: "px", background: "#ffffff" },
    metadata: { id, title: "研究图", createdAt: "2026-09-09T00:00:00.000Z", engine: "test", notes: [], ...(sourceImage ? { sourceImage } : {}) },
    nodes: [{ id: "editable", type: "ellipse", x: 10, y: 10, w: 20, h: 20, style: { fill: "#ffffff", stroke: "#111111" } }],
    edges: []
  };
}

function options(overrides: AppOptions = {}): AppOptions {
  return {
    paths, env: {}, distDir: false,
    reconstruct: async () => scene() as unknown as Record<string, unknown>,
    analyze: async () => scene(),
    fetchModels: async () => ({ models: ["test-model"], error: null, status: 200 }),
    ...overrides
  };
}

async function start(overrides: AppOptions = {}) {
  const server = createApp(options(overrides)).listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function imageBytes() {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: "#ffffff" } }).png().toBuffer();
}

async function imageForm() {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(await imageBytes())], { type: "image/png" }), "input.png");
  form.append("mode", "mono");
  form.append("model", "test-model");
  return form;
}

function postJson(base: string, route: string, body: unknown) {
  return fetch(`${base}/api/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function waitFor(predicate: () => Promise<boolean>) {
  for (let i = 0; i < 100; i += 1) {
    if (await predicate()) return;
    await delay(10);
  }
  assert.fail("Background cleanup did not finish within one second.");
}

describe("application assembly and isolation", () => {
  it("constructs and serves health without creating directories, running retention, adding signal handlers or contacting models", async () => {
    const isolated = createDataPaths(path.join(paths.rootDir, "uninitialized"));
    const beforeSignals = [process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")];
    let calls = 0;
    const base = await start({ paths: isolated, fetchModels: async () => { calls += 1; throw new Error("Must stay offline."); } });
    const response = await fetch(`${base}/api/health`);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls, 0);
    assert.deepEqual([process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")], beforeSignals);
    assert.equal(await fs.stat(isolated.rootDir).catch(() => undefined), undefined);
  });

  it("binds scene reads and configuration to each app's own data directory", async () => {
    const otherPaths = createDataPaths(path.join(paths.rootDir, "other"));
    ensureDataDirs({ info: () => undefined }, otherPaths);
    const original = scene("same-id");
    const other = { ...scene("same-id"), metadata: { ...scene().metadata, id: "same-id", title: "Other" } };
    await createSceneStore(paths).save("same-id", original);
    await createSceneStore(otherPaths).save("same-id", other);
    writePersistedConfig({ apiKey: "fixture-one", baseUrl: "https://one.example/v1", reconstructModel: "one" }, paths.configPath);
    writePersistedConfig({ apiKey: "fixture-two", baseUrl: "https://two.example/v1", reconstructModel: "two" }, otherPaths.configPath);
    const first = await start();
    const second = await start({ paths: otherPaths });
    assert.deepEqual(await (await fetch(`${first}/api/scenes/same-id`)).json(), original);
    assert.deepEqual(await (await fetch(`${second}/api/scenes/same-id`)).json(), other);
    const configOne = await (await fetch(`${first}/api/config`)).json() as SafeAiProviderConfig;
    const configTwo = await (await fetch(`${second}/api/config`)).json() as SafeAiProviderConfig;
    assert.equal(configOne.reconstructModel, "one");
    assert.equal(configTwo.reconstructModel, "two");
    assert.equal("apiKey" in configOne, false);
    assert.equal("apiKey" in configTwo, false);
  });

  it("serves frontend routes, uploads and historical export attachments with their original boundaries", async () => {
    const distDir = path.join(paths.rootDir, "frontend");
    await fs.mkdir(distDir);
    await fs.writeFile(path.join(distDir, "index.html"), "<html>Fixture SPA</html>");
    await fs.writeFile(path.join(paths.exportDir, "old.svg"), "<svg/>");
    const base = await start({ distDir });
    assert.match(await (await fetch(`${base}/editor/scene`)).text(), /Fixture SPA/);
    assert.equal((await fetch(`${base}/api/no-such-route`)).status, 404);
    const attachment = await fetch(`${base}/exports/old.svg`);
    assert.equal(attachment.headers.get("content-disposition"), "attachment");
    assert.equal(await attachment.text(), "<svg/>");
  });
});

describe("scene pipeline boundaries", () => {
  it("analyzes through an injected runner, persists a valid scene, and serves its upload", async () => {
    let analyzedPath = "";
    const base = await start({ analyze: async (input) => { analyzedPath = input.imagePath; return scene(input.id); } });
    const response = await fetch(`${base}/api/analyze`, { method: "POST", body: await imageForm() });
    assert.equal(response.status, 200);
    const result = await response.json() as SceneResponse;
    assert.equal(path.dirname(analyzedPath), paths.uploadDir);
    assert.equal(result.scene.nodes[0].type, "image");
    assert.deepEqual(await (await fetch(`${base}${result.sceneUrl}`)).json(), result.scene);
    assert.deepEqual(Buffer.from(await (await fetch(`${base}${result.sourceUrl}`)).arrayBuffer()), await imageBytes());
    assert.equal((await fs.readdir(paths.sceneDir)).length, 1);
  });

  it("reconstructs with the selected model/mode and preserves a healthy request signal after its body is consumed", async () => {
    const base = await start({ reconstruct: async (input) => {
      assert.equal(input.mode, "mono");
      assert.equal(input.model, "test-model");
      assert.equal(input.signal?.aborted, false);
      assert.equal(path.dirname(input.imagePath), paths.uploadDir);
      return scene() as unknown as Record<string, unknown>;
    } });
    const response = await fetch(`${base}/api/reconstruct`, { method: "POST", body: await imageForm() });
    assert.equal(response.status, 200);
    const result = await response.json() as SceneResponse;
    assert.equal(result.scene.nodes.find((node) => node.id === "editable")?.type, "ellipse");
    assert.ok(result.scene.metadata.notes.includes("Reconstruction mode: mono."));
    assert.deepEqual(await (await fetch(`${base}${result.sceneUrl}`)).json(), result.scene);
    assert.equal((await fs.readdir(paths.uploadDir)).length, 1);
  });

  it("uses the injected configuration root when the real model client calls a local fixture gateway", { timeout: 3000 }, async () => {
    const requests: Array<{ url?: string; authorization?: string; model: string }> = [];
    const gateway = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { model: string };
      requests.push({ url: req.url, authorization: req.headers.authorization, model: body.model });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ output_text: JSON.stringify(scene()) }));
    }).listen(0, "127.0.0.1");
    servers.push(gateway);
    await new Promise<void>((resolve) => gateway.once("listening", resolve));
    const gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}/v1`;
    writePersistedConfig({ apiKey: "fixture-local-key", baseUrl: gatewayUrl, reconstructModel: "stored-model" }, paths.configPath);
    const base = await start({ reconstruct: undefined });
    const form = await imageForm();
    form.delete("model");
    const response = await fetch(`${base}/api/reconstruct`, { method: "POST", body: form });
    assert.equal(response.status, 200);
    assert.deepEqual(requests, [{ url: "/v1/responses", authorization: "Bearer fixture-local-key", model: "stored-model" }]);
    assert.equal((await response.json() as SceneResponse).scene.nodes.find((node) => node.id === "editable")?.type, "ellipse");
  });

  it("returns model errors with the existing envelope and removes uploaded artifacts", async () => {
    const base = await start({ reconstruct: async () => { throw new ReconstructError("UPSTREAM", "private upstream payload"); } });
    const response = await fetch(`${base}/api/reconstruct`, { method: "POST", body: await imageForm() });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: { code: "UPSTREAM", message: "Model service returned an error." } });
    assert.deepEqual(await fs.readdir(paths.uploadDir), []);
    assert.deepEqual(await fs.readdir(paths.sceneDir), []);
  });

  for (const mergeMode of ["replace", "overlay"] as const) {
    it(`merges a ${mergeMode} regional reconstruction and always removes the crop`, async () => {
      const sourceUrl = "/uploads/original.png";
      await fs.writeFile(path.join(paths.uploadDir, "original.png"), await imageBytes());
      let cropPath = "";
      const base = await start({ reconstruct: async (input) => {
        cropPath = input.imagePath;
        assert.equal((await sharp(cropPath).metadata()).width, 32);
        return scene("region") as unknown as Record<string, unknown>;
      } });
      const response = await postJson(base, "reconstruct-region", { scene: scene("existing", sourceUrl), region: { x: 0, y: 0, w: 32, h: 32 }, mergeMode });
      assert.equal(response.status, 200);
      const result = await response.json() as SceneResponse;
      assert.equal(result.sourceUrl, sourceUrl);
      assert.equal(result.sceneUrl, "/api/scenes/existing");
      assert.equal(result.scene.nodes.some((node) => node.id === "editable"), mergeMode === "overlay");
      assert.equal(await fs.stat(cropPath).catch(() => undefined), undefined);
      assert.deepEqual(await fs.readdir(paths.uploadDir), ["original.png"]);
      assert.deepEqual(await (await fetch(`${base}${result.sceneUrl}`)).json(), result.scene);
    });
  }

  it("embeds local assets from the injected root in SVG and PPTX exports", async () => {
    const bytes = await imageBytes();
    await fs.writeFile(path.join(paths.uploadDir, "export-image.png"), bytes);
    const value = scene();
    value.nodes.unshift({ id: "source", type: "image", x: 0, y: 0, w: 64, h: 64, source: "/uploads/export-image.png", style: {} });
    const base = await start();
    const svg = await postJson(base, "export/svg", { scene: value });
    assert.equal(svg.status, 200);
    assert.match(svg.headers.get("content-disposition") ?? "", /filename\*=UTF-8''%E7%A0%94%E7%A9%B6%E5%9B%BE.svg/);
    assert.ok((await svg.text()).includes(`data:image/png;base64,${bytes.toString("base64")}`));
    const pptx = await postJson(base, "export/pptx", { scene: value });
    assert.equal(pptx.status, 200);
    const archive = Buffer.from(await pptx.arrayBuffer());
    assert.equal(archive.subarray(0, 2).toString(), "PK");
    assert.ok(archive.includes(Buffer.from("ppt/media/image-")));
    const json = await postJson(base, "export/json", { scene: value });
    assert.equal(json.status, 200);
    assert.deepEqual(await json.json(), value);
    assert.equal((await postJson(base, "export/toString", { scene: value })).status, 404);
  });
});

describe("cancellation and failed file operations", () => {
  it("propagates a real client disconnect to the runner and cleans the upload", { timeout: 3000 }, async () => {
    let started!: () => void;
    let cancelled!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const didCancel = new Promise<void>((resolve) => { cancelled = resolve; });
    const base = await start({ reconstruct: async (input) => new Promise<never>((_resolve, reject) => {
      input.signal!.addEventListener("abort", () => { cancelled(); reject(input.signal!.reason); }, { once: true });
      started();
    }) });
    const controller = new AbortController();
    const response = fetch(`${base}/api/reconstruct`, { method: "POST", body: await imageForm(), signal: controller.signal });
    const rejected = assert.rejects(response, { name: "AbortError" });
    await didStart;
    controller.abort();
    await Promise.all([rejected, didCancel]);
    await waitFor(async () => (await fs.readdir(paths.uploadDir)).length === 0);
    assert.deepEqual(await fs.readdir(paths.sceneDir), []);
  });

  it("rejects late completion from a runner that ignores cancellation before persistence", async () => {
    const inputPath = path.join(paths.uploadDir, "input.upload.tmp");
    await fs.writeFile(inputPath, await imageBytes());
    const controller = new AbortController();
    const services = createServices(options({ reconstruct: async () => {
      controller.abort();
      return scene() as unknown as Record<string, unknown>;
    } }));
    await assert.rejects(services.reconstruction.reconstruct({ path: inputPath, mimetype: "image/png", originalname: "image.png" }, {}, controller.signal), { name: "AbortError" });
    assert.deepEqual(await fs.readdir(paths.uploadDir), []);
    assert.deepEqual(await fs.readdir(paths.sceneDir), []);
  });

  it("propagates regional disconnects and retains the original document and source", { timeout: 3000 }, async () => {
    const original = scene("existing", "/uploads/original.png");
    await fs.writeFile(path.join(paths.uploadDir, "original.png"), await imageBytes());
    await createSceneStore(paths).save("existing", original);
    let started!: () => void;
    let cancelled!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const didCancel = new Promise<void>((resolve) => { cancelled = resolve; });
    const base = await start({ reconstruct: async (input) => new Promise<never>((_resolve, reject) => {
      input.signal!.addEventListener("abort", () => { cancelled(); reject(input.signal!.reason); }, { once: true });
      started();
    }) });
    const controller = new AbortController();
    const response = fetch(`${base}/api/reconstruct-region`, {
      method: "POST", signal: controller.signal, headers: { "content-type": "application/json" },
      body: JSON.stringify({ scene: original, region: { x: 0, y: 0, w: 32, h: 32 } })
    });
    const rejected = assert.rejects(response, { name: "AbortError" });
    await didStart;
    controller.abort();
    await Promise.all([rejected, didCancel]);
    await waitFor(async () => (await fs.readdir(paths.uploadDir)).length === 1);
    assert.deepEqual(await fs.readdir(paths.uploadDir), ["original.png"]);
    assert.deepEqual(await createSceneStore(paths).read("existing"), original);
  });

  it("preserves an existing scene and removes partial temp files after write or rename failure", async () => {
    const original = scene("existing");
    await createSceneStore(paths).save("existing", original);
    for (const operation of ["write", "rename"]) {
      const files: SceneFileSystem = {
        ...fs,
        writeFile: async (file, data, encoding) => {
          if (operation === "write") {
            await fs.writeFile(file, "partial");
            throw new Error("injected write failure");
          }
          await fs.writeFile(file, data, encoding);
        },
        rename: async () => { throw new Error("injected rename failure"); }
      };
      await assert.rejects(createSceneStore(paths, files).save("existing", scene("changed")), /injected/);
      assert.deepEqual(await createSceneStore(paths).read("existing"), original);
      assert.deepEqual(await fs.readdir(paths.sceneDir), ["existing.scene.json"]);
    }
  });

  it("cleans a renamed upload when scene persistence fails", async () => {
    const base = await start({ files: { ...fs, writeFile: async (file) => {
      await fs.writeFile(file, "partial");
      throw new Error("injected persistence failure");
    } } });
    const response = await fetch(`${base}/api/analyze`, { method: "POST", body: await imageForm() });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Internal server error." });
    assert.deepEqual(await fs.readdir(paths.uploadDir), []);
    assert.deepEqual(await fs.readdir(paths.sceneDir), []);
  });

  it("cleans the upload temporary file when moving it fails", async () => {
    const base = await start({ files: { ...fs, rename: async () => { throw new Error("injected upload rename failure"); } } });
    const response = await fetch(`${base}/api/analyze`, { method: "POST", body: await imageForm() });
    assert.equal(response.status, 500);
    assert.deepEqual(await fs.readdir(paths.uploadDir), []);
    assert.deepEqual(await fs.readdir(paths.sceneDir), []);
  });

  it("keeps the original scene and image when a regional model request fails", async () => {
    const original = scene("existing", "/uploads/original.png");
    await fs.writeFile(path.join(paths.uploadDir, "original.png"), await imageBytes());
    await createSceneStore(paths).save("existing", original);
    const base = await start({ reconstruct: async () => { throw new ReconstructError("TIMEOUT", "test timeout"); } });
    const response = await postJson(base, "reconstruct-region", { scene: original, region: { x: 0, y: 0, w: 32, h: 32 } });
    assert.equal(response.status, 504);
    assert.deepEqual(await fs.readdir(paths.uploadDir), ["original.png"]);
    assert.deepEqual(await createSceneStore(paths).read("existing"), original);
  });

  it("removes the region crop and preserves the saved scene if publishing the new scene fails", async () => {
    const original = scene("existing", "/uploads/original.png");
    await fs.writeFile(path.join(paths.uploadDir, "original.png"), await imageBytes());
    await createSceneStore(paths).save("existing", original);
    const base = await start({ files: { ...fs, rename: async () => { throw new Error("injected publish failure"); } } });
    const response = await postJson(base, "reconstruct-region", { scene: original, region: { x: 0, y: 0, w: 32, h: 32 } });
    assert.equal(response.status, 500);
    assert.deepEqual(await fs.readdir(paths.uploadDir), ["original.png"]);
    assert.deepEqual(await fs.readdir(paths.sceneDir), ["existing.scene.json"]);
    assert.deepEqual(await createSceneStore(paths).read("existing"), original);
  });
});

describe("configuration service boundaries", () => {
  it("persists in the chosen root, prevents saved-key reuse at another endpoint, and supports env fallback", async () => {
    let modelCalls = 0;
    const base = await start({
      env: { OPENAI_API_KEY: "fixture-env", OPENAI_BASE_URL: "https://env.example/v1", OPENAI_RECONSTRUCT_MODEL: "env-model" },
      fetchModels: async () => { modelCalls += 1; return { models: [], error: null, status: 200 }; }
    });
    const input = { apiKey: "fixture-saved", baseUrl: "https://saved.example/v1", reconstructModel: "saved-model" };
    assert.equal((await postJson(base, "config", input)).status, 200);
    assert.equal(readPersistedConfig(paths.configPath)?.apiKey, input.apiKey);
    const unchangedEndpoint = await postJson(base, "config", { ...input, apiKey: "", reconstructModel: "next-model" });
    assert.equal(unchangedEndpoint.status, 200);
    assert.equal((await unchangedEndpoint.json() as SafeAiProviderConfig).source, "file");
    const callsBefore = modelCalls;
    for (const route of ["config", "config/test"]) {
      const rejected = await postJson(base, route, { ...input, apiKey: "", baseUrl: "https://changed.example/v1" });
      assert.equal(rejected.status, 400);
    }
    assert.equal(modelCalls, callsBefore);
    const test = await postJson(base, "config/test", { ...input, reconstructModel: "unsaved" });
    assert.equal(test.status, 200);
    assert.equal(readPersistedConfig(paths.configPath)?.reconstructModel, "next-model");
    const deleted = await fetch(`${base}/api/config`, { method: "DELETE" });
    const fallback = await deleted.json() as SafeAiProviderConfig;
    assert.equal(fallback.source, "env");
    assert.equal(fallback.reconstructModel, "env-model");
    assert.equal(readPersistedConfig(paths.configPath), null);
  });

  it("removes the configuration temporary file after a failed atomic rename", async () => {
    await fs.mkdir(paths.configPath);
    const base = await start();
    const response = await postJson(base, "config", { apiKey: "fixture-key", baseUrl: "https://fixture.example/v1", reconstructModel: "fixture" });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Failed to persist config." });
    assert.equal(await fs.stat(`${paths.configPath}.tmp`).catch(() => undefined), undefined);
    assert.equal((await fs.stat(paths.configPath)).isDirectory(), true);
  });
});
