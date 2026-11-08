import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";

const fixture = path.resolve("e2e/fixtures/localtext-ocr.png");

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`automatic drop OCR keeps results and the primary action reachable at ${viewport.width}x${viewport.height}`, async ({ page, context }, testInfo) => {
    await page.setViewportSize(viewport);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await expect(page.locator(".ocr-primary-action")).toHaveCount(0);
    const bytes = await readFile(fixture);
    await page.evaluate((input) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(input)], "private-auto-SENTINEL.png", { type: "image/png" }));
      document.querySelector(".dropzone")!.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
      window.scrollTo(0, document.documentElement.scrollHeight);
    }, [...bytes]);
    const result = page.getByRole("textbox", { name: /^Tidied/ });
    await expect(result).toHaveValue(/7429/, { timeout: 120_000 });
    await expect.poll(async () => {
      const box = await result.boundingBox();
      return box !== null && box.y >= 0 && box.y + 100 < viewport.height - 80;
    }).toBe(true);
    const action = page.locator(".ocr-primary-action");
    await expect(action).toHaveCSS("position", "fixed");
    await page.screenshot({ path: testInfo.outputPath(`auto-result-${viewport.width}.png`) });
    await page.getByRole("button", { name: "Copy text", exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/7429/);
    await page.getByLabel("Content type").selectOption("code");
    const rerun = page.getByRole("button", { name: "Re-run OCR", exact: true });
    await expect(rerun).toBeEnabled();
    await expect(result).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const box = (await rerun.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await rerun.click();
    await expect(result).toHaveValue(/7429/, { timeout: 120_000 });
    // Scroll anchoring may change the numeric offset as the result grows; an
    // explicit rerun must leave the user at the footer, not reveal the result.
    await expect(result).not.toBeInViewport();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(action).toHaveCSS("position", "static");
    await page.getByRole("button", { name: "Clear", exact: true }).first().click();
    await expect(action).toHaveCount(0);
    expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  });
}

test("mobile image selection is in the first screen and samples work offline", async ({ page, context }, testInfo) => {
  test.slow();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const choose = page.getByRole("button", { name: "Choose image", exact: true });
  const box = await choose.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  const sampleBox = await page.getByRole("button", { name: "Try a sample", exact: true }).boundingBox();
  expect(sampleBox).not.toBeNull();
  expect(sampleBox!.y + sampleBox!.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-first-screen.png"), fullPage: false });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Screenshot", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^Tidied/ })).toHaveValue(/SCREEN-7429/, { timeout: 120_000 });
  await expect(page.locator(".ocr-mobile-readiness")).toHaveText("Offline: ready for English", { timeout: 90_000 });
  await expect.poll(() => page.evaluate(async () => {
    const cache = await caches.open("localtext-shell-v10");
    return Boolean(await cache.match("/samples/code-terminal.png")) && Boolean(await cache.match("/samples/sample.png"));
  })).toBe(true);
  await context.setOffline(true);
  await page.reload();
  // First use of the mixed sample happens offline: shell preparation saves it
  // even when the visitor has only run a different image beforehand.
  await page.getByRole("button", { name: "Try a sample", exact: true }).click();
  const sampleResult = page.getByRole("textbox", { name: /^Tidied/ });
  await expect(sampleResult).toHaveValue(/OCR-7429/, { timeout: 120_000 });
  await expect(sampleResult).toHaveValue(/\$125\.50/);
  await expect(sampleResult).toHaveValue(/npm run build/);
  await expect(sampleResult).toHaveValue(/Build complete: 3 files ready\./);
  await expect(sampleResult).toHaveValue(/Turn a picture into editable text in your browser\./);
  await expect(page.getByText("sample.png (bundled with this site)", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mixed-sample-offline.png"), fullPage: true });
  await page.getByRole("button", { name: "Clear", exact: true }).first().click();
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^Tidied/ })).toHaveValue(/ERR-4097/, { timeout: 120_000 });
  expect(errors).toEqual([]);
});

test("source-linked correction changes only the editable version", async ({ page }) => {
  test.slow();
  await page.goto("/");
  await page.getByRole("button", { name: "Screenshot", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^Tidied/ })).toHaveValue(/SCREEN-7429/, { timeout: 120_000 });
  await page.locator(".ocr-source-review summary").click();
  await page.getByRole("button", { name: "SCREEN-7429", exact: true }).click();
  await expect(page.getByRole("img", { name: "Original source region with the selected recognised word highlighted" })).toBeVisible();
  await page.getByLabel("Correction for", { exact: false }).fill("SCREEN-7430");
  await page.getByRole("button", { name: "Apply correction", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^Your edits/ })).toHaveValue(/SCREEN-7430/);
  await page.getByRole("button", { name: "Rerun selected region", exact: true }).click();
  await expect(page.getByText("Region result is a suggestion. Review it before applying.")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("textbox", { name: /^Your edits/ })).toHaveValue(/SCREEN-7430/);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
});

test("real sequential batches retain edits, export in queue order and keep private names out of requests", async ({ page }, testInfo) => {
  test.slow();
  const requests: { url: string; method: string }[] = [];
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));
  const bytes = await readFile(fixture);
  await page.goto("/");
  await page.getByLabel("Choose image file", { exact: true }).setInputFiles([
    { name: "private-batch-SENTINEL-a.png", mimeType: "image/png", buffer: bytes },
    { name: "private-batch-SENTINEL-b.png", mimeType: "image/png", buffer: bytes },
  ]);
  await expect(page.getByRole("region", { name: "Image batch" })).toBeVisible();
  await page.getByRole("button", { name: "Process pending images", exact: true }).click();
  await expect(page.getByRole("button", { name: "2. private-batch-SENTINEL-b.png Complete", exact: true })).toBeEnabled({ timeout: 120_000 });
  await page.getByRole("button", { name: "1. private-batch-SENTINEL-a.png Complete", exact: true }).click();
  await page.getByRole("button", { name: "Edit this version", exact: true }).click();
  await page.getByRole("textbox", { name: /^Your edits/ }).fill("PRIVATE BATCH EDIT A");
  await page.getByRole("button", { name: "2. private-batch-SENTINEL-b.png Complete", exact: true }).click();
  await page.getByRole("button", { name: "Edit this version", exact: true }).click();
  await page.getByRole("textbox", { name: /^Your edits/ }).fill("PRIVATE BATCH EDIT B");
  await page.getByRole("button", { name: "Move private-batch-SENTINEL-b.png up", exact: true }).click();
  const combinedPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Combined text .txt", exact: true }).click();
  const combined = await combinedPromise;
  const combinedPath = testInfo.outputPath("combined.txt");
  await combined.saveAs(combinedPath);
  const text = await readFile(combinedPath, "utf8");
  expect(text).toContain("PRIVATE BATCH EDIT A");
  expect(text.indexOf("PRIVATE BATCH EDIT B")).toBeLessThan(text.indexOf("PRIVATE BATCH EDIT A"));
  const zipPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Separate text files .zip", exact: true }).click();
  const zip = await zipPromise;
  const zipPath = testInfo.outputPath("separate.zip");
  await zip.saveAs(zipPath);
  const zipBytes = await readFile(zipPath);
  expect(zipBytes.readUInt32LE(0)).toBe(0x04034b50);
  expect(zipBytes.includes(Buffer.from("PRIVATE BATCH EDIT A"))).toBe(true);
  expect(zipBytes.includes(Buffer.from("PRIVATE BATCH EDIT B"))).toBe(true);
  expect(requests.filter(({ method }) => method !== "GET")).toEqual([]);
  expect(JSON.stringify(requests)).not.toContain("SENTINEL");
  await page.getByRole("button", { name: "Clear", exact: true }).first().click();
  await expect(page.getByRole("region", { name: "Image batch" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /^Your edits/ })).toHaveCount(0);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
});
