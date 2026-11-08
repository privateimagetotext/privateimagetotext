import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { webkit } from "@playwright/test";

// One follow-up to isolate the cached-reload failure, independent of LocalOCR.
const root = path.resolve(import.meta.dirname, "../..");
const output = path.resolve(process.env.PDF_WEBKIT_DIAGNOSTIC_RESULTS ?? "");
const relative = path.relative(path.join(root, "tmp"), output);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || existsSync(output)) throw new Error("Use a new diagnostic output directory below tmp.");
await mkdir(output, { recursive: true });
const html = "<!doctype html><meta charset=utf-8><title>Minimal cached navigation</title><h1>NATIVE CACHED DOCUMENT 650271</h1>";
const worker = `
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open('native-diagnostic-v1');
  await cache.add('/index.html');
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (new URL(event.request.url).pathname === '/index.html') {
    event.respondWith(caches.match('/index.html'));
  }
});
`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
let disconnected = false;
let requests: { path: string; status: number }[] = [];
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (disconnected) { requests.push({ path: pathname, status: 0 }); request.socket.destroy(); return; }
  requests.push({ path: pathname, status: 200 });
  response.writeHead(200, { "Content-Type": pathname === "/sw.js" ? "text/javascript" : "text/html", "Cache-Control": "no-store" });
  response.end(pathname === "/sw.js" ? worker : html);
});
await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const address = server.address();
if (!address || typeof address === "string") throw new Error("No local address.");
const url = `http://127.0.0.1:${address.port}`;
const browser = await webkit.launch({ headless: true, timeout: 20_000 });
const results: Record<string, unknown>[] = [];
const errorText = (error: unknown) => error instanceof Error ? `${error.name}: ${error.message}` : String(error);
try {
  for (const mode of [{ name: "emulation-only", emulate: true, disconnect: false }, { name: "origin-disconnected-only", emulate: false, disconnect: true }]) {
    const evidence: Record<string, unknown> = { mode, browser: browser.version(), url, htmlSha256: hash(html), swSha256: hash(worker), beganAt: new Date().toISOString() };
    const context = await browser.newContext({ serviceWorkers: "allow" });
    context.setDefaultTimeout(10_000); context.setDefaultNavigationTimeout(15_000);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await context.newPage();
    const failures: unknown[] = [];
    page.on("requestfailed", (request) => failures.push({ url: request.url(), error: request.failure()?.errorText }));
    const ceiling = setTimeout(() => { evidence.caseCeilingExpired = true; void context.close(); }, 60_000);
    try {
      disconnected = false; requests = [];
      await page.goto(`${url}/index.html`);
      await page.evaluate(async () => {
        await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
      });
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { timeout: 10_000 });
      await page.reload();
      await page.getByRole("heading", { name: "NATIVE CACHED DOCUMENT 650271" }).waitFor();
      const before = await page.evaluate(async () => ({ nativeOnline: navigator.onLine, timeOrigin: performance.timeOrigin, controller: Boolean(navigator.serviceWorker.controller), text: await (await caches.match('/index.html'))!.text() }));
      if (hash(before.text) !== hash(html)) throw new Error("Cached document control differs.");
      evidence.before = { ...before, text: undefined, htmlSha256: hash(before.text) };
      requests = []; disconnected = mode.disconnect;
      await context.setOffline(mode.emulate);
      evidence.nativeOnlineAfterMode = await page.evaluate(() => navigator.onLine);
      try {
        const value = await page.evaluate(async () => {
          const response = await caches.match('/index.html');
          const text = await Promise.race([response!.text(), new Promise<string>((_, reject) => window.setTimeout(() => reject(new Error('Cached body read timed out')), 5_000))]);
          return { text, status: response!.status };
        });
        evidence.cachedBodyRead = { ok: true, status: value.status, htmlSha256: hash(value.text), equalsOriginal: hash(value.text) === hash(html) };
      } catch (error) { evidence.cachedBodyRead = { ok: false, error: errorText(error) }; }
      const started = Date.now();
      try {
        const response = await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 });
        await page.getByRole("heading", { name: "NATIVE CACHED DOCUMENT 650271" }).waitFor({ timeout: 10_000 });
        const state = await page.evaluate(() => ({ nativeOnline: navigator.onLine, timeOrigin: performance.timeOrigin, controller: Boolean(navigator.serviceWorker.controller) }));
        evidence.reload = { ok: true, elapsedMs: Date.now() - started, status: response?.status(), ...state, freshDocument: state.timeOrigin !== before.timeOrigin };
      } catch (error) { evidence.reload = { ok: false, elapsedMs: Date.now() - started, error: errorText(error) }; }
    } catch (error) { evidence.caseError = errorText(error); }
    finally {
      clearTimeout(ceiling);
      Object.assign(evidence, { requests, failures, finishedAt: new Date().toISOString() });
      await context.tracing.stop({ path: path.join(output, `${mode.name}-trace.zip`) }).catch(() => undefined);
      await context.close(); disconnected = false;
      await writeFile(path.join(output, `${mode.name}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
      results.push(evidence); process.stdout.write(`${mode.name}: ${JSON.stringify(evidence)}\n`);
    }
  }
} finally {
  await browser.close();
  server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  await writeFile(path.join(output, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
}
