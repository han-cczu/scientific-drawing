import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Scene } from "../../src/shared/scene";
import type { AppConfig } from "../../src/shared/apiContracts";

const SCENE_KEY = "sciDraw.scene";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZpUAAAAASUVORK5CYII=";
const config: AppConfig = {
  aiReconstructionAvailable: true, provider: "openai-compatible", baseUrl: "https://mock.invalid/v1",
  reconstructModel: "test-model", reconstructModels: ["test-model"], modelListAvailable: true,
  modelListError: null, hasApiKey: true, source: "env", maskedTail: "test"
};

function scene(id = "browser-fixture", label = "Alpha"): Scene {
  return {
    version: "0.1",
    page: { width: 640, height: 400, background: "#FFFFFF", units: "px" },
    metadata: { id, title: "Browser regression", sourceImage: `data:image/png;base64,${PNG}`, createdAt: "2026-01-01T00:00:00.000Z", engine: "test", notes: [] },
    nodes: [
      { id: "alpha", type: "rect", x: 80, y: 100, w: 100, h: 60, text: label, style: { fill: "#DBEAFE", stroke: "#2563EB", strokeWidth: 2, color: "#111111", fontSize: 16 } },
      { id: "beta", type: "ellipse", x: 300, y: 180, w: 90, h: 60, text: "Beta", style: { fill: "#FEF3C7", stroke: "#D97706", strokeWidth: 2 } }
    ],
    edges: [{ id: "edge", type: "arrow", from: "alpha:right@0.5", to: "beta:left@0.5", style: { stroke: "#475569", strokeWidth: 2 } }]
  };
}

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(({ initial, key }) => {
    localStorage.setItem("sciDraw.onboarding", JSON.stringify({ version: 1, seenAt: 1 }));
    // Refresh exercises the user's saved document instead of reseeding the fixture.
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, scene: initial, savedAt: 1 }));
  }, { initial: scene(), key: SCENE_KEY });
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    if (new URL(route.request().url()).pathname === "/api/config") await route.fulfill({ json: config });
    else await route.fulfill({ status: 500, json: { error: "Unexpected API call in browser test" } });
  });
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), "Browser must not produce uncaught runtime errors").toEqual([]);
});

async function openEditor(page: Page) {
  await page.goto("/");
  await expect(page.locator(".scene-canvas .node")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "局部 AI 重建", exact: true })).toBeEnabled();
}
const node = (page: Page, index = 0) => page.locator(".scene-canvas .node").nth(index);
const alphaRect = (page: Page) => node(page).locator("rect").first();
const undo = (page: Page) => page.getByTitle("撤销", { exact: true });

async function selectBoth(page: Page) {
  await node(page).click();
  await node(page, 1).click({ modifiers: ["Shift"] });
  await expect(page.locator(".layer-row.selected")).toHaveCount(2);
}
async function drag(page: Page, target: Locator, dx: number, dy: number) {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error("Drag target has no visible bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
}
async function readStored(page: Page): Promise<Scene> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!).scene as Scene, SCENE_KEY);
}
async function importJson(page: Page, value: unknown) {
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.locator('input[accept="application/json,.json"]').setInputFiles({ name: "fixture.scene.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
}
const imageFile = () => ({ name: "figure.png", mimeType: "image/png", buffer: Buffer.from(PNG, "base64") });
async function fulfillScene(route: Route, result: Scene) {
  await route.fulfill({ json: { scene: result, sceneUrl: `/api/scenes/${result.metadata.id}`, sourceUrl: result.metadata.sourceImage } });
}

test("multi-selection locking is one undo transaction", async ({ page }) => {
  await openEditor(page);
  await selectBoth(page);
  await page.getByRole("toolbar", { name: "选中节点操作" }).getByRole("button", { name: "锁定", exact: true }).click();
  await expect(page.locator(".scene-canvas .node.locked")).toHaveCount(2);
  await undo(page).click();
  await expect(page.locator(".scene-canvas .node.locked")).toHaveCount(0);
  await expect(undo(page)).toBeDisabled();
});

test("drag and resize each undo to the complete starting geometry", async ({ page }) => {
  await openEditor(page);
  await drag(page, node(page), 60, 30);
  await expect(alphaRect(page)).not.toHaveAttribute("x", "80");
  await expect(alphaRect(page)).not.toHaveAttribute("y", "100");
  await undo(page).click();
  await expect(alphaRect(page)).toHaveAttribute("x", "80");
  await expect(alphaRect(page)).toHaveAttribute("y", "100");
  await expect(undo(page)).toBeDisabled();
  await node(page).click();
  await drag(page, node(page).locator(".resize-handle").nth(4), 55, 35);
  await expect(alphaRect(page)).not.toHaveAttribute("width", "100");
  await expect(alphaRect(page)).not.toHaveAttribute("height", "60");
  await undo(page).click();
  await expect(alphaRect(page)).toHaveAttribute("width", "100");
  await expect(alphaRect(page)).toHaveAttribute("height", "60");
  await expect(undo(page)).toBeDisabled();
});

for (const gesture of ["drag", "resize"] as const) {
  test(`undo invalidates an in-flight ${gesture} and preserves redo`, async ({ page }) => {
    await openEditor(page);
    await node(page).click();
    const target = gesture === "drag" ? node(page) : node(page).locator(".resize-handle").nth(4);
    const attribute = gesture === "drag" ? "x" : "width";
    const baseline = gesture === "drag" ? "80" : "100";
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error("Gesture target has no visible bounds");
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 60, start.y + 30, { steps: 8 });
    await expect(alphaRect(page)).not.toHaveAttribute(attribute, baseline);
    const preview = await alphaRect(page).getAttribute(attribute);
    expect(preview).not.toBeNull();
    await page.keyboard.press("Control+z");
    await expect(alphaRect(page)).toHaveAttribute(attribute, baseline);
    await page.mouse.move(start.x + 100, start.y + 70, { steps: 5 });
    await page.mouse.up();
    await expect(alphaRect(page)).toHaveAttribute(attribute, baseline);
    await expect(page.getByTitle("重做", { exact: true })).toBeEnabled();
    await page.keyboard.press("Control+Shift+z");
    await expect(alphaRect(page)).toHaveAttribute(attribute, preview!);
    await expect(page.getByTitle("重做", { exact: true })).toBeDisabled();
  });
}

test("properties, style and batch alignment update visible geometry with undo", async ({ page }) => {
  await openEditor(page);
  await node(page).click();
  await page.getByLabel("X", { exact: true }).fill("120");
  await expect(alphaRect(page)).toHaveAttribute("x", "120");
  await page.getByRole("tab", { name: "样式", exact: true }).click();
  await page.getByLabel("描边线宽", { exact: true }).fill("5");
  await expect(alphaRect(page)).toHaveAttribute("stroke-width", "5");
  await undo(page).click();
  await expect(alphaRect(page)).toHaveAttribute("stroke-width", "2");
  await selectBoth(page);
  await page.getByRole("tab", { name: "排列", exact: true }).click();
  await page.getByTitle("左对齐", { exact: true }).click();
  await expect(node(page, 1).locator("ellipse")).toHaveAttribute("cx", "165");
  await undo(page).click();
  await expect(node(page, 1).locator("ellipse")).toHaveAttribute("cx", "345");
  await expect(alphaRect(page)).toHaveAttribute("x", "120");
});

test("primary selection targets its own properties and selected layers move as a group", async ({ page }) => {
  await openEditor(page);
  const expanded = scene();
  expanded.nodes.push({ id: "gamma", type: "rect", x: 450, y: 80, w: 80, h: 50, text: "Gamma", style: { fill: "#DCFCE7" } });
  await importJson(page, expanded);
  await expect(page.locator(".scene-canvas .node")).toHaveCount(3);
  await node(page, 1).click();
  await node(page, 0).click({ modifiers: ["Shift"] });
  await expect(page.locator(".layer-row.selected")).toHaveCount(2);
  await expect(page.locator(".node-id")).toHaveText("ellipse · beta");
  await page.getByLabel("X", { exact: true }).fill("330");
  await expect(node(page, 1).locator("ellipse")).toHaveAttribute("cx", "375");
  await expect(alphaRect(page)).toHaveAttribute("x", "80");
  await page.getByRole("tab", { name: "排列", exact: true }).click();
  await page.getByRole("tabpanel").getByRole("button", { name: "上移", exact: true }).click();
  const order = () => page.locator(".layers-list .layer-main").evaluateAll(elements => elements.map(element => element.getAttribute("title")));
  await expect.poll(order).toEqual(["beta", "alpha", "gamma"]);
  await undo(page).click();
  await expect.poll(order).toEqual(["gamma", "beta", "alpha"]);
});

test("native import replaces the scene and invalid import preserves it", async ({ page }) => {
  await openEditor(page);
  await importJson(page, scene("imported", "Imported"));
  await expect(page.getByRole("status")).toContainText("已导入 2 个节点");
  await expect(node(page).locator("text")).toHaveText("Imported");
  await expect.poll(async () => (await readStored(page)).metadata.id).toBe("imported");
  await importJson(page, { ...scene("invalid", "Must not appear"), version: "9.9" });
  await expect(page.getByRole("status")).toContainText("Unsupported scene version");
  await expect(node(page).locator("text")).toHaveText("Imported");
  await expect(undo(page)).toBeDisabled();
  expect((await readStored(page)).metadata.id).toBe("imported");
});

test("pending AI blocks editing, permits zoom, and cancellation isolates the next request", async ({ page }) => {
  const pending: Route[] = [];
  await page.route("**/api/reconstruct", route => { pending.push(route); });
  await openEditor(page);
  await node(page).click();
  await page.getByLabel("X", { exact: true }).fill("95");
  await node(page).click();
  await expect(undo(page)).toBeEnabled();
  await page.locator('.bottom-drawer input[type="file"]').setInputFiles(imageFile());
  await expect.poll(() => pending.length).toBe(1);
  await expect(page.getByRole("status")).toContainText("正在调用 AI");
  await expect(page.getByLabel("X", { exact: true })).toBeDisabled();
  await expect(page.getByTitle("点击画布添加矩形", { exact: true })).toBeDisabled();
  await expect(undo(page)).toBeDisabled();
  await expect(page.getByTitle("隐藏", { exact: true }).first()).toBeDisabled();
  await expect(page.getByRole("toolbar", { name: "选中节点操作" }).getByRole("button", { name: "删除", exact: true })).toBeDisabled();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Control+d");
  await page.keyboard.press("Control+z");
  await drag(page, node(page), 40, 20);
  await expect(alphaRect(page)).toHaveAttribute("x", "95");
  await expect(page.locator(".scene-canvas .node")).toHaveCount(2);
  await page.getByTitle("放大", { exact: true }).click();
  await expect(page.locator(".zoom-value")).not.toHaveText("100%");
  await page.locator(".status-cancel").click();
  await expect(page.getByRole("status")).toContainText("已取消");
  await page.locator('.bottom-drawer input[type="file"]').setInputFiles(imageFile());
  await expect.poll(() => pending.length).toBe(2);
  await fulfillScene(pending[1], scene("new-result", "Fresh result"));
  await expect(node(page).locator("text")).toHaveText("Fresh result");
  // The old network request was aborted by the UI; fulfilling its route must have no effect.
  await fulfillScene(pending[0], scene("stale-result", "Stale result"));
  await expect.poll(async () => (await readStored(page)).metadata.id).toBe("new-result");
  await expect(node(page).locator("text")).toHaveText("Fresh result");
  await expect(page.getByRole("status")).toContainText("AI 重建完成");
});

test("autosave survives refresh and restores the edited document", async ({ page }) => {
  await openEditor(page);
  await node(page).click();
  await page.getByLabel("X", { exact: true }).fill("145");
  await expect(page.getByLabel("保存状态：未保存", { exact: true })).toBeVisible();
  await expect.poll(async () => (await readStored(page)).nodes[0].x).toBe(145);
  await expect(page.getByLabel("保存状态：已保存到本地", { exact: true })).toBeVisible();
  await page.reload();
  await expect(alphaRect(page)).toHaveAttribute("x", "145");
  await expect(page.getByLabel("保存状态：已恢复本地草稿", { exact: true })).toBeVisible();
});

test("storage quota failures keep edits visible without falsely marking them saved", async ({ page }) => {
  await openEditor(page);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name: string, value: string) {
      if (name === key) throw new DOMException("Storage full", "QuotaExceededError");
      original.call(this, name, value);
    };
  }, SCENE_KEY);
  await node(page).click();
  const failedSave = page.waitForEvent("console", message => message.type() === "warning" && message.text().includes("写入 localStorage 失败"));
  await page.getByLabel("X", { exact: true }).fill("175");
  await expect(alphaRect(page)).toHaveAttribute("x", "175");
  await failedSave;
  await expect(page.getByLabel("保存状态：未保存", { exact: true })).toBeVisible();
  expect((await readStored(page)).nodes[0].x).toBe(80);
});

test("JSON download sends the current edited scene and uses the response filename", async ({ page }) => {
  let exported: Scene | undefined;
  await page.route("**/api/export/json", async route => {
    exported = (route.request().postDataJSON() as { scene: Scene }).scene;
    await route.fulfill({
      contentType: "application/json",
      headers: { "Content-Disposition": 'attachment; filename="browser.scene.json"' },
      body: JSON.stringify(exported)
    });
  });
  await openEditor(page);
  await node(page).click();
  await page.getByLabel("X", { exact: true }).fill("123");
  await page.getByTitle("导出", { exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("browser.scene.json");
  expect(exported?.nodes[0].x).toBe(123);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual(exported);
  await expect(page.getByRole("status")).toContainText("已下载 browser.scene.json");
});

test("pending configuration save disables its form and close actions until completion", async ({ page }) => {
  const pending: Route[] = [];
  await page.route("**/api/config", async route => {
    if (route.request().method() === "POST") pending.push(route);
    else await route.fulfill({ json: config });
  });
  await openEditor(page);
  await page.getByRole("button", { name: "AI 设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "AI 配置", exact: true });
  await dialog.locator('input[type="password"]').fill("mock-browser-secret");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => pending.length).toBe(1);
  await expect(dialog.locator('input[type="password"]')).toBeDisabled();
  await expect(dialog.locator('input[type="url"]')).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "测试连接", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await pending[0].fulfill({ json: { ...config, source: "file" } });
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText("AI 配置已更新");
  expect(pending).toHaveLength(1);
});

test("captures editor, settings, narrow layout and region confirmation", async ({ page }, testInfo) => {
  const reviewDir = path.resolve("data/evaluation/refactor-browser");
  await mkdir(reviewDir, { recursive: true });
  const capture = async (name: string) => {
    const output = path.join(reviewDir, `${name}.png`);
    await page.screenshot({ path: output, fullPage: true });
    await testInfo.attach(name, { path: output, contentType: "image/png" });
  };
  await openEditor(page);
  const thumbnail = await page.locator(".thumbnail-rail").boundingBox();
  const tabs = await page.locator(".canvas-view-tabs").boundingBox();
  const status = await page.locator(".canvas-status").boundingBox();
  expect(thumbnail).not.toBeNull();
  expect(tabs).not.toBeNull();
  expect(status).not.toBeNull();
  if (!thumbnail || !tabs || !status) throw new Error("Missing canvas viewing controls");
  expect(thumbnail.y).toBeGreaterThanOrEqual(tabs.y + tabs.height);
  expect(thumbnail.y).toBeGreaterThanOrEqual(status.y + status.height);
  await node(page).click();
  await capture("editor");
  await page.getByRole("button", { name: "AI 设置", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "AI 配置", exact: true })).toBeVisible();
  await capture("settings");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.setViewportSize({ width: 980, height: 900 });
  await capture("narrow");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "局部 AI 重建", exact: true }).click();
  const canvas = await page.locator(".scene-canvas").boundingBox();
  expect(canvas).not.toBeNull();
  if (!canvas) return;
  await page.mouse.move(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * 0.9, canvas.y + canvas.height * 0.7, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "局部 AI 重建方式", exact: true })).toBeVisible();
  await capture("region");
});
