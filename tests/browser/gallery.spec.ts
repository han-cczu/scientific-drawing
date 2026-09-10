import { expect, test } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { renderRefactorGallery } from "../../scripts/render-refactor-gallery";

test("renders the complete fixture in Canvas and the production SVG exporter", async ({ page }, testInfo) => {
  // Isolate generated files from the simultaneous PowerPoint acceptance check.
  const artifacts = await renderRefactorGallery("data/evaluation/refactor-gallery-browser");
  const image = await readFile(artifacts.imagePath);
  const svg = await readFile(artifacts.svgPath, "utf8");
  const outputDir = path.resolve("data/evaluation/refactor-browser");
  await mkdir(outputDir, { recursive: true });
  const runtimeErrors: string[] = [];
  page.on("pageerror", error => runtimeErrors.push(error.message));
  await page.setViewportSize({ width: 1900, height: 1250 });
  await page.addInitScript(() => {
    localStorage.setItem("sciDraw.onboarding", JSON.stringify({ version: 1, seenAt: 1 }));
  });
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    if (new URL(route.request().url()).pathname !== "/api/config") return route.abort();
    await route.fulfill({ json: {
      aiReconstructionAvailable: true, provider: "openai-compatible", baseUrl: "https://mock.invalid/v1",
      reconstructModel: "test-model", reconstructModels: ["test-model"], modelListAvailable: true,
      modelListError: null, hasApiKey: true, source: "env", maskedTail: "test"
    } });
  });
  await page.route("**/uploads/refactor-gallery-source.png", route => route.fulfill({ contentType: "image/png", body: image }));
  await page.goto("/");
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  const imageLoaded = page.waitForResponse(response => response.url().endsWith("/uploads/refactor-gallery-source.png"));
  await page.locator('input[accept="application/json,.json"]').setInputFiles(artifacts.fixturePath);
  await imageLoaded;
  await expect(page.locator(".scene-canvas .node")).toHaveCount(artifacts.nodeCount);
  await expect(page.getByRole("status")).toContainText(`已导入 ${artifacts.nodeCount} 个节点和 ${artifacts.edgeCount} 条连线`);
  await expect(page.locator(".scene-canvas image")).toHaveCount(1);
  await expect(page.locator(".scene-canvas")).toContainText("全图元重构验收");
  await expect(page.locator(".scene-canvas")).toContainText("中文 English");
  await expect(page.locator(".scene-canvas text").filter({ hasText: "固定夹具：" })).toHaveAttribute("fill", "#111111");
  await page.locator(".scene-canvas").screenshot({ path: path.join(outputDir, "gallery-canvas.png") });

  // Serve the actual exporter bytes, not a hand-authored/mock SVG response.
  await page.route("**/__refactor_gallery.svg", route => route.fulfill({ contentType: "image/svg+xml", body: svg }));
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto("/__refactor_gallery.svg");
  await expect(page.locator("svg")).toHaveAttribute("viewBox", "0 0 1280 850");
  await expect(page.locator("svg image")).toHaveAttribute("href", /^data:image\/png;base64,/);
  await expect(page.locator("svg")).toContainText("全图元重构验收");
  await expect(page.locator("svg")).toContainText("中文 English");
  await expect(page.locator("svg text#footer")).toHaveAttribute("fill", "#111111");
  await page.locator("svg").screenshot({ path: path.join(outputDir, "gallery-svg.png") });
  await testInfo.attach("gallery-canvas", { path: path.join(outputDir, "gallery-canvas.png"), contentType: "image/png" });
  await testInfo.attach("gallery-svg", { path: path.join(outputDir, "gallery-svg.png"), contentType: "image/png" });
  expect(runtimeErrors).toEqual([]);
});
