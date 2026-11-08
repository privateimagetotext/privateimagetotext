import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

type CorpusPage = {
  number: number;
  expectedMethod: string;
  expectedTokens: string[];
  minimumCharacters: number;
};
type CorpusCase = {
  id: string;
  kind: string;
  filename: string;
  bytes: number;
  sha256: string;
  mode: string;
  testPassword?: string;
  expectedAssets?: string[];
  pages: CorpusPage[];
};
type ResourceEvidence = {
  workersCreated: number;
  workersActive: number;
  objectUrls: number;
  maxCanvasWidth: number;
  maxCanvasHeight: number;
  maxCanvasPixels: number;
  canvasChanges: { width: number; height: number }[];
};
type RunEvidence = {
  schemaVersion: number;
  scenario: string;
  checkedAt: string;
  gitBaseCommit: string;
  workingTreeDirty: boolean;
  buildId: string;
  corpusManifestSha256: string;
  browserProject: string;
  browserVersion: string;
  sourceKind?: string;
  documentHtmlSha256?: string;
  requests: string[];
  unexpectedOrigins: string[];
  uncaughtErrorNames: string[];
  consoleErrorCount: number;
  pages: Record<string, unknown>[];
  [key: string]: unknown;
};

const root = path.resolve(import.meta.dirname, "../..");
const fixtureRoot = path.join(root, "tmp/pdf-release-corpus");
const manifestBytes = readFileSync(path.join(import.meta.dirname, "corpus.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8")) as { cases: CorpusCase[] };
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const normalise = (value: string) => value.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase("en");
const gitBaseCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const workingTreeDirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0;

async function fixture(entry: CorpusCase) {
  const buffer = await readFile(path.join(fixtureRoot, entry.filename));
  expect(buffer.length, `${entry.id} pinned bytes`).toBe(entry.bytes);
  expect(sha256(buffer), `${entry.id} pinned hash`).toBe(entry.sha256);
  return { name: entry.filename, mimeType: "application/pdf", buffer };
}

async function observe(page: Page, info: TestInfo, scenario: string): Promise<RunEvidence> {
  const evidence: RunEvidence = {
    schemaVersion: 1,
    scenario,
    checkedAt: new Date().toISOString(),
    gitBaseCommit,
    workingTreeDirty,
    buildId: process.env.PDF_RELEASE_BUILD_ID ?? "NOT_RECORDED",
    corpusManifestSha256: sha256(manifestBytes),
    browserProject: info.project.name,
    browserVersion: page.context().browser()?.version() ?? "unknown",
    requests: [],
    unexpectedOrigins: [],
    uncaughtErrorNames: [],
    consoleErrorCount: 0,
    pages: [],
    resourceScope: "Observed main-thread Worker/object-URL calls and HTMLCanvasElement dimension setters. Excludes worker/OffscreenCanvas allocations, process RSS and physical-device pressure; not a complete memory measurement.",
  };
  const origin = new URL(info.project.use.baseURL as string).origin;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (url.origin !== origin) evidence.unexpectedOrigins.push(url.origin);
      // No request bodies, query strings, input metadata, or result text are recorded.
      if (evidence.requests.length < 5000) evidence.requests.push(url.pathname);
    }
  });
  page.on("pageerror", (error) => evidence.uncaughtErrorNames.push(error.name));
  page.on("console", (message) => { if (message.type() === "error") evidence.consoleErrorCount += 1; });
  await page.addInitScript(() => {
    const resources: ResourceEvidence = {
      workersCreated: 0, workersActive: 0, objectUrls: 0,
      maxCanvasWidth: 0, maxCanvasHeight: 0, maxCanvasPixels: 0, canvasChanges: [],
    };
    (window as typeof window & { __pdfCorpus: ResourceEvidence }).__pdfCorpus = resources;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private ended = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        resources.workersCreated += 1;
        resources.workersActive += 1;
      }
      override terminate() {
        if (!this.ended) { this.ended = true; resources.workersActive -= 1; }
        super.terminate();
      }
    };
    const urls = new Set<string>();
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      const url = create(object); urls.add(url); resources.objectUrls = urls.size; return url;
    };
    URL.revokeObjectURL = (url) => { urls.delete(url); resources.objectUrls = urls.size; revoke(url); };
    for (const dimension of ["width", "height"] as const) {
      const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, dimension)!;
      Object.defineProperty(HTMLCanvasElement.prototype, dimension, {
        ...original,
        set(this: HTMLCanvasElement, value: number) {
          original.set!.call(this, value);
          resources.maxCanvasWidth = Math.max(resources.maxCanvasWidth, this.width);
          resources.maxCanvasHeight = Math.max(resources.maxCanvasHeight, this.height);
          resources.maxCanvasPixels = Math.max(resources.maxCanvasPixels, this.width * this.height);
          // Bounded numeric samples only; never retain the canvas or its pixels.
          if (resources.canvasChanges.length === 512) resources.canvasChanges.shift();
          resources.canvasChanges.push({ width: this.width, height: this.height });
        },
      });
    }
  });
  return evidence;
}

const resources = (page: Page) => page.evaluate(() =>
  (window as typeof window & { __pdfCorpus: ResourceEvidence }).__pdfCorpus,
);

async function openWorkspace(page: Page, evidence: RunEvidence) {
  const response = await page.goto("/pdf-to-text");
  expect(response?.status()).toBe(200);
  evidence.documentHtmlSha256 = sha256(await response!.body());
  await expect(page.getByRole("heading", { level: 1, name: "Extract text from a PDF. Nothing uploaded." })).toBeVisible();
  evidence.resourceBaseline = await resources(page);
}

async function selectDocument(page: Page, entry: CorpusCase) {
  await page.getByLabel("Choose one PDF").setInputFiles(await fixture(entry));
  if (entry.testPassword) {
    const dialog = page.getByRole("dialog", { name: "Enter the PDF password" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Password").fill(entry.testPassword);
    await dialog.getByRole("button", { name: "Open PDF" }).click();
  }
  await expect(page.getByRole("heading", { level: 2, name: entry.filename })).toBeVisible({ timeout: 90_000 });
}

async function configure(page: Page, entry: CorpusCase) {
  await page.getByRole("radio", { name: "Page range", exact: true }).check();
  await page.getByLabel("Pages to process").fill(entry.pages.map((item) => item.number).join(","));
  await page.locator(`input[name="pdf-extraction-method"][value="${entry.mode}"]`).check();
}

async function finishProcessing(page: Page) {
  await expect(page.locator(".pdf-results")).toBeVisible({ timeout: 240_000 });
  await expect(page.getByRole("button", { name: "Cancel processing", exact: true })).toHaveCount(0, { timeout: 240_000 });
}

function pageButton(page: Page, number: number) {
  return page.locator(".pdf-page-list button").filter({ has: page.getByText(`Page ${number}`, { exact: true }) });
}

async function clear(page: Page) {
  await page.getByRole("button", { name: "Clear PDF", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Clear this PDF and its results?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Clear PDF", exact: true }).click();
  await expect(page.locator(".pdf-results")).toHaveCount(0);
}

async function persist(info: TestInfo, evidence: RunEvidence) {
  evidence.recordedAt = new Date().toISOString();
  evidence.recordedSoftAssertionFailures = info.errors.length;
  // A thrown error is not in TestInfo.errors until this function's finally exits.
  evidence.assertionFailures = info.errors.length + (evidence.hardFailureObserved ? 1 : 0);
  const filename = info.outputPath("evidence.json");
  await writeFile(filename, `${JSON.stringify(evidence, null, 2)}\n`);
  await info.attach("corpus-evidence", { path: filename, contentType: "application/json" });
}

function assertRuntime(evidence: RunEvidence, measured: ResourceEvidence) {
  expect.soft(evidence.unexpectedOrigins, "runtime requests stay same-origin").toEqual([]);
  expect.soft(evidence.uncaughtErrorNames, "no uncaught browser errors").toEqual([]);
  expect.soft(measured.maxCanvasWidth, "observed main-thread canvas width bound").toBeLessThanOrEqual(4096);
  expect.soft(measured.maxCanvasHeight, "observed main-thread canvas height bound").toBeLessThanOrEqual(4096);
  expect.soft(measured.maxCanvasPixels, "observed main-thread canvas pixel bound").toBeLessThanOrEqual(4096 ** 2);
}

for (const entry of manifest.cases.filter((item) => item.mode !== "control")) {
  test(`corpus ${entry.id} (${entry.kind})`, async ({ page }, info) => {
    const evidence = await observe(page, info, entry.id);
    evidence.sourceKind = entry.kind;
    try {
      await openWorkspace(page, evidence);
      await selectDocument(page, entry);
      await configure(page, entry);
      const started = Date.now();
      await page.getByRole("button", { name: "Process selected pages" }).click();
      await finishProcessing(page);
      evidence.elapsedMs = Date.now() - started;
      evidence.resultHeading = await page.locator("#pdf-results-title").innerText();
      evidence.resultSummary = await page.locator(".pdf-result-summary").innerText();
      for (const expected of entry.pages) {
        await pageButton(page, expected.number).click();
        const editor = page.getByLabel(`Editable text for page ${expected.number}`, { exact: true });
        const completed = await editor.count() > 0;
        const text = completed ? await editor.inputValue() : "";
        const method = await page.locator(".pdf-method-badge").innerText();
        const tokenChecks = expected.expectedTokens.map((token) => ({ token, present: normalise(text).includes(normalise(token)) }));
        const warnings = await page.locator(".pdf-page-warnings li").allTextContents();
        evidence.pages.push({
          page: expected.number, expectedMethod: expected.expectedMethod, automaticMethod: entry.mode === "automatic" ? method : "N/A - forced mode", method,
          methodMatchesPreference: method === expected.expectedMethod, completed,
          outcome: completed ? (warnings.length ? "supported with warning" : "supported") : "page failed and processing continued",
          characters: text.length, tokenChecks,
          textUsefulness: entry.kind === "upstream-decoder-fixture" ? "N/A - decoder smoke only" : "OPEN - token smoke is not a manual usefulness review",
          overrideNeeded: method !== expected.expectedMethod ? "REVIEW" : "NOT_ASSESSED",
          warnings, safeErrors: await page.locator(".pdf-page-editor .pdf-control-error").allTextContents(),
          downscaledWarning: warnings.some((warning) => warning.includes("reduced before OCR")),
          renderDimensions: "Not exposed by workspace UI; bounded run-level canvas observations are attached",
        });
        expect.soft(completed, `${entry.id} page ${expected.number} completed`).toBe(true);
        expect.soft(method, `${entry.id} page ${expected.number} preferred method`).toBe(expected.expectedMethod);
        expect.soft(text.length, `${entry.id} page ${expected.number} minimum content`).toBeGreaterThanOrEqual(expected.minimumCharacters);
        for (const token of tokenChecks) expect.soft(token.present, `${entry.id} page ${expected.number}: ${token.token}`).toBe(true);
      }
      for (const asset of entry.expectedAssets ?? []) {
        expect.soft(evidence.requests, `decoder asset ${asset}`).toContain(asset);
      }
      const measured = await resources(page);
      evidence.resourcesAfterProcessing = measured;
      assertRuntime(evidence, measured);
      await clear(page);
      const baseline = evidence.resourceBaseline as ResourceEvidence;
      await expect.poll(async () => (await resources(page)).workersActive, { timeout: 30_000 }).toBe(baseline.workersActive);
      await expect.poll(async () => (await resources(page)).objectUrls, { timeout: 30_000 }).toBe(baseline.objectUrls);
      evidence.resourcesAfterClear = await resources(page);
    } catch (error) {
      evidence.hardFailureObserved = true;
      evidence.hardFailureName = error instanceof Error ? error.name : "ThrownValue";
      throw error;
    } finally {
      await persist(info, evidence);
    }
  });
}

test("control document cancellation leaves completed pages visible and stops future work", async ({ page }, info) => {
  const evidence = await observe(page, info, "control-cancellation");
  try {
    await openWorkspace(page, evidence);
    const entry = manifest.cases.find((item) => item.id === "fixture-benchmark-10")!;
    await selectDocument(page, entry);
    await page.locator('input[name="pdf-extraction-method"][value="ocr-all"]').check();
    await page.getByRole("button", { name: "Process selected pages" }).click();
    // Synchronise with real UI progress, not a fake OCR delay or engine mock.
    // OCR-all has no Automatic text preflight. A later page means page 1 finished.
    // Do not depend on catching a very brief recognition phase in every engine.
    await expect(page.locator(".pdf-progress")).toContainText(/Page (?:[2-9]|10).*of 10/s, { timeout: 180_000 });
    evidence.phaseBeforeCancel = await page.locator(".pdf-progress").innerText();
    const started = Date.now();
    await page.getByRole("button", { name: "Cancel processing", exact: true }).click();
    await finishProcessing(page);
    evidence.cancellationElapsedMs = Date.now() - started;
    await expect(page.locator("#pdf-results-title")).toContainText("Processing cancelled");
    await pageButton(page, 1).click();
    const retainedText = await page.getByLabel("Editable text for page 1", { exact: true }).inputValue();
    expect(retainedText.length).toBeGreaterThan(0);
    await expect(pageButton(page, 1)).toContainText("Complete");
    evidence.retainedPage1Characters = retainedText.length;
    evidence.retentionComparison = "Pre-cancel text is not exposed during a new document run; completed status and nonempty retained result observed. Byte-for-byte preservation is tested by the separate single-page control.";
    const buttons = await page.locator(".pdf-page-list button").allTextContents();
    expect(buttons.some((value) => value.includes("Not processed"))).toBe(true);
    evidence.pageStatuses = buttons;
    evidence.resourcesAfterCancel = await resources(page);
    assertRuntime(evidence, await resources(page));
    await clear(page);
    const baseline = evidence.resourceBaseline as ResourceEvidence;
    await expect.poll(async () => (await resources(page)).workersActive).toBe(baseline.workersActive);
    evidence.resourcesAfterClear = await resources(page);
  } catch (error) {
    evidence.hardFailureObserved = true;
    evidence.hardFailureName = error instanceof Error ? error.name : "ThrownValue";
    throw error;
  } finally { await persist(info, evidence); }
});

test("control single-page cancellation preserves a prior completed page byte-for-byte", async ({ page }, info) => {
  const evidence = await observe(page, info, "control-single-page-retention");
  try {
    await openWorkspace(page, evidence);
    const entry = manifest.cases.find((item) => item.id === "fixture-mixed")!;
    await selectDocument(page, entry);
    await page.locator('input[name="pdf-extraction-method"][value="embedded-text-only"]').check();
    await page.getByRole("button", { name: "Process selected pages" }).click();
    await finishProcessing(page);
    await pageButton(page, 1).click();
    const beforeText = await page.getByLabel("Editable text for page 1", { exact: true }).inputValue();
    const beforeStatus = await pageButton(page, 1).innerText();
    expect(beforeText.length).toBeGreaterThan(0);
    expect(beforeStatus).toContain("Complete");
    await pageButton(page, 2).click();
    await page.getByRole("button", { name: "Try OCR", exact: true }).click();
    await expect(page.locator(".pdf-progress")).toBeVisible();
    evidence.phaseBeforeCancel = await page.locator(".pdf-progress").innerText();
    const started = Date.now();
    await page.getByRole("button", { name: "Cancel processing", exact: true }).click();
    await finishProcessing(page);
    evidence.cancellationElapsedMs = Date.now() - started;
    await pageButton(page, 1).click();
    const afterText = await page.getByLabel("Editable text for page 1", { exact: true }).inputValue();
    const afterStatus = await pageButton(page, 1).innerText();
    expect(afterText).toBe(beforeText);
    expect(afterStatus).toBe(beforeStatus);
    evidence.pages.push({ page: 1, outcome: "supported", beforeCharacters: beforeText.length, afterCharacters: afterText.length, byteForByteTextEqual: beforeText === afterText, beforeStatus, afterStatus });
    assertRuntime(evidence, await resources(page));
    await clear(page);
    const baseline = evidence.resourceBaseline as ResourceEvidence;
    await expect.poll(async () => (await resources(page)).workersActive).toBe(baseline.workersActive);
    evidence.resourcesAfterClear = await resources(page);
  } catch (error) {
    evidence.hardFailureObserved = true;
    evidence.hardFailureName = error instanceof Error ? error.name : "ThrownValue";
    throw error;
  } finally { await persist(info, evidence); }
});

test("control 26 image-only pages fail before rendering in Automatic and OCR-all", async ({ page }, info) => {
  const evidence = await observe(page, info, "control-ocr-page-cap");
  try {
    await openWorkspace(page, evidence);
    await selectDocument(page, manifest.cases.find((item) => item.id === "fixture-benchmark-26")!);
    const before = await resources(page);
    for (const mode of ["automatic", "ocr-all"]) {
      await page.locator(`input[name="pdf-extraction-method"][value="${mode}"]`).check();
      await page.getByRole("button", { name: "Process selected pages" }).click();
      await expect(page.locator("p:not(.sr-only)").filter({ hasText: /^Too many selected pages require OCR for one operation\./ })).toBeVisible();
      await expect(page.getByRole("button", { name: "Cancel processing", exact: true })).toHaveCount(0);
      const after = await resources(page);
      // Zeroing a scratch canvas for cleanup is not page rendering.
      expect(after.maxCanvasPixels, `${mode}: preflight should not allocate a rendered bitmap`).toBe(before.maxCanvasPixels);
      evidence.pages.push({ mode, outcome: "document rejected safely", safeError: "Too many selected pages require OCR for one operation.", maximumObservedCanvasPixels: after.maxCanvasPixels });
    }
    expect(evidence.requests.some((item) => /\/ocr\/.*(?:worker|traineddata|wasm)/.test(item))).toBe(false);
    assertRuntime(evidence, await resources(page));
  } catch (error) {
    evidence.hardFailureObserved = true;
    evidence.hardFailureName = error instanceof Error ? error.name : "ThrownValue";
    throw error;
  } finally { await persist(info, evidence); }
});

test("control invalid signature, empty and oversized inputs show fixed safe errors", async ({ page }, info) => {
  const evidence = await observe(page, info, "control-file-validation");
  try {
    await openWorkspace(page, evidence);
    const inputs = [
      { id: "invalid-signature", buffer: Buffer.from("Public synthetic non-PDF fixture"), message: "This file does not have a valid PDF signature." },
      { id: "empty", buffer: Buffer.alloc(0), message: "Select a PDF that is not empty." },
      { id: "oversized", buffer: Buffer.alloc(25 * 1024 * 1024 + 1), message: "This PDF is larger than the current local limit." },
    ];
    for (const input of inputs) {
      await page.getByLabel("Choose one PDF").setInputFiles({ name: `${input.id}.pdf`, mimeType: "application/pdf", buffer: input.buffer });
      await expect(page.getByText(input.message, { exact: true })).toBeVisible();
      await expect(page.locator(".pdf-results")).toHaveCount(0);
      evidence.pages.push({ control: input.id, outcome: "document rejected safely", safeError: input.message });
    }
    assertRuntime(evidence, await resources(page));
  } catch (error) {
    evidence.hardFailureObserved = true;
    evidence.hardFailureName = error instanceof Error ? error.name : "ThrownValue";
    throw error;
  } finally { await persist(info, evidence); }
});
