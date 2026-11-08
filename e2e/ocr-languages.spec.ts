import { expect, test } from "@playwright/test";
import path from "node:path";
import fixtures from "./fixtures/languages/manifest.json" with { type: "json" };
import manifest from "../src/config/ocr-languages.json" with { type: "json" };
import AxeBuilder from "@axe-core/playwright";

test("download languages before adding an image, show readiness, retry failure and recognise offline", async ({ page, context, baseURL }) => {
  const requests: string[] = [];
  context.on("request", request => requests.push(request.url()));
  const english = manifest.models.find(model => model.id === "eng")!;
  const spanish = manifest.models.find(model => model.id === "spa")!;
  await page.goto("/");
  await page.locator(".ocr-language-picker summary").click();
  const download = page.getByRole("button", { name: "Download selected languages", exact: true });
  const status = page.locator(".ocr-language-download [role=status]");
  const header = page.locator(".header-offline-status");
  await expect(download).toBeEnabled();
  expect(requests.filter(url => new URL(url).pathname.includes("/ocr/lang/"))).toEqual([]);
  await download.click();
  await expect(header.locator("summary")).toHaveText("Image OCR offline: ready for English", { timeout: 30_000 });
  await page.getByRole("checkbox", { name: /^Spanish/ }).check();
  await expect(download).toBeEnabled();
  await expect(header.locator("summary")).toHaveText("Image OCR offline: ready for English");
  expect(requests.filter(url => new URL(url).pathname === spanish.path)).toEqual([]);

  // A failed download must remain retryable and cannot mark Spanish ready.
  await context.setOffline(true);
  await download.click();
  await expect(status).toContainText("The download could not finish");
  await expect(download).toBeEnabled();
  await expect(page.getByRole("checkbox", { name: /^Spanish/ })).toHaveAccessibleName(/download needed/);
  await expect(page.getByRole("checkbox", { name: /^English/ })).toHaveAccessibleName(/downloaded and cached/);
  await context.setOffline(false);

  // Hold the real model response so the in-progress state can be inspected.
  let releaseDownload!: () => void;
  const modelResponse = new Promise<void>(resolve => { releaseDownload = resolve; });
  await context.route(`**${spanish.path}`, async route => {
    await modelResponse;
    await route.continue();
  });
  await download.click();
  try {
    await expect(status).toContainText("Downloading and checking English, Spanish");
    await expect(header.locator("summary")).toHaveText("Image OCR offline: preparing English, Spanish…");
    await expect(page.getByRole("button", { name: "Downloading…", exact: true })).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: /^Spanish/ })).toBeDisabled();
    await header.locator("summary").click();
    await expect(header.locator("p")).toContainText("Downloaded and cached: English.");
  } finally {
    releaseDownload();
  }
  await expect(header.locator("summary")).toHaveText("Image OCR offline: ready for English, Spanish", { timeout: 30_000 });
  await expect(header.locator("p")).toContainText("Downloaded and cached in this browser: English, Spanish");
  await expect(status).toContainText("Ready for English, Spanish.");
  await expect(page.getByRole("button", { name: "Selected languages downloaded", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /^Spanish/ })).toHaveAccessibleName(/downloaded and cached/);
  const cached = await page.evaluate(async () => {
    const cache = await caches.open("localtext-ocr-v5");
    return (await cache.keys()).map(request => new URL(request.url).pathname).filter(path => path.includes("/lang/")).sort();
  });
  expect(cached).toEqual([english.path, spanish.path].sort());
  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/language-download-${width}.png`, fullPage: true });
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await context.setOffline(true);
  await page.reload();
  await page.locator(".ocr-language-picker summary").click();
  await page.getByRole("checkbox", { name: /^Spanish/ }).check();
  await expect(status).toContainText("Ready for English, Spanish.");
  await page.getByLabel("Choose image file", { exact: true }).setInputFiles(path.resolve("e2e/fixtures/languages/spa.png"));
  await expect(page.getByLabel("Tidied", { exact: true })).toHaveValue(/El texto permanece/);
  expect(requests.filter(url => new URL(url).origin !== new URL(baseURL!).origin)).toEqual([]);
});

for (const fixture of fixtures) {
  test(`${fixture.family} recognition, selected-only caching and offline reuse`, async ({ page, context, baseURL }) => {
    // Thai's word segmentation may insert spaces within this phrase. Assert
    // every known character in order, while preserving raw output in the UI.
    const expected = fixture.id === "tha"
      ? new RegExp([...fixture.text].join("\\s*"))
      : new RegExp(fixture.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const requests: string[] = [];
    context.on("request", request => requests.push(request.url()));
    await page.goto("/");
    await page.locator(".ocr-language-picker summary").click();
    const model = manifest.models.find(model => model.id === fixture.id)!;
    await page.getByRole("checkbox", { name: model.label }).check();
    await page.getByRole("checkbox", { name: /^English/ }).uncheck();
    await page.getByLabel("Choose image file", { exact: true }).setInputFiles(path.resolve(`e2e/fixtures/languages/${fixture.id}.png`));
    await expect(page.getByLabel("Tidied", { exact: true })).toHaveValue(expected, { timeout: 30_000 });
    await expect(page.locator(".trust-markers .offline-readiness")).toHaveText(`Offline: ready for ${model.label}`, { timeout: 30_000 });
    const cached = await page.evaluate(async () => {
      const cache = await caches.open("localtext-ocr-v5");
      return (await cache.keys()).map(request => new URL(request.url).pathname).filter(path => path.includes("/lang/"));
    });
    expect(cached).toEqual([model.path]);
    expect(requests.filter(url => new URL(url).pathname.includes("/ocr/lang/"))).toEqual(expect.arrayContaining([new URL(model.path, baseURL).href]));
    expect(requests.filter(url => new URL(url).origin !== new URL(baseURL!).origin)).toEqual([]);
    await context.setOffline(true);
    await page.reload();
    await page.locator(".ocr-language-picker summary").click();
    await expect(page.getByRole("checkbox", { name: /^English/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: model.label })).not.toBeChecked();
    await page.getByRole("checkbox", { name: model.label }).check();
    await page.getByRole("checkbox", { name: /^English/ }).uncheck();
    await page.getByLabel("Choose image file", { exact: true }).setInputFiles(path.resolve(`e2e/fixtures/languages/${fixture.id}.png`));
    await expect(page.getByLabel("Tidied", { exact: true })).toHaveValue(expected, { timeout: 30_000 });
    expect(requests.filter(url => new URL(url).origin !== new URL(baseURL!).origin)).toEqual([]);
  });
}

test("language limit, combined recognition, switching and responsive picker", async ({ page, context }) => {
  await page.goto("/");
  await page.locator(".ocr-language-picker summary").click();
  await page.getByRole("checkbox", { name: /^Spanish/ }).check();
  await page.getByRole("checkbox", { name: /^French/ }).check();
  await expect(page.getByRole("checkbox", { name: /^Hindi/ })).toBeDisabled();
  await page.getByLabel("Choose image file", { exact: true }).setInputFiles(path.resolve("e2e/fixtures/languages/spa.png"));
  await expect(page.getByLabel("Tidied", { exact: true })).toHaveValue(/El texto permanece/);
  await expect(page.locator(".trust-markers .offline-readiness")).toHaveText("Offline: ready for English, Spanish, French");
  await page.getByRole("checkbox", { name: /^French/ }).uncheck();
  await page.getByRole("checkbox", { name: /^English/ }).uncheck();
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect(page.locator(".ocr-primary-action")).toHaveCount(1);
  await expect(page.getByLabel("Tidied", { exact: true })).toHaveValue(/El texto permanece/);
  await page.getByRole("button", { name: "Re-run OCR", exact: true }).click();
  await expect(page.getByLabel("Tidied", { exact: true })).toHaveValue(/El texto permanece/);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/d6-picker-${width}.png`, fullPage: true });
  }
  const storage = await context.storageState();
  expect(storage.origins.flatMap(origin => origin.localStorage).filter(item => /lang/i.test(item.name))).toEqual([]);
});

test("Hindi content modes and enhancement presets retain recognition with cleanup disabled", async ({ page }) => {
  await page.goto("/");
  await page.locator(".ocr-language-picker summary").click();
  await page.getByRole("checkbox", { name: /^Hindi/ }).check();
  await page.getByRole("checkbox", { name: /^English/ }).uncheck();
  await page.getByLabel("Choose image file", { exact: true }).setInputFiles(path.resolve("e2e/fixtures/languages/hin.png"));
  await expect(page.getByLabel("Tidied", { exact: true })).toHaveValue(/नमस्ते दुनिया/);
  for (const mode of ["document", "columns", "screenshot", "code", "sparse", "single-line"]) {
    await page.getByLabel("Content type", { exact: false }).selectOption(mode);
    await page.getByRole("button", { name: "Re-run OCR", exact: true }).click();
    await expect(page.getByLabel("Tidied", { exact: true })).toHaveValue(/नमस्ते दुनिया/);
  }
  await page.getByLabel("Content type", { exact: false }).selectOption("document");
  for (const preset of ["original", "document", "adaptive-document", "high-contrast", "inverted"]) {
    await page.getByLabel("Enhancement", { exact: false }).selectOption(preset);
    await page.getByRole("button", { name: "Re-run OCR", exact: true }).click();
    await expect(page.getByLabel("Tidied", { exact: true })).toHaveValue(/नमस्ते दुनिया/);
  }
  await expect(page.getByText(/Text cleanup is disabled for Hindi and Thai selections/)).toBeVisible();
});
