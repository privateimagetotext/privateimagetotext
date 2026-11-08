import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

const pdfPath = path.resolve("tmp/pdf-phase0/fixtures/selectable.pdf");
const imagePath = path.resolve("e2e/fixtures/ocr-corpus/clean-screenshot.png");
const canonical = "https://privateimagetotext.com/pdf-to-text";

test.beforeAll(async () => {
  await Promise.all([access(pdfPath), access(imagePath)]);
});

function isProcessingRuntime(pathname: string) {
  // The image homepage prefetches this worker loader (covered by route-splitting).
  // Its bootstrap is allowed here; every other OCR asset and all PDF assets
  // must still stay lazy until processing is requested.
  return pathname.startsWith("/pdf/6.2.108/") ||
    /\/assets\/.*pdfjs/i.test(pathname) ||
    (pathname.startsWith("/ocr/") && pathname !== "/ocr/worker.min.js");
}

async function expectPublicPdf(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: "Extract text from a PDF. Nothing uploaded." })).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page).toHaveTitle("PDF to Text — Private OCR, No Upload");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical);
  await expect(page.locator(".pdf-preview-notice")).toHaveCount(0);
  await expect(page.getByText("PDF to Text preview", { exact: true })).toHaveCount(0);
}

async function primaryNavigationLink(page: Page, name: string) {
  const menuButton = page.getByRole("button", { name: "Open navigation menu", exact: true });
  if (await menuButton.isVisible()) await menuButton.click();
  return page.getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name, exact: true });
}

async function openIndependentTab(source: Page, link: Locator) {
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toContainText("opens in a new tab");
  const popupEvent = source.waitForEvent("popup");
  await link.click();
  const popup = await popupEvent;
  await popup.waitForLoadState("domcontentloaded");
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  expect(await popup.evaluate(() => document.referrer)).toBe("");
  return popup;
}

test("public PDF navigation, direct HTML, refresh and guide are indexable with lazy runtime", async ({ page, context }) => {
  const processingRequests: string[] = [];
  context.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (isProcessingRuntime(pathname)) processingRequests.push(pathname);
  });
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  const handoff = page.getByRole("main").locator('a[href="/pdf-to-text"]').first();
  await expect(handoff).toBeVisible();
  const pdfPopup = await openIndependentTab(page, handoff);
  await expectPublicPdf(pdfPopup);
  await expect(page).toHaveURL(/\/$/);
  await pdfPopup.waitForLoadState("networkidle");
  expect(processingRequests).toEqual([]);
  await pdfPopup.close();
  // Global navigation deliberately retains its ordinary same-tab behavior.
  const primaryPdfLink = await primaryNavigationLink(page, "PDF to text");
  await expect(primaryPdfLink).toHaveAttribute("href", "/pdf-to-text");
  await expect(primaryPdfLink).not.toHaveAttribute("target", "_blank");
  await primaryPdfLink.click();
  await expectPublicPdf(page);
  await page.waitForLoadState("networkidle");
  expect(processingRequests).toEqual([]);

  const direct = await page.goto("/pdf-to-text");
  expect(direct?.status()).toBe(200);
  const html = await direct!.text();
  expect(html).toContain('data-route-path="/pdf-to-text"');
  expect(html).toContain(`rel="canonical" href="${canonical}"`);
  expect(html).toContain('name="robots" content="index, follow"');
  expect(html).not.toMatch(/PDF to Text preview|Internal release candidate/);
  await expectPublicPdf(page);
  await page.reload();
  await expectPublicPdf(page);

  const guide = await openIndependentTab(page, page.getByRole("link", { name: /Read the PDF to text guide/ }));
  await expect(guide).toHaveURL(/\/guides\/pdf-to-text$/);
  await expect(page).toHaveURL(/\/pdf-to-text$/);
  await expect(guide.getByRole("heading", { level: 1, name: "How to extract text from a PDF without uploading it" })).toBeVisible();
  await expect(guide.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  await expect(guide.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://privateimagetotext.com/guides/pdf-to-text");
  await expect(guide.getByRole("main").locator('a[href="/pdf-to-text"]').first()).toBeVisible();
  await guide.waitForLoadState("networkidle");
  expect(processingRequests).toEqual([]);
  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  expect(sitemap).toContain(`${canonical}</loc>`);
  expect(sitemap).toContain("https://privateimagetotext.com/guides/pdf-to-text</loc>");
  await guide.close();
});

test("public PDF extracts real selectable text and starts independently from image OCR", async ({ page, context }) => {
  const requests: { url: string; method: string; body: string }[] = [];
  const pageErrors: string[] = [];
  context.on("request", (request) => requests.push({ url: request.url(), method: request.method(), body: request.postData() ?? "" }));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  context.on("page", (popup) => popup.on("pageerror", (error) => pageErrors.push(error.message)));
  await page.goto("/");
  await page.getByLabel("Choose image file", { exact: true }).setInputFiles(imagePath);
  const imageResult = page.getByRole("textbox", { name: /Tidied/ });
  await expect(imageResult).toHaveValue(/SCREEN-7429/, { timeout: 120_000 });
  await page.getByRole("button", { name: "Edit this version", exact: true }).click();
  const imageSentinel = "PRIVATE IMAGE EDIT SENTINEL 670923";
  await page.getByRole("textbox", { name: /Your edits/ }).fill(imageSentinel);
  // Finish the image workspace's explicit offline preparation before measuring
  // whether this selectable PDF itself causes an OCR-model request.
  await page.waitForLoadState("networkidle");

  // Rejecting a PDF in the image picker offers a separate workspace before
  // resetting the image session or discarding any corrected text.
  await page.getByLabel("Choose image file", { exact: true }).setInputFiles(pdfPath);
  const rejection = page.getByRole("alert").filter({ hasText: "This image workspace does not accept PDFs." });
  await expect(rejection).toBeVisible();
  await expect(rejection).toBeFocused();
  await expect(rejection).toContainText("No files from this selection were added.");
  await expect(page.getByRole("textbox", { name: /Your edits/ })).toHaveValue(imageSentinel);
  await expect(page.getByText("clean-screenshot.png", { exact: true })).toBeVisible();
  const pdf = await openIndependentTab(page, rejection.getByRole("link", { name: "Open PDF to text (opens in a new tab)" }));
  await expectPublicPdf(pdf);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("textbox", { name: /Your edits/ })).toHaveValue(imageSentinel);
  await expect(page.getByText("clean-screenshot.png", { exact: true })).toBeVisible();
  await expect(pdf.getByRole("button", { name: "Choose PDF", exact: true })).toBeVisible();
  expect(await pdf.getByLabel("Choose one PDF").evaluate((input: HTMLInputElement) => input.files?.length ?? 0)).toBe(0);
  await expect(pdf.locator(".pdf-results")).toHaveCount(0);
  await expect(pdf.getByText(imageSentinel, { exact: true })).toHaveCount(0);
  await expect(pdf.getByText("clean-screenshot.png", { exact: true })).toHaveCount(0);
  await pdf.waitForLoadState("networkidle");

  const pdfRequestStart = requests.length;
  const displayedName = "private-release-fixture-482901.pdf";
  await pdf.getByLabel("Choose one PDF").setInputFiles({ name: displayedName, mimeType: "application/pdf", buffer: await readFile(pdfPath) });
  await expect(pdf.getByRole("heading", { level: 2, name: displayedName })).toBeVisible({ timeout: 90_000 });
  await pdf.getByRole("button", { name: "Process selected pages" }).click();
  const pdfEditor = pdf.getByLabel("Editable text for page 1");
  await expect(pdfEditor).toHaveValue(/PDF PHASE ZERO SELECTABLE 271828/, { timeout: 120_000 });
  await expect(pdf.locator(".pdf-method-badge")).toHaveText("PDF text");
  await expect(pdf.getByRole("navigation", { name: "Selected PDF pages" }).getByRole("button")).toHaveCount(2);
  expect(requests.slice(pdfRequestStart).some((request) => new URL(request.url).pathname.includes("pdf.worker"))).toBe(true);
  expect(requests.slice(pdfRequestStart).some((request) => new URL(request.url).pathname.startsWith("/ocr/"))).toBe(false);

  const pdfSentinel = "PRIVATE PDF EDIT SENTINEL 992740";
  const editedPdfText = `${await pdfEditor.inputValue()}\n${pdfSentinel}`;
  await pdfEditor.fill(editedPdfText);
  const guide = await openIndependentTab(pdf, pdf.getByRole("link", { name: /Read the PDF to text guide/ }));
  await expect(guide.getByRole("heading", { level: 1, name: "How to extract text from a PDF without uploading it" })).toBeVisible();
  await expect(pdf).toHaveURL(/\/pdf-to-text$/);
  await expect(pdfEditor).toHaveValue(editedPdfText);
  await expect(page.getByRole("textbox", { name: /Your edits/ })).toHaveValue(imageSentinel);
  await expect(guide.locator("body")).not.toContainText(pdfSentinel);
  await expect(guide.locator("body")).not.toContainText(imageSentinel);
  await expect(guide.locator("body")).not.toContainText(displayedName);
  await expect(guide.getByRole("textbox")).toHaveCount(0);

  const downloadEvent = pdf.waitForEvent("download");
  await pdf.getByRole("button", { name: "Download .txt", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("private-release-fixture-482901-pdf-text.txt");
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const output = await readFile(downloadedPath!, "utf8");
  expect(output).toContain("PDF PHASE ZERO SELECTABLE 271828");
  expect(output).toContain("SECOND SELECTABLE PAGE");
  expect(output).toContain(pdfSentinel);
  expect(output).not.toContain(imageSentinel);

  await (await primaryNavigationLink(pdf, "Extract text")).click();
  await expect(pdf.getByRole("heading", { name: "Your editable result will appear here" })).toBeVisible();
  await expect(pdf.getByText("clean-screenshot.png", { exact: true })).toHaveCount(0);
  await expect(pdf.getByText(displayedName, { exact: true })).toHaveCount(0);
  await expect(pdf.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /Your edits/ })).toHaveValue(imageSentinel);

  const localOrigin = new URL(page.url()).origin;
  // Edge can load edge://downloads-hub resources after the explicit download.
  // Browser UI resources are outside the site's HTTP(S) network/data flow.
  const networkRequests = requests.filter((request) => ["http:", "https:"].includes(new URL(request.url).protocol));
  expect(networkRequests.every((request) => new URL(request.url).origin === localOrigin && request.method === "GET")).toBe(true);
  for (const request of networkRequests) {
    const requestData = decodeURIComponent(request.url) + request.body;
    expect(requestData).not.toContain(imageSentinel);
    expect(requestData).not.toContain(pdfSentinel);
    expect(requestData).not.toContain(displayedName);
    expect(requestData).not.toContain("PDF PHASE ZERO SELECTABLE 271828");
  }
  expect(pageErrors).toEqual([]);
  await guide.close();
  await pdf.close();
});

test("public homepage keeps image selection in the first mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const choose = page.getByRole("button", { name: "Choose image", exact: true });
  await expect(choose).toBeInViewport({ ratio: 1 });
  const bounds = await choose.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole("region", { name: "PDF to text", exact: true })).toBeVisible();
});
