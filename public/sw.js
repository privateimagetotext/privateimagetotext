const SHELL_CACHE = "localtext-shell-v10";
// __LOCALTEXT_BUILD_ASSETS__
const OCR_CACHE = "localtext-ocr-v5";
const JPEG_V2_CACHE = "localtext-jpeg-v2-v1";
const PDF_CACHE = "localtext-pdf-v1-pdfjs-6.2.108";
const PDF_STAGING_CACHE = `${PDF_CACHE}-staging`;
const PDF_READY_KEY = "/__localtext-pdf-cache-ready-v1__";
const PDF_FETCH_CONCURRENCY = 4;

const PDF_ASSETS = [
  // __LOCALTEXT_PDF_CACHE_ASSETS__
];
const PDF_ASSET_BY_PATH = new Map(
  PDF_ASSETS.map((asset) => [asset.path, asset]),
);
let pdfPreparationPromise = null;
let pdfReadinessPromise = null;
let pdfReadyInMemory = false;

function pdfCacheError(code, assetPath, details = {}) {
  const error = new Error("Local PDF runtime cache validation failed");
  error.pdfCacheCode = code;
  error.pdfAssetPath = assetPath;
  error.pdfCacheDetails = details;
  return error;
}

const SHELL_DOCUMENTS = [
  // __LOCALTEXT_PUBLIC_ROUTE_DOCUMENTS__
];
const SHELL_DOCUMENT_ROUTES = SHELL_DOCUMENTS.map(({ path }) => path);
const SHELL_STATIC_ASSETS = [
  // __LOCALTEXT_GUIDE_FIGURES__
  "/manifest.webmanifest",
  "/icon.svg",
  "/favicon.ico",
  "/samples/sample.png",
  "/samples/clean-screenshot.png",
  "/samples/receipt.png",
  "/samples/code-terminal.png",
];
const SHELL_NOT_FOUND_SOURCE = "/404.html";
const SHELL_NOT_FOUND_CACHE_KEY = "/__localtext-offline-not-found__";
const SHELL_DOCUMENT_PATHS = new Set(SHELL_DOCUMENT_ROUTES);
const SHELL_DOCUMENT_BY_PATH = new Map(
  SHELL_DOCUMENTS.map((document) => [document.path, document]),
);
const SHELL_STATIC_PATHS = new Set(SHELL_STATIC_ASSETS);

const OCR_RUNTIME = [
  // __LOCALTEXT_OCR_RUNTIME__
];
const OCR_LANGUAGES = [
  // __LOCALTEXT_OCR_LANGUAGES__
];
const OCR_ASSETS = [...OCR_RUNTIME, ...OCR_LANGUAGES];
const OCR_ASSET_BY_PATH = new Map(OCR_ASSETS.map(asset => [asset.path, asset]));
const OCR_ASSET_PATHS = new Set(OCR_ASSET_BY_PATH.keys());
function selectedOcrAssets(languages = ["eng"]) {
  if (!Array.isArray(languages) || languages.length < 1 || languages.length > 3 || new Set(languages).size !== languages.length) throw new Error("Invalid language selection");
  return [...OCR_RUNTIME, ...languages.map(id => {
    const model = OCR_LANGUAGES.find(model => model.id === id);
    if (!model) throw new Error("Unknown language");
    return model;
  })];
}
const JPEG_V2_ASSET = "/steg/jpeg-v2-codec.wasm";
const JPEG_V2_ASSET_BYTES = 253_687;
const JPEG_V2_ASSET_SHA256 =
  "1c8326b7278e5f0afa003a9bf95ffe280f2e733160d1458f0be54f9cb9c1968a";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key !== SHELL_CACHE &&
                key !== OCR_CACHE &&
                key !== JPEG_V2_CACHE &&
                key !== PDF_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function canonicalAssetPath(reference, basePath = "/") {
  try {
    const url = new URL(reference, new URL(basePath, self.location.origin));
    if (
      url.origin !== self.location.origin ||
      url.search !== "" ||
      url.hash !== "" ||
      !url.pathname.startsWith("/assets/")
    ) {
      return null;
    }
    return url.pathname;
  } catch {
    return null;
  }
}

function discoverHtmlAssetPaths(html) {
  const paths = new Set();
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const path = canonicalAssetPath(match[1]);
    if (path) paths.add(path);
  }
  return [...paths];
}

function discoverCssAssetPaths(css, stylesheetPath) {
  const paths = new Set();
  for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    const path = canonicalAssetPath(match[1], stylesheetPath);
    if (path) paths.add(path);
  }
  return [...paths];
}

function responseContentType(response) {
  return response.headers.get("Content-Type")?.toLowerCase() ?? "";
}

function isValidShellDocument(response) {
  return Boolean(
    response?.ok && responseContentType(response).includes("text/html"),
  );
}

async function isExpectedShellDocument(path, response) {
  if (!isValidShellDocument(response)) return false;
  const expected = SHELL_DOCUMENT_BY_PATH.get(path);
  if (!expected) return false;
  const html = await response.clone().text();
  const canonicalMatches =
    expected.canonicalUrl === null
      ? !html.includes('rel="canonical"')
      : html.includes(`rel="canonical" href="${expected.canonicalUrl}"`);
  return (
    html.includes(`data-route-path="${expected.path}"`) &&
    canonicalMatches
  );
}

async function isExpectedNotFoundDocument(response) {
  if (
    !response ||
    (response.status !== 200 && response.status !== 404) ||
    !responseContentType(response).includes("text/html")
  ) {
    return false;
  }
  const html = await response.clone().text();
  return (
    html.includes('data-route-path="/__not-found__"') &&
    html.includes('name="robots" content="noindex, nofollow"') &&
    !html.includes('rel="canonical"')
  );
}

function isValidShellAsset(response) {
  return Boolean(
    response?.ok && !responseContentType(response).includes("text/html"),
  );
}

async function fetchShellAsset(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!isValidShellAsset(response)) {
    throw new Error("Invalid application shell asset response");
  }
  return response;
}

// A guide visit should not download every tool and guide in the site. Cache
// this document, its figures, the guide-route chunk (so links to other guides
// still open offline) and the font subsets the browser actually used.
// Full application preparation remains available from the tool routes.
async function prepareGuideAssets(path, fontPaths) {
  const guide = SHELL_DOCUMENT_BY_PATH.get(path);
  if (!guide || guide.routeType === "tool") throw new Error("Unknown content document");
  const response = await fetch(path, { cache: "force-cache" });
  if (!(await isExpectedShellDocument(path, response))) throw new Error("Invalid guide document");
  const cache = await caches.open(SHELL_CACHE);
  const assets = discoverHtmlAssetPaths(await response.clone().text());
  await cache.put(path, response);
  const fonts = new Set(Array.isArray(fontPaths) ? fontPaths : []);
  const cachedPaths = [path];
  for (const assetPath of [...new Set([...assets, ...(guide.assets ?? []), ...(guide.figures ?? []), "/icon.svg", "/favicon.ico", "/manifest.webmanifest"])]) {
    const asset = await fetch(assetPath, { cache: "force-cache" });
    if (!isValidShellAsset(asset)) throw new Error("Invalid guide asset");
    if (responseContentType(asset).includes("text/css")) {
      for (const fontPath of discoverCssAssetPaths(await asset.clone().text(), assetPath)) {
        if (!fonts.has(fontPath)) continue;
        const font = await fetch(fontPath, { cache: "force-cache" });
        if (!isValidShellAsset(font)) throw new Error("Invalid guide font");
        await cache.put(fontPath, font);
        cachedPaths.push(fontPath);
      }
    }
    await cache.put(assetPath, asset);
    cachedPaths.push(assetPath);
  }
  await cache.put(`/__localtext-guide-ready${path}`, new Response(JSON.stringify(cachedPaths), { headers: { "Content-Type": "application/json" } }));
}

async function guideCacheReady(path) {
  const document = SHELL_DOCUMENT_BY_PATH.get(path);
  if (!document || document.routeType === "tool") return false;
  const cache = await caches.open(SHELL_CACHE);
  const marker = await cache.match(`/__localtext-guide-ready${path}`);
  if (!marker || !(await isExpectedShellDocument(path, await cache.match(path)))) return false;
  try {
    const paths = await marker.json();
    if (!Array.isArray(paths) || paths.length < 2) return false;
    for (const assetPath of paths.filter(value => value !== path)) {
      if (!isValidShellAsset(await cache.match(assetPath))) return false;
    }
    return true;
  } catch { return false; }
}

function routeShellAssets(path = "/") {
  const route = SHELL_DOCUMENT_BY_PATH.get(path);
  if (!route) throw new Error("Unknown application route");
  return [...new Set([...SHELL_COMMON_ASSETS, ...(route.assets ?? [])])];
}

async function prepareShellAssets(routePath = "/") {
  const [documents, notFoundResponse] = await Promise.all([
    Promise.all(SHELL_DOCUMENTS.map(async ({ path }) => {
      const response = await fetch(path, { cache: "no-cache" });
      if (!(await isExpectedShellDocument(path, response))) {
        throw new Error(`Application document unavailable: ${path}`);
      }
      return { path, response };
    })),
    fetch(SHELL_NOT_FOUND_SOURCE, { cache: "no-cache" }),
  ]);
  if (!(await isExpectedNotFoundDocument(notFoundResponse))) {
    throw new Error("Application not-found document unavailable");
  }
  const topLevelAssets = routeShellAssets(routePath);
  if (topLevelAssets.length === 0) {
    throw new Error("Application shell assets unavailable");
  }

  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(
    [
      ...documents.map(({ path, response }) => cache.put(path, response)),
      notFoundResponse.arrayBuffer().then((body) =>
        cache.put(
          SHELL_NOT_FOUND_CACHE_KEY,
          new Response(body, {
            status: 404,
            statusText: "Not Found",
            headers: notFoundResponse.headers,
          }),
        ),
      ),
    ],
  );

  for (const path of SHELL_STATIC_ASSETS) {
    const response = await fetch(path, { cache: "no-cache" });
    if (!isValidShellAsset(response)) {
      throw new Error("Invalid static application asset response");
    }
    await cache.put(path, response);
  }

  for (const path of topLevelAssets) {
    const response = await fetchShellAsset(path);
    const contentType = responseContentType(response);
    const css = contentType.includes("text/css")
      ? await response.clone().text()
      : null;
    await cache.put(path, response);

    if (css !== null) {
      for (const dependencyPath of discoverCssAssetPaths(css, path)) {
        const dependency = await fetchShellAsset(dependencyPath);
        await cache.put(dependencyPath, dependency);
      }
    }
  }
}

async function shellCacheReady(routePath = "/") {
  const cache = await caches.open(SHELL_CACHE);
  const root = await cache.match("/");
  if (!(await isExpectedShellDocument("/", root))) return false;

  for (const path of SHELL_DOCUMENT_ROUTES) {
    const response = await cache.match(path);
    if (!(await isExpectedShellDocument(path, response))) return false;
  }

  for (const path of SHELL_STATIC_ASSETS) {
    if (!isValidShellAsset(await cache.match(path))) return false;
  }
  if (
    !(await isExpectedNotFoundDocument(
      await cache.match(SHELL_NOT_FOUND_CACHE_KEY),
    ))
  ) {
    return false;
  }

  const topLevelAssets = routeShellAssets(routePath);
  if (topLevelAssets.length === 0) return false;

  for (const path of topLevelAssets) {
    const response = await cache.match(path);
    if (!isValidShellAsset(response)) return false;

    if (responseContentType(response).includes("text/css")) {
      const css = await response.clone().text();
      for (const dependencyPath of discoverCssAssetPaths(css, path)) {
        if (!isValidShellAsset(await cache.match(dependencyPath))) return false;
      }
    }
  }

  return true;
}

async function cachedShellAssetResponse(request, pathname) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(pathname);
  if (cached) return cached;
  const response = await fetch(request);
  if (isValidShellAsset(response)) {
    await cache.put(pathname, response.clone());
  }
  return response;
}

async function navigationResponse(request, pathname, cacheable) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (cacheable && (await isExpectedShellDocument(pathname, response))) {
      await cache.put(pathname, response.clone());
    }
    return response;
  } catch {
    const routeFallback = SHELL_DOCUMENT_PATHS.has(pathname)
      ? await cache.match(pathname)
      : undefined;
    return (
      routeFallback ??
      (await cache.match(SHELL_NOT_FOUND_CACHE_KEY)) ??
      (await cache.match("/")) ??
      Response.error()
    );
  }
}

async function isValidOcrResponse(pathname, response) {
  const asset = OCR_ASSET_BY_PATH.get(pathname);
  if (!asset || !response?.ok || responseContentType(response).includes("text/html")) return false;
  const bytes = await response.clone().arrayBuffer();
  const digest = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
  return (bytes.byteLength === asset.bytes && digest === asset.sha256) ||
    (bytes.byteLength === asset.uncompressedBytes && digest === asset.uncompressedSha256);
}

async function cacheFirstOcr(request) {
  const pathname = new URL(request.url).pathname;
  const cache = await caches.open(OCR_CACHE);
  const cached = await cache.match(pathname);
  if (cached && (await isValidOcrResponse(pathname, cached))) return cached;
  if (cached) await cache.delete(pathname);

  const response = await fetch(request, { cache: "no-cache", redirect: "error" });
  if (!(await isValidOcrResponse(pathname, response))) {
    throw new Error("Invalid local OCR asset response");
  }
  await cache.put(pathname, response.clone());
  return response;
}

async function ocrCacheStatus() {
  const cache = await caches.open(OCR_CACHE);
  const runtimeReady = (await Promise.all(OCR_RUNTIME.map(async asset =>
    isValidOcrResponse(asset.path, await cache.match(asset.path))))).every(Boolean);
  const readyLanguages = [];
  if (runtimeReady) for (const model of OCR_LANGUAGES) {
    if (await isValidOcrResponse(model.path, await cache.match(model.path))) readyLanguages.push(model.id);
  }
  return { ready: readyLanguages.includes("eng"), readyLanguages };
}

async function prepareOcrAssets(languages) {
  // Never download an unselected language, including English when deselected.
  for (const asset of selectedOcrAssets(languages)) {
    await cacheFirstOcr(new Request(new URL(asset.path, self.location.origin)));
  }
}

function hex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function isValidJpegV2CodecResponse(response) {
  if (!response?.ok) return false;
  const contentType = responseContentType(response);
  if (!contentType.includes("application/wasm")) return false;
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength !== JPEG_V2_ASSET_BYTES) return false;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return hex(new Uint8Array(digest)) === JPEG_V2_ASSET_SHA256;
}

async function cacheFirstJpegV2Codec(request) {
  const cache = await caches.open(JPEG_V2_CACHE);
  const cached = await cache.match(JPEG_V2_ASSET);
  if (cached && (await isValidJpegV2CodecResponse(cached))) return cached;
  if (cached) await cache.delete(JPEG_V2_ASSET);
  const response = await fetch(request);
  if (!(await isValidJpegV2CodecResponse(response))) {
    throw new Error("Invalid local JPEG v2 codec response");
  }
  await cache.put(JPEG_V2_ASSET, response.clone());
  return response;
}

async function jpegV2CacheReady() {
  const cache = await caches.open(JPEG_V2_CACHE);
  const response = await cache.match(JPEG_V2_ASSET);
  const ready = await isValidJpegV2CodecResponse(response);
  if (!ready && response) await cache.delete(JPEG_V2_ASSET);
  return ready;
}

async function prepareJpegV2Codec() {
  if (await jpegV2CacheReady()) return;
  const response = await fetch(JPEG_V2_ASSET, { cache: "no-cache" });
  if (!(await isValidJpegV2CodecResponse(response))) {
    throw new Error("Invalid local JPEG v2 codec response");
  }
  const cache = await caches.open(JPEG_V2_CACHE);
  await cache.put(JPEG_V2_ASSET, response);
}

function pdfMimeMatches(expected, actual) {
  const mime = actual.split(";", 1)[0].trim();
  if (expected === "text/javascript") {
    return mime === "text/javascript" || mime === "application/javascript";
  }
  return mime === expected;
}

async function pdfAssetValidationFailure(asset, response) {
  if (!asset || !response?.ok) return "PDF_ASSET_RESPONSE_STATUS_INVALID";
  const contentType = responseContentType(response);
  if (contentType.includes("text/html")) return "PDF_ASSET_RESPONSE_HTML";
  if (!pdfMimeMatches(asset.contentType, contentType)) {
    return "PDF_ASSET_RESPONSE_MIME_INVALID";
  }
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength !== asset.bytes) return "PDF_ASSET_RESPONSE_SIZE_INVALID";
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return hex(new Uint8Array(digest)) === asset.sha256
    ? null
    : "PDF_ASSET_RESPONSE_HASH_INVALID";
}

async function isValidPdfAssetResponse(asset, response) {
  return (await pdfAssetValidationFailure(asset, response)) === null;
}

async function materialiseValidPdfAssetResponse(asset, response) {
  if (!asset || !response?.ok) return null;
  const contentType = responseContentType(response);
  if (
    contentType.includes("text/html") ||
    !pdfMimeMatches(asset.contentType, contentType)
  ) {
    return null;
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== asset.bytes) return null;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  if (hex(new Uint8Array(digest)) !== asset.sha256) return null;
  return new Response(bytes, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function mapWithConcurrency(items, limit, operation) {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await operation(items[index], index);
      }
    },
  );
  await Promise.all(workers);
}

async function validatePdfCache(cache, requireReadyMarker) {
  const requests = await cache.keys();
  const expectedCount = PDF_ASSETS.length + (requireReadyMarker ? 1 : 0);
  if (requests.length !== expectedCount) return false;
  const allowed = new Set(PDF_ASSETS.map((asset) => asset.path));
  if (requireReadyMarker) allowed.add(PDF_READY_KEY);
  if (
    requests.some((request) => {
      const url = new URL(request.url);
      return (
        url.origin !== self.location.origin ||
        url.search !== "" ||
        url.hash !== "" ||
        !allowed.has(url.pathname)
      );
    })
  ) {
    return false;
  }
  if (requireReadyMarker) {
    const marker = await cache.match(PDF_READY_KEY);
    if (!marker?.ok || (await marker.text()) !== PDF_CACHE) return false;
  }
  let valid = true;
  await mapWithConcurrency(PDF_ASSETS, PDF_FETCH_CONCURRENCY, async (asset) => {
    if (!valid) return;
    const response = await cache.match(asset.path);
    if (!(await isValidPdfAssetResponse(asset, response))) valid = false;
  });
  return valid;
}

async function checkPdfCacheReady() {
  if (PDF_ASSETS.length === 0) return false;
  const keys = await caches.keys();
  if (!keys.includes(PDF_CACHE)) {
    pdfReadyInMemory = false;
    return false;
  }
  const cache = await caches.open(PDF_CACHE);
  const ready = await validatePdfCache(cache, true);
  if (!ready) await caches.delete(PDF_CACHE);
  pdfReadyInMemory = ready;
  return ready;
}

function pdfCacheReady() {
  if (pdfReadinessPromise) return pdfReadinessPromise;
  pdfReadinessPromise = checkPdfCacheReady().finally(() => {
    pdfReadinessPromise = null;
  });
  return pdfReadinessPromise;
}

async function preparePdfAssetsOnce() {
  if (PDF_ASSETS.length === 0) {
    throw new Error("Local PDF runtime manifest unavailable");
  }
  if (await pdfCacheReady()) return;
  await caches.delete(PDF_STAGING_CACHE);
  const staging = await caches.open(PDF_STAGING_CACHE);
  try {
    await mapWithConcurrency(PDF_ASSETS, PDF_FETCH_CONCURRENCY, async (asset) => {
      const response = await fetch(asset.path, {
        // Explicit preparation must refresh HTTP metadata too: revalidation
        // can retain an old MIME header when the asset bytes/ETag are unchanged.
        // A verified PDF Cache Storage entry is still reused above.
        cache: "reload",
        credentials: "same-origin",
      });
      const failureCode = await pdfAssetValidationFailure(asset, response);
      if (failureCode) {
        throw pdfCacheError(failureCode, asset.path, {
          expectedContentType: asset.contentType,
          actualContentType: responseContentType(response),
        });
      }
      try {
        await staging.put(asset.path, response);
      } catch {
        throw pdfCacheError("PDF_ASSET_STAGING_WRITE_FAILED", asset.path);
      }
    });
    if (!(await validatePdfCache(staging, false))) {
      throw pdfCacheError("PDF_STAGING_CACHE_INCOMPLETE");
    }

    await caches.delete(PDF_CACHE);
    const finalCache = await caches.open(PDF_CACHE);
    for (const asset of PDF_ASSETS) {
      const response = await staging.match(asset.path);
      if (!(await isValidPdfAssetResponse(asset, response))) {
        throw pdfCacheError("PDF_STAGED_ASSET_INVALID", asset.path);
      }
      try {
        await finalCache.put(asset.path, response);
      } catch {
        throw pdfCacheError("PDF_ASSET_FINAL_WRITE_FAILED", asset.path);
      }
    }
    await finalCache.put(
      PDF_READY_KEY,
      new Response(PDF_CACHE, { headers: { "Content-Type": "text/plain" } }),
    );
    if (!(await validatePdfCache(finalCache, true))) {
      throw pdfCacheError("PDF_FINAL_CACHE_INCOMPLETE");
    }
    pdfReadyInMemory = true;
  } catch (error) {
    pdfReadyInMemory = false;
    await caches.delete(PDF_CACHE);
    throw error;
  } finally {
    await caches.delete(PDF_STAGING_CACHE);
  }
}

function preparePdfAssets() {
  if (pdfPreparationPromise) return pdfPreparationPromise;
  pdfPreparationPromise = preparePdfAssetsOnce().finally(() => {
    pdfPreparationPromise = null;
  });
  return pdfPreparationPromise;
}

async function pdfAssetResponse(request, asset) {
  if (pdfReadyInMemory || (await pdfCacheReady())) {
    const cache = await caches.open(PDF_CACHE);
    const cached = await cache.match(asset.path);
    const validated = await materialiseValidPdfAssetResponse(asset, cached);
    if (validated) return validated;
    pdfReadyInMemory = false;
    await caches.delete(PDF_CACHE);
  }
  const response = await fetch(request);
  if (!(await isValidPdfAssetResponse(asset, response))) {
    throw new Error("Invalid local PDF runtime asset response");
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const pdfAsset =
    url.search === "" && url.hash === ""
      ? PDF_ASSET_BY_PATH.get(url.pathname)
      : undefined;
  if (pdfAsset) {
    event.respondWith(pdfAssetResponse(request, pdfAsset));
    return;
  }

  if (url.search === "" && OCR_ASSET_PATHS.has(url.pathname)) {
    event.respondWith(cacheFirstOcr(request));
    return;
  }

  if (url.search === "" && url.pathname === JPEG_V2_ASSET) {
    event.respondWith(cacheFirstJpegV2Codec(request));
    return;
  }

  if (request.mode === "navigate") {
    const cacheable =
      url.search === "" &&
      url.hash === "" &&
      SHELL_DOCUMENT_PATHS.has(url.pathname);
    event.respondWith(navigationResponse(request, url.pathname, cacheable));
    return;
  }

  if (url.search !== "" || url.hash !== "") return;

  if (SHELL_STATIC_PATHS.has(url.pathname)) {
    event.respondWith(cachedShellAssetResponse(request, url.pathname));
    return;
  }

  if (SHELL_BUILD_ASSETS.includes(url.pathname)) {
    event.respondWith(cachedShellAssetResponse(request, url.pathname));
  }
});

function postMessage(event, message) {
  event.source?.postMessage(message);
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "PREPARE_GUIDE_CACHE") {
    event.waitUntil(prepareGuideAssets(event.data.path, event.data.fontPaths)
      .then(() => postMessage(event, { type: "GUIDE_CACHE_READY", path: event.data.path }))
      .catch(() => postMessage(event, { type: "GUIDE_CACHE_FAILED", path: event.data.path })));
    return;
  }
  if (event.data?.type === "CHECK_SHELL_CACHE") {
    event.waitUntil(
      shellCacheReady(event.data.path).then(async (ready) => {
        if (!ready && await guideCacheReady(event.data.path)) postMessage(event, { type: "GUIDE_CACHE_READY", path: event.data.path });
        else postMessage(event, { type: "SHELL_CACHE_STATUS", ready, path: event.data.path });
      }),
    );
    return;
  }

  if (event.data?.type === "PREPARE_SHELL_CACHE") {
    postMessage(event, { type: "SHELL_CACHE_PREPARING", path: event.data.path });
    event.waitUntil(
      prepareShellAssets(event.data.path)
        .then(() =>
          postMessage(event, { type: "SHELL_CACHE_STATUS", ready: true, path: event.data.path }),
        )
        .catch(() =>
          postMessage(event, { type: "SHELL_CACHE_FAILED", path: event.data.path }),
        ),
    );
    return;
  }

  if (event.data?.type === "CHECK_OCR_CACHE") {
    event.waitUntil(ocrCacheStatus().then(status => postMessage(event, { type: "OCR_CACHE_STATUS", ...status })));
    return;
  }

  if (event.data?.type === "PREPARE_OCR_CACHE") {
    const languages = event.data.languages ?? ["eng"];
    postMessage(event, { type: "OCR_CACHE_PREPARING", languages });
    event.waitUntil(
      prepareOcrAssets(languages)
        .then(() => ocrCacheStatus())
        .then(status => postMessage(event, { type: "OCR_CACHE_STATUS", languages, ...status }))
        .catch(() => postMessage(event, { type: "OCR_CACHE_FAILED", languages })),
    );
    return;
  }

  if (event.data?.type === "CHECK_JPEG_CODEC_CACHE") {
    event.waitUntil(
      jpegV2CacheReady().then((ready) =>
        postMessage(event, { type: "JPEG_CODEC_CACHE_STATUS", ready }),
      ),
    );
    return;
  }

  if (event.data?.type === "PREPARE_JPEG_CODEC_CACHE") {
    postMessage(event, { type: "JPEG_CODEC_CACHE_PREPARING" });
    event.waitUntil(
      prepareJpegV2Codec()
        .then(() =>
          postMessage(event, { type: "JPEG_CODEC_CACHE_STATUS", ready: true }),
        )
        .catch(() =>
          postMessage(event, { type: "JPEG_CODEC_CACHE_FAILED" }),
        ),
    );
    return;
  }

  if (event.data?.type === "CHECK_PDF_CACHE") {
    event.waitUntil(
      pdfCacheReady().then((ready) =>
        postMessage(event, {
          type: "PDF_CACHE_STATUS",
          ready,
          cacheVersion: PDF_CACHE,
          requestId: event.data.requestId,
        }),
      ),
    );
    return;
  }

  if (event.data?.type === "PREPARE_PDF_CACHE") {
    postMessage(event, {
      type: "PDF_CACHE_PREPARING",
      cacheVersion: PDF_CACHE,
      requestId: event.data.requestId,
    });
    event.waitUntil(
      preparePdfAssets()
        .then(() =>
          postMessage(event, {
            type: "PDF_CACHE_STATUS",
            ready: true,
            cacheVersion: PDF_CACHE,
            requestId: event.data.requestId,
          }),
        )
        .catch((error) =>
          postMessage(event, {
            type: "PDF_CACHE_FAILED",
            cacheVersion: PDF_CACHE,
            requestId: event.data.requestId,
            failureCode:
              error?.pdfCacheCode ?? "PDF_CACHE_PREPARATION_FAILED",
            assetPath: error?.pdfAssetPath ?? null,
            details: error?.pdfCacheDetails ?? null,
          }),
        ),
    );
  }
});
