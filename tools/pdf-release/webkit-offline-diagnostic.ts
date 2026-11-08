import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { webkit, type Page } from "@playwright/test";

// Diagnostic only: native browser APIs and the unmodified frozen workspace.
// Never imported by the app or acceptance suites; every invocation retains its
// own output. Emulation failures are observations, not accepted product gates.
const root = path.resolve(import.meta.dirname, "../..");
const output = path.resolve(process.env.PDF_WEBKIT_DIAGNOSTIC_RESULTS ?? "");
const relative = path.relative(path.join(root, "tmp"), output);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || existsSync(output)) {
  throw new Error("Set PDF_WEBKIT_DIAGNOSTIC_RESULTS to a new directory below repo tmp.");
}
const appURL = process.env.PDF_VALIDATION_BASE_URL;
if (!appURL || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(appURL)) throw new Error("An isolated loopback app origin is required.");
const expectedBuild = "fc7f74206d04ea889a106b80eddb9e8e20cb43cdbc5eb2ffcc5540c9308baca9";
const expectedHtml = "e6b38511c29dfd826502082934b451d87d817db546558425924d8c4b23ad8810";
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const png = await readFile(path.join(root, "e2e/fixtures/localtext-ocr.png"));
if (hash(png) !== "57793f32230825b2884003f1172148d6266ab8bbed11b1d5626bea2b01597f60") throw new Error("PNG fixture changed.");
const pdf = await readFile(path.join(root, "tmp/pdf-phase0/fixtures/selectable.pdf"));
if (hash(pdf) !== "3700671a52179557ab84ed22e6ebe75b548d09c2bc4ab68b9dc4b06e156dd5c7") throw new Error("PDF fixture changed.");
await mkdir(output, { recursive: true });
const modes = [
  { name: "online", emulate: false, disconnect: false },
  { name: "emulation-only", emulate: true, disconnect: false },
  { name: "origin-disconnected-only", emulate: false, disconnect: true },
  { name: "combined", emulate: true, disconnect: true },
] as const;
const results: Record<string, unknown>[] = [];
let disconnected = false;
let minimalRequests: { path: string; status: number }[] = [];
const html = "<!doctype html><meta charset=utf-8><title>Native offline diagnostic</title><h1>Native APIs only</h1>";
const minimal = http.createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (disconnected) { minimalRequests.push({ path: pathname, status: 0 }); request.socket.destroy(); return; }
  minimalRequests.push({ path: pathname, status: 200 });
  const body = pathname === "/ping" ? "native-http-control" : html;
  response.writeHead(200, { "Content-Type": pathname === "/ping" ? "text/plain" : "text/html", "Cache-Control": "no-store" });
  response.end(body);
});
await new Promise<void>((resolve, reject) => { minimal.once("error", reject); minimal.listen(0, "127.0.0.1", resolve); });
const address = minimal.address();
if (!address || typeof address === "string") throw new Error("No native server address.");
const nativeURL = `http://127.0.0.1:${address.port}`;
const browser = await webkit.launch({ headless: true, timeout: 20_000 });
const api = await browser.newContext();
const request = api.request;
async function control(value: { networkDisabled: boolean; resetLog?: boolean }) {
  const response = await request.post(`${appURL}/__pdf-validation__/control`, { data: { fault: null, ...value }, timeout: 10_000, headers: { Connection: "close" } });
  if (!response.ok()) throw new Error("App server control failed.");
}
const errorText = (error: unknown) => error instanceof Error ? `${error.name}: ${error.message}` : String(error);
async function step(evidence: Record<string, unknown>, name: string, action: () => Promise<unknown>) {
  const began = Date.now();
  try { const value = await action(); evidence[name] = { ok: true, durationMs: Date.now() - began, value }; return true; }
  catch (error) { evidence[name] = { ok: false, durationMs: Date.now() - began, error: errorText(error) }; return false; }
}
async function nativeProbes(page: Page) {
  return page.evaluate(async (encoded) => {
    const raw = Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0));
    const blob = new Blob([raw], { type: "image/png" });
    const run = async (operation: () => Promise<unknown>) => {
      const started = performance.now();
      let timer: number | undefined;
      try {
        const value = await Promise.race([operation(), new Promise((_, reject) => { timer = window.setTimeout(() => reject(new Error("Native operation timed out after 5000 ms")), 5_000); })]);
        return { ok: true, elapsedMs: performance.now() - started, value };
      } catch (error) { return { ok: false, elapsedMs: performance.now() - started, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }; }
      finally { window.clearTimeout(timer); }
    };
    const image = async (src: string) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight };
    };
    const blobUrl = URL.createObjectURL(blob);
    const workerUrls: string[] = [];
    const workers: Worker[] = [];
    const worker = async (type: "classic" | "module") => {
      const url = URL.createObjectURL(new Blob(["postMessage('native-blob-worker-ready')"], { type: "text/javascript" }));
      workerUrls.push(url);
      return new Promise((resolve, reject) => {
        const instance = new Worker(url, { type }); workers.push(instance);
        instance.onmessage = (event) => resolve(event.data);
        instance.onerror = (event) => { event.preventDefault(); reject(new Error(event.message || "Worker error event")); };
      });
    };
    try {
      const values = await Promise.all([
        run(async () => ({ bytes: (await blob.arrayBuffer()).byteLength })),
        run(() => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ bytes: (reader.result as ArrayBuffer).byteLength });
          reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob);
        })),
        run(async () => { const response = await fetch(blobUrl); return { status: response.status, bytes: (await response.arrayBuffer()).byteLength }; }),
        run(() => image(blobUrl)),
        // Independent data-URL control, not a replacement for the blob path.
        run(() => image(`data:image/png;base64,${encoded}`)),
        run(() => worker("classic")), run(() => worker("module")),
      ]);
      return { nativeOnline: navigator.onLine, controller: Boolean(navigator.serviceWorker.controller), results: Object.fromEntries(["blobArrayBuffer", "fileReader", "blobFetch", "blobImage", "dataImageControl", "blobClassicWorker", "blobModuleWorker"].map((name, i) => [name, values[i]])) };
    } finally { workers.forEach((worker) => worker.terminate()); [blobUrl, ...workerUrls].forEach((url) => URL.revokeObjectURL(url)); }
  }, png.toString("base64"));
}

try {
  const state = await (await request.get(`${appURL}/__pdf-validation__/state`, { timeout: 10_000 })).json();
  if (state.buildId !== expectedBuild || state.offlineMode !== "disconnect") throw new Error("Unexpected frozen app identity or transport.");
  await writeFile(path.join(output, "identity.json"), JSON.stringify({ checkedAt: new Date().toISOString(), browser: browser.version(), playwrightVersion: "1.62.0", gitBase: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), dirty: true, appURL, nativeURL, buildId: state.buildId, htmlSha256: expectedHtml, fixtureHashes: { png: hash(png), pdf: hash(pdf) }, nativeHtmlSha256: hash(html) }, null, 2));
  for (const surface of ["native", "app"] as const) {
    for (const mode of modes) {
      const id = `${surface}-${mode.name}`;
      const evidence: Record<string, unknown> = { id, mode, startedAt: new Date().toISOString(), scope: "Diagnostic observation, not offline acceptance or shipping Safari proof" };
      const context = await browser.newContext({ serviceWorkers: "allow" });
      context.setDefaultTimeout(10_000); context.setDefaultNavigationTimeout(15_000);
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const page = await context.newPage();
      const failures: unknown[] = []; const consoleErrors: unknown[] = []; const pageErrors: string[] = [];
      page.on("requestfailed", (request) => failures.push({ url: request.url(), error: request.failure()?.errorText }));
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push({ text: message.text(), location: message.location() }); });
      page.on("pageerror", (error) => pageErrors.push(errorText(error)));
      // Hard per-case ceiling, including protocol/evaluation failures.
      const ceiling = setTimeout(() => { evidence.caseCeilingExpired = true; void context.close(); }, 150_000);
      try {
        disconnected = false;
        await control({ networkDisabled: false, resetLog: true });
        if (surface === "native") {
          await page.goto(nativeURL);
          evidence.precondition = await page.evaluate(() => ({ nativeOnline: navigator.onLine, controller: Boolean(navigator.serviceWorker.controller), scripts: document.scripts.length }));
          minimalRequests = [];
          disconnected = mode.disconnect;
        } else {
          const response = await page.goto(`${appURL}/pdf-to-text`);
          if (response?.status() !== 200 || hash(await response.body()) !== expectedHtml) throw new Error("App HTML mismatch.");
          await page.getByText("Site available offline", { exact: true }).waitFor({ timeout: 45_000 });
          await page.getByRole("button", { name: "Prepare PDF and OCR support", exact: true }).click();
          await page.locator('.pdf-readiness-list li[data-status="ready"]').filter({ hasText: "PDF reader available offline" }).waitFor({ timeout: 60_000 });
          await page.locator('.pdf-readiness-list li[data-status="ready"]').filter({ hasText: "English OCR available offline" }).waitFor({ timeout: 60_000 });
          evidence.precondition = await page.evaluate(async () => ({ nativeOnline: navigator.onLine, controller: Boolean(navigator.serviceWorker.controller), cacheNames: await caches.keys(), timeOrigin: performance.timeOrigin }));
          await control({ networkDisabled: mode.disconnect, resetLog: true });
        }
        await context.setOffline(mode.emulate);
        evidence.nativeOnlineAfterMode = await page.evaluate(() => navigator.onLine);
        await step(evidence, "nativeProbes", () => nativeProbes(page));
        if (surface === "native") {
          await step(evidence, "httpControl", () => page.evaluate(async () => {
            const response = await fetch("/ping", { signal: AbortSignal.timeout(5_000) }); return { status: response.status, text: await response.text() };
          }));
        } else {
          const selected = await step(evidence, "pdfSelection", async () => {
            await page.getByLabel("Choose one PDF").setInputFiles({ name: "PUBLIC-WEBKIT-DIAGNOSTIC.pdf", mimeType: "application/pdf", buffer: pdf });
            await page.getByRole("heading", { level: 2, name: "PUBLIC-WEBKIT-DIAGNOSTIC.pdf" }).waitFor({ timeout: 15_000 });
            return { selected: true };
          });
          if (selected) await step(evidence, "pdfExistingText", async () => {
            await page.getByRole("radio", { name: "Page range", exact: true }).check();
            await page.getByLabel("Pages to process").fill("1");
            await page.locator('input[name="pdf-extraction-method"][value="embedded-text-only"]').check();
            await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
            const editor = page.getByLabel("Editable text for page 1", { exact: true });
            await editor.waitFor({ timeout: 20_000 });
            const text = await editor.inputValue();
            if (!text.includes("PDF PHASE ZERO SELECTABLE 271828")) throw new Error("Expected digital token missing.");
            return { characters: text.length, sha256: hash(text), method: await page.locator(".pdf-method-badge").innerText() };
          });
          evidence.beforeReload = await page.evaluate(() => ({ nativeOnline: navigator.onLine, timeOrigin: performance.timeOrigin, controller: Boolean(navigator.serviceWorker.controller) }));
          await step(evidence, "cachedReload", async () => {
            const response = await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 });
            await page.getByRole("heading", { level: 1, name: "Extract text from a PDF. Nothing uploaded." }).waitFor({ timeout: 10_000 });
            return { status: response?.status(), nativeOnline: await page.evaluate(() => navigator.onLine), timeOrigin: await page.evaluate(() => performance.timeOrigin) };
          });
        }
        await page.screenshot({ path: path.join(output, `${id}.png`), fullPage: true, timeout: 10_000 }).catch((error: unknown) => { evidence.screenshotError = errorText(error); });
      } catch (error) { evidence.caseError = errorText(error); }
      finally {
        clearTimeout(ceiling);
        if (surface === "native") evidence.serverRequests = minimalRequests;
        else evidence.serverRequests = await (await request.get(`${appURL}/__pdf-validation__/requests`, { timeout: 10_000, headers: { Connection: "close" }, maxRetries: 1 })).json().catch((error: unknown) => ({ captureError: errorText(error) }));
        Object.assign(evidence, { failures, consoleErrors, pageErrors, finishedAt: new Date().toISOString() });
        await context.tracing.stop({ path: path.join(output, `${id}-trace.zip`) }).catch(() => undefined);
        await context.close(); disconnected = false;
        await control({ networkDisabled: false });
        await writeFile(path.join(output, `${id}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
        results.push(evidence);
        process.stdout.write(`${id}: ${JSON.stringify({ native: evidence.nativeProbes, selection: evidence.pdfSelection, text: evidence.pdfExistingText, reload: evidence.cachedReload, caseError: evidence.caseError })}\n`);
      }
    }
  }
} finally {
  await control({ networkDisabled: false }).catch(() => undefined);
  await api.close(); await browser.close();
  minimal.closeAllConnections(); await new Promise<void>((resolve) => minimal.close(() => resolve()));
  await writeFile(path.join(output, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
}
