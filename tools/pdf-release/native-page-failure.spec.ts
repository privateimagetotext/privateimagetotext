import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PDF_ERROR_MESSAGES, createPdfSafeError, type PdfErrorCode, type PdfSafeError } from "../../src/features/pdf/errors";
import { PDF_LIMITS } from "../../src/features/pdf/validation";
import { root, sha256, storageSnapshot, type BuildManifest } from "./offline-helpers";

type Outcome = "supported" | "supported with warning" | "page failed and processing continued" | "document rejected safely" | "intentionally unsupported";
type Mode = "embedded-text-only" | "automatic" | "ocr-all";
type TextExpectation = { page: number; text: string };
type ComplexFixture = {
  id: string; category: string; categories?: string[]; availability: "available" | "unavailable";
  file?: string; bytes?: number; sha256?: string; notes?: string | string[]; structureAssertions?: unknown;
  expected: {
    outcomes: Outcome[]; mode: Mode; selectedPages: number[]; pageCount?: number | null;
    requiredText?: TextExpectation[]; forbiddenText?: TextExpectation[]; exactCharacters?: { page: number; count: number }[];
    failedPages?: number[]; safeErrorCodes?: PdfErrorCode[]; warningCodes?: string[]; emptyPages?: number[];
    requiresRender?: boolean; downscaled?: boolean; downscaledPages?: number[]; rejectionStage?: "selection" | "processing" | "either";
  };
};
type Manifest = { schemaVersion: number; fixtures: ComplexFixture[]; untestedCategories: { category: string; reason: string }[] };
type Resources = {
  pdfWorkersCreated: number; pdfWorkersActive: number; maxPdfWorkers: number;
  otherWorkersCreated: number; otherWorkersActive: number; maxOtherWorkers: number;
  workerPaths: string[]; nativePdfModuleWorkers: number; pdfWorkerMessages: number; workerErrors: number;
  maxCanvasWidth: number; maxCanvasHeight: number; maxCanvasPixels: number;
  canvasSizes: { width: number; height: number }[]; canvases: Set<HTMLCanvasElement>; urls: Set<string>;
  windowOpenCalls: number; formSubmissions: number;
};
type ResourceSnapshot = Omit<Resources, "canvases" | "urls"> & { nonzeroCanvases: number; objectUrls: number };
type PageEvidence = { number: number; status: string; method: string; characters: number; textSha256: string | null; safeErrorCodes: PdfErrorCode[]; safeErrors: PdfSafeError[]; warningCodes: string[] };

const manifestPath = path.join(import.meta.dirname, "native-page-failure.json");
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8")) as Manifest;
if (sha256(manifestBytes) !== "030dad5cdb8e96c2187444143feb21c3e48df9d7020556b5f560801ee3dcc7f6") throw new Error("The frozen native-page-failure manifest changed.");
if (manifest.fixtures.length !== 1 || manifest.fixtures[0]?.id !== "deferred-flate-page-error") throw new Error("Run only the one frozen candidate.");
const expectedHtml = "47a8b6a52ad4549a3d4a766e538e25e207ba4d34e28df8d7eb81e1e6370932d5";
// Type1 Helvetica defaults to StandardEncoding: byte0x27 is quoteright U+2019.
// PDF.js worker lines36595,12739,15921 establish this independently of output.
const expectedPage2Text = "SECOND PAGE REMAINS READABLE 86420 This separate page has a complete, valid text stream. Its contents must survive the first page\u2019s decoding error.";
const expectedBuild = process.env.PDF_VALIDATION_EXPECTED_BUILD_ID;
if (!expectedBuild || !/^[a-f0-9]{64}$/u.test(expectedBuild)) throw new Error("Set the exact frozen PDF_VALIDATION_EXPECTED_BUILD_ID.");
const warnings: Record<string, string> = {
  NO_EMBEDDED_TEXT: "No existing text was found.",
  TEXT_LAYER_UNCERTAIN: "The existing text layer may be incomplete or unreliable.",
  TEXT_LAYER_INVALID: "The existing text layer appeared invalid.",
  UNMAPPED_TEXT_CHARACTERS: "Some extracted characters may not represent the original symbols. Compare symbols with the PDF and correct the text before use.",
  EMPTY_PAGE_TEXT: "This extraction returned no text.",
  PAGE_RENDER_REDUCED: "This large page was reduced before OCR.",
};
const outcomeClasses: Outcome[] = ["supported", "supported with warning", "page failed and processing continued", "document rejected safely", "intentionally unsupported"];
const textNormalised = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
const pendingEvidence = new WeakMap<Page, Record<string, unknown>>();

async function observeNativeResources(page: Page) {
  await page.addInitScript(() => {
    const state: Resources = {
      pdfWorkersCreated: 0, pdfWorkersActive: 0, maxPdfWorkers: 0,
      otherWorkersCreated: 0, otherWorkersActive: 0, maxOtherWorkers: 0,
      workerPaths: [], nativePdfModuleWorkers: 0, pdfWorkerMessages: 0, workerErrors: 0,
      maxCanvasWidth: 0, maxCanvasHeight: 0, maxCanvasPixels: 0, canvasSizes: [],
      canvases: new Set(), urls: new Set(), windowOpenCalls: 0, formSubmissions: 0,
    };
    (window as typeof window & { __pdfNativeFailureResources: Resources }).__pdfNativeFailureResources = state;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private ended = false;
      private isPdf: boolean;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        const parsed = new URL(String(url), location.href);
        this.isPdf = /\/pdf\.worker(?:\.min)?\.mjs$/u.test(parsed.pathname);
        state.workerPaths.push(parsed.protocol === "blob:" ? "blob:" : parsed.pathname);
        if (this.isPdf) {
          state.pdfWorkersCreated += 1; state.pdfWorkersActive += 1;
          state.maxPdfWorkers = Math.max(state.maxPdfWorkers, state.pdfWorkersActive);
          if (options?.type === "module") state.nativePdfModuleWorkers += 1;
          this.addEventListener("message", () => { state.pdfWorkerMessages += 1; });
        } else {
          state.otherWorkersCreated += 1; state.otherWorkersActive += 1;
          state.maxOtherWorkers = Math.max(state.maxOtherWorkers, state.otherWorkersActive);
        }
        this.addEventListener("error", () => { state.workerErrors += 1; });
      }
      override terminate() {
        if (!this.ended) {
          this.ended = true;
          if (this.isPdf) state.pdfWorkersActive -= 1;
          else state.otherWorkersActive -= 1;
        }
        super.terminate();
      }
    };
    const createObjectUrl = URL.createObjectURL.bind(URL);
    const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (value) => { const url = createObjectUrl(value); state.urls.add(url); return url; };
    URL.revokeObjectURL = (url) => { state.urls.delete(url); revokeObjectUrl(url); };
    for (const dimension of ["width", "height"] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, dimension)!;
      Object.defineProperty(HTMLCanvasElement.prototype, dimension, {
        ...descriptor,
        set(this: HTMLCanvasElement, value: number) {
          descriptor.set!.call(this, value); state.canvases.add(this);
          state.maxCanvasWidth = Math.max(state.maxCanvasWidth, this.width);
          state.maxCanvasHeight = Math.max(state.maxCanvasHeight, this.height);
          state.maxCanvasPixels = Math.max(state.maxCanvasPixels, this.width * this.height);
          if (state.canvasSizes.length < 100 && this.width > 0 && this.height > 0) state.canvasSizes.push({ width: this.width, height: this.height });
        },
      });
    }
    const nativeOpen = window.open.bind(window);
    window.open = (...args) => { state.windowOpenCalls += 1; return nativeOpen(...args); };
    document.addEventListener("submit", () => { state.formSubmissions += 1; }, true);
    for (const name of ["submit", "requestSubmit"] as const) {
      const original = HTMLFormElement.prototype[name];
      HTMLFormElement.prototype[name] = function (...args: [HTMLButtonElement?]) {
        state.formSubmissions += 1;
        return Reflect.apply(original, this, args);
      };
    }
  });
}

async function resources(page: Page): Promise<ResourceSnapshot> {
  return page.evaluate(() => {
    const { canvases, urls, ...state } = (window as typeof window & { __pdfNativeFailureResources: Resources }).__pdfNativeFailureResources;
    return { ...state, nonzeroCanvases: [...canvases].filter((canvas) => canvas.width > 0 && canvas.height > 0).length, objectUrls: urls.size };
  });
}

async function safeErrors(page: Page) {
  const messages = await page.locator(".pdf-control-error, .pdf-field-error, .pdf-document-error > p").allTextContents();
  return messages.map((value) => {
    const message = value.replace(/\s*You can retry this page\.\s*$/u, "").trim();
    const match = (Object.entries(PDF_ERROR_MESSAGES) as [PdfErrorCode, string][]).find(([, expected]) => message === expected);
    expect(match, "every user-visible PDF error is an exact fixed safe message").toBeDefined();
    return match![0];
  });
}

async function unsupportedSurfacesAbsent(page: Page) {
  await expect(page.locator(".annotationLayer, .xfaLayer, iframe, object, embed, form")).toHaveCount(0);
  await expect(page.locator('a[href^="javascript:"], a[download]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /validate signature|extract attachment|submit (?:pdf )?form/iu })).toHaveCount(0);
  const visibleAppCopy = await page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("textarea,input,script,style").forEach((element) => element.remove());
    return clone.textContent ?? "";
  });
  expect(visibleAppCopy).not.toMatch(/InvalidPDFException|UnknownErrorException|FormatError|RangeError:|ReferenceError:|TypeError:|at \w+ \([^\n]+:\d+:\d+\)/u);
  expect(visibleAppCopy).not.toMatch(/signature (?:is )?(?:valid|verified)|signature validation (?:passed|successful)/iu);
}

function validateFixture(entry: ComplexFixture) {
  expect(entry.expected.outcomes.length).toBeGreaterThan(0);
  expect(entry.expected.outcomes.every((outcome) => outcomeClasses.includes(outcome))).toBe(true);
  expect(entry.expected.selectedPages.every((number) => Number.isSafeInteger(number) && number > 0)).toBe(true);
  expect(new Set(entry.expected.selectedPages).size).toBe(entry.expected.selectedPages.length);
}

test.afterEach(async ({ page }, info) => {
  const evidence = pendingEvidence.get(page);
  if (!evidence) return;
  // A test body's finally runs before Playwright assigns its failed status.
  // Finalize here; the runner JSON remains the authoritative suite result.
  Object.assign(evidence, { status: info.status, assertionFailures: info.errors.length });
  const filename = info.outputPath("evidence.json");
  await writeFile(filename, `${JSON.stringify(evidence, null, 2)}\n`);
  await info.attach("native-page-failure-evidence", { path: filename, contentType: "application/json" });
  pendingEvidence.delete(page);
});

for (const entry of manifest.fixtures) {
  test(`${entry.id}: ${entry.category}`, async ({ page, context, request, baseURL, browser }, info) => {
    test.skip(entry.availability !== "available", `Untested fixture: ${entry.notes ?? entry.category}`);
    validateFixture(entry);
    const evidence: Record<string, unknown> = {
      schemaVersion: 1, scenario: info.title, fixture: { id: entry.id, category: entry.category, categories: entry.categories, bytes: entry.bytes, sha256: entry.sha256, structureAssertions: entry.structureAssertions, notes: entry.notes },
      checkedAt: new Date().toISOString(), browserProject: info.project.name, browserVersion: browser.version(),
      manifestSha256: sha256(manifestBytes), expected: entry.expected, untestedCategories: manifest.untestedCategories,
      scope: "Frozen private app; real native PDF/OCR pipeline; service workers blocked; no parse-result injection. Not offline, physical-device, shipping-browser or deployed acceptance.",
      resourceScope: "Main-thread native Worker construction/termination and HTMLCanvasElement dimensions. Excludes worker/OffscreenCanvas allocation, decompressed internal heaps, total RSS and physical memory pressure.",
      outcome: null, rejectionStage: null, pages: [] as PageEvidence[],
    };
    pendingEvidence.set(page, evidence);
    const outputs: string[] = [];
    const expectedText = (entry.expected.requiredText ?? []).map((item) => item.text).filter((text) => text.length >= 12);
    const sentinels = ["NATIVE-PAGE-FAILURE-PUBLIC-", ...expectedText];
    const observations = { requestPaths: [] as string[], outsideOrigins: [] as string[], unexpectedPaths: [] as string[], nonReadRequests: [] as string[], contentLeakPaths: [] as string[], requestLogTruncated: false, pageErrors: [] as string[], consoleErrors: 0, parserConsoleMessages: 0, fakeWorkerWarnings: 0, dialogs: 0, popups: 0, downloads: 0 };
    const pendingInspections: Promise<void>[] = [];
    const origin = new URL(baseURL!).origin;
    const stateResponse = await request.get(new URL("/__pdf-validation__/state", baseURL!).href);
    expect(stateResponse.ok()).toBe(true);
    const state = await stateResponse.json() as { buildId: string; buildManifest: BuildManifest; fault: unknown; networkDisabled: boolean };
    expect(state.buildId).toBe(expectedBuild);
    expect(state.buildManifest.files.find((file) => file.path === "pdf-to-text.html")?.sha256).toBe(expectedHtml);
    expect(state.fault).toBeNull(); expect(state.networkDisabled).toBe(false);
    const build = state.buildManifest;
    const allowedPaths = new Set(build.files.map((file) => `/${file.path}`));
    allowedPaths.add("/pdf-to-text");
    Object.assign(evidence, { buildId: state.buildId, pdfHtmlSha256: build.files.find((file) => file.path === "pdf-to-text.html")!.sha256 });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && (url.origin !== origin || !allowedPaths.has(url.pathname))) await route.abort("blockedbyclient");
      else await route.continue();
    });
    context.on("request", (networkRequest) => {
      const url = new URL(networkRequest.url());
      if (!["http:", "https:"].includes(url.protocol)) return;
      if (observations.requestPaths.length < 2000) observations.requestPaths.push(url.pathname);
      else observations.requestLogTruncated = true;
      if (url.origin !== origin) observations.outsideOrigins.push(url.origin);
      if (!allowedPaths.has(url.pathname)) observations.unexpectedPaths.push(url.pathname);
      if (!["GET", "HEAD"].includes(networkRequest.method())) observations.nonReadRequests.push(networkRequest.method());
      pendingInspections.push((async () => {
        const transmitted = `${networkRequest.url()}\n${JSON.stringify(await networkRequest.allHeaders())}\n${networkRequest.postData() ?? ""}`;
        if ([...sentinels, ...outputs].some((value) => value && transmitted.includes(value))) observations.contentLeakPaths.push(url.pathname);
      })());
    });
    context.on("page", (popup) => { if (popup !== page) { observations.popups += 1; void popup.close(); } });
    page.on("dialog", (dialog) => { observations.dialogs += 1; void dialog.dismiss(); });
    page.on("download", () => { observations.downloads += 1; });
    page.on("pageerror", (error) => { observations.pageErrors.push(error.name); });
    page.on("console", (message) => {
      if (message.type() === "error") observations.consoleErrors += 1;
      if (/InvalidPDFException|UnknownErrorException|FormatError|Warning:|Error:/u.test(message.text())) observations.parserConsoleMessages += 1;
      if (/fake worker/iu.test(message.text())) observations.fakeWorkerWarnings += 1;
    });
    await observeNativeResources(page);
    try {
      const response = await page.goto("/pdf-to-text");
      expect(response?.status()).toBe(200);
      expect(sha256(await response!.body())).toBe(evidence.pdfHtmlSha256);
      await expect(page.getByRole("heading", { level: 1, name: "Extract text from a PDF. Nothing uploaded." })).toBeVisible();
      expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
      expect(observations.requestPaths.some((pathname) => /^\/(?:pdf|ocr)\//u.test(pathname))).toBe(false);
      await unsupportedSurfacesAbsent(page);
      const fixturePath = path.resolve(root, entry.file!);
      const fixtureRelative = path.relative(root, fixturePath);
      expect(Boolean(fixtureRelative) && !fixtureRelative.startsWith("..") && !path.isAbsolute(fixtureRelative), "fixture stays below the repository root").toBe(true);
      const buffer = await readFile(fixturePath);
      expect(buffer.length).toBe(entry.bytes); expect(sha256(buffer)).toBe(entry.sha256);
      const inputName = `NATIVE-PAGE-FAILURE-PUBLIC-${entry.id}.pdf`;
      await page.getByLabel("Choose one PDF", { exact: true }).setInputFiles({ name: inputName, mimeType: "application/pdf", buffer });
      const documentHeading = page.getByRole("heading", { level: 2, name: inputName, exact: true });
      await expect.poll(async () => await documentHeading.count() > 0 || await page.locator(".pdf-control-error, .pdf-document-error").count() > 0, { timeout: 45_000 }).toBe(true);
      let rejected = await documentHeading.count() === 0;
      if (rejected) evidence.rejectionStage = "selection";
      else {
        if (entry.expected.pageCount !== undefined && entry.expected.pageCount !== null) await expect(page.locator(".pdf-summary-facts > div").filter({ has: page.getByText("Pages", { exact: true }) }).locator("dd")).toHaveText(String(entry.expected.pageCount));
        await page.getByRole("radio", { name: "Page range", exact: true }).check();
        await page.getByLabel("Pages to process", { exact: true }).fill(entry.expected.selectedPages.join(","));
        await page.locator(`input[name="pdf-extraction-method"][value="${entry.expected.mode}"]`).check();
        await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
        await expect.poll(async () => await page.locator(".pdf-results").count() > 0 || await page.locator(".pdf-document-error").count() > 0, { timeout: 150_000 }).toBe(true);
        await expect(page.getByRole("button", { name: "Cancel processing", exact: true })).toHaveCount(0, { timeout: 150_000 });
        rejected = await page.locator(".pdf-results").count() === 0;
        if (rejected) evidence.rejectionStage = "processing";
      }
      const initialSafeErrors = await safeErrors(page);
      evidence.safeErrorCodes = initialSafeErrors;
      evidence.safeErrors = initialSafeErrors.map((code) => createPdfSafeError(code));
      if (rejected) {
        evidence.outcome = "document rejected safely";
        expect(initialSafeErrors.length).toBeGreaterThan(0);
        expect.soft(initialSafeErrors.every((code) => entry.expected.safeErrorCodes?.includes(code))).toBe(true);
        if (entry.expected.rejectionStage && entry.expected.rejectionStage !== "either") expect.soft(evidence.rejectionStage).toBe(entry.expected.rejectionStage);
        await expect(page.locator(".pdf-results textarea")).toHaveCount(0);
      } else {
        const pageEvidence: PageEvidence[] = [];
        evidence.pages = pageEvidence;
        const allWarnings = new Set<string>();
        await expect(page.getByRole("navigation", { name: "Selected PDF pages" }).getByRole("button")).toHaveCount(entry.expected.selectedPages.length);
        for (const number of entry.expected.selectedPages) {
          const button = page.getByRole("navigation", { name: "Selected PDF pages" }).getByRole("button").filter({ has: page.getByText(`Page ${number}`, { exact: true }) });
          await button.click();
          const labels = await button.locator("small").allTextContents();
          const statusLabel = labels.find((label) => /^(?:Complete|Failed|Not processed|Skipped)/u.test(label)) ?? "unknown";
          const status = statusLabel.split(" · ")[0]!;
          const editor = page.getByLabel(`Editable text for page ${number}`, { exact: true });
          const text = await editor.count() ? await editor.inputValue() : null;
          const codes = await safeErrors(page);
          const warningTexts = await page.locator(".pdf-page-warnings li").allTextContents();
          const warningCodes = warningTexts.map((text) => {
            const match = Object.entries(warnings).find(([, label]) => label === text.trim());
            expect(match, "every page warning has a known fixed message").toBeDefined();
            allWarnings.add(match![0]); return match![0];
          });
          pageEvidence.push({ number, status, method: await page.locator(".pdf-method-badge").innerText(), characters: text?.length ?? 0, textSha256: text === null ? null : sha256(text), safeErrorCodes: codes, safeErrors: codes.map((code) => {
            const safe = createPdfSafeError(code);
            return safe.scope === "page" ? createPdfSafeError(code, { pageNumber: number }) : safe;
          }), warningCodes });
          if (text !== null) {
            outputs.push(text);
            if (number === 2) expect(textNormalised(text), "all independently verified second-page text is preserved").toBe(expectedPage2Text);
            expect(text.length).toBeLessThanOrEqual(PDF_LIMITS.maxPageTextCharacters);
            for (const required of entry.expected.requiredText?.filter((item) => item.page === number) ?? []) expect.soft(textNormalised(text).includes(textNormalised(required.text)), "required public fixture token is present").toBe(true);
            for (const forbidden of entry.expected.forbiddenText?.filter((item) => item.page === number) ?? []) expect(textNormalised(text).includes(textNormalised(forbidden.text)), "forbidden attachment/script/old-revision token is absent").toBe(false);
            for (const exact of entry.expected.exactCharacters?.filter((item) => item.page === number) ?? []) expect.soft(text.length).toBe(exact.count);
            if (entry.expected.emptyPages?.includes(number)) expect.soft(text.length).toBe(0);
          } else expect.soft(entry.expected.failedPages ?? []).toContain(number);
          if (entry.expected.failedPages?.includes(number)) {
            expect.soft(status).toBe("Failed"); expect.soft(text === null, "a failed page must not expose completed text").toBe(true);
            expect.soft(codes.length).toBeGreaterThan(0);
            expect.soft(codes.every((code) => entry.expected.safeErrorCodes?.includes(code))).toBe(true);
          } else expect.soft(status).toBe("Complete");
        }
        evidence.pages = pageEvidence;
        const failures = pageEvidence.filter((item) => item.status === "Failed").map((item) => item.number);
        expect.soft(failures).toEqual(entry.expected.failedPages ?? []);
        const total = pageEvidence.reduce((sum, item) => sum + item.characters, 0);
        expect(total).toBeLessThanOrEqual(PDF_LIMITS.maxTotalTextCharacters);
        for (const warning of entry.expected.warningCodes ?? []) expect.soft([...allWarnings]).toContain(warning);
        evidence.totalCharacters = total;
        evidence.laterPageContinuationProved = failures.some((failed) => pageEvidence.some((item) => item.number > failed && item.status === "Complete" && item.characters > 0));
        if (failures.length && (entry.expected.requiredText ?? []).some((item) => item.page > failures[0]!)) expect(evidence.laterPageContinuationProved).toBe(true);
        evidence.outcome = failures.length ? "page failed and processing continued" : allWarnings.size ? "supported with warning" : "supported";
        if (entry.expected.outcomes.includes("intentionally unsupported")) {
          evidence.extractionOutcome = evidence.outcome;
          evidence.outcome = "intentionally unsupported";
          evidence.unsupportedScope = "Fixture-declared active/attachment/form/signature capabilities are not exposed or activated; ordinary page text may still be extracted.";
        }
      }
      expect.soft(entry.expected.outcomes).toContain(evidence.outcome);
      await expect(page).toHaveURL(new URL("/pdf-to-text", baseURL!).href);
      await unsupportedSurfacesAbsent(page);
      const measured = await resources(page);
      evidence.resourcesBeforeClear = measured;
      expect(measured.maxPdfWorkers).toBeLessThanOrEqual(1);
      expect(measured.workerErrors).toBe(0);
      expect(measured.maxOtherWorkers).toBeLessThanOrEqual(1);
      expect(measured.maxCanvasWidth).toBeLessThanOrEqual(PDF_LIMITS.maxRenderedSide);
      expect(measured.maxCanvasHeight).toBeLessThanOrEqual(PDF_LIMITS.maxRenderedSide);
      expect(measured.maxCanvasPixels).toBeLessThanOrEqual(PDF_LIMITS.maxRenderedPixels);
      if (!rejected) {
        expect(measured.pdfWorkersCreated).toBe(1); expect(measured.nativePdfModuleWorkers).toBe(1);
        expect(measured.pdfWorkerMessages).toBeGreaterThan(0);
        if (entry.expected.mode === "embedded-text-only") { expect(measured.otherWorkersCreated).toBe(0); expect(measured.maxCanvasPixels).toBe(0); }
        if (entry.expected.requiresRender) expect(measured.maxCanvasPixels).toBeGreaterThan(0);
        if (entry.expected.downscaled) expect((evidence.pages as PageEvidence[]).some((item) => item.warningCodes.includes("PAGE_RENDER_REDUCED"))).toBe(true);
        for (const number of entry.expected.downscaledPages ?? []) expect((evidence.pages as PageEvidence[]).find((item) => item.number === number)?.warningCodes).toContain("PAGE_RENDER_REDUCED");
      }
      evidence.storageBeforeClear = await storageSnapshot(page, build, [...sentinels, ...outputs]);
      const clearButton = page.getByRole("button", { name: "Clear PDF", exact: true });
      evidence.cleanupAction = await clearButton.count() ? "Clear PDF" : "failed-selection cleanup";
      if (await clearButton.count()) {
        await clearButton.click();
        const confirmation = page.getByRole("dialog", { name: "Clear this PDF and its results?" });
        if (await confirmation.count()) await confirmation.getByRole("button", { name: "Clear PDF", exact: true }).click();
      }
      await expect(page.locator(".pdf-results")).toHaveCount(0);
      await expect.poll(async () => { const value = await resources(page); return value.pdfWorkersActive + value.otherWorkersActive; }, { timeout: 15_000 }).toBe(0);
      const afterClear = await resources(page);
      evidence.resourcesAfterClear = afterClear;
      expect(afterClear.nonzeroCanvases).toBe(0); expect(afterClear.objectUrls).toBe(0);
      expect(afterClear.windowOpenCalls).toBe(0); expect(afterClear.formSubmissions).toBe(0);
      evidence.storageAfterClear = await storageSnapshot(page, build, [...sentinels, ...outputs]);
      await Promise.all(pendingInspections);
      expect(observations.outsideOrigins).toEqual([]); expect(observations.unexpectedPaths).toEqual([]);
      expect(observations.nonReadRequests).toEqual([]); expect(observations.contentLeakPaths).toEqual([]);
      expect(observations.pageErrors).toEqual([]); expect(observations.requestLogTruncated).toBe(false);
      expect(observations.fakeWorkerWarnings).toBe(0);
      expect(observations.dialogs).toBe(0); expect(observations.popups).toBe(0); expect(observations.downloads).toBe(0);
    } finally {
      evidence.resourcesAtEnd = await resources(page).catch(() => null);
      Object.assign(evidence, observations);
    }
  });
}
