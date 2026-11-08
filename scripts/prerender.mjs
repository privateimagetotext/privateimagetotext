import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveLastModified, validateSitemap } from "./sitemap.mjs";
import { validateGuideAssets } from "./guide-quality.mjs";
import { generateSocialImages } from "./og-images.mjs";
import { JSDOM } from "jsdom";
import { buildAssetAllowlist, staticRouteFiles } from "./bundle-manifest.mjs";

const root = process.cwd();
const dist = path.resolve(root, "dist");
const serverEntry = path.resolve(root, "tmp", "prerender", "entry-server.js");
const templatePath = path.resolve(dist, "index.html");
const viteManifestPath = path.resolve(dist, ".vite", "manifest.json");
const serviceWorkerPath = path.resolve(dist, "sw.js");
const pdfAssetManifestPath = path.resolve(root, "scripts", "pdf-assets.manifest.json");

const {
  guides,
  notFoundMetadata,
  pdfOcrPreviewRouteDocuments,
  publicRouteDocuments,
  renderRoute,
  SITE_ORIGIN,
  socialImagePathForRoute,
} = await import(pathToFileURL(serverEntry).href);

await validateGuideAssets(guides, dist);

const [template, viteManifest, pdfAssetManifest] = await Promise.all([
  readFile(templatePath, "utf8"),
  readFile(viteManifestPath, "utf8").then(JSON.parse),
  readFile(pdfAssetManifestPath, "utf8").then(JSON.parse),
]);

// Include the worker build graph in the manifest consumed by offline policy
// and bundle audits; no list of hashed chunks is maintained by hand.
for (const file of await readdir(path.dirname(viteManifestPath))) {
  if (!/^worker-.+\.json$/.test(file)) continue;
  Object.assign(viteManifest, JSON.parse(await readFile(path.join(path.dirname(viteManifestPath), file), "utf8")));
}
const workerEntries = Object.entries(viteManifest).filter(([, entry]) => entry.isWorkerEntry);
for (const entry of Object.values(viteManifest)) {
  if (!entry.file.endsWith(".js") || entry.isWorkerEntry) continue;
  const code = await readFile(resolveOutputFile(entry.file), "utf8");
  const workers = workerEntries.filter(([, worker]) => code.includes(worker.file)).map(([key]) => key);
  if (workers.length) entry.workers = workers;
}
await writeFile(viteManifestPath, JSON.stringify(viteManifest, null, 2) + "\n");

if (
  pdfAssetManifest.schemaVersion !== 1 ||
  pdfAssetManifest.package !== "pdfjs-dist" ||
  pdfAssetManifest.packageVersion !== "6.2.108" ||
  pdfAssetManifest.runtimeRoot !== "/pdf/6.2.108/" ||
  pdfAssetManifest.cacheVersion !== "localtext-pdf-v1-pdfjs-6.2.108"
) {
  throw new Error("Unexpected production PDF runtime manifest identity.");
}

await Promise.all(
  pdfAssetManifest.assets.map(async (asset) => {
    if (
      !asset.offlineRequired ||
      !asset.runtimePath.startsWith(pdfAssetManifest.runtimeRoot) ||
      asset.runtimePath.includes("..")
    ) {
      throw new Error(`Unsafe production PDF runtime asset: ${asset.runtimePath}`);
    }
    const output = resolveOutputFile(asset.runtimePath.slice(1));
    const bytes = await readFile(output);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== asset.bytes || sha256 !== asset.sha256) {
      throw new Error(`Built PDF runtime asset mismatch: ${asset.runtimePath}`);
    }
  }),
);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeXml(value) {
  return escapeHtml(value).replaceAll("'", "&apos;");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function insertBeforeHeadClose(html, markup) {
  if (!html.includes("</head>")) throw new Error("HTML template has no head.");
  return html.replace("</head>", `${markup}\n  </head>`);
}

function setTitle(html, title) {
  const markup = `<title>${escapeHtml(title)}</title>`;
  return /<title>[\s\S]*?<\/title>/i.test(html)
    ? html.replace(/<title>[\s\S]*?<\/title>/i, markup)
    : insertBeforeHeadClose(html, markup);
}

function setMeta(html, attribute, key, content) {
  const pattern = new RegExp(
    `<meta\\b(?=[^>]*\\b${attribute}=["']${escapeRegExp(key)}["'])[^>]*>`,
    "gi",
  );
  const markup = `<meta ${attribute}="${escapeHtml(key)}" content="${escapeHtml(content)}" />`;
  const matches = html.match(pattern) ?? [];
  if (matches.length === 0) return insertBeforeHeadClose(html, markup);
  let replaced = false;
  return html.replace(pattern, () => {
    if (replaced) return "";
    replaced = true;
    return markup;
  });
}

function removeMeta(html, attribute, key) {
  const pattern = new RegExp(
    `\\s*<meta\\b(?=[^>]*\\b${attribute}=["']${escapeRegExp(key)}["'])[^>]*>`,
    "gi",
  );
  return html.replace(pattern, "");
}

function setCanonical(html, canonicalUrl) {
  const withoutCanonical = html.replace(
    /\s*<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/gi,
    "",
  );
  if (!canonicalUrl) return withoutCanonical;
  return insertBeforeHeadClose(
    withoutCanonical,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`,
  );
}

function setRoot(html, pathname, markup) {
  const rootPattern = /<div\s+id=["']root["'][^>]*>[\s\S]*?<\/div>/i;
  if (!rootPattern.test(html)) throw new Error("HTML template has no root.");
  return html.replace(
    rootPattern,
    `<div id="root" data-route-path="${escapeHtml(pathname)}" data-structured-data-dates="${escapeHtml(JSON.stringify(structuredDataDates))}">${markup}</div>`,
  );
}

function addModulePreload(html, file) {
  const href = `/${file.replaceAll("\\", "/")}`;
  if (html.includes(`href="${href}"`)) return html;
  return insertBeforeHeadClose(
    html,
    `<link rel="modulepreload" crossorigin href="${escapeHtml(href)}" />`,
  );
}

function addStylesheet(html, file) {
  const href = `/${file.replaceAll("\\", "/")}`;
  if (html.includes(`href="${href}"`)) return html;
  return insertBeforeHeadClose(
    html,
    `<link rel="stylesheet" crossorigin href="${escapeHtml(href)}" />`,
  );
}

function renderDocument({
  pathname,
  metadata,
  canonicalUrl,
  modulePreloads = [],
  stylesheets = [],
}) {
  const routeMarkup = renderRoute(pathname, structuredDataDates);
  let html = setRoot(template, pathname, routeMarkup);
  html = setTitle(html, metadata.title);
  html = setMeta(html, "name", "description", metadata.description);
  html = setMeta(
    html,
    "name",
    "robots",
    metadata.indexable ? "index, follow" : "noindex, nofollow",
  );
  html = setMeta(
    html,
    "property",
    "og:type",
    metadata.routeType === "guide" ? "article" : "website",
  );
  html = setMeta(
    html,
    "property",
    "og:site_name",
    "Private Image to Text",
  );
  html = setMeta(html, "property", "og:title", metadata.title);
  html = setMeta(html, "property", "og:description", metadata.description);
  html = canonicalUrl
    ? setMeta(html, "property", "og:url", canonicalUrl)
    : removeMeta(html, "property", "og:url");
  html = setMeta(html, "name", "twitter:card", "summary_large_image");
  html = setMeta(html, "name", "twitter:title", metadata.title);
  html = setMeta(html, "name", "twitter:description", metadata.description);
  const imageUrl = new URL(socialImagePathForRoute(pathname), SITE_ORIGIN).href;
  html = setMeta(html, "property", "og:image", imageUrl);
  html = setMeta(html, "property", "og:image:alt", metadata.title);
  html = setMeta(html, "property", "og:image:width", "1200");
  html = setMeta(html, "property", "og:image:height", "630");
  html = setMeta(html, "property", "og:image:type", "image/png");
  html = setMeta(html, "name", "twitter:image", imageUrl);
  html = setMeta(html, "name", "twitter:image:alt", metadata.title);
  html = setCanonical(html, canonicalUrl);
  for (const modulePreload of modulePreloads) {
    html = addModulePreload(html, modulePreload);
  }
  for (const stylesheet of stylesheets) html = addStylesheet(html, stylesheet);
  return `${html.trimEnd()}\n`;
}

function resolveOutputFile(relativePath) {
  const output = path.resolve(dist, relativePath);
  if (output !== dist && !output.startsWith(`${dist}${path.sep}`)) {
    throw new Error(`Route output escapes dist: ${relativePath}`);
  }
  return output;
}

const mediaInspectorAsset =
  viteManifest["src/pages/MediaInspectorPage.tsx"]?.file;
if (!mediaInspectorAsset) {
  throw new Error("Media Inspector client chunk was not found in the Vite manifest.");
}
const hasPdfDocument = pdfOcrPreviewRouteDocuments.length > 0 || publicRouteDocuments.some((route) => route.key === "pdfToText");
const pdfOcrPageAsset = viteManifest["src/pages/PdfOcrPage.tsx"]?.file;
const pdfOcrPageStylesheets =
  viteManifest["src/pages/PdfOcrPage.tsx"]?.css ?? [];
if (hasPdfDocument && !pdfOcrPageAsset) {
  throw new Error("PDF to Text preview client chunk was not found in the Vite manifest.");
}
if (hasPdfDocument && pdfOcrPageStylesheets.length === 0) {
  throw new Error("PDF to Text preview stylesheet was not found in the Vite manifest.");
}

function staticImportFiles(entryKey) {
  return staticRouteFiles(viteManifest, entryKey).filter(file => file.endsWith(".js"));
}

const pdfOcrPagePreloads = hasPdfDocument
  ? staticImportFiles("src/pages/PdfOcrPage.tsx")
  : [];

// Guide bodies live in the lazily loaded GuidePage chunk. Guide documents
// preload it (so a guide visit caches it for offline use), and it joins the
// common shell assets so any tool visit also prepares every guide offline.
const guidePageFiles = staticRouteFiles(viteManifest, "src/pages/GuidePage.tsx");

function clientFiles(route) {
  if (route.routeType === "tool") return staticRouteFiles(viteManifest, route.sourceFile);
  if (route.routeType === "guide") return guidePageFiles;
  return [];
}

function offlineFiles(route) {
  const files = new Set(clientFiles(route));
  // Content pages and the guides index link to guides; prepare the guide chunk
  // in the background so those links still open offline, without preloading it.
  if (route.routeType === "content" || route.routeType === "guide-index") {
    for (const file of guidePageFiles) files.add(file);
  }
  // Cache the general image-message worker for a first offline PNG operation.
  // Its dynamic JPEG glue and WASM remain first-use-only.
  for (const entry of Object.values(viteManifest)) {
    if (!files.has(entry.file)) continue;
    for (const worker of entry.workers ?? []) {
      for (const file of staticRouteFiles(viteManifest, worker)) files.add(file);
    }
  }
  return [...files].map(file => `/${file}`);
}

// Resolve once for both JSON-LD and sitemap; serialize for identical hydration
// and client navigation, without fetching metadata or loading an external script.
const structuredDataDates = Object.fromEntries(publicRouteDocuments.map((route) =>
  [route.path, resolveLastModified(route, guides, root)],
));
const generatedManifest = [];
const socialPages = [];
for (const route of publicRouteDocuments) {
  const canonicalUrl = new URL(route.path, SITE_ORIGIN).href;
  const html = renderDocument({
    pathname: route.path,
    metadata: route,
    canonicalUrl,
    modulePreloads: clientFiles(route).filter(file => file.endsWith(".js")),
    stylesheets: clientFiles(route).filter(file => file.endsWith(".css")),
  });
  if (!html.includes(route.heading)) {
    throw new Error(`Prerendered heading missing for ${route.path}`);
  }
  if (html.includes("Opening guide…")) {
    throw new Error(`${route.path} rendered only the guide Suspense fallback.`);
  }
  if (html.includes("Opening Media Inspector…")) {
    throw new Error("Media Inspector rendered only its Suspense fallback.");
  }
  if (html.includes("Opening Steganography Analysis…")) {
    throw new Error("Steganography Analysis rendered only its Suspense fallback.");
  }
  const output = resolveOutputFile(route.outputFile);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, html, "utf8");
  const document = JSDOM.fragment(html);
  const eyebrow = document.querySelector("main .content-page__eyebrow, main .eyebrow")?.textContent?.trim();
  if (!eyebrow) throw new Error(`Missing page eyebrow for social image: ${route.path}`);
  socialPages.push({ title: route.heading, eyebrow, imagePath: socialImagePathForRoute(route.path) });
  const guide = guides.find((item) => item.path === route.path);
  generatedManifest.push({
    ...route,
    canonicalUrl,
    lastModified: structuredDataDates[route.path],
    images: guide?.sections.flatMap((section) => (section.figures ?? []).map((figure) => figure.src)) ?? [],
  });
}
await generateSocialImages({ pages: socialPages, dist });

for (const route of pdfOcrPreviewRouteDocuments) {
  const html = renderDocument({
    pathname: route.path,
    metadata: route,
    canonicalUrl: undefined,
    modulePreloads: pdfOcrPagePreloads,
    stylesheets: pdfOcrPageStylesheets,
  });
  if (!html.includes(route.heading)) {
    throw new Error(`Prerendered heading missing for ${route.path}`);
  }
  if (html.includes("Opening PDF to Text preview…")) {
    throw new Error("PDF to Text preview rendered only its Suspense fallback.");
  }
  const output = resolveOutputFile(route.outputFile);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, html, "utf8");
}

const notFoundHtml = renderDocument({
  pathname: "/__not-found__",
  metadata: notFoundMetadata,
  canonicalUrl: undefined,
});
await writeFile(resolveOutputFile("404.html"), notFoundHtml, "utf8");

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
  ...generatedManifest.flatMap((route) => [
    "  <url>",
    `    <loc>${escapeXml(route.canonicalUrl)}</loc>`,
    `    <lastmod>${escapeXml(route.lastModified)}</lastmod>`,
    ...route.images.map((src) => `    <image:image><image:loc>${escapeXml(new URL(src, SITE_ORIGIN).href)}</image:loc></image:image>`),
    "  </url>",
  ]),
  "</urlset>",
  "",
].join("\n");
await writeFile(resolveOutputFile("sitemap.xml"), sitemap, "utf8");
await validateSitemap({ dist, routes: generatedManifest, origin: SITE_ORIGIN });
await writeFile(
  resolveOutputFile("document-manifest.json"),
  `${JSON.stringify(generatedManifest, null, 2)}\n`,
  "utf8",
);

const serviceWorker = await readFile(serviceWorkerPath, "utf8");
if (!serviceWorker.includes("// __LOCALTEXT_BUILD_ASSETS__")) {
  throw new Error("Service-worker build-asset placeholder was not found.");
}
const buildAssets = buildAssetAllowlist(viteManifest);
// Validate every emitted path, including worker and interaction-only chunks.
await Promise.all(buildAssets.map(file => readFile(resolveOutputFile(file.slice(1)))));
const commonAssets = [...new Set([...staticRouteFiles(viteManifest, "index.html"), ...guidePageFiles])].map(file => `/${file}`);
const routeDeclaration = [
  ...generatedManifest.map(
    (route) =>
      `  ${JSON.stringify({ path: route.path, canonicalUrl: route.canonicalUrl, figures: route.images, routeType: route.routeType, assets: offlineFiles(route) })},`,
  ),
  ...pdfOcrPreviewRouteDocuments.map(
    (route) =>
      `  ${JSON.stringify({ path: route.path, canonicalUrl: null, routeType: "tool", assets: offlineFiles(route) })},`,
  ),
]
  .join("\n");
const serviceWorkerPlaceholder =
  "  // __LOCALTEXT_PUBLIC_ROUTE_DOCUMENTS__";
if (!serviceWorker.includes(serviceWorkerPlaceholder)) {
  throw new Error("Service-worker public-route placeholder was not found.");
}
const pdfAssetPlaceholder = "  // __LOCALTEXT_PDF_CACHE_ASSETS__";
if (!serviceWorker.includes(pdfAssetPlaceholder)) {
  throw new Error("Service-worker PDF-asset placeholder was not found.");
}
const guideAssetPlaceholder = "  // __LOCALTEXT_GUIDE_FIGURES__";
if (!serviceWorker.includes(guideAssetPlaceholder)) throw new Error("Service-worker guide-asset placeholder was not found.");
const guideAssets = [...new Set(generatedManifest.flatMap((route) => route.images))];
const pdfAssetDeclaration = pdfAssetManifest.assets
  .map(
    (asset) =>
      `  ${JSON.stringify({
        path: asset.runtimePath,
        bytes: asset.bytes,
        sha256: asset.sha256,
        contentType: asset.contentType,
      })},`,
  )
  .join("\n");
const ocrLanguages = JSON.parse(await readFile(path.resolve("src/config/ocr-languages.json"), "utf8")).models;
const ocrManifest = JSON.parse(await readFile(path.resolve("scripts/ocr-assets.manifest.json"), "utf8"));
const ocrRuntime = await Promise.all(ocrManifest.assets.map(async asset => ({
  path: asset.destination.replace(/^public/, ""), sha256: asset.outputSha256 ?? asset.sha256,
  bytes: (await readFile(path.resolve(asset.destination))).length,
})));
for (const placeholder of ["// __LOCALTEXT_OCR_RUNTIME__", "// __LOCALTEXT_OCR_LANGUAGES__"]) {
  if (!serviceWorker.includes(placeholder)) throw new Error(`Missing OCR placeholder: ${placeholder}`);
}
await writeFile(
  serviceWorkerPath,
  serviceWorker
    .replace("// __LOCALTEXT_OCR_RUNTIME__", ocrRuntime.map(asset => JSON.stringify(asset)).join(","))
    .replace("// __LOCALTEXT_OCR_LANGUAGES__", ocrLanguages.map(({id,path,bytes,sha256,uncompressedBytes,uncompressedSha256}) => JSON.stringify({id,path,bytes,sha256,uncompressedBytes,uncompressedSha256})).join(","))
    .replace("// __LOCALTEXT_BUILD_ASSETS__", `const SHELL_BUILD_ASSETS = ${JSON.stringify(buildAssets)};\nconst SHELL_COMMON_ASSETS = ${JSON.stringify(commonAssets)};`)
    .replace(serviceWorkerPlaceholder, routeDeclaration)
    .replace(guideAssetPlaceholder, guideAssets.map((src) => `  ${JSON.stringify(src)},`).join("\n"))
    .replace(pdfAssetPlaceholder, pdfAssetDeclaration),
  "utf8",
);
