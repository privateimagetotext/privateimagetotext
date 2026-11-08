import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const fixtureRoot = path.resolve("tmp/pdf-phase0/fixtures");
const readyLabel = "Image OCR offline: ready for English, Spanish";
const editMarker = "OFFLINE-SCOPE-EDIT-STAYS-IN-THIS-TAB-74912";
const headerWidths = [1061, 1100, 1200, 1281, 1304, 1305, 1312, 1440, 1920];

test.beforeAll(async () => {
  // Standard test:e2e builds do not prepare the PDF harness. Generate the
  // project's small, synthetic fixtures locally; no document is fetched.
  await promisify(execFile)(process.execPath, [path.resolve("tools/pdf-phase0/scripts/generate-fixtures.mjs")]);
});

async function headerFits(page: Page, width: number, label: string, info: TestInfo, stage: string) {
  await page.setViewportSize({ width, height: 924 });
  const summary = page.locator(".header-offline-status summary");
  await expect(summary).toHaveAccessibleName(label);
  const target = await summary.boundingBox();
  expect(target!.width, `${stage} summary hit target at ${width}px`).toBeGreaterThanOrEqual(44);
  expect(target!.height, `${stage} summary hit target at ${width}px`).toBeGreaterThanOrEqual(44);
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    pageWidth: document.documentElement.scrollWidth,
    controlsRight: document.querySelector(".app-header__actions")!.getBoundingClientRect().right,
  }));
  expect(geometry.pageWidth, `${stage} page at ${width}px`).toBeLessThanOrEqual(geometry.width);
  expect(geometry.controlsRight, `${stage} controls at ${width}px`).toBeLessThanOrEqual(geometry.width);
  const visibleState = await summary.locator(".local-processing-badge__label").evaluate(element => {
    const text = element.firstChild!;
    const label = text.textContent!;
    const state = label.includes(": ready") ? "ready" : "setup";
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, label.indexOf(state) + state.length);
    return { stateRight: range.getBoundingClientRect().right, labelRight: element.getBoundingClientRect().right };
  });
  expect(visibleState.stateRight, `${stage} keeps ready/setup visible at ${width}px`).toBeLessThanOrEqual(visibleState.labelRight - 8);
  await page.screenshot({ path: info.outputPath(`${stage}-${width}.png`) });
}

async function clearPdf(page: Page) {
  await page.getByRole("button", { name: "Clear PDF", exact: true }).click();
  await page.getByRole("dialog", { name: "Clear this PDF and its results?" })
    .getByRole("button", { name: "Clear PDF", exact: true }).click();
  await expect(page.locator(".pdf-results")).toHaveCount(0);
}

test("image OCR readiness stays scoped when PDF support is missing, then prepared PDFs work offline", async ({ page, context, baseURL }, info) => {
  test.setTimeout(480_000);
  const digital = await readFile(path.join(fixtureRoot, "selectable.pdf"));
  const scanned = await readFile(path.join(fixtureRoot, "scanned.pdf"));
  const digitalName = "OFFLINE-SCOPE-DIGITAL-74912.pdf";
  const scannedName = "OFFLINE-SCOPE-SCAN-74912.pdf";
  const markers = [digitalName, scannedName, editMarker, "PDF PHASE ZERO SELECTABLE 271828"];
  const requestEvidence: Promise<string>[] = [];
  const requestHeaderErrors: string[] = [];
  const outsideOrigins: string[] = [];
  const uploadMethods: string[] = [];
  const errors: string[] = [];
  context.on("request", request => {
    const url = new URL(request.url());
    if (!["http:", "https:"].includes(url.protocol)) return;
    if (url.origin !== new URL(baseURL!).origin) outsideOrigins.push(url.origin);
    if (!["GET", "HEAD"].includes(request.method())) uploadMethods.push(request.method());
    // The browser's own service-worker script update check is issued from the
    // service worker. If that worker is replaced mid-fetch, allHeaders() never
    // settles. Its URL is the fixed same-origin script and it has no body, so
    // the provisional headers are complete enough evidence; every other
    // request still requires full headers.
    const workerScriptUpdate = request.serviceWorker() !== null && url.pathname === "/sw.js" && request.method() === "GET";
    requestEvidence.push((workerScriptUpdate ? Promise.resolve(request.headers()) : request.allHeaders())
      .then(headers => JSON.stringify({ url: request.url(), headers, body: request.postData() }))
      .catch(error => {
        requestHeaderErrors.push(error instanceof Error ? error.message : String(error));
        return "";
      }));
  });
  page.on("pageerror", error => errors.push(error.message));

  await page.goto("/");
  const summary = page.locator(".header-offline-status summary");
  await expect(summary).toHaveAccessibleName("Image OCR offline: setup needed");
  await page.evaluate(() => document.fonts.ready);
  for (const width of headerWidths) await headerFits(page, width, "Image OCR offline: setup needed", info, "unprepared");
  await page.setViewportSize({ width: 1305, height: 924 });
  await page.locator(".ocr-language-picker > summary").click();
  await page.getByRole("checkbox", { name: /^Spanish/ }).check();
  await page.getByRole("button", { name: "Download selected languages", exact: true }).click();
  await expect(summary).toHaveAccessibleName(readyLabel, { timeout: 90_000 });
  for (const width of headerWidths) await headerFits(page, width, readyLabel, info, "prepared-image-ocr");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 924 });
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    const dialog = page.getByRole("dialog", { name: "Navigation menu" });
    const badge = dialog.locator(".local-processing-badge");
    await expect(badge).toHaveText(readyLabel);
    const bounds = await badge.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await badge.locator(".local-processing-badge__label").evaluate(label => label.scrollWidth <= label.clientWidth), "full mobile status wraps inside the badge").toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`prepared-menu-${width}.png`) });
    await dialog.getByRole("button", { name: "Close navigation menu" }).click();
  }
  await page.setViewportSize({ width: 1305, height: 924 });

  await page.goto("/pdf-to-text");
  await expect(summary).toHaveAccessibleName(readyLabel);
  await expect(page.getByText("PDF reader not prepared for offline use", { exact: false })).toBeVisible();
  await expect(page.getByText("English OCR available offline", { exact: true })).toBeVisible();
  expect(await page.evaluate(async () => {
    const names = (await caches.keys()).filter(name => name.startsWith("localtext-pdf-"));
    const counts = await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).length));
    return counts.reduce((total, count) => total + count, 0);
  }), "no PDF reader assets have been cached").toBe(0);

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(summary).toHaveAccessibleName(readyLabel);
  await expect(page.getByText("PDF reader not prepared for offline use", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Offline support prepared", exact: true })).toHaveCount(0);
  // Browser network emulation can leave this advisory flag true after a
  // service-worker reload. Exercise the explicit offline message deterministically;
  // real requests remain blocked by setOffline and cached reuse is tested below.
  await page.evaluate(() => Object.defineProperty(navigator, "onLine", {
    configurable: true, get: () => false,
  }));
  await page.getByLabel("Choose one PDF").setInputFiles({ name: digitalName, mimeType: "application/pdf", buffer: digital });
  await expect(page.getByText("The PDF reader is not available offline. Connect to the internet and prepare it first.")).toBeVisible();
  await expect(page.locator(".pdf-results")).toHaveCount(0);
  await summary.click();
  await expect(page.locator(".header-offline-status > p")).toContainText("PDF tools have separate preparation checks.");
  await page.screenshot({ path: info.outputPath("image-ready-pdf-missing-offline.png"), fullPage: true });

  await context.setOffline(false);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Prepare PDF and OCR support", exact: true }).click();
  await expect(page.getByRole("button", { name: "Offline support prepared", exact: true })).toBeDisabled({ timeout: 240_000 });
  await expect(page.getByText("PDF reader available offline", { exact: false })).toBeVisible();
  await expect(summary).toHaveAccessibleName(readyLabel);

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Offline support prepared", exact: true })).toBeDisabled();
  await page.getByLabel("Choose one PDF").setInputFiles({ name: digitalName, mimeType: "application/pdf", buffer: digital });
  await expect(page.getByRole("heading", { level: 2, name: digitalName })).toBeVisible();
  await page.getByRole("radio", { name: "Page range", exact: true }).check();
  await page.getByLabel("Pages to process").fill("1");
  await page.getByRole("radio", { name: /^Existing PDF text only/ }).check();
  await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
  const editor = page.getByLabel("Editable text for page 1", { exact: true });
  await expect(editor).toHaveValue(/PDF PHASE ZERO SELECTABLE 271828/, { timeout: 90_000 });
  await expect(page.locator(".pdf-method-badge")).toHaveText("PDF text");
  await editor.fill(editMarker);
  await clearPdf(page);

  await page.getByLabel("Choose one PDF").setInputFiles({ name: scannedName, mimeType: "application/pdf", buffer: scanned });
  await expect(page.getByRole("heading", { level: 2, name: scannedName })).toBeVisible();
  await page.getByRole("radio", { name: /^OCR selected pages/ }).check();
  await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
  await expect(editor).toBeVisible({ timeout: 180_000 });
  await expect(page.locator(".pdf-method-badge")).toHaveText("OCR");
  const scannedText = await editor.inputValue();
  expect(scannedText.length, "real offline OCR completes with nonempty text; not a quality benchmark").toBeGreaterThan(20);
  markers.push(scannedText);
  await editor.fill(editMarker);
  await page.screenshot({ path: info.outputPath("prepared-pdf-ocr-offline.png"), fullPage: true });

  const fixtureHashes = [digital, scanned].map(bytes => createHash("sha256").update(bytes).digest("hex"));
  const storage = await page.evaluate(async ({ markers: sentinels, fixtureHashes: selectedHashes }) => {
    const cacheKeys: string[] = [];
    const matches: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const key of await cache.keys()) {
        cacheKeys.push(key.url);
        const bytes = await (await cache.match(key))!.arrayBuffer();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
        if (selectedHashes.includes(hash)) matches.push("selected PDF bytes");
        const text = new TextDecoder().decode(bytes);
        if (sentinels.some(marker => text.includes(marker))) matches.push("selected or edited text");
      }
    }
    return { cacheKeys, matches, local: Object.entries(localStorage), session: Object.entries(sessionStorage), databases: await indexedDB.databases(), cookies: document.cookie };
  }, { markers, fixtureHashes });
  expect(storage.matches, "support caches contain no selected PDF or result content").toEqual([]);
  expect(storage.databases, "OCR model caching does not create a document database").toEqual([]);
  for (const marker of markers) expect(JSON.stringify(storage)).not.toContain(marker);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".pdf-results")).toHaveCount(0);
  await expect(summary).toHaveAccessibleName(readyLabel);
  const network = (await Promise.all(requestEvidence)).join("\n");
  expect(requestHeaderErrors, "privacy request evidence was collected completely").toEqual([]);
  for (const marker of markers) expect(network).not.toContain(marker);
  expect(outsideOrigins).toEqual([]);
  expect(uploadMethods).toEqual([]);
  expect(errors).toEqual([]);
});
