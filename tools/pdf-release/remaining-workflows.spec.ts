import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PDF_ERROR_MESSAGES } from "../../src/features/pdf/errors";
import {
  assertPdfCache, control, goOffline, ocrCache, openWorkspace, prepareBoth,
  root, serverLog, sha256, storageSnapshot, type BuildManifest,
} from "./offline-helpers";

type Progress = { value: number | null; phase: string; position: string };
type NativeState = {
  pdfCreated: number; pdfActive: number; pdfMessages: number; pdfModuleWorkers: number;
  ocrCreated: number; ocrActive: number; recognitionRequests: number; maxOcrActive: number;
  positiveCanvasChanges: number; maxCanvasPixels: number; canvases: Set<HTMLCanvasElement>; urls: Set<string>;
  renderPages: number[]; heldPage: number | null; renderCancels: number; released: number; release: () => void;
  progress: Progress[]; progressTruncated: boolean;
};
type NativeSnapshot = Omit<NativeState, "canvases" | "urls" | "release"> & { nonzeroCanvases: number; objectUrls: number };
type Fixture = { id: string; file: string; bytes: number; sha256: string; structureAssertions: string[] };
type Evidence = Record<string, unknown> & {
  paths: string[]; outsideOrigins: string[]; nonReadRequests: string[]; contentLeakPaths: string[]; pageErrors: string[];
};
const manifestBytes = readFileSync(path.join(import.meta.dirname, "complex-fixtures.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8")) as { fixtures: Fixture[] };
const buildId = process.env.PDF_VALIDATION_EXPECTED_BUILD_ID;
const htmlSha = process.env.PDF_VALIDATION_EXPECTED_HTML_SHA256;
if (!buildId?.match(/^[a-f0-9]{64}$/u) || !htmlSha?.match(/^[a-f0-9]{64}$/u)) throw new Error("Set exact frozen PDF_VALIDATION_EXPECTED_BUILD_ID and PDF_VALIDATION_EXPECTED_HTML_SHA256.");
const evidenceByPage = new WeakMap<Page, Evidence>();
const buildByPage = new WeakMap<Page, BuildManifest>();
const outputsByPage = new WeakMap<Page, string[]>();
const inspectionsByPage = new WeakMap<Page, Promise<void>[]>();
const inputPrefix = "REMAINING-WORKFLOWS-PUBLIC-";
const reviewedSentinel = "REMAINING WORKFLOWS REVIEWED SAVINGS 849237";
const linearizedOnlineOutput = { characters: 1240, sha256: "498c8ae12b6da01f0f0b85d2ab3347f6bb5b796322b16821ce0b6c1fa0c9a74f" };

async function observe(page: Page) {
  await page.addInitScript(() => {
    const state: NativeState = {
      pdfCreated: 0, pdfActive: 0, pdfMessages: 0, pdfModuleWorkers: 0,
      ocrCreated: 0, ocrActive: 0, recognitionRequests: 0, maxOcrActive: 0,
      positiveCanvasChanges: 0, maxCanvasPixels: 0, canvases: new Set(), urls: new Set(),
      renderPages: [], heldPage: null, renderCancels: 0, released: 0, release: () => undefined,
      progress: [], progressTruncated: false,
    };
    (window as typeof window & { __remainingPdf: NativeState }).__remainingPdf = state;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private ended = false;
      private readonly isPdf: boolean;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.isPdf = /\/pdf\.worker(?:\.min)?\.mjs$/u.test(new URL(String(url), location.href).pathname);
        if (this.isPdf) {
          state.pdfCreated += 1; state.pdfActive += 1;
          if (options?.type === "module") state.pdfModuleWorkers += 1;
          this.addEventListener("message", () => { state.pdfMessages += 1; });
        } else {
          state.ocrCreated += 1; state.ocrActive += 1;
          state.maxOcrActive = Math.max(state.maxOcrActive, state.ocrActive);
        }
      }
      override postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
        if (!this.isPdf && (message as { action?: string })?.action === "recognize") state.recognitionRequests += 1;
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
      override terminate() {
        if (!this.ended) { if (this.isPdf) state.pdfActive -= 1; else state.ocrActive -= 1; }
        this.ended = true; super.terminate();
      }
    };
    for (const dimension of ["width", "height"] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, dimension)!;
      Object.defineProperty(HTMLCanvasElement.prototype, dimension, { ...descriptor,
        set(this: HTMLCanvasElement, value: number) {
          descriptor.set!.call(this, value); state.canvases.add(this);
          if (this.width > 0 && this.height > 0) state.positiveCanvasChanges += 1;
          state.maxCanvasPixels = Math.max(state.maxCanvasPixels, this.width * this.height);
        },
      });
    }
    const createUrl = URL.createObjectURL.bind(URL), revokeUrl = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (value) => { const url = createUrl(value); state.urls.add(url); return url; };
    URL.revokeObjectURL = (url) => { state.urls.delete(url); revokeUrl(url); };
    const start = () => {
      const observer = new MutationObserver(() => {
        const section = document.querySelector(".pdf-progress");
        if (!section) return;
        const bar = section.querySelector<HTMLProgressElement>('progress[aria-label="Document processing progress"]');
        const value: Progress = {
          value: bar?.value ?? null,
          phase: section.querySelector("h2")?.textContent ?? "",
          position: [...section.querySelectorAll("p")].find(item => /^Page \d/u.test(item.textContent ?? ""))?.textContent ?? "",
        };
        if (JSON.stringify(value) === JSON.stringify(state.progress.at(-1))) return;
        if (state.progress.length >= 1000) state.progressTruncated = true;
        else state.progress.push(value);
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    };
    if (document.body) start(); else document.addEventListener("DOMContentLoaded", start, { once: true });
  });
}

const snapshot = (page: Page): Promise<NativeSnapshot> => page.evaluate(() => {
  const { canvases, urls, release: _release, ...value } = (window as typeof window & { __remainingPdf: NativeState }).__remainingPdf;
  return { ...value, nonzeroCanvases: [...canvases].filter(canvas => canvas.width > 0 && canvas.height > 0).length, objectUrls: urls.size };
});

async function choose(page: Page, id: "blank-pages-26" | "linearized-cfpb-savings") {
  const fixture = manifest.fixtures.find(item => item.id === id)!;
  const filename = path.resolve(root, fixture.file);
  expect(path.relative(root, filename).startsWith("..")).toBe(false);
  const buffer = await readFile(filename);
  expect(buffer.length).toBe(fixture.bytes); expect(sha256(buffer)).toBe(fixture.sha256);
  evidenceByPage.get(page)!.fixture = fixture;
  if (id === "linearized-cfpb-savings") expect(buffer.subarray(0, 2048).toString("latin1")).toMatch(/\/Linearized\s+1\b/u);
  const name = `${inputPrefix}${id}.pdf`;
  await page.getByLabel("Choose one PDF", { exact: true }).setInputFiles({ name, mimeType: "application/pdf", buffer });
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible({ timeout: 45_000 });
}

async function configure(page: Page, mode: "automatic" | "ocr-all" | "embedded-text-only", pages: string) {
  await page.getByRole("radio", { name: "Page range", exact: true }).check();
  await page.getByLabel("Pages to process", { exact: true }).fill(pages);
  await page.locator(`input[name="pdf-extraction-method"][value="${mode}"]`).check();
}

function assertProgress(samples: Progress[], requireObserved: boolean) {
  if (requireObserved) expect(samples.length).toBeGreaterThan(0);
  const values = samples.flatMap(sample => sample.value === null ? [] : [sample.value]);
  expect(values.every(value => Number.isFinite(value) && value >= 0 && value < 1)).toBe(true);
  expect(values.every((value, index) => index === 0 || value >= values[index - 1]!)).toBe(true);
}

async function storage(page: Page) {
  return storageSnapshot(page, buildByPage.get(page)!, [inputPrefix, reviewedSentinel, ...outputsByPage.get(page)!]);
}

async function clear(page: Page) {
  await page.getByRole("button", { name: "Clear PDF", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Clear this PDF and its results?" });
  if (await dialog.count()) await dialog.getByRole("button", { name: "Clear PDF", exact: true }).click();
  await expect(page.locator(".pdf-results")).toHaveCount(0);
  await expect.poll(async () => { const state = await snapshot(page); return state.pdfActive + state.ocrActive; }, { timeout: 15_000 }).toBe(0);
  const state = await snapshot(page);
  expect(state.nonzeroCanvases).toBe(0); expect(state.objectUrls).toBe(0);
  evidenceByPage.get(page)!.afterClear = state;
  evidenceByPage.get(page)!.storageAfterClear = await storage(page);
}

test.beforeEach(async ({ page, context, request, baseURL, browser }, info) => {
  const evidence: Evidence = {
    checkedAt: new Date().toISOString(), scenario: info.title, project: info.project.name, browserVersion: browser.version(),
    buildId, pdfHtmlSha256: htmlSha, fixtureManifestSha256: sha256(manifestBytes),
    scope: "Local frozen build and existing pinned public fixtures. Native engine output; any held completion explicitly recorded. No physical-browser or Cloudflare acceptance.",
    resourceScope: "Observed main-thread Worker construction/termination and canvas dimensions/object URLs; excludes worker-internal allocation, garbage collection, RSS and physical memory.",
    paths: [], outsideOrigins: [], nonReadRequests: [], contentLeakPaths: [], pageErrors: [],
  };
  evidenceByPage.set(page, evidence); outputsByPage.set(page, []); inspectionsByPage.set(page, []);
  await control(request, baseURL!, { fault: null, networkDisabled: false, resetLog: true });
  const response = await request.get(new URL("/__pdf-validation__/state", baseURL!).href);
  expect(response.ok()).toBe(true);
  const state = await response.json() as { buildId: string; buildManifest: BuildManifest; offlineMode: string };
  expect(state.buildId).toBe(buildId); expect(state.buildManifest.files.find(file => file.path === "pdf-to-text.html")!.sha256).toBe(htmlSha);
  buildByPage.set(page, state.buildManifest); evidence.serverOfflineMode = state.offlineMode;
  const origin = new URL(baseURL!).origin;
  context.on("request", networkRequest => {
    const url = new URL(networkRequest.url());
    if (!["http:", "https:"].includes(url.protocol)) return;
    evidence.paths.push(url.pathname);
    if (url.origin !== origin) evidence.outsideOrigins.push(url.origin);
    if (!["GET", "HEAD"].includes(networkRequest.method())) evidence.nonReadRequests.push(networkRequest.method());
    inspectionsByPage.get(page)!.push((async () => {
      const sent = `${networkRequest.url()}\n${JSON.stringify(await networkRequest.allHeaders())}\n${networkRequest.postData() ?? ""}`;
      if ([inputPrefix, reviewedSentinel, ...outputsByPage.get(page)!].some(value => value && sent.includes(value))) evidence.contentLeakPaths.push(url.pathname);
    })());
  });
  page.on("pageerror", error => evidence.pageErrors.push(error.name));
  await observe(page);
});

test.afterEach(async ({ page, context, request, baseURL }, info) => {
  const evidence = evidenceByPage.get(page);
  if (!evidence) return;
  try {
    await Promise.all(inspectionsByPage.get(page)!);
    evidence.finalResources = await snapshot(page).catch(() => null);
    evidence.finalOriginRequests = await serverLog(request, baseURL!).catch(() => ({ captureFailed: true }));
    expect(evidence.outsideOrigins).toEqual([]); expect(evidence.nonReadRequests).toEqual([]);
    expect(evidence.contentLeakPaths).toEqual([]); expect(evidence.pageErrors).toEqual([]);
  } finally {
    await control(request, baseURL!, { fault: null, networkDisabled: false }).catch(() => undefined);
    await context.setOffline(false).catch(() => undefined);
    Object.assign(evidence, { status: info.status, assertionFailures: info.errors.length });
    const filename = info.outputPath("evidence.json");
    await writeFile(filename, `${JSON.stringify(evidence, null, 2)}\n`);
    await info.attach("remaining-workflows-evidence", { path: filename, contentType: "application/json" });
  }
});

test.describe("blank-page bounds and cancellation", () => {
  test.use({ serviceWorkers: "block" });

  test("26 blank pages reach Automatic and OCR-all caps before rendering or OCR", async ({ page }) => {
    const response = await page.goto("/pdf-to-text");
    expect(response?.status()).toBe(200); expect(sha256(await response!.body())).toBe(htmlSha);
    await choose(page, "blank-pages-26");
    await expect(page.locator(".pdf-options")).toContainText("26 of 26 pages selected");
    const evidence = evidenceByPage.get(page)!;
    const modes = [];
    for (const mode of ["automatic", "ocr-all"] as const) {
      await configure(page, mode, "1-26");
      await page.evaluate(() => { (window as typeof window & { __remainingPdf: NativeState }).__remainingPdf.progress = []; });
      const before = await snapshot(page), requestIndex = evidence.paths.length;
      await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText(PDF_ERROR_MESSAGES.PDF_OCR_PAGE_LIMIT_EXCEEDED);
      await expect(page.getByRole("button", { name: "Cancel processing", exact: true })).toHaveCount(0);
      await expect(page.getByRole("group", { name: "Pages", exact: true })).toBeFocused();
      await expect(page.locator(".pdf-results")).toHaveCount(0);
      const after = await snapshot(page);
      expect(after.positiveCanvasChanges).toBe(before.positiveCanvasChanges);
      expect(after.maxCanvasPixels).toBe(0); expect(after.ocrCreated).toBe(0); expect(after.recognitionRequests).toBe(0);
      expect(after.pdfCreated).toBe(1); expect(after.pdfModuleWorkers).toBe(1); expect(after.pdfMessages).toBeGreaterThan(0);
      const ocrRequests = evidence.paths.slice(requestIndex).filter(value => value.startsWith("/ocr/"));
      expect(ocrRequests).toEqual([]); expect(after.progressTruncated).toBe(false);
      assertProgress(after.progress, mode === "automatic");
      if (mode === "automatic") expect(after.progress.some(item => item.phase === "Checking which pages already contain usable text…")).toBe(true);
      modes.push({ mode, observedSafeMessage: PDF_ERROR_MESSAGES.PDF_OCR_PAGE_LIMIT_EXCEEDED, focusedPagesGroup: true, before, after, ocrRequests });
    }
    evidence.modes = modes; evidence.storageBeforeClear = await storage(page);
    await clear(page);
  });

  test("blank-page OCR progress and cancellation retain page 1 while a native page 2 render completion is held", async ({ page }) => {
    const evidence = evidenceByPage.get(page)!;
    evidence.injection = "Only page 2 native PDF.js render-task promise delivery is held after the real renderer completes. No PDF/text/OCR output or progress is manufactured; cancellation and late release use the app's normal UI/lifecycle.";
    await page.route("**/pdf/*/api/pdf.mjs", async route => {
      const response = await route.fetch();
      const source = await response.text();
      const expected = buildByPage.get(page)!.files.find(file => `/${file.path}` === new URL(route.request().url()).pathname)!;
      expect(sha256(Buffer.from(source))).toBe(expected.sha256);
      await route.fulfill({ response, body: `${source}\nconst remainingGetDocument = getDocument;
getDocument = (...args) => {
  const task = remainingGetDocument(...args);
  task.promise.then(document => {
    const nativeGetPage = document.getPage.bind(document), wrapped = new WeakSet();
    document.getPage = async number => {
      const page = await nativeGetPage(number);
      if (wrapped.has(page)) return page;
      wrapped.add(page);
      const nativeRender = page.render.bind(page);
      page.render = (...options) => {
        const state = globalThis.__remainingPdf;
        state.renderPages.push(number);
        const renderTask = nativeRender(...options);
        if (number !== 2) return renderTask;
        return { promise: renderTask.promise.then(value => {
          state.heldPage = number;
          return new Promise(resolve => { state.release = () => {
            state.heldPage = null; state.released += 1; resolve(value);
          }; });
        }), cancel: (...args) => { state.renderCancels += 1; return renderTask.cancel(...args); } };
      };
      return page;
    };
  }).catch(() => {});
  return task;
};` });
    });
    const response = await page.goto("/pdf-to-text");
    expect(response?.status()).toBe(200); expect(sha256(await response!.body())).toBe(htmlSha);
    await choose(page, "blank-pages-26");
    await configure(page, "ocr-all", "1-3");
    await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).heldPage, { timeout: 120_000 }).toBe(2);
    const held = await snapshot(page);
    expect(held.renderPages).toEqual([1, 2]); expect(held.recognitionRequests).toBe(1);
    expect(held.maxOcrActive).toBe(1); expect(held.ocrCreated).toBe(1); expect(held.maxCanvasPixels).toBeLessThanOrEqual(16_777_216);
    await expect(page.getByRole("heading", { name: "Preparing the selected PDF page…", exact: true })).toBeVisible();
    await expect(page.locator(".pdf-progress")).toContainText("Page 2 · 2 of 3");
    assertProgress(held.progress, true); expect(held.progressTruncated).toBe(false);
    expect(held.progress.some(item => item.phase === "Recognising text on this page…")).toBe(true);
    const started = Date.now();
    await page.getByRole("button", { name: "Cancel processing", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Processing cancelled — completed pages retained", exact: true })).toBeVisible({ timeout: 5_000 });
    evidence.cancelElapsedMs = Date.now() - started;
    const navigation = page.getByRole("navigation", { name: "Selected PDF pages" });
    const pageButton = (number: number) => navigation.getByRole("button").filter({ has: page.getByText(`Page ${number}`, { exact: true }) });
    await expect(pageButton(1)).toContainText("Complete");
    await pageButton(1).click();
    await expect(page.getByLabel("Editable text for page 1", { exact: true })).toHaveValue("");
    await expect(page.locator(".pdf-method-badge")).toHaveText("OCR");
    await expect(page.locator(".pdf-page-warnings")).toContainText("This extraction returned no text.");
    for (const number of [2, 3]) {
      await expect(pageButton(number)).toContainText("Not processed");
      await pageButton(number).click();
      await expect(page.getByLabel(`Editable text for page ${number}`, { exact: true })).toHaveCount(0);
    }
    const cancelled = await snapshot(page);
    expect(cancelled.ocrActive).toBe(0); expect(cancelled.recognitionRequests).toBe(1);
    expect(cancelled.nonzeroCanvases).toBe(0); expect(cancelled.renderCancels).toBeGreaterThan(0);
    await page.evaluate(async () => {
      (window as typeof window & { __remainingPdf: NativeState }).__remainingPdf.release();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    const late = await snapshot(page);
    expect(late.heldPage).toBeNull(); expect(late.released).toBe(1);
    expect(late.renderPages).toEqual([1, 2]); expect(late.recognitionRequests).toBe(1);
    await expect(pageButton(1)).toContainText("Complete"); await expect(pageButton(2)).toContainText("Not processed"); await expect(pageButton(3)).toContainText("Not processed");
    Object.assign(evidence, { held, cancelled, afterLateRelease: late, retainedPage: { page: 1, method: "OCR", status: "Complete", characters: 0, textSha256: sha256("") }, unprocessedPages: [2, 3], storageBeforeClear: await storage(page) });
    await clear(page);
  });
});

test.describe("prepared genuine offline linearized PDF", () => {
  test.use({ serviceWorkers: "allow" });

  test("linearized CFPB page text survives prepared offline reload in Chromium and Firefox", async ({ page, context, request, baseURL, browserName }) => {
    test.skip(browserName === "webkit", "Known native offline emulation/file-blob defect remains open; no WebKit offline rerun or navigator substitute.");
    const evidence = evidenceByPage.get(page)!;
    await openWorkspace(page, htmlSha!);
    await prepareBoth(page);
    const prepared = await storage(page);
    assertPdfCache(prepared, true);
    expect(prepared.stores.find(store => store.name === ocrCache)?.entries.length).toBe(5);
    evidence.preparedStorage = prepared;
    await goOffline(page, context, request, baseURL!, evidence);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    const readerReadiness = page.locator(".pdf-readiness-list li").filter({ has: page.getByText("PDF reader", { exact: true }) });
    await expect(readerReadiness).toHaveAttribute("data-status", "ready");
    await expect(readerReadiness.locator("small")).toContainText("PDF reader available offline");
    await choose(page, "linearized-cfpb-savings");
    await configure(page, "embedded-text-only", "1");
    await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Selected pages processed", exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".pdf-method-badge")).toHaveText("PDF text");
    const editor = page.getByLabel("Editable text for page 1", { exact: true });
    const output = await editor.inputValue();
    expect(output.toLowerCase()).toContain("savings");
    expect(output.length).toBe(linearizedOnlineOutput.characters); expect(sha256(output)).toBe(linearizedOnlineOutput.sha256);
    outputsByPage.get(page)!.push(output);
    const native = await snapshot(page);
    expect(native.pdfCreated).toBe(1); expect(native.pdfModuleWorkers).toBe(1); expect(native.pdfMessages).toBeGreaterThan(0);
    expect(native.ocrCreated).toBe(0); expect(native.positiveCanvasChanges).toBe(0);
    await editor.fill(reviewedSentinel);
    await expect(page.getByText(/Edited in this tab/u)).toBeVisible();
    evidence.offlineOutput = { ...linearizedOnlineOutput, method: "PDF text", matchesPriorOnlineComplexCorpusOutput: true };
    evidence.offlineNative = native; evidence.offlineEditedStorage = await storage(page);
    assertPdfCache(evidence.offlineEditedStorage as Awaited<ReturnType<typeof storageSnapshot>>, true);
    await clear(page);
    const log = await serverLog(request, baseURL!);
    evidence.offlineOriginRequests = log;
    expect(log.truncated).toBe(false);
    expect(log.requests.filter(entry => !entry.path.startsWith("/__pdf-validation__/") && entry.status >= 200 && entry.status < 400)).toEqual([]);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  });
});
