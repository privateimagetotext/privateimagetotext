import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";

const fixture = (name: string) => path.resolve(`tmp/pdf-improvements/fixtures/${name}.pdf`);
async function choose(page: Page, name = "mixed-pages") {
  await page.getByLabel("Choose one PDF", { exact: true }).setInputFiles(fixture(name));
  await expect(page.getByRole("heading", { name: `${name}.pdf`, exact: true })).toBeVisible();
}
async function source(page: Page, number: number) {
  await expect(page.getByRole("img", { name: `Source PDF page ${number}`, exact: true })).toBeVisible();
}

test("local preview follows result pages, preserves edits and fits mobile with keyboard controls", async ({ page, context, baseURL }, testInfo) => {
  const requests: { url: string; method: string; body: string }[] = [];
  const errors: string[] = [];
  context.on("request", (request) => requests.push({ url: request.url(), method: request.method(), body: request.postData() ?? "" }));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/pdf-to-text");
  await choose(page);
  await source(page, 1);
  await expect(page.getByRole("button", { name: "Previous page", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Next page", exact: true }).focus();
  await page.keyboard.press("Enter");
  await source(page, 2);
  await page.getByLabel("Preview page", { exact: true }).selectOption("3");
  await source(page, 3);
  const dimensions = await page.locator(".pdf-preview-canvas canvas").evaluate((canvas: HTMLCanvasElement) => ({ width: canvas.width, height: canvas.height }));
  expect(dimensions.width).toBeGreaterThan(dimensions.height);
  await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
  const editor = page.getByLabel("Editable text for page 1", { exact: true });
  await expect(editor).toHaveValue(/ORCHID-271828/);
  await source(page, 1);
  await editor.fill("PRIVATE EDIT SENTINEL ORCHID-987612");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await source(page, 2);
  await expect(page.getByLabel("Editable text for page 2", { exact: true })).toHaveValue(/LIME-314159/);
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await source(page, 1);
  await expect(editor).toHaveValue("PRIVATE EDIT SENTINEL ORCHID-987612");
  await page.getByLabel("Preview zoom", { exact: true }).selectOption("200");
  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator(".pdf-page-comparison").screenshot({ path: testInfo.outputPath(`preview-${width}.png`) });
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .txt", exact: true }).click();
  const download = await downloadEvent;
  expect(await readFile((await download.path())!, "utf8")).toContain("PRIVATE EDIT SENTINEL ORCHID-987612");
  await page.getByRole("button", { name: "Clear PDF", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Clear/ }).click();
  await expect(page.locator(".pdf-preview-canvas canvas")).toHaveCount(0);
  const storage = await page.evaluate(async () => ({
    local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage),
    cached: (await Promise.all((await caches.keys()).map(async (name) => (await (await caches.open(name)).keys()).map((r) => r.url)))).flat(),
  }));
  for (const sentinel of ["ORCHID-271828", "PRIVATE EDIT SENTINEL", "mixed-pages.pdf"]) {
    expect(JSON.stringify(storage)).not.toContain(sentinel);
    expect(JSON.stringify(requests)).not.toContain(sentinel);
  }
  expect(requests.every((request) => new URL(request.url).origin === new URL(baseURL!).origin && request.method === "GET")).toBe(true);
  expect(errors).toEqual([]);
});

test("rapid page changes and immediate extraction keep the PDF worker reusable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/pdf-to-text");
  await choose(page);
  for (const number of [3, 2, 1, 3, 1]) await page.getByLabel("Preview page", { exact: true }).selectOption(String(number));
  await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
  await expect(page.getByLabel("Editable text for page 1", { exact: true })).toHaveValue(/ORCHID-271828/);
  await source(page, 1);
  await page.getByRole("button", { name: "Clear PDF", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Clear/ }).click();
  await choose(page);
  await source(page, 1);
  expect(errors).toEqual([]);
});

test("Spanish scanned PDF uses selected same-origin models and works again offline", async ({ page, context, baseURL }) => {
  const requests: string[] = [];
  context.on("request", (request) => requests.push(request.url()));
  await page.goto("/pdf-to-text");
  await choose(page, "spanish-scan");
  await page.locator(".ocr-language-picker summary").click();
  await page.getByRole("checkbox", { name: /^Spanish/ }).check();
  await page.getByRole("checkbox", { name: /^English/ }).uncheck();
  await page.getByRole("button", { name: "Prepare PDF and OCR support", exact: true }).click();
  await expect(page.getByRole("button", { name: "Offline support prepared", exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
  await expect(page.getByLabel("Editable text for page 1", { exact: true })).toHaveValue(/El texto permanece/, { timeout: 120_000 });
  expect(requests.some((url) => url.includes("/ocr/lang/spa/"))).toBe(true);
  expect(requests.some((url) => url.includes("/ocr/lang/eng/"))).toBe(false);
  await context.setOffline(true);
  await page.reload();
  await choose(page, "spanish-scan");
  await page.locator(".ocr-language-picker summary").click();
  await page.getByRole("checkbox", { name: /^Spanish/ }).check();
  await page.getByRole("checkbox", { name: /^English/ }).uncheck();
  await source(page, 1);
  await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
  await expect(page.getByLabel("Editable text for page 1", { exact: true })).toHaveValue(/El texto permanece/, { timeout: 120_000 });
  await page.getByLabel("Editable text for page 1", { exact: true }).fill("Retained Spanish review edit");
  await page.getByRole("checkbox", { name: /^French/ }).check();
  await page.getByRole("checkbox", { name: /^Spanish/ }).uncheck();
  await page.getByRole("button", { name: "Re-run OCR for this page", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reprocess page", exact: true }).click();
  // Chromium's offline network emulation can retain navigator.onLine=true after
  // a service-worker reload. Either safe error must preserve the reviewed text.
  await expect(page.locator(".pdf-document-error")).toContainText(/selected OCR languages are not available offline|Text could not be recognised on this PDF page/);
  await expect(page.getByLabel("Editable text for page 1", { exact: true })).toHaveValue("Retained Spanish review edit");
  await page.getByRole("checkbox", { name: /^Spanish/ }).check();
  await page.getByRole("checkbox", { name: /^French/ }).uncheck();
  await page.getByRole("button", { name: "Re-run OCR for this page", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reprocess page", exact: true }).click();
  await expect(page.getByLabel("Editable text for page 1", { exact: true })).toHaveValue(/El texto permanece/, { timeout: 120_000 });
  expect(requests.every((url) => new URL(url).origin === new URL(baseURL!).origin)).toBe(true);
});

test.describe("preview failure recovery", () => {
  test.use({ serviceWorkers: "block" });
  test("a failed local render has a retry and does not prevent existing-text extraction", async ({ page }) => {
    await page.route("**/pdf/*/api/pdf.mjs", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${await response.text()}
const previewOriginalGetDocument = getDocument;
let previewShouldFail = true;
getDocument = (...args) => {
  const task = previewOriginalGetDocument(...args);
  task.promise.then(document => {
    const originalGetPage = document.getPage.bind(document);
    document.getPage = async (number) => {
      const page = await originalGetPage(number);
      const originalRender = page.render.bind(page);
      page.render = (...renderArgs) => {
        if (previewShouldFail) { previewShouldFail = false; throw new Error('SYNTHETIC PRIVATE ERROR'); }
        return originalRender(...renderArgs);
      };
      return page;
    };
  });
  return task;
};` });
    });
    await page.goto("/pdf-to-text");
    await choose(page);
    await expect(page.getByText(/could not be previewed/)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("SYNTHETIC PRIVATE ERROR");
    await page.getByRole("button", { name: "Retry preview", exact: true }).click();
    await source(page, 1);
    await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
    await expect(page.getByLabel("Editable text for page 1", { exact: true })).toHaveValue(/ORCHID-271828/);
  });
});
