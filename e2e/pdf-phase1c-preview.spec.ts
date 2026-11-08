import { access, readFile } from "node:fs/promises";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const fixtureRoot = path.resolve("tmp", "pdf-phase0", "fixtures");
const fixturePath = (name: string) => path.join(fixtureRoot, name);
const pdfFixtures = [
  "selectable.pdf",
  "scanned.pdf",
  "mixed.pdf",
  "password.pdf",
  "benchmark-10.pdf",
] as const;

type BrowserEvidence = {
  clipboardText: string;
  workersCreated: number;
  workersActive: number;
  objectUrls: number;
};

test.beforeAll(async () => {
  await Promise.all(pdfFixtures.map((name) => access(fixturePath(name))));
});

async function installBrowserEvidence(page: Page) {
  await page.addInitScript(() => {
    const evidence: BrowserEvidence = {
      clipboardText: "",
      workersCreated: 0,
      workersActive: 0,
      objectUrls: 0,
    };
    const target = window as typeof window & {
      __phase1cEvidence?: BrowserEvidence;
    };
    target.__phase1cEvidence = evidence;

    const NativeWorker = window.Worker;
    window.Worker = class TrackingWorker extends NativeWorker {
      private phase1cTerminated = false;

      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        evidence.workersCreated += 1;
        evidence.workersActive += 1;
      }

      override terminate() {
        if (!this.phase1cTerminated) {
          this.phase1cTerminated = true;
          evidence.workersActive -= 1;
        }
        super.terminate();
      }
    };

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          evidence.clipboardText = value;
        },
      },
    });

    const createObjectUrl = URL.createObjectURL.bind(URL);
    const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      const url = createObjectUrl(object);
      evidence.objectUrls += 1;
      return url;
    };
    URL.revokeObjectURL = (url) => {
      evidence.objectUrls = Math.max(0, evidence.objectUrls - 1);
      revokeObjectUrl(url);
    };
  });
}

async function browserEvidence(page: Page) {
  return page.evaluate(() =>
    (window as typeof window & { __phase1cEvidence: BrowserEvidence })
      .__phase1cEvidence,
  );
}

async function openPreview(page: Page) {
  const response = await page.goto("/pdf-to-text");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Extract text from a PDF. Nothing uploaded.",
    }),
  ).toBeVisible();
  await expect(page.locator(".pdf-preview-notice__title")).toHaveText(
    "PDF to Text preview",
  );
}

async function selectFixture(
  page: Page,
  fixture: string,
  displayedName = fixture,
) {
  const buffer = await readFile(fixturePath(fixture));
  await page.getByLabel("Choose one PDF").setInputFiles({
    name: displayedName,
    mimeType: "application/pdf",
    buffer,
  });
}

async function waitForDocument(page: Page, displayedName: string) {
  await expect(
    page.getByRole("heading", { level: 2, name: displayedName }),
  ).toBeVisible({ timeout: 90_000 });
}

async function processSelectedPages(page: Page) {
  await page.getByRole("button", { name: "Process selected pages" }).click();
  await expect(page.locator(".pdf-results")).toBeVisible({ timeout: 240_000 });
}

function resultPageButton(page: Page, pageNumber: number) {
  return page
    .locator(".pdf-page-list button")
    .filter({ has: page.getByText(`Page ${pageNumber}`, { exact: true }) });
}

async function clearWorkspace(page: Page) {
  await page.getByRole("button", { name: "Clear PDF" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Clear this PDF and its results?",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Clear PDF" }).click();
  await expect(page.getByRole("button", { name: "Choose PDF" })).toBeVisible();
}

function supportRequest(pathname: string) {
  return (
    pathname.startsWith("/pdf/6.2.108/") ||
    /\/assets\/.*pdfjs/i.test(pathname) ||
    pathname.startsWith("/ocr/")
  );
}

function ocrSupportRequest(pathname: string) {
  return pathname.startsWith("/ocr/");
}

test("direct preview route is noindex and initially loads no PDF/OCR runtime @phase1c-core", async ({
  page,
}) => {
  const runtimeRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (supportRequest(pathname)) runtimeRequests.push(pathname);
  });

  await openPreview(page);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow",
  );
  await page.waitForTimeout(500);
  expect(runtimeRequests).toEqual([]);

  await page.reload();
  await expect(page.locator("h1")).toHaveCount(1);
  expect(runtimeRequests).toEqual([]);
  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  expect(sitemap).not.toContain("pdf-to-text");
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

test("selectable Automatic supports editing, output, dirty override and Clear @phase1c-core", async ({
  page,
}) => {
  await installBrowserEvidence(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await openPreview(page);

  const displayedName = "phase1c-selectable-private.pdf";
  await selectFixture(page, "selectable.pdf", displayedName);
  await waitForDocument(page, displayedName);
  await expect.poll(() => requests.some((value) => value.includes("pdf.worker"))).toBe(true);

  await processSelectedPages(page);
  await expect(page.locator(".pdf-method-badge")).toHaveText("PDF text");
  expect(requests.some(ocrSupportRequest)).toBe(false);

  await resultPageButton(page, 1).focus();
  await resultPageButton(page, 1).press("ArrowDown");
  await expect(resultPageButton(page, 2)).toHaveAttribute("aria-current", "page");
  await resultPageButton(page, 1).click();

  const editor = page.getByLabel("Editable text for page 1");
  const editedText = "USER EDIT SENTINEL 8675309";
  await editor.fill(editedText);
  await expect(page.getByText(/Edited in this tab/)).toBeVisible();

  await page.getByRole("button", { name: "Copy all" }).click();
  await expect.poll(async () => (await browserEvidence(page)).clipboardText).toContain(
    editedText,
  );
  const copied = (await browserEvidence(page)).clipboardText;
  expect(copied).toContain("--- Page 1");
  expect(copied).toContain("--- Page 2");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .txt" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "phase1c-selectable-private-pdf-text.txt",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  expect(await readFile(downloadPath!, "utf8")).toContain(editedText);
  await expect.poll(async () => (await browserEvidence(page)).objectUrls).toBe(0);

  await page.getByRole("button", { name: "Force OCR for this page" }).click();
  const dirtyDialog = page.getByRole("dialog", { name: "Reprocess page 1?" });
  await expect(dirtyDialog).toBeVisible();
  await dirtyDialog.getByRole("button", { name: "Keep current work" }).click();
  await expect(editor).toHaveValue(editedText);

  await page.getByRole("button", { name: "Force OCR for this page" }).click();
  await dirtyDialog.getByRole("button", { name: "Reprocess page" }).click();
  await expect(page.locator(".pdf-method-badge")).toHaveText("OCR", {
    timeout: 240_000,
  });
  expect(requests.some(ocrSupportRequest)).toBe(true);

  await page
    .getByRole("button", { name: "Use existing PDF text for this page" })
    .click();
  await expect(page.locator(".pdf-method-badge")).toHaveText("PDF text", {
    timeout: 90_000,
  });

  await clearWorkspace(page);
  await expect.poll(async () => (await browserEvidence(page)).workersActive).toBe(0);
});

test("mixed Automatic reports PDF text and OCR per page @phase1c-core", async ({
  page,
}) => {
  await openPreview(page);
  await selectFixture(page, "mixed.pdf", "phase1c-mixed.pdf");
  await waitForDocument(page, "phase1c-mixed.pdf");
  await processSelectedPages(page);

  await expect(resultPageButton(page, 1)).toContainText("PDF text");
  await expect(resultPageButton(page, 2)).toContainText("OCR");
  await resultPageButton(page, 2).click();
  await expect(page.getByLabel("Editable text for page 2")).toHaveValue(
    /SENTINEL/i,
  );
});

test("page range and explicit extraction modes use the production sessions @phase1c-core", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await openPreview(page);
  await selectFixture(page, "selectable.pdf", "phase1c-range.pdf");
  await waitForDocument(page, "phase1c-range.pdf");
  await page.getByRole("radio", { name: "Page range" }).check();
  await page.getByLabel("Pages to process").fill("2");
  await page.getByRole("radio", { name: /Existing PDF text only/ }).check();
  await expect(page.getByRole("group", { name: "English OCR options" })).toHaveCount(0);
  await processSelectedPages(page);
  await expect(page.locator(".pdf-page-list button")).toHaveCount(1);
  await expect(resultPageButton(page, 2)).toContainText("PDF text");
  expect(requests.some(ocrSupportRequest)).toBe(false);

  await clearWorkspace(page);
  await selectFixture(page, "scanned.pdf", "phase1c-ocr-all.pdf");
  await waitForDocument(page, "phase1c-ocr-all.pdf");
  await page.getByRole("radio", { name: /OCR selected pages/ }).check();
  await expect(page.getByRole("group", { name: "English OCR options" })).toBeVisible();
  await processSelectedPages(page);
  await expect(resultPageButton(page, 1)).toContainText("OCR");
});

test("password rejection, acceptance and Escape cancellation remain ephemeral @phase1c-core", async ({
  page,
}) => {
  await openPreview(page);
  await selectFixture(page, "password.pdf", "phase1c-password-private.pdf");
  const passwordDialog = page.getByRole("dialog", {
    name: "Enter the PDF password",
  });
  await expect(passwordDialog).toBeVisible();
  await expect(passwordDialog.getByLabel("Password")).toBeFocused();
  await passwordDialog.getByLabel("Password").fill("wrong-password");
  await passwordDialog.getByRole("button", { name: "Open PDF" }).click();
  await expect(passwordDialog.getByText("That password was not accepted.")).toBeVisible();
  await expect(passwordDialog.getByLabel("Password")).toHaveValue("");
  await passwordDialog.getByLabel("Password").fill("phase0-only");
  await passwordDialog.getByRole("button", { name: "Open PDF" }).click();
  await waitForDocument(page, "phase1c-password-private.pdf");
  await expect(page.getByText("Password accepted", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: /Existing PDF text only/ }).check();
  await processSelectedPages(page);
  await expect(page.getByLabel("Editable text for page 1")).toHaveValue(
    /PASSWORD FIXTURE OPEN 424242/,
  );

  await clearWorkspace(page);
  await selectFixture(page, "password.pdf", "phase1c-password-cancel.pdf");
  await expect(passwordDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(passwordDialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose PDF" })).toBeFocused();
  const storage = await page.evaluate(() => ({
    local: JSON.stringify(localStorage),
    session: JSON.stringify(sessionStorage),
    cookies: document.cookie,
    url: location.href,
  }));
  expect(JSON.stringify(storage)).not.toContain("phase0-only");
  expect(JSON.stringify(storage)).not.toContain("wrong-password");
});

test("cancellation retains completed pages and stops later work @phase1c-core", async ({
  page,
}) => {
  await openPreview(page);
  await selectFixture(page, "benchmark-10.pdf", "phase1c-cancel.pdf");
  await waitForDocument(page, "phase1c-cancel.pdf");
  await page.getByRole("radio", { name: /OCR selected pages/ }).check();
  await page.getByRole("button", { name: "Process selected pages" }).click();
  await expect(page.locator(".pdf-progress")).toContainText(
    /Page (?:[2-9]|10).*?(?:[2-9]|10) of 10/s,
    {
      timeout: 240_000,
    },
  );
  await page.getByRole("button", { name: "Cancel processing" }).click();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: /Processing cancelled.*completed pages retained/,
    }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".pdf-page-list button")).toHaveCount(10);
  expect(await page.locator(".pdf-page-list button", { hasText: "Complete" }).count()).toBeGreaterThan(0);
  expect(await page.locator(".pdf-page-list button", { hasText: "Not processed" }).count()).toBeGreaterThan(0);
});

test("invalid ranges and unavailable offline support fail early @phase1c-extended", async ({
  page,
  context,
}) => {
  await openPreview(page);
  await selectFixture(page, "selectable.pdf", "phase1c-invalid-range.pdf");
  await waitForDocument(page, "phase1c-invalid-range.pdf");
  await page.getByRole("radio", { name: "Page range" }).check();
  await page.getByLabel("Pages to process").fill("0-2");
  await expect(page.getByText("Enter a valid PDF page or page range.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Process selected pages" })).toBeDisabled();
  await clearWorkspace(page);

  await context.setOffline(true);
  await selectFixture(page, "scanned.pdf", "phase1c-offline-missing.pdf");
  await expect(
    page.getByText(
      "The PDF reader is not available offline. Connect to the internet and prepare it first.",
    ),
  ).toBeVisible();
  await expect(page.getByText("phase1c-offline-missing.pdf")).toHaveCount(0);
});

test("representative workflows transmit and persist no user content @phase1c-extended", async ({
  page,
  context,
  baseURL,
}) => {
  const expectedOrigin = new URL(baseURL!).origin;
  const externalRequests: string[] = [];
  const requestEvidence: string[] = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== expectedOrigin) {
      externalRequests.push(request.url());
      await route.abort();
      return;
    }
    requestEvidence.push(
      JSON.stringify({
        url: request.url(),
        headers: await request.allHeaders(),
        body: request.postData(),
      }),
    );
    await route.continue();
  });

  await openPreview(page);
  await selectFixture(page, "selectable.pdf", "PRIVATE-PHASE1C-SELECTABLE.pdf");
  await waitForDocument(page, "PRIVATE-PHASE1C-SELECTABLE.pdf");
  await processSelectedPages(page);
  await clearWorkspace(page);

  await selectFixture(page, "scanned.pdf", "PRIVATE-PHASE1C-SCANNED.pdf");
  await waitForDocument(page, "PRIVATE-PHASE1C-SCANNED.pdf");
  await page.getByRole("radio", { name: /OCR selected pages/ }).check();
  await processSelectedPages(page);
  await clearWorkspace(page);

  await selectFixture(page, "password.pdf", "PRIVATE-PHASE1C-PASSWORD.pdf");
  const passwordDialog = page.getByRole("dialog", { name: "Enter the PDF password" });
  await passwordDialog.getByLabel("Password").fill("phase0-only");
  await passwordDialog.getByRole("button", { name: "Open PDF" }).click();
  await waitForDocument(page, "PRIVATE-PHASE1C-PASSWORD.pdf");

  const storage = await page.evaluate(async () => {
    const cacheKeys = (
      await Promise.all(
        (await caches.keys()).map(async (name) => ({
          name,
          requests: (await (await caches.open(name)).keys()).map((request) => request.url),
        })),
      )
    ).flatMap((entry) => [entry.name, ...entry.requests]);
    return {
      localStorage: Object.entries(localStorage),
      sessionStorage: Object.entries(sessionStorage),
      indexedDb: await indexedDB.databases(),
      cacheKeys,
      cookies: document.cookie,
      url: location.href,
    };
  });
  const privateValues = [
    "PRIVATE-PHASE1C",
    "271828",
    "314159",
    "phase0-only",
    "PASSWORD FIXTURE OPEN 424242",
  ];
  const serialisedNetwork = requestEvidence.join("\n");
  const serialisedStorage = JSON.stringify(storage);
  for (const value of privateValues) {
    expect(serialisedNetwork).not.toContain(value);
    expect(serialisedStorage).not.toContain(value);
  }
  expect(externalRequests).toEqual([]);
  expect(storage.cacheKeys.every((value) => value.startsWith("localtext-") || value.startsWith(expectedOrigin))).toBe(true);
});

test("explicit preparation supports a prepared offline reload @phase1c-extended", async ({
  page,
  context,
}) => {
  await openPreview(page);
  await page.evaluate(() => {
    const target = window as typeof window & {
      __phase1cPdfCacheMessages?: unknown[];
    };
    target.__phase1cPdfCacheMessages = [];
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (String(event.data?.type ?? "").startsWith("PDF_CACHE_")) {
        target.__phase1cPdfCacheMessages?.push(event.data);
      }
    });
  });
  await page.getByRole("button", { name: "Prepare PDF and OCR support" }).click();
  const terminalPdfCacheMessage = () =>
    page.evaluate(() => {
      const messages = (
        window as typeof window & { __phase1cPdfCacheMessages?: unknown[] }
      ).__phase1cPdfCacheMessages ?? [];
      return messages.find((value) => {
        const type = (value as { type?: string }).type;
        return type === "PDF_CACHE_STATUS" || type === "PDF_CACHE_FAILED";
      }) ?? null;
    });
  await expect.poll(terminalPdfCacheMessage, { timeout: 240_000 }).not.toBeNull();
  const pdfCacheResult = await terminalPdfCacheMessage() as {
    type?: string;
    ready?: boolean;
  } | null;
  if (pdfCacheResult?.type !== "PDF_CACHE_STATUS" || pdfCacheResult.ready !== true) {
    throw new Error(`PDF cache preparation result: ${JSON.stringify(pdfCacheResult)}`);
  }
  await expect(page.getByText(/PDF reader available offline/)).toBeVisible({
    timeout: 240_000,
  });
  await expect(page.getByText(/English OCR available offline/)).toBeVisible({
    timeout: 240_000,
  });

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Extract text from a PDF. Nothing uploaded.",
    }),
  ).toBeVisible();
  await selectFixture(page, "selectable.pdf", "phase1c-prepared-digital.pdf");
  await waitForDocument(page, "phase1c-prepared-digital.pdf");
  await page.getByRole("radio", { name: /Existing PDF text only/ }).check();
  await processSelectedPages(page);
  await expect(resultPageButton(page, 1)).toContainText("PDF text");

  await clearWorkspace(page);
  await selectFixture(page, "scanned.pdf", "phase1c-prepared-scan.pdf");
  await waitForDocument(page, "phase1c-prepared-scan.pdf");
  await page.getByRole("radio", { name: /OCR selected pages/ }).check();
  await processSelectedPages(page);
  await expect(resultPageButton(page, 1)).toContainText("OCR");
});

test("repeated process and Clear cycles release workers and accept the same PDF @phase1c-extended", async ({
  page,
}) => {
  await installBrowserEvidence(page);
  await openPreview(page);
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await selectFixture(page, "selectable.pdf", "phase1c-repeat.pdf");
    await waitForDocument(page, "phase1c-repeat.pdf");
    await processSelectedPages(page);
    await clearWorkspace(page);
    await expect.poll(async () => (await browserEvidence(page)).workersActive).toBe(0);
  }
  expect((await browserEvidence(page)).workersCreated).toBeGreaterThanOrEqual(3);
});

test("mobile Chromium keeps the page list and editor within the viewport @phase1c-mobile", async ({
  page,
}) => {
  await openPreview(page);
  await selectFixture(page, "selectable.pdf", "phase1c-mobile.pdf");
  await waitForDocument(page, "phase1c-mobile.pdf");
  await processSelectedPages(page);
  await expect(page.locator(".pdf-page-list")).toBeVisible();
  await expect(page.locator(".pdf-page-editor")).toBeVisible();
  const geometry = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    buttons: Array.from(document.querySelectorAll<HTMLButtonElement>(".pdf-page-list button"))
      .map((button) => button.getBoundingClientRect().height),
  }));
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.buttons.every((height) => height >= 40)).toBe(true);
});
