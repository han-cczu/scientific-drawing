import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it, type TestContext } from "node:test";
import { checkBoundaries } from "../../scripts/check-boundaries.mjs";

async function projectFixture(t: TestContext, files: Record<string, string>) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-boundaries-"));
  t.after(async () => {
    const target = path.resolve(rootDir);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith("drawing-boundaries-"));
    await fs.rm(target, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(rootDir, "tsconfig.json"), JSON.stringify({
    compilerOptions: { baseUrl: ".", paths: { "@io/*": ["src/lib/*"], "@shared/*": ["src/shared/*"], "@ui/*": ["src/editor/*"] } },
    files: []
  }));
  for (const [relativeFile, source] of Object.entries(files)) {
    const file = path.join(rootDir, relativeFile);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, source);
  }
  return rootDir;
}

it("resolves aliases and rejects forbidden imports, exports, import types and dynamic imports", async (t) => {
  const rootDir = await projectFixture(t, {
    "src/shared/invalid.ts": [
      'import fs from "node:fs";',
      'export { value } from "@io/api";',
      'type Panel = import("@ui/panel").Panel;',
      'const browser = import("../lib/api");'
    ].join("\n"),
    "src/lib/api.ts": "export const value = 1;",
    "src/editor/panel.tsx": "export type Panel = {};",
    "server/src/services/invalid.ts": 'export { value } from "../routes/api";',
    "server/src/routes/api.ts": "export const value = 1;",
    "src/editor/model/invalid.ts": 'import { value } from "@io/api"; import React from "react";'
  });
  const violations = checkBoundaries(rootDir);
  assert.equal(violations.length, 7);
  assert.deepEqual(violations.filter((issue) => issue.file === "src/shared/invalid.ts").map((issue) => issue.line), [1, 2, 3, 4]);
  assert.ok(violations.some((issue) => issue.file === "server/src/services/invalid.ts"));
  assert.equal(violations.filter((issue) => issue.file === "src/editor/model/invalid.ts").length, 2);
});

it("allows pure shared dependencies and ignores import-looking text and comments", async (t) => {
  const rootDir = await projectFixture(t, {
    "src/shared/geometry.ts": "export const value = 1;",
    "src/shared/valid.ts": 'import { value } from "@shared/geometry"; const text = \'import fs from "node:fs";\'; // import React from "react"',
    "src/editor/model/valid.ts": 'import { value } from "@shared/geometry";'
  });
  assert.deepEqual(checkBoundaries(rootDir), []);
});

it("fails when a protected layer contains an unresolved or computed local import", async (t) => {
  const rootDir = await projectFixture(t, {
    "src/shared/invalid.ts": 'import { value } from "./missing"; const target = "./geometry"; import(target);'
  });
  const violations = checkBoundaries(rootDir);
  assert.equal(violations.length, 2);
  assert.ok(violations.some((issue) => issue.message.startsWith("Unresolved")));
  assert.ok(violations.some((issue) => issue.message.startsWith("Computed")));
});
