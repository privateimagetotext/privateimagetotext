import languageManifest from "../../src/config/ocr-languages.json" with { type: "json" };
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

type Phase = "text" | "render" | "recognition" | "reject-recognition";
type Control = {
  armed: Phase | null;
  holding: Phase | null;
  released: number;
  textChunks: number;
  textCancels: number;
  renderCompletions: number;
  renderCancels: number;
  recognitionRequests: number;
  recognitionReplies: number;
  injectedRejections: number;
  workersActive: number;
  ocrWorkersActive: number;
  ocrWorkersCreated: number;
  canvases: Set<HTMLCanvasElement>;
  release: () => void;
};
type Fixture = { id: string; kind: string; filename: string; bytes: number; sha256: string };
type Evidence = Record<string, unknown> & { requests: string[]; outsideOrigins: string[]; pageErrors: string[] };
const root = path.resolve(import.meta.dirname, "../..");
const manifestBytes = readFileSync(path.join(import.meta.dirname, "corpus.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8")) as { cases: Fixture[] };
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const observations = new WeakMap<Page, Evidence>();
const editedSentinel = "Reviewed synthetic amount 7319.";

// These existing artificial fixtures are the only admitted document bytes.
async function fixture(id: "fixture-mixed" | "fixture-cmap-font") {
  const entry = manifest.cases.find((candidate) => candidate.id === id)!;
  expect(entry.kind).toBe("synthetic");
  const buffer = await readFile(path.join(root, "tmp/pdf-release-corpus", entry.filename));
  expect(buffer.length).toBe(entry.bytes);
  expect(sha256(buffer)).toBe(entry.sha256);
  return { entry, input: { name: entry.filename, mimeType: "application/pdf", buffer } };
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const state = (window as typeof window & { __pdfLifecycle: Control }).__pdfLifecycle;
    const { armed, holding, released, textChunks, textCancels, renderCompletions, renderCancels,
      recognitionRequests, recognitionReplies, injectedRejections, workersActive, ocrWorkersActive, ocrWorkersCreated } = state;
    return { armed, holding, released, textChunks, textCancels, renderCompletions, renderCancels,
      recognitionRequests, recognitionReplies, injectedRejections, workersActive, ocrWorkersActive, ocrWorkersCreated,
      nonzeroCanvases: [...state.canvases].filter((canvas) => canvas.width > 0 && canvas.height > 0).length };
  });
}

async function arm(page: Page, phase: Phase) {
  await page.evaluate((value) => {
    (window as typeof window & { __pdfLifecycle: Control }).__pdfLifecycle.armed = value;
  }, phase);
}

async function release(page: Page) {
  await page.evaluate(async () => {
    (window as typeof window & { __pdfLifecycle: Control }).__pdfLifecycle.release();
    // Let the actual late promise/message and React's next paint settle before
    // asserting that they did not overwrite the new document or its results.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  await expect.poll(async () => (await snapshot(page)).holding).toBeNull();
}

async function choose(page: Page, id: "fixture-mixed" | "fixture-cmap-font", replacing = false) {
  const { entry, input } = await fixture(id);
  const evidence = observations.get(page)!;
  (evidence.fixtures as unknown[]).push({ id: entry.id, sha256: entry.sha256, bytes: entry.bytes });
  await page.getByLabel("Choose one PDF").setInputFiles(input);
  if (replacing) await page.getByRole("dialog").getByRole("button", { name: "Replace PDF", exact: true }).click();
  await expect(page.getByRole("heading", { name: entry.filename, exact: true })).toBeVisible({ timeout: 10_000 });
}

async function configure(page: Page, mode: "automatic" | "ocr-all" = "automatic", pages = "1") {
  await page.getByRole("radio", { name: "Page range", exact: true }).check();
  await page.getByLabel("Pages to process", { exact: true }).fill(pages);
  await page.locator(`input[name="pdf-extraction-method"][value="${mode}"]`).check();
}

async function processDocument(page: Page) {
  await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
}

async function complete(page: Page) {
  await expect(page.getByRole("heading", { name: "Selected pages processed", exact: true })).toBeVisible({ timeout: 120_000 });
}

async function cancel(page: Page) {
  const started = Date.now();
  await page.getByRole("button", { name: "Cancel processing", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Processing cancelled — completed pages retained", exact: true })).toBeVisible({ timeout: 5_000 });
  observations.get(page)!.cancelElapsedMs = Date.now() - started;
}

async function clearAndAssertResources(page: Page) {
  await page.getByRole("button", { name: "Clear PDF", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Clear PDF", exact: true }).click();
  await expect(page.locator(".pdf-results")).toHaveCount(0);
  await expect.poll(async () => (await snapshot(page)).workersActive).toBe(0);
  await expect.poll(async () => (await snapshot(page)).nonzeroCanvases).toBe(0);
  expect(observations.get(page)!.pageErrors).toEqual([]);
  expect(observations.get(page)!.outsideOrigins).toEqual([]);
}

async function injectPdfBoundary(page: Page) {
  await page.route("**/pdf/*/api/pdf.mjs", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({ response, body: `${source}
const lifecycleOriginalGetDocument = getDocument;
getDocument = (...args) => {
  const task = lifecycleOriginalGetDocument(...args);
  task.promise.then((document) => {
    const getPage = document.getPage.bind(document);
    const wrapped = new WeakSet();
    document.getPage = async (number) => {
      const page = await getPage(number);
      if (wrapped.has(page)) return page;
      wrapped.add(page);
      const control = globalThis.__pdfLifecycle;
      const streamText = page.streamTextContent.bind(page);
      page.streamTextContent = (...options) => {
        const stream = streamText(...options);
        if (control.armed !== "text") return stream;
        control.armed = null;
        const reader = stream.getReader();
        let first = true;
        return { getReader: () => ({
          read: async () => {
            const chunk = await reader.read();
            if (!first || chunk.done) return chunk;
            first = false;
            control.textChunks += 1;
            control.holding = "text";
            return new Promise((resolve) => { control.release = () => {
              control.holding = null; control.released += 1; resolve(chunk);
            }; });
          },
          cancel: (...args) => { control.textCancels += 1; return reader.cancel(...args); },
          releaseLock: () => reader.releaseLock(),
        }) };
      };
      const render = page.render.bind(page);
      page.render = (...options) => {
        const task = render(...options);
        if (control.armed !== "render") return task;
        control.armed = null;
        // The native renderer completes unchanged; hold only its promise delivery.
        return {
          promise: task.promise.then((value) => {
            control.renderCompletions += 1;
            control.holding = "render";
            return new Promise((resolve) => { control.release = () => {
              control.holding = null; control.released += 1; resolve(value);
            }; });
          }),
          cancel: (...args) => { control.renderCancels += 1; return task.cancel(...args); },
        };
      };
      return page;
    };
  }).catch(() => {});
  return task;
};` });
  });
}

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ page, baseURL, browser, request }, info) => {
  test.setTimeout(180_000);
  const origin = new URL(baseURL!).origin;
  observations.set(page, {
    scenario: info.title, checkedAt: new Date().toISOString(), browserProject: info.project.name,
    browserVersion: browser.version(), buildId: process.env.PDF_RELEASE_BUILD_ID ?? "NOT_RECORDED",
    corpusManifestSha256: sha256(manifestBytes), fixtures: [], requests: [], outsideOrigins: [], pageErrors: [],
    scope: "Injected completion/failure boundaries around real PDF.js, native canvas and Tesseract workers. Worker and bounded main-thread canvas observations only; not process memory, physical-device, offline or deployed-service evidence.",
  });
  const identity = await request.get("/__pdf-validation__/state");
  expect(identity.ok()).toBe(true);
  const served = await identity.json() as { buildId: string; fileCount: number };
  expect(served.buildId).toBe(process.env.PDF_RELEASE_BUILD_ID);
  observations.get(page)!.serverBuildId = served.buildId;
  observations.get(page)!.serverFileCount = served.fileCount;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["http:", "https:"].includes(url.protocol)) return;
    const evidence = observations.get(page)!;
    if (evidence.requests.length < 2000) evidence.requests.push(url.pathname);
    if (url.origin !== origin) evidence.outsideOrigins.push(url.origin);
  });
  page.on("pageerror", (error) => observations.get(page)!.pageErrors.push(error.name));
  await page.addInitScript(() => {
    const control: Control = {
      armed: null, holding: null, released: 0, textChunks: 0, textCancels: 0,
      renderCompletions: 0, renderCancels: 0, recognitionRequests: 0, recognitionReplies: 0,
      injectedRejections: 0, workersActive: 0, ocrWorkersActive: 0, ocrWorkersCreated: 0,
      canvases: new Set(), release: () => undefined,
    };
    (window as typeof window & { __pdfLifecycle: Control }).__pdfLifecycle = control;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private ended = false;
      private readonly isOcr: boolean;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.isOcr = new URL(String(url), location.href).pathname === "/ocr/worker.min.js";
        control.workersActive += 1;
        if (!this.isOcr) return;
        control.ocrWorkersActive += 1;
        control.ocrWorkersCreated += 1;
        let handler: ((this: Worker, event: MessageEvent) => unknown) | null = null;
        Object.defineProperty(this, "onmessage", { configurable: true,
          get: () => handler,
          set: (value: typeof handler) => { handler = value; },
        });
        this.addEventListener("message", (event) => {
          const data = event.data as { action?: string; status?: string };
          if (data.action === "recognize" && data.status === "resolve") {
            control.recognitionReplies += 1;
            if (control.armed === "recognition") {
              control.armed = null; control.holding = "recognition";
              const selectedHandler = handler;
              control.release = () => {
                control.holding = null; control.released += 1;
                selectedHandler?.call(this, event);
              };
              return;
            }
            if (control.armed === "reject-recognition") {
              control.armed = null; control.injectedRejections += 1;
              // Replace one real result with the engine's rejection protocol.
              handler?.call(this, new MessageEvent("message", { data: {
                ...event.data, status: "reject", data: "INJECTED OCR FAILURE SENTINEL",
              } }));
              return;
            }
          }
          handler?.call(this, event);
        });
      }
      override postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
        if (this.isOcr && (message as { action?: string })?.action === "recognize") control.recognitionRequests += 1;
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
      override terminate() {
        if (!this.ended) { control.workersActive -= 1; if (this.isOcr) control.ocrWorkersActive -= 1; }
        this.ended = true;
        super.terminate();
      }
    };
    for (const dimension of ["width", "height"] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, dimension)!;
      Object.defineProperty(HTMLCanvasElement.prototype, dimension, { ...descriptor,
        set(this: HTMLCanvasElement, value: number) {
          descriptor.set!.call(this, value);
          if (control.canvases.size < 32) control.canvases.add(this);
        },
      });
    }
  });
  await injectPdfBoundary(page);
  const response = await page.goto("/pdf-to-text");
  expect(response?.status()).toBe(200);
  observations.get(page)!.documentHtmlSha256 = sha256(await response!.body());
  await expect(page.getByRole("heading", { name: "Extract text from a PDF. Nothing uploaded.", exact: true })).toBeVisible();
});

test.afterEach(async ({ page }, info: TestInfo) => {
  const evidence = observations.get(page);
  if (!evidence) return;
  evidence.finalResources = await snapshot(page).catch(() => null);
  evidence.status = info.status;
  const filename = info.outputPath("lifecycle-evidence.json");
  await writeFile(filename, `${JSON.stringify(evidence, null, 2)}\n`);
  await info.attach("lifecycle-evidence", { path: filename, contentType: "application/json" });
});

test("failed OCR page replacement preserves reviewed text and its download", async ({ page }) => {
  await choose(page, "fixture-mixed");
  await configure(page);
  await processDocument(page);
  await complete(page);
  await page.getByLabel("Editable text for page 1", { exact: true }).fill(editedSentinel);
  await arm(page, "reject-recognition");
  await page.getByRole("button", { name: "Force OCR for this page", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reprocess page", exact: true }).click();
  await expect(page.locator(".pdf-page-editor .pdf-control-error")).toContainText("Text could not be recognised on this PDF page", { timeout: 120_000 });
  await expect(page.getByLabel("Editable text for page 1", { exact: true })).toHaveValue(editedSentinel);
  await expect(page.locator(".pdf-method-badge")).toHaveText("PDF text");
  await expect(page.locator("body")).not.toContainText("INJECTED OCR FAILURE SENTINEL");
  expect((await snapshot(page)).injectedRejections).toBe(1);
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .txt", exact: true }).click();
  const download = await pendingDownload;
  const output = await readFile((await download.path())!, "utf8");
  expect(output).toContain(editedSentinel);
  observations.get(page)!.retainedTextSha256 = sha256(editedSentinel);
  await clearAndAssertResources(page);
});

for (const phase of ["text", "render", "recognition"] as const) {
  test(`file replacement rejects late ${phase} completion`, async ({ page }) => {
    await choose(page, "fixture-mixed");
    await configure(page, phase === "text" ? "automatic" : "ocr-all");
    await arm(page, phase);
    await processDocument(page);
    await expect.poll(async () => (await snapshot(page)).holding, { timeout: 120_000 }).toBe(phase);
    observations.get(page)!.heldResources = await snapshot(page);
    await choose(page, "fixture-cmap-font", true);
    await expect(page.locator(".pdf-results")).toHaveCount(0);
    await expect.poll(async () => (await snapshot(page)).workersActive).toBe(1);
    await expect.poll(async () => (await snapshot(page)).ocrWorkersActive).toBe(0);
    await expect.poll(async () => (await snapshot(page)).nonzeroCanvases).toBe(0);
    await configure(page);
    await processDocument(page);
    await complete(page);
    const editor = page.getByLabel("Editable text for page 1", { exact: true });
    await expect(editor).toHaveValue(/CMAP SUPPORT SENTINEL/);
    const replacement = await editor.inputValue();
    await release(page);
    await expect(editor).toHaveValue(replacement);
    await expect(page.getByRole("heading", { name: "fixture-cmap-font.pdf", exact: true })).toBeVisible();
    expect((await snapshot(page)).released).toBe(1);
    observations.get(page)!.replacementTextSha256 = sha256(replacement);
    await clearAndAssertResources(page);
  });
}

test("cancel during held native render completion stops before OCR and permits retry", async ({ page }) => {
  await choose(page, "fixture-mixed");
  await configure(page, "ocr-all");
  await arm(page, "render");
  await processDocument(page);
  await expect.poll(async () => (await snapshot(page)).holding).toBe("render");
  await expect(page.locator(".pdf-progress")).toContainText(/Preparing the selected PDF page/);
  expect((await snapshot(page)).nonzeroCanvases).toBeGreaterThan(0);
  await cancel(page);
  await release(page);
  expect((await snapshot(page)).renderCancels).toBeGreaterThan(0);
  expect((await snapshot(page)).recognitionRequests).toBe(0);
  expect(observations.get(page)!.requests.some((url) => url.startsWith("/ocr/"))).toBe(false);
  await expect.poll(async () => (await snapshot(page)).nonzeroCanvases).toBe(0);
  await processDocument(page);
  await complete(page);
  await expect(page.getByLabel("Editable text for page 1", { exact: true })).toHaveValue(/MIXED/);
  await clearAndAssertResources(page);
});

test("cancel while an OCR model request is held ignores late startup and permits fresh OCR", async ({ page, request }) => {
  const controlPath = "/__pdf-validation__/control";
  const configured = await request.post(controlPath, { data: {
    fault: { path: languageManifest.models[0].path, kind: "hold" }, resetLog: true,
  } });
  expect(configured.ok()).toBe(true);
  try {
    await choose(page, "fixture-mixed");
    await configure(page, "ocr-all");
    await processDocument(page);
    await expect.poll(async () => {
      const response = await request.get("/__pdf-validation__/state");
      const state = await response.json() as { heldRequests: number | unknown[] };
      return Array.isArray(state.heldRequests) ? state.heldRequests.length : state.heldRequests;
    }, { timeout: 120_000 }).toBeGreaterThan(0);
    observations.get(page)!.heldAssetResources = await snapshot(page);
    await cancel(page);
    observations.get(page)!.cancelledWithAssetHeldResources = await snapshot(page);
    expect((await snapshot(page)).recognitionRequests).toBe(0);
    await expect.poll(async () => (await snapshot(page)).nonzeroCanvases).toBe(0);
    expect((await request.post(controlPath, { data: { fault: null } })).ok()).toBe(true);
    await expect.poll(async () => (await snapshot(page)).ocrWorkersActive, { timeout: 120_000 }).toBe(0);
    await expect(page.getByLabel("Editable text for page 1", { exact: true })).toHaveCount(0);
    await processDocument(page);
    await complete(page);
    await expect(page.getByLabel("Editable text for page 1", { exact: true })).toHaveValue(/MIXED/);
    expect((await snapshot(page)).ocrWorkersCreated).toBe(2);
    await clearAndAssertResources(page);
  } finally {
    await request.post(controlPath, { data: { fault: null } });
  }
});

test("one OCR worker job rejection is safe and later selected pages continue", async ({ page }) => {
  await choose(page, "fixture-mixed");
  await configure(page, "ocr-all", "1-2");
  await arm(page, "reject-recognition");
  await processDocument(page);
  await expect(page.getByRole("heading", { name: "Partial result — review page warnings", exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator(".pdf-page-list button").filter({ hasText: "Page 1" })).toContainText("Failed");
  await page.locator(".pdf-page-list button").filter({ hasText: "Page 1" }).click();
  await expect(page.locator(".pdf-page-editor .pdf-control-error")).toContainText("Text could not be recognised on this PDF page");
  await expect(page.locator("body")).not.toContainText("INJECTED OCR FAILURE SENTINEL");
  await page.locator(".pdf-page-list button").filter({ hasText: "Page 2" }).click();
  await expect(page.getByLabel("Editable text for page 2", { exact: true })).not.toHaveValue("");
  await expect(page.locator(".pdf-method-badge")).toHaveText("OCR");
  expect((await snapshot(page)).recognitionReplies).toBe(2);
  expect((await snapshot(page)).injectedRejections).toBe(1);
  await clearAndAssertResources(page);
});
