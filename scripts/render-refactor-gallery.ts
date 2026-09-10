import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createDataPaths, resolveLocalAssetPath } from "../server/src/paths";
import { sceneToSvg } from "../server/src/scene/svg";
import { sceneToPptx } from "../server/src/scene/pptx";
import { validateScene } from "../src/shared/sceneValidation";
import type { Scene } from "../src/shared/scene";

/** Reproducible acceptance artifacts; no calls to a model or production storage. */
export async function renderRefactorGallery(output = "data/evaluation/refactor-gallery") {
  const fixturePath = fileURLToPath(new URL("../tests/fixtures/refactor-gallery.scene.json", import.meta.url));
  const scene = JSON.parse(await fs.readFile(fixturePath, "utf-8")) as Scene;
  assert.deepEqual(validateScene(scene), { ok: true, issues: [] });
  const nodeTypes = [...new Set(scene.nodes.map(node => node.type))].sort();
  assert.equal(nodeTypes.length, 11);
  const outputDir = path.resolve(output);
  const assets = path.join(outputDir, "assets");
  await fs.mkdir(assets, { recursive: true });
  const imagePath = path.join(assets, "refactor-gallery-source.png");
  const pixels = Buffer.alloc(300 * 180 * 3);
  const palette = [[37, 99, 235], [22, 163, 74], [217, 119, 6], [124, 58, 237], [219, 234, 254], [241, 245, 249]];
  for (let y = 0; y < 180; y += 1) {
    for (let x = 0; x < 300; x += 1) {
      const color = palette[(Math.floor(x / 50) + Math.floor(y / 45)) % palette.length];
      for (let channel = 0; channel < 3; channel += 1) pixels[(y * 300 + x) * 3 + channel] = color[channel];
    }
  }
  await sharp(pixels, { raw: { width: 300, height: 180, channels: 3 } }).png().toFile(imagePath);
  // Bind the controlled /uploads namespace to this artifact's asset directory.
  const paths = { ...createDataPaths(outputDir), uploadDir: assets };
  const resolver = (source: unknown) => resolveLocalAssetPath(source, paths);
  const svg = await sceneToSvg(scene, resolver);
  const pptx = await sceneToPptx(scene, resolver);
  const svgPath = path.join(outputDir, "refactor-gallery.svg");
  const pptxPath = path.join(outputDir, "refactor-gallery.pptx");
  await fs.writeFile(svgPath, svg);
  await fs.writeFile(pptxPath, pptx);
  const result = { fixturePath, outputDir, imagePath, svgPath, pptxPath, nodeTypes, nodeCount: scene.nodes.length, edgeCount: scene.edges.length };
  await fs.writeFile(path.join(outputDir, "artifacts.json"), JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await renderRefactorGallery(), null, 2));
}
