import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { apiRouter } from "../server/src/routes/api";
import { httpErrorHandler } from "../server/src/httpErrorHandler";

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
  const app = express();
  app.use("/api", apiRouter);
  app.use(httpErrorHandler);
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
