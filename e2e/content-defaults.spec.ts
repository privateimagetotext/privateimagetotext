import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const screenshot = "e2e/fixtures/ocr-corpus/clean-screenshot.png";
const terminal = "e2e/fixtures/ocr-corpus/code-terminal.png";
const photo = "tests/fixtures/content-defaults/phone-page.jpg";

for (const [name, path, content, preset] of [
  ["screenshot", screenshot, "screenshot", "original"],
  ["phone page", photo, "document", "adaptive-document"],
  ["terminal", terminal, "screenshot", "original"],
]) {
  test(`${name} receives its suggestion before real automatic OCR`, async ({ page }, testInfo) => {
    await page.goto("/");
    await page.getByLabel("Choose image file", { exact: true }).setInputFiles(path);
    await expect(page.getByLabel("Content type", { exact: false })).toHaveValue(content);
    await expect(page.getByLabel("Enhancement", { exact: false })).toHaveValue(preset);
    await expect(page.locator("select option:checked").filter({ hasText: "(suggested)" })).toHaveCount(1);
    await expect(page.getByRole("textbox", { name: /^Tidied/ })).toBeVisible({ timeout: 120_000 });
    expect((await page.getByRole("textbox", { name: /^Tidied/ }).inputValue()).trim().length).toBeGreaterThan(10);
    await page.getByLabel("Content type", { exact: false }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("suggested-default.png") });
  });
}

test("clipboard defaults and manual overrides survive Clear and navigation, reset on reload, and use no storage", async ({ page }) => {
  test.slow();
  const requests: { url: string; method: string }[] = [];
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));
  await page.goto("/");
  // The paste listener is attached when the lazily loaded tool mounts, which
  // also replaces the prerendered "preparing" offline marker. A synthetic
  // paste sent before that is dropped, so wait for the mounted tool first.
  const toolMounted = () => expect(page.locator(".trust-markers .offline-readiness")).not.toContainText(/preparing/i);
  const pasteImage = async () => page.evaluate((bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], "private-D2-sentinel.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true }));
  }, [...await readFile("e2e/fixtures/localtext-ocr.png")]);
  const paste = async () => {
    await toolMounted();
    await pasteImage();
  };
  await paste();
  await expect(page.getByRole("textbox", { name: /^Tidied/ })).toBeVisible();
  await expect(page.getByLabel("Content type", { exact: false })).toHaveValue("screenshot");
  await page.getByLabel("Content type", { exact: false }).selectOption("code");
  await page.getByLabel("Enhancement", { exact: false }).selectOption("high-contrast");
  await page.getByRole("button", { name: "Clear", exact: true }).first().click();
  await page.getByRole("link", { name: "See how private OCR works" }).click();
  await page.getByRole("navigation", { name: "Footer navigation" })
    .getByRole("link", { name: "Extract text", exact: true }).click();
  await paste();
  await expect(page.getByRole("textbox", { name: /^Tidied/ })).toBeVisible();
  await expect(page.getByLabel("Content type", { exact: false })).toHaveValue("code");
  await expect(page.getByLabel("Enhancement", { exact: false })).toHaveValue("high-contrast");
  await expect(page.locator("select option").filter({ hasText: "(suggested)" })).toHaveCount(0);
  await page.reload();
  await paste();
  await expect(page.getByRole("textbox", { name: /^Tidied/ })).toBeVisible();
  await expect(page.getByLabel("Content type", { exact: false })).toHaveValue("screenshot");
  await expect(page.getByLabel("Enhancement", { exact: false })).toHaveValue("original");
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  expect(requests.filter(({ method }) => method !== "GET")).toEqual([]);
  expect(JSON.stringify(requests)).not.toContain("private-D2-sentinel");
});
