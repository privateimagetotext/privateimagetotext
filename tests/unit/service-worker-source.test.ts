import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isPublicDocumentRoute,
  publicDocumentRoutes,
  publicRouteDocuments,
  routeMetadata,
} from "../../src/config/routes";

const serviceWorkerPath = resolve(process.cwd(), "public", "sw.js");

describe("service worker source policy", () => {
  it("bundles the compact mixed OCR sample in the offline shell allowlist", async () => {
    const source = await readFile(serviceWorkerPath, "utf8");
    const png = await readFile(resolve(process.cwd(), "public/samples/sample.png"));
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([900, 400]);
    expect(png.length).toBeLessThanOrEqual(120_000);
    const staticAssets = source.slice(source.indexOf("const SHELL_STATIC_ASSETS"), source.indexOf("const SHELL_NOT_FOUND_SOURCE"));
    expect(staticAssets).toContain('"/samples/sample.png"');
  });

  it("uses a generated public-route declaration and validates each document", async () => {
    const source = await readFile(serviceWorkerPath, "utf8");

    expect(source).toContain('const SHELL_CACHE = "localtext-shell-v10"');
    expect(source).toContain("// __LOCALTEXT_PUBLIC_ROUTE_DOCUMENTS__");
    expect(source).not.toContain('"/privacy"');
    expect(Object.keys(routeMetadata)).toEqual(publicDocumentRoutes);
    expect(publicRouteDocuments.map(({ path }) => path)).toEqual(
      publicDocumentRoutes,
    );
    expect(source).toContain('event.data?.type === "CHECK_SHELL_CACHE"');
    expect(source).toContain('event.data?.type === "PREPARE_SHELL_CACHE"');
    expect(source).toContain('type: "SHELL_CACHE_STATUS"');
    expect(source).toContain("discoverHtmlAssetPaths");
    expect(source).toContain("discoverCssAssetPaths");
    expect(source).toContain("isExpectedShellDocument");
    expect(source).toContain("SHELL_NOT_FOUND_CACHE_KEY");
    expect(source).toContain('fetch(path, { cache: "no-cache" })');
    expect(source).not.toContain("rootResponse.clone()");
  });

  it("keeps every public route indexable with unique canonical metadata", () => {
    const metadataEntries = Object.entries(routeMetadata);

    expect(metadataEntries.map(([route]) => route)).toEqual(
      publicDocumentRoutes,
    );
    expect(
      metadataEntries.map(([, metadata]) => metadata.canonicalPath),
    ).toEqual(metadataEntries.map(([route]) => route));
    expect(metadataEntries.every(([, metadata]) => metadata.indexable)).toBe(
      true,
    );
    expect(new Set(metadataEntries.map(([, metadata]) => metadata.title)).size)
      .toBe(metadataEntries.length);
    expect(
      new Set(metadataEntries.map(([, metadata]) => metadata.description)).size,
    ).toBe(metadataEntries.length);
    expect(isPublicDocumentRoute("/privacy")).toBe(true);
    expect(isPublicDocumentRoute("/privacy/")).toBe(false);
    expect(isPublicDocumentRoute("/guides/not-configured")).toBe(false);
  });

  it("keeps OCR preparation separate from shell preparation", async () => {
    const source = await readFile(serviceWorkerPath, "utf8");
    const ocrPreparationBranch = source.slice(
      source.indexOf('event.data?.type === "PREPARE_OCR_CACHE"'),
    );

    expect(ocrPreparationBranch).toContain("prepareOcrAssets(languages)");
    expect(ocrPreparationBranch).not.toContain("prepareShellAssets()");
  });

  it("uses an isolated allowlisted JPEG codec cache with integrity checks", async () => {
    const source = await readFile(serviceWorkerPath, "utf8");

    expect(source).toContain('const JPEG_V2_CACHE = "localtext-jpeg-v2-v1"');
    expect(source).toContain('const JPEG_V2_ASSET = "/steg/jpeg-v2-codec.wasm"');
    expect(source).toContain("253_687");
    expect(source).toContain("1c8326b7278e5f0afa003a9bf95ffe280f2e733160d1458f0be54f9cb9c1968a");
    expect(source).toContain('contentType.includes("application/wasm")');
    expect(source).toContain('event.data?.type === "CHECK_JPEG_CODEC_CACHE"');
    expect(source).toContain('event.data?.type === "PREPARE_JPEG_CODEC_CACHE"');
    expect(source).toContain('type: "JPEG_CODEC_CACHE_PREPARING"');
    expect(source).toContain('type: "JPEG_CODEC_CACHE_FAILED"');
    expect(source).not.toContain("JPEG_V2_ASSETS");
  });

  it("does not cache arbitrary navigation, query, or asset requests", async () => {
    const source = await readFile(serviceWorkerPath, "utf8");

    expect(source).toContain('url.search === ""');
    expect(source).toContain("SHELL_DOCUMENT_PATHS.has(url.pathname)");
    expect(source).toContain('if (url.search !== "" || url.hash !== "") return');
    expect(source).not.toMatch(/cache\.put\(request/);
    expect(source).not.toMatch(/cacheFirst\(request/);
  });

  it("uses an explicit, staged, integrity-checked PDF cache contract", async () => {
    const source = await readFile(serviceWorkerPath, "utf8");

    expect(source).toContain(
      'const PDF_CACHE = "localtext-pdf-v1-pdfjs-6.2.108"',
    );
    expect(source).toContain("// __LOCALTEXT_PDF_CACHE_ASSETS__");
    expect(source).toContain("PDF_FETCH_CONCURRENCY = 4");
    expect(source).toContain("isValidPdfAssetResponse");
    expect(source).toContain('crypto.subtle.digest("SHA-256"');
    expect(source).toContain("validatePdfCache(staging, false)");
    expect(source).toContain("PDF_READY_KEY");
    expect(source).toContain('event.data?.type === "CHECK_PDF_CACHE"');
    expect(source).toContain('event.data?.type === "PREPARE_PDF_CACHE"');
    expect(source).toContain('type: "PDF_CACHE_PREPARING"');
    expect(source).toContain('type: "PDF_CACHE_FAILED"');
    const fetchHandler = source.slice(source.indexOf('self.addEventListener("fetch"'));
    expect(fetchHandler.indexOf("PDF_ASSET_BY_PATH.get(url.pathname)")).toBeLessThan(
      fetchHandler.indexOf('SHELL_BUILD_ASSETS.includes(url.pathname)'),
    );
  });

  it("bypasses analytics POSTs and does not cache the production beacon", async () => {
    const source = await readFile(serviceWorkerPath, "utf8");
    const fetchHandlerStart = source.indexOf('self.addEventListener("fetch"');
    const fetchHandlerEnd = source.indexOf("\n});", fetchHandlerStart);
    const fetchHandler = source.slice(fetchHandlerStart, fetchHandlerEnd);
    const methodGuard = fetchHandler.indexOf(
      'if (request.method !== "GET") return;',
    );

    expect(fetchHandlerStart).toBeGreaterThanOrEqual(0);
    expect(fetchHandlerEnd).toBeGreaterThan(fetchHandlerStart);
    expect(methodGuard).toBeGreaterThanOrEqual(0);
    expect(methodGuard).toBeLessThan(fetchHandler.indexOf("new URL(request.url)"));
    expect(methodGuard).toBeLessThan(fetchHandler.indexOf("event.respondWith"));
    expect(fetchHandler).toContain(
      "if (url.origin !== self.location.origin) return;",
    );
    expect(source).not.toContain("/cdn-cgi/rum");
    expect(source).not.toContain(
      "https://static.cloudflareinsights.com/beacon.min.js",
    );
  });
});
