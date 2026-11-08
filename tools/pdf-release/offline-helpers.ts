import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

export const root = path.resolve(import.meta.dirname, "../..");
export const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
export const pdfManifest = JSON.parse(readFileSync(path.join(root, "scripts/pdf-assets.manifest.json"), "utf8")) as {
  cacheVersion: string; assets: { runtimePath: string; bytes: number; sha256: string }[];
};
export const pdfMarker = "/__localtext-pdf-cache-ready-v1__";
export const ocrCache = "localtext-ocr-v5";
export const privateSentinel = "OFFLINE MATRIX EDITED RESULT 9081726354";
export const fixtureIdentity = {
  "selectable.pdf": { bytes: 2281, sha256: "3700671a52179557ab84ed22e6ebe75b548d09c2bc4ab68b9dc4b06e156dd5c7" },
  "scanned.pdf": { bytes: 20184, sha256: "7fceaf6f86cef958512f2d8ddb669f3960544f29a132625c6c8cb6c17daeecc3" },
} as const;
export type BuildManifest = { manifestSha256: string; files: { path: string; bytes: number; sha256: string }[] };
export type Control = { fault?: null | { path: string; kind: "missing" | "wrong-hash" }; networkDisabled?: boolean; resetLog?: boolean };
export type ServerLog = { requests: { path: string; status: number; faultApplied: string | null }[]; truncated: boolean };
export type Metrics = { positiveCanvasChanges: number; workersCreated: number; imageBitmapCalls: number };

export async function control(request: APIRequestContext, baseURL: string, patch: Control) {
  const response = await request.post(new URL("/__pdf-validation__/control", baseURL).href, { data: patch, headers: { Connection: "close" } });
  expect(response.ok(), "test server control succeeds").toBe(true);
}

export async function serverLog(request: APIRequestContext, baseURL: string): Promise<ServerLog> {
  // The disconnected-origin server deliberately resets sockets. Retry this
  // idempotent metadata GET at most once if the client reused a stale socket.
  const response = await request.get(new URL("/__pdf-validation__/requests", baseURL).href, { headers: { Connection: "close" }, maxRetries: 1 });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<ServerLog>;
}

export async function observeResources(page: Page) {
  await page.addInitScript(() => {
    const metrics: Metrics = { positiveCanvasChanges: 0, workersCreated: 0, imageBitmapCalls: 0 };
    (window as typeof window & { __pdfOfflineMetrics: Metrics }).__pdfOfflineMetrics = metrics;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        metrics.workersCreated += 1;
      }
    };
    for (const dimension of ["width", "height"] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, dimension)!;
      Object.defineProperty(HTMLCanvasElement.prototype, dimension, {
        ...descriptor,
        set(this: HTMLCanvasElement, value: number) {
          descriptor.set!.call(this, value);
          if (this.width > 0 && this.height > 0) metrics.positiveCanvasChanges += 1;
        },
      });
    }
    if (window.createImageBitmap) {
      const original = window.createImageBitmap.bind(window);
      window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => {
        metrics.imageBitmapCalls += 1;
        return original(...args);
      }) as typeof createImageBitmap;
    }
  });
}

export const metrics = (page: Page) => page.evaluate(() =>
  (window as typeof window & { __pdfOfflineMetrics: Metrics }).__pdfOfflineMetrics,
);

export async function openWorkspace(page: Page, expectedHtml: string) {
  const response = await page.goto("/pdf-to-text");
  expect(response?.status()).toBe(200);
  expect(sha256(await response!.body()), "frozen PDF HTML identity").toBe(expectedHtml);
  await expect(page.getByRole("heading", { level: 1, name: "Extract text from a PDF. Nothing uploaded." })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 60_000 }).toBe(true);
  await expect(page.getByText("Site available offline", { exact: true })).toBeVisible({ timeout: 240_000 });
}

export async function cacheMessage(page: Page, type: "PREPARE_PDF_CACHE" | "CHECK_PDF_CACHE") {
  return page.evaluate(async (messageType) => {
    const registration = await navigator.serviceWorker.ready;
    const target = navigator.serviceWorker.controller ?? registration.active;
    if (!target) throw new Error("No controlling service worker");
    const requestId = `offline-matrix-${messageType}-${Date.now()}`;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        navigator.serviceWorker.removeEventListener("message", listener);
        reject(new Error("PDF cache protocol timed out"));
      }, 240_000);
      const listener = (event: MessageEvent) => {
        if (event.data?.requestId !== requestId || !["PDF_CACHE_STATUS", "PDF_CACHE_FAILED"].includes(event.data?.type)) return;
        window.clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener("message", listener);
        resolve(event.data as Record<string, unknown>);
      };
      navigator.serviceWorker.addEventListener("message", listener);
      target.postMessage({ type: messageType, requestId });
    });
  }, type);
}

export async function prepareBoth(page: Page) {
  await page.getByRole("button", { name: "Prepare PDF and OCR support", exact: true }).click();
  await expect(page.locator(".pdf-readiness-list li").filter({ hasText: "PDF reader available offline" })).toHaveAttribute("data-status", "ready", { timeout: 240_000 });
  await expect(page.locator(".pdf-readiness-list li").filter({ hasText: "English OCR available offline" })).toHaveAttribute("data-status", "ready", { timeout: 240_000 });
}

export async function goOffline(page: Page, context: BrowserContext, request: APIRequestContext, baseURL: string, evidence: Record<string, unknown>) {
  const transition: Record<string, unknown> = {
    initialNativeOnline: await page.evaluate(() => navigator.onLine),
    beforeReloadTimeOrigin: await page.evaluate(() => performance.timeOrigin),
    nativeOfflineReasserted: false,
  };
  evidence.offlineTransition = transition;
  await control(request, baseURL, { networkDisabled: true, resetLog: true });
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  transition.nativeOnlineBeforeReload = await page.evaluate(() => navigator.onLine);
  try {
    const response = await page.reload({ waitUntil: "domcontentloaded" });
    transition.reloadResponseStatus = response?.status();
  } catch (error) {
    transition.reloadError = error instanceof Error ? error.message : "Unknown reload error";
    transition.nativeOnlineAfterReloadFailure = await page.evaluate(() => navigator.onLine).catch(() => null);
    throw error;
  }
  transition.nativeOnlineAfterReload = await page.evaluate(() => navigator.onLine);
  transition.afterReloadTimeOrigin = await page.evaluate(() => performance.timeOrigin);
  expect(transition.afterReloadTimeOrigin, "offline reload creates a fresh document").not.toBe(transition.beforeReloadTimeOrigin);
  if (transition.nativeOnlineAfterReload === true) {
    // Some automation engines lose the native offline flag across reload. Use
    // the real context API again and record it; never replace navigator.onLine.
    transition.nativeOfflineReasserted = true;
    await context.setOffline(true);
    transition.nativeOnlineImmediatelyAfterReassertion = await page.evaluate(() => navigator.onLine);
    if (transition.nativeOnlineImmediatelyAfterReassertion === true
      && context.browser()?.browserType().name() === "chromium") {
      // Playwright 1.62 Chromium network manager skips same-value setOffline
      // calls (coreBundle.js:35865). A bounded diagnostic proved this real API
      // toggle reapplies the protocol. The origin stays transport-disconnected.
      expect(evidence.serverOfflineMode).toBe("disconnect");
      transition.nativeOfflineToggleRequired = true;
      await context.setOffline(false);
      transition.nativeOnlineDuringToggle = await page.evaluate(() => navigator.onLine);
      await context.setOffline(true);
      transition.nativeOnlineAfterToggle = await page.evaluate(() => navigator.onLine);
    }
  }
  try {
    await expect.poll(() => page.evaluate(() => navigator.onLine), { timeout: 5_000 }).toBe(false);
  } finally {
    transition.nativeOnlineAfterReassertionCheck = await page.evaluate(() => navigator.onLine);
  }
  await expect(page.getByRole("heading", { level: 1, name: "Extract text from a PDF. Nothing uploaded." })).toBeVisible();
}

export async function select(page: Page, filename: keyof typeof fixtureIdentity) {
  const pdf = await readFile(path.join(root, "tmp/pdf-phase0/fixtures", filename));
  expect(pdf.length).toBe(fixtureIdentity[filename].bytes);
  expect(sha256(pdf)).toBe(fixtureIdentity[filename].sha256);
  const name = `OFFLINE-MATRIX-PUBLIC-${filename}`;
  await page.getByLabel("Choose one PDF").setInputFiles({ name, mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByRole("heading", { level: 2, name })).toBeVisible({ timeout: 90_000 });
  await page.getByRole("radio", { name: "Page range", exact: true }).check();
  await page.getByLabel("Pages to process").fill("1");
}

export async function process(page: Page, mode: "embedded-text-only" | "automatic" | "ocr-all") {
  await page.locator(`input[name="pdf-extraction-method"][value="${mode}"]`).check();
  await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
  await expect(page.locator(".pdf-results")).toBeVisible({ timeout: 240_000 });
  await expect(page.getByRole("button", { name: "Cancel processing", exact: true })).toHaveCount(0, { timeout: 240_000 });
}

export async function clear(page: Page) {
  await page.getByRole("button", { name: "Clear PDF", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Clear this PDF and its results?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Clear PDF", exact: true }).click();
  await expect(page.locator(".pdf-results")).toHaveCount(0);
}

export async function storageSnapshot(page: Page, build: BuildManifest, outputSentinels: string[]) {
  const snapshot = await page.evaluate(async (sentinels) => {
    const digest = async (value: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", value)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const contentMatches: string[] = [];
    const binaryHashes: string[] = [];
    const inspect = async (value: unknown): Promise<void> => {
      if (typeof value === "string") {
        for (const sentinel of sentinels) if (sentinel.length > 0 && value.includes(sentinel)) contentMatches.push(sentinel);
      } else if (value instanceof Blob) binaryHashes.push(await digest(await value.arrayBuffer()));
      else if (value instanceof ArrayBuffer) binaryHashes.push(await digest(value));
      else if (ArrayBuffer.isView(value)) binaryHashes.push(await digest(new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer));
      else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) { await inspect(key); await inspect(child); }
    };
    const stores = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      const entries = [];
      for (const key of await cache.keys()) {
        const response = (await cache.match(key))!;
        const bytes = await response.arrayBuffer();
        entries.push({ url: key.url, bytes: bytes.byteLength, sha256: await digest(bytes) });
      }
      stores.push({ name, entries });
    }
    const local = Object.entries(localStorage);
    const session = Object.entries(sessionStorage);
    const databases = await indexedDB.databases();
    const indexedStores: { database: string; store: string; count: number; keyCount: number }[] = [];
    for (const database of databases) {
      if (!database.name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const opening = indexedDB.open(database.name!);
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error);
      });
      for (const name of Array.from(db.objectStoreNames)) {
        const records = await new Promise<unknown[]>((resolve, reject) => {
          const transaction = db.transaction(name, "readonly");
          const all = transaction.objectStore(name).getAll();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => reject(all.error);
        });
        const keys = await new Promise<unknown[]>((resolve, reject) => {
          const all = db.transaction(name, "readonly").objectStore(name).getAllKeys();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => reject(all.error);
        });
        indexedStores.push({ database: database.name, store: name, count: records.length, keyCount: keys.length });
        await inspect(records);
        await inspect(keys);
      }
      db.close();
    }
    await inspect({ local, session, databases, indexedStores, cookies: document.cookie, url: location.href });
    return { stores, local, session, databases, indexedStores, binaryHashes, contentMatches, cookies: document.cookie, url: location.href };
  }, ["OFFLINE-MATRIX-PUBLIC-", privateSentinel, "PDF PHASE ZERO SELECTABLE 271828", ...outputSentinels]);
  const byPath = new Map(build.files.map((file) => [file.path, file]));
  const origin = new URL(page.url()).origin;
  for (const store of snapshot.stores) {
    expect(store.name.startsWith("localtext-"), "only application caches").toBe(true);
    for (const entry of store.entries) {
      const url = new URL(entry.url);
      expect(url.origin).toBe(origin);
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
      if (url.pathname === pdfMarker) {
        expect(store.name).toBe(pdfManifest.cacheVersion);
        expect(entry.sha256).toBe(sha256(pdfManifest.cacheVersion));
      } else {
        const relative = url.pathname === "/__localtext-offline-not-found__" ? "404.html" : url.pathname.slice(1);
        const file = [relative, `${relative}.html`, relative ? `${relative}/index.html` : "index.html"].map((candidate) => byPath.get(candidate)).find(Boolean);
        expect(file, `cache path is an exact frozen artifact: ${url.pathname}`).toBeTruthy();
        expect(entry.sha256, `cached body unchanged: ${url.pathname}`).toBe(file!.sha256);
        expect(entry.bytes).toBe(file!.bytes);
      }
    }
  }
  expect(snapshot.contentMatches, "no selected PDF, result or edited sentinel in observed storage").toEqual([]);
  const allowedBinaryHashes = new Set(build.files.map((file) => file.sha256));
  for (const hash of snapshot.binaryHashes) expect(allowedBinaryHashes.has(hash), "IndexedDB binary is a frozen support artifact, not input/rendered content").toBe(true);
  return snapshot;
}

export function assertPdfCache(snapshot: Awaited<ReturnType<typeof storageSnapshot>>, ready: boolean) {
  const cache = snapshot.stores.find((store) => store.name === pdfManifest.cacheVersion);
  expect(snapshot.stores.some((store) => store.name === `${pdfManifest.cacheVersion}-staging`), "no surviving staging cache").toBe(false);
  if (!ready) {
    expect(cache?.entries ?? [], "failed/partial preparation never publishes ready cache").toEqual([]);
    return;
  }
  expect(cache, "PDF cache exists").toBeTruthy();
  expect(cache!.entries.map((entry) => new URL(entry.url).pathname).sort()).toEqual([...pdfManifest.assets.map((asset) => asset.runtimePath), pdfMarker].sort());
  for (const asset of pdfManifest.assets) {
    const stored = cache!.entries.find((entry) => new URL(entry.url).pathname === asset.runtimePath)!;
    expect(stored.sha256).toBe(asset.sha256);
    expect(stored.bytes).toBe(asset.bytes);
  }
}
