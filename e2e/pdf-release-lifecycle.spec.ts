import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

type EncodingRaceControl = {
  armed: boolean;
  holding: boolean;
  released: boolean;
  nativeBlobBytes: number;
  ocrWorkersCreated: number;
  ocrWorkersActive: number;
  release: () => void;
};

// Small, generated fixtures contain no personal data and need no external corpus.
function pdf(pages: number, text = true) {
  const objects: string[] = ["", ""];
  const fontId = 3 + pages * 2;
  const kids: string[] = [];
  for (let page = 1; page <= pages; page += 1) {
    const pageId = 3 + (page - 1) * 2;
    kids.push(`${pageId} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    const content = text
      ? `BT /F1 12 Tf 72 700 Td (Local PDF lifecycle fixture page ${page} contains selectable text for verification.) Tj ET`
      : "";
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Count ${pages} /Kids [${kids.join(" ")}] >>`;
  let result = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(result));
    result += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  result += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}

async function choose(page: Page, name: string, pages = 2, text = true) {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/pdf", buffer: pdf(pages, text) });
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

async function injectPageBehavior(page: Page, body: string) {
  await page.route("**/pdf/*/api/pdf.mjs", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({
      response,
      body: `${source}\nconst originalReleaseTestGetDocument = getDocument;
getDocument = (...args) => {
  const task = originalReleaseTestGetDocument(...args);
  task.promise.then((document) => {
    const originalGetPage = document.getPage.bind(document);
    document.getPage = async (number) => {
      const page = await originalGetPage(number);
      ${body}
      return page;
    };
  }).catch(() => {});
  return task;
};`,
    });
  });
}

test.use({ serviceWorkers: "block" });

test("restored PDF lifecycle clears stale state and accepts the same file again @phase1c-core", async ({ page }) => {
  await page.goto("/pdf-to-text");
  await choose(page, "restored.pdf");
  await page.getByRole("button", { name: "Process selected pages" }).click();
  await expect(page.getByLabel(/Editable text for page 1/)).toHaveValue(/Local PDF lifecycle fixture/);
  // Deterministically exercise the persisted lifecycle in every engine. Actual
  // BFCache eligibility and physical background/restore remain separate checks.
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect(page.getByRole("heading", { name: "restored.pdf", exact: true })).toHaveCount(0);
  await expect(page.getByLabel(/Editable text for page/)).toHaveCount(0);
  await expect(page.getByText(/previous PDF workspace was cleared/)).toBeVisible();
  await choose(page, "restored.pdf");
  await page.getByRole("button", { name: "Process selected pages" }).click();
  await expect(page.getByLabel(/Editable text for page 1/)).toHaveValue(/Local PDF lifecycle fixture/);
});

test("selected-page overflow remains actionable in the PDF UI @phase1c-core", async ({ page }) => {
  await page.goto("/pdf-to-text");
  await choose(page, "fifty-one-pages.pdf", 51);
  await page.getByLabel("Pages to process", { exact: true }).fill("1-51");
  await expect(page.getByRole("alert")).toContainText("too many PDF pages");
  await expect(page.getByRole("button", { name: "Process selected pages" })).toBeDisabled();
  await page.getByLabel("Pages to process", { exact: true }).fill("1-2");
  await expect(page.getByRole("button", { name: "Process selected pages" })).toBeEnabled();
});

for (const method of ["Automatic", "OCR selected pages"]) {
  test(`${method} rejects OCR-page overflow before requesting OCR assets @phase1c-core`, async ({ page }) => {
    const ocrRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/ocr/")) ocrRequests.push(request.url());
    });
    await page.goto("/pdf-to-text");
    await choose(page, "twenty-six-scanned-pages.pdf", 26, false);
    await page.getByRole("radio", { name: new RegExp(`^${method}`) }).check();
    await page.getByRole("button", { name: "Process selected pages" }).click();
    await expect(page.getByRole("alert")).toContainText("Too many selected pages require OCR");
    expect(ocrRequests).toEqual([]);
    await expect(page.getByRole("group", { name: "Pages", exact: true })).toBeFocused();
  });
}

test("Cancel during a stalled text preflight settles and allows replacement @phase1c-core", async ({ page }) => {
  await injectPageBehavior(page, `
    page.streamTextContent = () => {
      globalThis.__pdfReleaseTextStarted = true;
      return new ReadableStream({ start() {} });
    };
  `);
  await page.goto("/pdf-to-text");
  await choose(page, "stalled-text.pdf");
  await page.getByRole("button", { name: "Process selected pages" }).click();
  await expect.poll(() => page.evaluate(() =>
    (globalThis as typeof globalThis & { __pdfReleaseTextStarted?: boolean }).__pdfReleaseTextStarted,
  )).toBe(true);
  await expect(page.getByRole("button", { name: "Cancel processing", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel processing", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Processing cancelled — completed pages retained", exact: true })).toBeVisible({ timeout: 5_000 });
  await page.locator('input[type="file"]').setInputFiles({ name: "replacement.pdf", mimeType: "application/pdf", buffer: pdf(1) });
  await page.getByRole("dialog").getByRole("button", { name: "Replace PDF", exact: true }).click();
  await expect(page.getByRole("heading", { name: "replacement.pdf", exact: true })).toBeVisible({ timeout: 5_000 });
});

test("Cancel during native canvas encoding rejects late OCR work and allows a fresh worker @phase1c-core", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const control: EncodingRaceControl = {
      armed: false, holding: false, released: false, nativeBlobBytes: 0,
      ocrWorkersCreated: 0, ocrWorkersActive: 0, release: () => undefined,
    };
    (window as typeof window & { __pdfEncodingRace: EncodingRaceControl }).__pdfEncodingRace = control;
    const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      const hold = control.armed && type === "image/png" && this.width > 0 && this.height > 0;
      if (hold) control.armed = false;
      // Keep actual native encoding and Blob bytes; delay only callback delivery.
      nativeToBlob.call(this, (blob) => {
        if (!hold) { callback(blob); return; }
        control.nativeBlobBytes = blob?.size ?? 0;
        control.holding = true;
        control.release = () => {
          control.release = () => undefined;
          control.holding = false;
          control.released = true;
          callback(blob);
        };
      }, type, quality);
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private readonly isOcr: boolean;
      private terminated = false;
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        this.isOcr = new URL(String(scriptURL), location.href).pathname === "/ocr/worker.min.js";
        if (this.isOcr) { control.ocrWorkersCreated += 1; control.ocrWorkersActive += 1; }
      }
      override terminate() {
        if (this.isOcr && !this.terminated) control.ocrWorkersActive -= 1;
        this.terminated = true;
        super.terminate();
      }
    };
  });
  const evidence = () => page.evaluate(() => {
    const { holding, released, nativeBlobBytes, ocrWorkersCreated, ocrWorkersActive } =
      (window as typeof window & { __pdfEncodingRace: EncodingRaceControl }).__pdfEncodingRace;
    return { holding, released, nativeBlobBytes, ocrWorkersCreated, ocrWorkersActive };
  });
  const fixture = await readFile("tmp/pdf-phase0/fixtures/selectable.pdf");
  const selectForOcr = async () => {
    await page.locator('input[type="file"]').setInputFiles({ name: "encoding-race.pdf", mimeType: "application/pdf", buffer: fixture });
    await expect(page.getByRole("heading", { name: "encoding-race.pdf", exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "Page range", exact: true }).check();
    await page.getByLabel("Pages to process", { exact: true }).fill("1");
    await page.getByRole("radio", { name: /^OCR selected pages/ }).check();
  };
  const clear = async () => {
    await page.getByRole("button", { name: "Clear PDF", exact: true }).click();
    await page.getByRole("dialog", { name: "Clear this PDF and its results?" })
      .getByRole("button", { name: "Clear PDF", exact: true }).click();
    await expect(page.getByRole("button", { name: "Choose PDF", exact: true })).toBeVisible();
  };

  await page.goto("/pdf-to-text");
  await selectForOcr();
  await page.evaluate(() => {
    (window as typeof window & { __pdfEncodingRace: EncodingRaceControl }).__pdfEncodingRace.armed = true;
  });
  await page.getByRole("button", { name: "Process selected pages" }).click();
  await expect.poll(async () => (await evidence()).holding, { timeout: 120_000 }).toBe(true);
  expect((await evidence()).nativeBlobBytes).toBeGreaterThan(0);
  expect((await evidence()).ocrWorkersCreated).toBe(1);
  await page.getByRole("button", { name: "Cancel processing", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Processing cancelled — completed pages retained", exact: true })).toBeVisible({ timeout: 5_000 });
  await expect.poll(async () => (await evidence()).ocrWorkersActive).toBe(0);
  await page.evaluate(() => {
    (window as typeof window & { __pdfEncodingRace: EncodingRaceControl }).__pdfEncodingRace.release();
  });
  expect((await evidence()).released).toBe(true);
  await expect(page.locator(".pdf-page-list button")).toContainText("Not processed");
  await expect(page.getByLabel(/Editable text for page/)).toHaveCount(0);
  await clear();

  await selectForOcr();
  await page.getByRole("button", { name: "Process selected pages" }).click();
  await expect(page.getByRole("heading", { name: "Selected pages processed", exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator(".pdf-method-badge")).toHaveText("OCR");
  await expect(page.getByLabel("Editable text for page 1", { exact: true })).toHaveValue(/SELECTABLE/i);
  expect((await evidence()).ocrWorkersCreated).toBe(2);
  await clear();
  await expect.poll(async () => (await evidence()).ocrWorkersActive).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("a failed page shows safe partial results and later embedded text remains usable @phase1c-core", async ({ page }) => {
  await injectPageBehavior(page, `
    if (number === 1) {
      page.streamTextContent = () => new ReadableStream({ start(controller) { controller.error(new Error("PRIVATE PARSER SENTINEL")); } });
      page.render = () => ({ promise: Promise.reject(new Error("PRIVATE RENDER SENTINEL")), cancel() {} });
    }
  `);
  await page.goto("/pdf-to-text");
  await choose(page, "partial-results.pdf");
  await page.getByRole("button", { name: "Process selected pages" }).click();
  await expect(page.getByRole("heading", { name: "Partial result — review page warnings", exact: true })).toBeVisible();
  await expect(page.locator(".pdf-page-list button").filter({ hasText: "Page 1" })).toContainText("Failed");
  await page.locator(".pdf-page-list button").filter({ hasText: "Page 2" }).click();
  await expect(page.getByLabel(/Editable text for page 2/)).toHaveValue(/Local PDF lifecycle fixture page 2/);
  await expect(page.locator("body")).not.toContainText("PRIVATE PARSER SENTINEL");
  await expect(page.locator("body")).not.toContainText("PRIVATE RENDER SENTINEL");
});

test("combined text overflow retains complete earlier pages and exports visible failure markers @phase1c-extended", async ({ page }) => {
  await injectPageBehavior(page, `
    page.streamTextContent = () => new ReadableStream({
      start(controller) {
        controller.enqueue({ items: [{ str: "a".repeat(200000), dir: "ltr", transform: [1, 0, 0, 1, 72, 700], width: 400, height: 12 }] });
        controller.close();
      }
    });
  `);
  await page.goto("/pdf-to-text");
  await choose(page, "combined-limit.pdf", 11);
  await page.getByRole("radio", { name: /^Existing PDF text only/ }).check();
  await page.getByRole("button", { name: "Process selected pages" }).click();
  await expect(page.getByRole("heading", { name: "Partial result — review page warnings", exact: true })).toBeVisible();
  await expect(page.locator(".pdf-page-list button").filter({ hasText: "Complete" })).toHaveCount(10);
  await expect(page.locator(".pdf-page-list button").filter({ hasText: "Failed" })).toHaveCount(1);
  await expect(page.getByLabel(/Editable text for page 1$/)).toHaveValue("a".repeat(200_000));
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .txt", exact: true }).click();
  const download = await downloaded;
  const filename = await download.path();
  expect(filename).not.toBeNull();
  const output = await readFile(filename!, "utf8");
  expect(output.match(/a{200000}/g)).toHaveLength(10);
  expect(output).toContain("--- Page 11 — failed ---");
});
