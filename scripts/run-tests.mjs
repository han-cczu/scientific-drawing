import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function findTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return findTests(file);
    return entry.isFile() && entry.name.endsWith(".test.ts") ? [file] : [];
  }));
  return nested.flat().sort();
}

const files = await findTests(path.join(rootDir, "tests"));
if (files.length === 0) throw new Error("No .test.ts files discovered; refusing an empty test run.");
const child = spawn(process.execPath, ["--import", "tsx", "--test", ...files], {
  cwd: rootDir, stdio: "inherit", env: process.env
});
child.once("error", (error) => { console.error(error); process.exitCode = 1; });
child.once("exit", (code) => { process.exitCode = code ?? 1; });
