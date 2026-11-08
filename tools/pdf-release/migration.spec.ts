import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test as base, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import {
  assertPdfCache, clear, fixtureIdentity, observeResources, ocrCache, pdfManifest,
  process as processPdf, root, select, sha256, storageSnapshot, type BuildManifest,
} from "./offline-helpers";

type Generation = "prior" | "candidate";
type ServerState = {
  generation: Generation; buildId: string; buildManifest: BuildManifest;
  artifacts: Record<Generation, { manifestSha256: string; workerSha256: string }>;
};
type RequestLog = { requests: { path: string; status: number | null; generation: Generation; sha256: string | null; faultApplied: string | null }[]; truncated: boolean };
type Patch = { generation?: Generation; fault?: null | { path: string; kind: "missing" | "wrong-hash" }; networkDisabled?: boolean; resetLog?: boolean };
type CacheState = Awaited<ReturnType<typeof storageSnapshot>>;
type Harness = {
  page: Page; context: BrowserContext; request: APIRequestContext; baseURL: string;
  builds: Record<Generation, BuildManifest>; identities: ServerState["artifacts"];
  evidence: Record<string, unknown>; outputs: string[];
};
const priorWorkerSha = "ab60955878e7fa5a6436dbea3a7871dee16e83e1b81aef79f30d10e6971c446c";
const priorManifestSha = "be8cc8cf55f09a168b747ee5900e782f8d3197fb0ee1a32ccaeaaeac5ca75d54";
const jpegCache = "localtext-jpeg-v2-v1";
const jpegPath = "/steg/jpeg-v2-codec.wasm";
const imageEdit = "MIGRATION IMAGE EDIT 3185270469";
const pdfEdit = "MIGRATION PDF EDIT 5720461839";
const imageFixture = { bytes: 14_210, sha256: "57793f32230825b2884003f1172148d6266ab8bbed11b1d5626bea2b01597f60" };
const privateMarkers = [imageEdit, pdfEdit, "MIGRATION-PUBLIC-", "OFFLINE-MATRIX-PUBLIC-"];

async function control(request: APIRequestContext, baseURL: string, patch: Patch): Promise<ServerState> {
  const response = await request.post(new URL("/__pdf-migration__/control", baseURL).href, { data: patch });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<ServerState>;
}

async function serverLog(h: Pick<Harness, "request" | "baseURL">): Promise<RequestLog> {
  const response = await h.request.get(new URL("/__pdf-migration__/requests", h.baseURL).href);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<RequestLog>;
}

async function protocol(page: Page, type: string, timeoutMs = 30_000) {
  return page.evaluate(async ({ type, timeoutMs }) => {
    const registration = await navigator.serviceWorker.ready;
    const target = navigator.serviceWorker.controller ?? registration.active;
    if (!target) throw new Error("No controlling worker for cache protocol");
    const family = type.includes("PDF") ? "PDF" : type.includes("JPEG") ? "JPEG_CODEC" : type.includes("OCR") ? "OCR" : "SHELL";
    const terminal = [`${family}_CACHE_STATUS`, `${family}_CACHE_FAILED`];
    const requestId = `migration-${type}-${Date.now()}`;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const finish = (value: Record<string, unknown>) => {
        clearTimeout(timer); navigator.serviceWorker.removeEventListener("message", listener); resolve(value);
      };
      const listener = (event: MessageEvent) => {
        if (event.source !== target || !terminal.includes(event.data?.type)) return;
        if (family === "PDF" && event.data?.requestId !== requestId) return;
        finish(event.data as Record<string, unknown>);
      };
      const timer = window.setTimeout(() => {
        navigator.serviceWorker.removeEventListener("message", listener);
        reject(new Error("Cache protocol timed out"));
      }, timeoutMs);
      navigator.serviceWorker.addEventListener("message", listener);
      target.postMessage({ type, requestId });
    });
  }, { type, timeoutMs });
}

async function shellReady(page: Page) {
  await expect.poll(async () => (await protocol(page, "CHECK_SHELL_CACHE")).ready, { timeout: 240_000 }).toBe(true);
}

async function snapshot(h: Harness, label: string, generation: Generation) {
  const value = await storageSnapshot(h.page, h.builds[generation], [...h.outputs, ...privateMarkers]);
  h.evidence[label] = value;
  return value;
}

function supportIdentity(snapshot: CacheState) {
  return snapshot.stores.filter((store) => [ocrCache, jpegCache].includes(store.name))
    .map((store) => ({ name: store.name, entries: [...store.entries].sort((a, b) => a.url.localeCompare(b.url)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function imageResult(page: Page) {
  const buffer = await readFile(path.join(root, "e2e/fixtures/localtext-ocr.png"));
  expect(buffer.length).toBe(imageFixture.bytes);
  expect(sha256(buffer)).toBe(imageFixture.sha256);
  await page.getByLabel("Choose image file", { exact: true }).setInputFiles({ name: "MIGRATION-PUBLIC-image.png", mimeType: "image/png", buffer });
  // Bound input decoding separately: a browser-level offline blob failure must
  // become a recorded substep failure rather than consume the case-wide limit.
  await page.getByRole("button", { name: "Extract text", exact: true }).click({ timeout: 30_000 });
  const editor = page.locator(".result-editor textarea");
  await expect(editor).toHaveValue(/LOCALTEXT\s+OFFLINE\s+OCR\s+TEST\s+7429/i, { timeout: 120_000 });
  await page.getByRole("button", { name: "Edit this version", exact: true }).click();
  await editor.fill(imageEdit);
  await expect(editor).toHaveValue(imageEdit);
}

async function transition(h: Harness, generation: Generation) {
  const state = await control(h.request, h.baseURL, { generation, fault: null, networkDisabled: false });
  expect(state.buildId).toBe(h.builds[generation].manifestSha256);
  const changed = await h.page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const prior = navigator.serviceWorker.controller;
    if (!prior) throw new Error("A prior real controller is required");
    const result = new Promise<{ changed: boolean; url: string; state: string }>((resolve, reject) => {
      const listener = () => {
        const current = navigator.serviceWorker.controller;
        if (!current || current === prior) return;
        clearTimeout(timer); navigator.serviceWorker.removeEventListener("controllerchange", listener);
        resolve({ changed: current === registration.active, url: current.scriptURL, state: current.state });
      };
      const timer = window.setTimeout(() => {
        navigator.serviceWorker.removeEventListener("controllerchange", listener);
        reject(new Error("Real worker controller did not change"));
      }, 60_000);
      navigator.serviceWorker.addEventListener("controllerchange", listener);
      registration.update().catch((error: unknown) => {
        clearTimeout(timer); navigator.serviceWorker.removeEventListener("controllerchange", listener); reject(error);
      });
    });
    return result;
  });
  expect(changed.changed).toBe(true);
  expect(changed.url).toBe(new URL("/sw.js", h.baseURL).href);
  await expect.poll(() => h.page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe("activated");
  await shellReady(h.page);
  const log = await serverLog(h);
  expect(log.truncated).toBe(false);
  expect(log.requests.some((entry) => entry.path === "/sw.js" && entry.generation === generation && entry.status === 200 && entry.sha256 === h.identities[generation].workerSha256), "updated controller received the pinned emitted worker bytes").toBe(true);
  h.evidence[`${generation}ControllerChange`] = changed;
}

async function openCandidatePdf(h: Harness) {
  const response = await h.page.goto("/pdf-to-text");
  expect(response?.status()).toBe(200);
  expect(sha256(await response!.body())).toBe(h.builds.candidate.files.find((file) => file.path === "pdf-to-text.html")!.sha256);
  await expect(h.page.getByRole("heading", { level: 1, name: "Extract text from a PDF. Nothing uploaded." })).toBeVisible();
  await shellReady(h.page);
  await select(h.page, "selectable.pdf");
  await processPdf(h.page, "embedded-text-only");
  const editor = h.page.getByLabel("Editable text for page 1", { exact: true });
  const text = await editor.inputValue();
  expect(text).toContain("PDF PHASE ZERO SELECTABLE 271828");
  h.outputs.push(text);
  await editor.fill(pdfEdit);
}

const test = base.extend<{ harness: Harness }>({
  harness: async ({ page, context, request, baseURL, browser }, use, info) => {
    const evidence: Record<string, unknown> = {
      scenario: info.title, browserProject: info.project.name, browserVersion: browser.version(), checkedAt: new Date().toISOString(),
      scope: "Local real-controller upgrade/rollback of a reconstructed exact-source prior app and frozen private candidate. No Cloudflare, shipping-browser or device acceptance.",
      fixtureIdentity, imageFixture,
    };
    const outputs: string[] = [];
    const networkLeaks: string[] = [];
    const outsideOrigins: string[] = [];
    const nonReadRequests: string[] = [];
    const pageErrors: string[] = [];
    const inspections: Promise<void>[] = [];
    let downloads = 0;
    const origin = new URL(baseURL!).origin;
    context.on("request", (request) => {
      const url = new URL(request.url());
      if (!["http:", "https:"].includes(url.protocol)) return;
      if (url.origin !== origin) outsideOrigins.push(url.origin);
      if (!["GET", "HEAD"].includes(request.method())) nonReadRequests.push(request.method());
      inspections.push((async () => {
        const data = `${request.url()}\n${JSON.stringify(await request.allHeaders())}\n${request.postData() ?? ""}`;
        if ([...privateMarkers, ...outputs].some((marker) => marker && data.includes(marker))) networkLeaks.push(url.pathname);
      })());
    });
    page.on("pageerror", (error) => pageErrors.push(error.name));
    page.on("download", () => { downloads += 1; });
    try {
      const candidate = await control(request, baseURL!, { generation: "candidate", fault: null, networkDisabled: false });
      const prior = await control(request, baseURL!, { generation: "prior", resetLog: true });
      expect(prior.artifacts.prior.workerSha256).toBe(priorWorkerSha);
      expect(prior.buildId).toBe(priorManifestSha);
      const h: Harness = { page, context, request, baseURL: baseURL!, builds: { prior: prior.buildManifest, candidate: candidate.buildManifest }, identities: prior.artifacts, evidence, outputs };
      evidence.artifacts = prior.artifacts;
      await observeResources(page);
      const response = await page.goto("/");
      expect(response?.status()).toBe(200);
      expect(sha256(await response!.body())).toBe(h.builds.prior.files.find((file) => file.path === "index.html")!.sha256);
      await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
      await shellReady(page);
      expect((await protocol(page, "PREPARE_OCR_CACHE", 240_000)).ready).toBe(true);
      expect((await protocol(page, "PREPARE_JPEG_CODEC_CACHE", 90_000)).ready).toBe(true);
      const initial = await snapshot(h, "priorPreparedStorage", "prior");
      expect(initial.stores.find((store) => store.name === ocrCache)?.entries).toHaveLength(5);
      expect(initial.stores.find((store) => store.name === jpegCache)?.entries).toHaveLength(1);
      expect(initial.stores.some((store) => store.name.startsWith("localtext-pdf-"))).toBe(false);
      await use(h);
      await Promise.all(inspections);
      expect(networkLeaks).toEqual([]);
      expect(outsideOrigins).toEqual([]);
      expect(nonReadRequests).toEqual([]);
      expect(pageErrors).toEqual([]);
      expect(downloads, "no automatic export during migration").toBe(0);
    } finally {
      evidence.serverRequests = await serverLog({ request, baseURL: baseURL! }).catch(() => ({ captureFailed: true }));
      await control(request, baseURL!, { fault: null, networkDisabled: false }).catch(() => undefined);
      await context.setOffline(false).catch(() => undefined);
      Object.assign(evidence, { networkLeaks, outsideOrigins, nonReadRequests, pageErrors, downloads, status: info.status, assertionFailures: info.errors.length, outputSummaries: outputs.map((text) => ({ characters: text.length, sha256: sha256(text) })) });
      const filename = info.outputPath("evidence.json");
      await writeFile(filename, `${JSON.stringify(evidence, null, 2)}\n`);
      await info.attach("pdf-migration-evidence", { path: filename, contentType: "application/json" });
    }
  },
});

test.use({ actionTimeout: 30_000, navigationTimeout: 30_000 });
test.setTimeout(900_000);

test("real prior worker upgrades without losing image edits and rolls back without false PDF readiness", async ({ harness: h }) => {
  const before = supportIdentity(await snapshot(h, "beforeUpgrade", "prior"));
  await imageResult(h.page);
  await transition(h, "candidate");
  await expect(h.page.locator(".result-editor textarea")).toHaveValue(imageEdit);
  const upgraded = await snapshot(h, "afterUpgrade", "candidate");
  expect(upgraded.stores.some((store) => store.name === "localtext-shell-v7")).toBe(false);
  expect(upgraded.stores.some((store) => store.name === "localtext-shell-v8")).toBe(true);
  expect(supportIdentity(upgraded)).toEqual(before);
  expect((await protocol(h.page, "CHECK_PDF_CACHE")).ready).toBe(false);

  await openCandidatePdf(h);
  await h.page.getByRole("button", { name: "Prepare PDF and OCR support", exact: true }).click();
  await expect(h.page.locator(".pdf-readiness-list li").filter({ hasText: "PDF reader" })).toHaveAttribute("data-status", "ready", { timeout: 240_000 });
  const prepared = await snapshot(h, "candidatePdfPrepared", "candidate");
  assertPdfCache(prepared, true);
  await transition(h, "prior");
  await expect(h.page.getByLabel("Editable text for page 1", { exact: true })).toHaveValue(pdfEdit);
  const rolledBack = await snapshot(h, "afterRollback", "prior");
  expect(rolledBack.stores.some((store) => store.name === "localtext-shell-v8" || store.name.startsWith("localtext-pdf-"))).toBe(false);
  expect(supportIdentity(rolledBack)).toEqual(before);
  const pdfReadiness = h.page.locator(".pdf-readiness-list li").filter({ hasText: "PDF reader" });
  h.evidence.rollbackReadiness = { actualCachePresent: false, displayedState: await pdfReadiness.getAttribute("data-status"), displayedText: await pdfReadiness.innerText() };
  // Keep exercising cleanup/recovery even when the frozen baseline exposes its
  // known suspected stale-readiness boundary. A soft failure is still a FAIL.
  await expect.soft(pdfReadiness, "rollback removed PDF support; an open tab must not still report it ready").not.toHaveAttribute("data-status", "ready", { timeout: 10_000 });

  const reloaded = await h.page.reload();
  expect(reloaded?.status()).toBe(404);
  await expect(h.page.getByLabel("Editable text for page 1", { exact: true })).toHaveCount(0);
  await expect(h.page.locator("body")).not.toContainText(pdfEdit);
  await h.page.goto("/");
  await shellReady(h.page);
  expect((await protocol(h.page, "CHECK_OCR_CACHE")).ready).toBe(true);
  expect((await protocol(h.page, "CHECK_JPEG_CODEC_CACHE")).ready).toBe(true);
  // No reload while offline: cross-engine reload behavior belongs to the
  // dedicated offline matrix, which records the current engine limitations.
  await control(h.request, h.baseURL, { networkDisabled: true, resetLog: true });
  await h.context.setOffline(true);
  await expect.poll(() => h.page.evaluate(() => navigator.onLine)).toBe(false);
  await imageResult(h.page);
  const jpeg = await h.page.evaluate(async (pathname) => {
    const response = await fetch(pathname);
    const bytes = await response.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return { ok: response.ok, bytes: bytes.byteLength, sha256: hash };
  }, jpegPath);
  expect(jpeg).toEqual({ ok: true, bytes: 253_687, sha256: "1c8326b7278e5f0afa003a9bf95ffe280f2e733160d1458f0be54f9cb9c1968a" });
  h.evidence.offlineRecoveryRequests = await serverLog(h);
  expect((h.evidence.offlineRecoveryRequests as RequestLog).requests.filter((entry) => entry.status !== null && entry.status >= 200 && entry.status < 400)).toEqual([]);
  await snapshot(h, "rollbackOfflineRecoveryStorage", "prior");
});

test("real upgrade rejects an incomplete PDF cache and recovers failed preparation while preserving OCR and JPEG", async ({ harness: h }) => {
  const before = supportIdentity(await snapshot(h, "beforeIncompleteUpgrade", "prior"));
  await h.page.evaluate(async ({ name, asset }) => {
    const partial = await caches.open(name);
    await partial.put(asset, new Response("incomplete public support fixture", { headers: { "Content-Type": "application/octet-stream" } }));
    const staging = await caches.open(`${name}-staging`);
    await staging.put(asset, new Response("unfinished public support fixture"));
  }, { name: pdfManifest.cacheVersion, asset: pdfManifest.assets[0].runtimePath });
  await transition(h, "candidate");
  expect((await protocol(h.page, "CHECK_PDF_CACHE")).ready).toBe(false);
  const invalidated = await snapshot(h, "incompleteCacheInvalidated", "candidate");
  assertPdfCache(invalidated, false);
  expect(supportIdentity(invalidated)).toEqual(before);
  await openCandidatePdf(h);
  const faultPath = pdfManifest.assets.find((asset) => asset.runtimePath.endsWith("/cmaps/78-EUC-H.bcmap"))!.runtimePath;
  await control(h.request, h.baseURL, { fault: { path: faultPath, kind: "wrong-hash" }, resetLog: true });
  await h.page.getByRole("button", { name: "Prepare PDF and OCR support", exact: true }).click();
  await expect(h.page.locator('.pdf-readiness-list li[data-status="failed"]')).toContainText("PDF reader preparation failed", { timeout: 240_000 });
  await expect(h.page.getByRole("button", { name: "Prepare PDF and OCR support", exact: true })).toBeEnabled();
  await expect(h.page.getByLabel("Editable text for page 1", { exact: true })).toHaveValue(pdfEdit);
  expect((await protocol(h.page, "CHECK_PDF_CACHE")).ready).toBe(false);
  const failed = await snapshot(h, "failedPreparation", "candidate");
  assertPdfCache(failed, false);
  expect(supportIdentity(failed)).toEqual(before);
  const failedLog = await serverLog(h);
  expect(failedLog.requests.some((entry) => entry.path === faultPath && entry.faultApplied === "wrong-hash")).toBe(true);
  h.evidence.failedPreparationRequests = failedLog;
  await control(h.request, h.baseURL, { fault: null, resetLog: true });
  await h.page.getByRole("button", { name: "Prepare PDF and OCR support", exact: true }).click();
  await expect(h.page.locator(".pdf-readiness-list li").filter({ hasText: "PDF reader available offline" })).toHaveAttribute("data-status", "ready", { timeout: 240_000 });
  const recovered = await snapshot(h, "recoveredPreparation", "candidate");
  assertPdfCache(recovered, true);
  expect(supportIdentity(recovered)).toEqual(before);
  await expect(h.page.getByLabel("Editable text for page 1", { exact: true })).toHaveValue(pdfEdit);
  await clear(h.page);
  await control(h.request, h.baseURL, { networkDisabled: true, resetLog: true });
  await h.context.setOffline(true);
  await expect.poll(() => h.page.evaluate(() => navigator.onLine)).toBe(false);
  await select(h.page, "selectable.pdf");
  await processPdf(h.page, "embedded-text-only");
  await expect(h.page.getByLabel("Editable text for page 1", { exact: true })).toHaveValue(/PDF PHASE ZERO SELECTABLE 271828/);
  h.evidence.offlineRecoveredPdfRequests = await serverLog(h);
  expect((h.evidence.offlineRecoveredPdfRequests as RequestLog).requests.filter((entry) => entry.status !== null && entry.status >= 200 && entry.status < 400)).toEqual([]);
  await snapshot(h, "recoveredOfflinePdfStorage", "candidate");
});
