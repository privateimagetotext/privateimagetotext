import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chooseCarrier, explicitDownload, generatePng, revealFile } from "./steganography-helpers";

const image = path.resolve("e2e/fixtures/localtext-ocr.png");
const jpeg = path.resolve("tests/fixtures/jpeg-v2/libjpeg-testorig.jpg");
const manifest = JSON.parse(await readFile("dist/.vite/manifest.json", "utf8"));

async function cacheHas(page: Page, pattern: RegExp) {
  return page.evaluate(async source => {
    const cache = await caches.open("localtext-shell-v10");
    return (await cache.keys()).some(request => new RegExp(source).test(request.url));
  }, pattern.source);
}

for (const route of ["/", "/hide-message", "/media-inspector", "/steganography-analysis", "/guides/screenshot-to-text", "/privacy"]) {
  test(`route requests stay isolated, including service-worker preparation: ${route}`, async ({ page, context }) => {
    const requests: string[] = [];
    context.on("request", request => requests.push(new URL(request.url()).pathname));
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(route);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect(page.locator(".header-offline-status summary")).toHaveText("Image OCR offline: setup needed");
    // Let idle prefetch and background route preparation finish.
    await page.waitForTimeout(3500);
    for (const [name, pathname] of [["ToolPage", "/"], ["HideMessagePage", "/hide-message"], ["MediaInspectorPage", "/media-inspector"], ["StegoAnalysisPage", "/steganography-analysis"], ["PdfOcrPage", "/pdf-to-text"]]) {
      const file = manifest[`src/pages/${name}.tsx`]?.file;
      if (file) expect(requests.includes(`/${file}`), `${route}: ${name}`).toBe(pathname === route);
    }
    expect(requests.some(file => /(?:c2pa.*\.wasm|jpeg-v2-codec)/.test(file))).toBe(false);
    expect(requests.some(file => /stego-analysis\.worker-/.test(file))).toBe(route === "/steganography-analysis");
    expect(requests.includes("/ocr/worker.min.js")).toBe(route === "/");
    expect(requests.some(file => /\/ocr\/(?:core|lang)\//.test(file))).toBe(false);
    expect(errors).toEqual([]);
  });
}

test("three visited tools work offline; JPEG and C2PA remain available after first online use", async ({ page, context }) => {
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Choose image file", { exact: true }).setInputFiles(image);
  await expect(page.getByRole("textbox", { name: /^Tidied/ })).toHaveValue(/7429/, { timeout: 120_000 });
  await expect(page.locator(".offline-readiness")).toHaveText("Offline: ready for English", { timeout: 90_000 });

  await page.goto("/hide-message");
  await expect.poll(() => cacheHas(page, /steganography\.worker-.*\.js$/)).toBe(true);
  // First PNG operation happens offline after only visiting this tool.
  await context.setOffline(true);
  await page.reload();
  await chooseCarrier(page);
  await generatePng(page, "D5 offline PNG π");
  const png = await (await explicitDownload(page)).path();
  await page.getByRole("button", { name: "Clear" }).last().click();
  await expect(await revealFile(page, png!)).toHaveValue("D5 offline PNG π");

  await context.setOffline(false);
  await page.goto("/hide-message");
  await page.locator('input[type="file"]').setInputFiles(jpeg);
  await page.getByRole("radio", { name: /^JPEG — advanced/i }).check();
  await page.getByRole("radio", { name: /^No password/i }).check();
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("D5 offline JPEG");
  await page.getByRole("button", { name: "Create JPEG with hidden message" }).click();
  await expect(page.getByRole("heading", { name: "Download your hidden-message image" })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JPEG" }).click();
  const encodedJpeg = await (await downloading).path();
  await expect.poll(() => cacheHas(page, /jpeg-v2-codec-.*\.js$/)).toBe(true);

  await page.goto("/media-inspector");
  await page.getByLabel("Choose a media file to inspect").setInputFiles(image);
  await page.getByRole("tab", { name: "Origin & AI clues" }).click();
  await expect(page.getByRole("heading", { name: "No embedded Content Credential found" })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => cacheHas(page, /c2pa.*\.wasm$/)).toBe(true);

  // New documents and workers must succeed with the HTTP cache emptied.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.clearBrowserCache");
  await context.setOffline(true);
  await page.reload();
  await page.getByLabel("Choose a media file to inspect").setInputFiles(image);
  await page.getByRole("tab", { name: "Origin & AI clues" }).click();
  await expect(page.getByRole("heading", { name: "No embedded Content Credential found" })).toBeVisible({ timeout: 30_000 });
  await page.goto("/hide-message");
  await page.getByRole("radio", { name: /Reveal a message/i }).check();
  await page.locator('input[type="file"]').setInputFiles({ name: "encoded.jpg", mimeType: "image/jpeg", buffer: await readFile(encodedJpeg!) });
  await expect(page.getByLabel("Message text")).toHaveValue("D5 offline JPEG");
  await page.goto("/");
  await page.getByLabel("Choose image file", { exact: true }).setInputFiles(image);
  await expect(page.getByRole("textbox", { name: /^Tidied/ })).toHaveValue(/7429/, { timeout: 120_000 });
  expect(errors).toEqual([]);
});
