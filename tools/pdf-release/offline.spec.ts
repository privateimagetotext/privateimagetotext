import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { expect, test as base, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import {
  assertPdfCache, cacheMessage, clear, control, fixtureIdentity, goOffline,
  metrics, observeResources, ocrCache, openWorkspace, pdfManifest, prepareBoth,
  privateSentinel, process as processPages, root, select, serverLog, sha256,
  storageSnapshot, type BuildManifest,
} from "./offline-helpers";

type Harness = {
  page: Page; context: BrowserContext; request: APIRequestContext; baseURL: string;
  build: BuildManifest; evidence: Record<string, unknown>;
  paths: string[]; outputs: string[];
};

const test = base.extend<{ harness: Harness }>({
  harness: async ({ page, context, request, baseURL, browser }, use, info) => {
    const evidence: Record<string, unknown> = {
      scenario: info.title, browserProject: info.project.name, browserVersion: browser.version(),
      checkedAt: new Date().toISOString(), buildId: process.env.PDF_RELEASE_BUILD_ID,
      expectedHtmlSha256: process.env.PDF_OFFLINE_EXPECTED_HTML_SHA256,
      gitBaseCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      workingTreeDirty: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0,
      fixtureIdentity,
      scope: "Local real-workspace/service-worker offline state matrix with pinned synthetic fixtures. No physical-device or Cloudflare claim; OCR completion is not recognition-quality acceptance.",
      resourceScope: "Main-thread HTMLCanvasElement positive-dimension writes, Worker constructors and createImageBitmap calls. No engine hooks; excludes worker/OffscreenCanvas allocations and process memory.",
    };
    const paths: string[] = [];
    const outputs: string[] = [];
    const outsideOrigins: string[] = [];
    const contentInNetwork: string[] = [];
    const nonReadRequests: string[] = [];
    const pageErrors: string[] = [];
    const origin = new URL(baseURL!).origin;
    context.on("request", (request) => {
      const url = new URL(request.url());
      if (!["http:", "https:"].includes(url.protocol)) return;
      paths.push(url.pathname);
      if (url.origin !== origin) outsideOrigins.push(url.origin);
      if (!["GET", "HEAD"].includes(request.method())) nonReadRequests.push(request.method());
      const content = `${request.url()}\n${request.postData() ?? ""}`;
      if (["OFFLINE-MATRIX-PUBLIC-", privateSentinel].some((value) => content.includes(value))) contentInNetwork.push(url.pathname);
    });
    page.on("pageerror", (error) => pageErrors.push(error.name));
    try {
      expect(process.env.PDF_RELEASE_BUILD_ID).toMatch(/^[a-f0-9]{64}$/u);
      expect(process.env.PDF_OFFLINE_EXPECTED_HTML_SHA256).toMatch(/^[a-f0-9]{64}$/u);
      await control(request, baseURL!, { fault: null, networkDisabled: false, resetLog: true });
      const stateResponse = await request.get(new URL("/__pdf-validation__/state", baseURL!).href);
      expect(stateResponse.ok()).toBe(true);
      const state = await stateResponse.json() as { buildManifest: BuildManifest; offlineMode?: string };
      const build = state.buildManifest;
      expect(build.manifestSha256).toBe(process.env.PDF_RELEASE_BUILD_ID);
      evidence.serverBuildId = build.manifestSha256;
      evidence.serverOfflineMode = state.offlineMode ?? "http-503";
      await observeResources(page);
      await openWorkspace(page, process.env.PDF_OFFLINE_EXPECTED_HTML_SHA256!);
      await use({ page, context, request, baseURL: baseURL!, build, evidence, paths, outputs });
      expect(outsideOrigins, "only same-origin application traffic").toEqual([]);
      expect(nonReadRequests, "no browser upload requests").toEqual([]);
      expect(contentInNetwork, "no fixture filename or edited text in browser request URL/body").toEqual([]);
      expect(pageErrors, "no uncaught browser exception").toEqual([]);
    } finally {
      evidence.serverRequestsAtEnd = await serverLog(request, baseURL!).catch(() => ({ captureFailed: true }));
      await control(request, baseURL!, { fault: null, networkDisabled: false }).catch(() => undefined);
      await context.setOffline(false).catch(() => undefined);
      Object.assign(evidence, {
        paths, outsideOrigins, contentInNetwork, nonReadRequests, pageErrors,
        status: info.status, assertionFailuresRecorded: info.errors.length,
        outputSummaries: outputs.map((text) => ({ characters: text.length, sha256: sha256(text) })),
      });
      const filename = info.outputPath("evidence.json");
      await writeFile(filename, `${JSON.stringify(evidence, null, 2)}\n`);
      await info.attach("pdf-offline-evidence", { path: filename, contentType: "application/json" });
    }
  },
});
test.setTimeout(900_000);

async function snapshot(harness: Harness, label: string, ready: boolean) {
  const value = await storageSnapshot(harness.page, harness.build, harness.outputs);
  assertPdfCache(value, ready);
  harness.evidence[label] = value;
  return value;
}

async function digitalResult(harness: Harness) {
  await select(harness.page, "selectable.pdf");
  await processPages(harness.page, "embedded-text-only");
  await expect(harness.page.locator(".pdf-method-badge")).toHaveText("PDF text");
  const editor = harness.page.getByLabel("Editable text for page 1", { exact: true });
  await expect(editor).toBeVisible();
  const text = await editor.inputValue();
  expect(text).toContain("PDF PHASE ZERO SELECTABLE 271828");
  harness.outputs.push(text);
  await editor.fill(privateSentinel);
  await expect(harness.page.getByText(/Edited in this tab/)).toBeVisible();
}

test("prepared PDF and OCR support survives offline reload and extracts digital plus scanned pages", async ({ harness }) => {
  const { page, context, request, baseURL, evidence } = harness;
  await prepareBoth(page);
  const prepared = await snapshot(harness, "preparedStorage", true);
  expect(prepared.stores.find((store) => store.name === ocrCache)?.entries.length).toBe(5);
  await goOffline(page, context, request, baseURL, evidence);
  await expect(page.getByText(/PDF reader available offline/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/English OCR available offline/)).toBeVisible({ timeout: 90_000 });
  await digitalResult(harness);
  await snapshot(harness, "offlineDigitalStorage", true);
  await clear(page);
  await select(page, "scanned.pdf");
  await processPages(page, "ocr-all");
  await expect(page.locator(".pdf-method-badge")).toHaveText("OCR");
  const scanEditor = page.getByLabel("Editable text for page 1", { exact: true });
  await expect(scanEditor).toBeVisible();
  const text = await scanEditor.inputValue();
  expect(text.length, "real offline OCR returns nonempty editable text").toBeGreaterThan(20);
  harness.outputs.push(text);
  evidence.offlineScan = { method: "OCR", characters: text.length, sha256: sha256(text), qualityScope: "Completion and nonempty result only; original fixture recognition expectations are not changed." };
  await scanEditor.fill(privateSentinel);
  await snapshot(harness, "offlineScannedStorage", true);
  const log = await serverLog(request, baseURL);
  evidence.offlineRequests = log;
  expect(log.truncated).toBe(false);
  expect(log.requests.filter((entry) => !entry.path.startsWith("/__pdf-validation__/") && entry.status >= 200 && entry.status < 400), "no successful network fallback while offline").toEqual([]);
});

test("PDF-only readiness permits existing text but rejects Automatic and OCR-all before rendering when OCR is absent", async ({ harness }) => {
  const { page, context, request, baseURL, evidence, paths } = harness;
  // This is the application's real support-cache protocol, used only to create
  // a PDF-only setup state. All document extraction still uses the workspace UI.
  const ready = await cacheMessage(page, "PREPARE_PDF_CACHE");
  expect(ready.type).toBe("PDF_CACHE_STATUS");
  expect(ready.ready).toBe(true);
  // Refresh readiness through the application's own startup check. The setup
  // message only prepares support and must not stand in for UI status handling.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Extract text from a PDF. Nothing uploaded." })).toBeVisible();
  await expect(page.getByText(/PDF reader available offline/)).toBeVisible();
  await expect(page.getByText("English OCR not prepared for offline use", { exact: true })).toBeVisible();
  const prepared = await snapshot(harness, "readerOnlyStorage", true);
  expect(prepared.stores.find((store) => store.name === ocrCache)?.entries ?? []).toEqual([]);
  expect(paths.filter((pathname) => pathname.startsWith("/ocr/"))).toEqual([]);
  await goOffline(page, context, request, baseURL, evidence);
  await digitalResult(harness);
  await clear(page);
  const failures = [];
  for (const mode of ["automatic", "ocr-all"] as const) {
    await select(page, "scanned.pdf");
    const before = await metrics(page);
    const requestIndex = paths.length;
    await page.locator(`input[name="pdf-extraction-method"][value="${mode}"]`).check();
    await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
    const error = page.getByRole("alert").filter({ hasText: "English OCR is not available offline. Connect to the internet and prepare it first." });
    await expect(error.first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Cancel processing", exact: true })).toHaveCount(0);
    const after = await metrics(page);
    const ocrRequests = paths.slice(requestIndex).filter((pathname) => pathname.startsWith("/ocr/"));
    expect(after, `${mode} fails before new main-thread bitmap/worker work`).toEqual(before);
    expect(ocrRequests, `${mode} needs no attempted OCR runtime load`).toEqual([]);
    await expect(page.getByLabel("Editable text for page 1", { exact: true })).toHaveCount(0);
    failures.push({ mode, before, after, ocrRequests, error: await error.first().innerText() });
    await clear(page);
  }
  evidence.missingOcrFailures = failures;
  await snapshot(harness, "readerOnlyAfterActionsStorage", true);
  const log = await serverLog(request, baseURL);
  evidence.offlineRequests = log;
  expect(log.truncated).toBe(false);
  expect(log.requests.filter((entry) => !entry.path.startsWith("/__pdf-validation__/") && entry.status >= 200 && entry.status < 400)).toEqual([]);
});

for (const kind of ["missing", "wrong-hash"] as const) {
  test(`${kind} PDF asset preparation remains unready, displays failure, and succeeds after repair and retry`, async ({ harness }) => {
    const { page, request, baseURL, evidence } = harness;
    const faultPath = pdfManifest.assets.find((asset) => asset.runtimePath.endsWith("/cmaps/78-EUC-H.bcmap"))!.runtimePath;
    await digitalResult(harness);
    await page.evaluate(() => {
      const target = window as typeof window & { __pdfOfflineCacheMessages: Record<string, unknown>[] };
      target.__pdfOfflineCacheMessages = [];
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (String(event.data?.type).startsWith("PDF_CACHE_")) target.__pdfOfflineCacheMessages.push(event.data as Record<string, unknown>);
      });
    });
    await control(request, baseURL, { fault: { path: faultPath, kind }, resetLog: true });
    await page.getByRole("button", { name: "Prepare PDF and OCR support", exact: true }).click();
    await expect(page.locator('.pdf-readiness-list li[data-status="failed"]')).toContainText("PDF reader preparation failed", { timeout: 240_000 });
    await expect(page.getByRole("button", { name: "Prepare PDF and OCR support", exact: true })).toBeEnabled();
    await expect(page.getByText(/English OCR available offline/)).toBeVisible({ timeout: 240_000 });
    const messages = await page.evaluate(() => (window as typeof window & { __pdfOfflineCacheMessages: Record<string, unknown>[] }).__pdfOfflineCacheMessages);
    const failed = messages.find((message) => message.type === "PDF_CACHE_FAILED");
    expect(failed?.assetPath).toBe(faultPath);
    expect(failed?.failureCode).toBe(kind === "missing" ? "PDF_ASSET_RESPONSE_STATUS_INVALID" : "PDF_ASSET_RESPONSE_HASH_INVALID");
    evidence.failureMessage = failed;
    await snapshot(harness, "failedPreparationStorage", false);
    const status = await cacheMessage(page, "CHECK_PDF_CACHE");
    expect(status.ready).toBe(false);
    evidence.failedReadiness = status;
    const failedLog = await serverLog(request, baseURL);
    evidence.failedRequests = failedLog;
    expect(failedLog.truncated).toBe(false);
    expect(failedLog.requests.some((entry) => entry.path === faultPath && Boolean(entry.faultApplied) && entry.status === (kind === "missing" ? 404 : 200))).toBe(true);
    await control(request, baseURL, { fault: null, resetLog: true });
    await prepareBoth(page);
    const recovered = await cacheMessage(page, "CHECK_PDF_CACHE");
    expect(recovered.ready).toBe(true);
    evidence.recoveredReadiness = recovered;
    await snapshot(harness, "repairedPreparationStorage", true);
    const repairedLog = await serverLog(request, baseURL);
    evidence.repairedRequests = repairedLog;
    expect(repairedLog.truncated).toBe(false);
    expect(repairedLog.requests.some((entry) => entry.path === faultPath && !entry.faultApplied && entry.status === 200)).toBe(true);
    await clear(page);
  });
}
