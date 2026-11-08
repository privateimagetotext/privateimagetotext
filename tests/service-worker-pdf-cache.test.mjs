import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { URL } from "node:url";
import vm from "node:vm";

const { Headers, Request, Response, TextDecoder, TextEncoder } = globalThis;

const root = process.cwd();
const origin = "https://localtext.test";
const cacheName = "localtext-pdf-v1-pdfjs-6.2.108";
const stagingName = `${cacheName}-staging`;
const readyPath = "/__localtext-pdf-cache-ready-v1__";
const manifest = JSON.parse(
  await readFile(path.join(root, "scripts", "pdf-assets.manifest.json"), "utf8"),
);
const source = await readFile(path.join(root, "dist", "sw.js"), "utf8");

function requestKey(input) {
  const value = typeof input === "string" ? input : input.url;
  const url = new URL(value, origin);
  return `${url.origin}${url.pathname}${url.search}`;
}

class MemoryCache {
  entries = new Map();

  async match(input) {
    return this.entries.get(requestKey(input))?.clone();
  }

  async put(input, response) {
    this.entries.set(requestKey(input), response.clone());
  }

  async delete(input) {
    return this.entries.delete(requestKey(input));
  }

  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
}

async function createHarness({ fault } = {}) {
  const listeners = new Map();
  const stores = new Map();
  const networkPaths = [];
  const networkRequests = [];
  let activeFetches = 0;
  let maxActiveFetches = 0;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new MemoryCache());
      return stores.get(name);
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
  };

  const fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, origin);
    networkPaths.push(url.pathname);
    networkRequests.push({ path: url.pathname, ...options });
    activeFetches += 1;
    maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
    try {
      await Promise.resolve();
      const asset = manifest.assets.find((entry) => entry.runtimePath === url.pathname);
      if (!asset) return new Response("not found", { status: 404 });
      const body = Buffer.from(await readFile(path.join(root, asset.destination)));
      const selectedFault = fault?.path === url.pathname ? fault.kind : null;
      if (selectedFault === "missing") return new Response("missing", { status: 404 });
      if (selectedFault === "html") {
        return new Response("<!doctype html><title>fallback</title>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      if (selectedFault === "wrong-size") body.push?.(0);
      if (selectedFault === "wrong-hash") body[0] ^= 0xff;
      const responseBody =
        selectedFault === "wrong-size" ? Buffer.concat([body, Buffer.from([0])]) : body;
      return new Response(responseBody, {
        status: 200,
        headers: {
          // Model revalidation retaining old MIME metadata when asset bytes
          // (and therefore the server ETag) have not changed.
          "Content-Type": selectedFault === "wrong-mime" ||
            (selectedFault === "stale-http-mime" && options.cache !== "reload")
            ? `application/octet-stream, ${asset.contentType}`
            : asset.contentType,
          "Content-Length": String(responseBody.length),
        },
      });
    } finally {
      activeFetches -= 1;
    }
  };

  const self = {
    location: { origin },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  vm.runInContext(
    source,
    vm.createContext({
      self,
      caches,
      fetch,
      crypto: webcrypto,
      URL,
      Request,
      Response,
      Headers,
      TextEncoder,
      TextDecoder,
      ArrayBuffer,
      Uint8Array,
      Set,
      Map,
      Promise,
      Error,
      console: globalThis.console,
    }),
    { filename: "dist/sw.js" },
  );

  async function dispatchLifecycle(type) {
    let completion = Promise.resolve();
    listeners.get(type)({ waitUntil: (promise) => (completion = promise) });
    await completion;
  }

  async function dispatchMessage(data) {
    const messages = [];
    let completion = Promise.resolve();
    listeners.get("message")({
      data,
      source: { postMessage: (message) => messages.push(message) },
      waitUntil: (promise) => (completion = promise),
    });
    await completion;
    return messages;
  }

  async function dispatchFetch(url) {
    let responsePromise = null;
    listeners.get("fetch")({
      request: new Request(url),
      respondWith: (promise) => (responsePromise = Promise.resolve(promise)),
    });
    return responsePromise ? responsePromise : null;
  }

  return {
    caches,
    stores,
    networkPaths,
    networkRequests,
    get maxActiveFetches() {
      return maxActiveFetches;
    },
    dispatchLifecycle,
    dispatchMessage,
    dispatchFetch,
  };
}

test("ordinary service-worker startup never prepares PDF assets", async () => {
  const harness = await createHarness();
  await harness.dispatchLifecycle("install");
  await harness.dispatchLifecycle("activate");
  assert.equal(harness.networkPaths.length, 0);
  assert.equal(harness.stores.has(cacheName), false);
  const messages = await harness.dispatchMessage({
    type: "CHECK_PDF_CACHE",
    requestId: "check-before",
  });
  assert.deepEqual({ ...messages.at(-1) }, {
    type: "PDF_CACHE_STATUS",
    ready: false,
    cacheVersion: cacheName,
    requestId: "check-before",
  });
});

test("explicit preparation atomically validates and caches exactly the allowlist", async () => {
  const harness = await createHarness();
  const messages = await harness.dispatchMessage({
    type: "PREPARE_PDF_CACHE",
    requestId: "prepare",
  });
  assert.equal(messages[0].type, "PDF_CACHE_PREPARING");
  assert.deepEqual({ ...messages.at(-1) }, {
    type: "PDF_CACHE_STATUS",
    ready: true,
    cacheVersion: cacheName,
    requestId: "prepare",
  });
  assert.ok(harness.maxActiveFetches <= 4);
  assert.equal(harness.stores.has(stagingName), false);
  const cache = harness.stores.get(cacheName);
  const keys = (await cache.keys()).map((request) => new URL(request.url).pathname);
  assert.equal(keys.length, manifest.assets.length + 1);
  assert.deepEqual(
    new Set(keys),
    new Set([...manifest.assets.map((asset) => asset.runtimePath), readyPath]),
  );
  const status = await harness.dispatchMessage({
    type: "CHECK_PDF_CACHE",
    requestId: "check-after",
  });
  assert.equal(status.at(-1).ready, true);
});

test("explicit preparation refreshes stale HTTP MIME metadata without clearing other caches", async () => {
  const font = manifest.assets.find((asset) => asset.runtimePath.endsWith("LiberationSans-Bold.ttf"));
  assert.ok(font);
  const harness = await createHarness({
    fault: { path: font.runtimePath, kind: "stale-http-mime" },
  });
  const ocr = await harness.caches.open("localtext-ocr-v5");
  await ocr.put("/ocr/test-support", new Response("existing OCR support"));
  const messages = await harness.dispatchMessage({ type: "PREPARE_PDF_CACHE", requestId: "refresh" });
  assert.equal(messages.at(-1).ready, true);
  assert.equal(harness.networkRequests.length, manifest.assets.length);
  for (const request of harness.networkRequests) {
    assert.equal(request.cache, "reload");
    assert.equal(request.credentials, "same-origin");
  }
  const cachedFont = await harness.stores.get(cacheName).match(font.runtimePath);
  assert.equal(cachedFont.headers.get("Content-Type"), "font/ttf");
  assert.equal(await (await ocr.match("/ocr/test-support")).text(), "existing OCR support");
  // A fully verified offline cache remains reusable without another download.
  await harness.dispatchMessage({ type: "PREPARE_PDF_CACHE", requestId: "already-ready" });
  assert.equal(harness.networkRequests.length, manifest.assets.length);
});

for (const kind of ["missing", "wrong-size", "wrong-hash", "html", "wrong-mime"]) {
  test(`PDF preparation rejects a ${kind} allowlisted response`, async () => {
    const harness = await createHarness({
      fault: { path: manifest.assets[0].runtimePath, kind },
    });
    const messages = await harness.dispatchMessage({
      type: "PREPARE_PDF_CACHE",
      requestId: kind,
    });
    assert.equal(messages.at(-1).type, "PDF_CACHE_FAILED");
    assert.equal(harness.stores.has(cacheName), false);
    assert.equal(harness.stores.has(stagingName), false);
  });
}

test("activation removes obsolete PDF/staging caches and retains current unrelated caches", async () => {
  const harness = await createHarness();
  for (const name of [
    "localtext-shell-v10",
    "localtext-ocr-v5",
    "localtext-jpeg-v2-v1",
    cacheName,
    "localtext-pdf-v0-pdfjs-5",
    stagingName,
  ]) {
    await harness.caches.open(name);
  }
  await harness.dispatchLifecycle("activate");
  assert.deepEqual(new Set(await harness.caches.keys()), new Set([
    "localtext-shell-v10",
    "localtext-ocr-v5",
    "localtext-jpeg-v2-v1",
    cacheName,
  ]));
});

test("partial caches are never ready and selected or external PDFs are never intercepted", async () => {
  const harness = await createHarness();
  const partial = await harness.caches.open(cacheName);
  const asset = manifest.assets[0];
  await partial.put(
    asset.runtimePath,
    new Response(await readFile(path.join(root, asset.destination)), {
      headers: { "Content-Type": asset.contentType },
    }),
  );
  const messages = await harness.dispatchMessage({
    type: "CHECK_PDF_CACHE",
    requestId: "partial",
  });
  assert.equal(messages.at(-1).ready, false);
  assert.equal(harness.stores.has(cacheName), false);
  assert.equal(await harness.dispatchFetch(`${origin}/selected-private.pdf`), null);
  assert.equal(
    await harness.dispatchFetch(`https://external.invalid${asset.runtimePath}`),
    null,
  );
  assert.equal(harness.stores.size, 0);
});
