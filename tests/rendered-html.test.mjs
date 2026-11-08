import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const CLOUDFLARE_BEACON_URL =
  "https://static.cloudflareinsights.com/beacon.min.js";
// Cloudflare injects versioned copies such as `${CLOUDFLARE_BEACON_URL}/v<id>`.
// A CSP source without a trailing slash matches only its exact path, so the
// production policy also allows this prefix (and nothing else on the host).
const CLOUDFLARE_BEACON_VERSIONED_PREFIX = `${CLOUDFLARE_BEACON_URL}/`;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function metaContent(html, attribute, key) {
  const tag = html.match(
    new RegExp(
      `<meta\\b(?=[^>]*\\b${attribute}=["']${escapeRegExp(key)}["'])[^>]*>`,
      "i",
    ),
  )?.[0];
  return tag?.match(/\bcontent=(["'])(.*?)\1/i)?.[2];
}

function articleDate(html, property) {
  const tag = html.match(new RegExp(`<time\\b(?=[^>]*\\bdata-article-date="${property}")[^>]*>`, "i"))?.[0];
  return tag?.match(/\bdatetime="([^"]+)"/i)?.[1];
}

function countMatches(value, pattern) {
  return Array.from(value.matchAll(pattern)).length;
}

async function generatedRoutes() {
  return JSON.parse(
    await readFile(resolve(dist, "document-manifest.json"), "utf8"),
  );
}

async function generatedRouteHtml(pathname) {
  const routes = await generatedRoutes();
  const route = routes.find(({ path }) => path === pathname);
  assert.ok(route, `${pathname} should be present in the route manifest`);
  return readFile(resolve(dist, route.outputFile), "utf8");
}

function assertNoManualCloudflareBeacon(html, pathname) {
  assert.doesNotMatch(
    html,
    /<script\b[^>]*\bsrc=["']https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js(?:\/[^"'?#]*)?(?:[?#][^"']*)?["'][^>]*>/i,
    `${pathname} must not contain a manually embedded Cloudflare beacon`,
  );
  assert.doesNotMatch(
    html,
    /<script\b[^>]*\bdata-cf-beacon\s*=/i,
    `${pathname} must not contain a manually embedded Cloudflare token`,
  );
}

function cspDirective(csp, name) {
  return csp
    .split(";")
    .map((directive) => directive.trim())
    .find(
      (directive) => directive === name || directive.startsWith(`${name} `),
    );
}

test("every public route is a complete, self-describing static document", async () => {
  const routes = await generatedRoutes();
  assert.ok(routes.length > 0);
  assert.equal(new Set(routes.map((route) => route.path)).size, routes.length);
  assert.equal(
    new Set(routes.map((route) => route.outputFile)).size,
    routes.length,
  );
  assert.equal(new Set(routes.map((route) => route.title)).size, routes.length);
  assert.equal(
    new Set(routes.map((route) => route.description)).size,
    routes.length,
  );
  const homepage = routes.find((route) => route.path === "/");
  assert.ok(homepage);

  for (const route of routes) {
    const html = await readFile(resolve(dist, route.outputFile), "utf8");
    assert.match(
      html,
      new RegExp(
        `<div id="root" data-route-path="${escapeRegExp(route.path)}"[^>]*>(?!\\s*</div>)`,
      ),
      `${route.path} should contain a non-empty React root`,
    );
    assert.equal(countMatches(html, /<h1\b/gi), 1, route.path);
    assert.ok(html.includes(route.heading), `${route.path} should contain its H1`);
    assert.ok(
      html.includes(`<title>${route.title}</title>`),
      `${route.path} should contain its title`,
    );
    assert.equal(metaContent(html, "name", "description"), route.description);
    assert.equal(metaContent(html, "name", "robots"), "index, follow");
    assert.equal(metaContent(html, "property", "og:title"), route.title);
    assert.equal(
      metaContent(html, "property", "og:description"),
      route.description,
    );
    assert.equal(
      metaContent(html, "property", "og:type"),
      route.routeType === "guide" ? "article" : "website",
    );
    assert.equal(metaContent(html, "property", "og:url"), route.canonicalUrl);
    const imagePath = `/og${route.path === "/" ? "/home" : route.path}.png`;
    assert.equal(metaContent(html, "property", "og:image"), `https://privateimagetotext.com${imagePath}`);
    assert.equal(metaContent(html, "name", "twitter:image"), `https://privateimagetotext.com${imagePath}`);
    assert.equal(metaContent(html, "property", "og:image:width"), "1200");
    assert.equal(metaContent(html, "property", "og:image:height"), "630");
    const socialImage = await readFile(resolve(dist, imagePath.slice(1)));
    assert.equal(socialImage.readUInt32BE(16), 1200);
    assert.equal(socialImage.readUInt32BE(20), 630);
    assert.equal(metaContent(html, "name", "twitter:title"), route.title);
    assert.equal(
      metaContent(html, "name", "twitter:description"),
      route.description,
    );
    assert.equal(
      countMatches(html, /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/gi),
      1,
      `${route.path} should contain exactly one canonical`,
    );
    assert.ok(
      html.includes(`rel="canonical" href="${route.canonicalUrl}"`),
      `${route.path} should contain its exact canonical`,
    );
    assert.ok(
      html.includes('href="mailto:contact@privateimagetotext.com"'),
      `${route.path} should contain the public contact address`,
    );
    assertNoManualCloudflareBeacon(html, route.path);
    assert.doesNotMatch(html, /Opening Media Inspector…/);

    if (route.path !== "/") {
      assert.notEqual(metaContent(html, "property", "og:url"), homepage.canonicalUrl);
      assert.notEqual(metaContent(html, "name", "description"), homepage.description);
    }
  }

  const media = await readFile(resolve(dist, "media-inspector.html"), "utf8");
  assert.match(
    media,
    /<link rel="modulepreload" crossorigin href="\/assets\/MediaInspectorPage-[^"]+\.js"/,
  );
});

test("the generated not-found document has no canonical or homepage OG URL", async () => {
  const html = await readFile(resolve(dist, "404.html"), "utf8");
  assertNoManualCloudflareBeacon(html, "/404.html");
  assert.match(html, /data-route-path="\/__not-found__"/);
  assert.match(html, /<h1[^>]*>There is no page at this address<\/h1>/);
  assert.equal(metaContent(html, "name", "robots"), "noindex, nofollow");
  assert.equal(metaContent(html, "property", "og:url"), undefined);
  assert.equal(metaContent(html, "property", "og:image"), "https://privateimagetotext.com/og.png");
  assert.equal(
    countMatches(html, /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/gi),
    0,
  );
});

test("rendered privacy pages document the exact production analytics boundary", async () => {
  const privacy = await generatedRouteHtml("/privacy");
  const technicalPrivacy = await generatedRouteHtml("/privacy/technical");
  const verify = await generatedRouteHtml("/verify");

  assert.match(privacy, /Hosting and traffic analytics/);
  assert.match(privacy, /Cloudflare Web Analytics/);
  assert.match(privacy, /runs on every page, including the tools/);
  assert.match(privacy, /could technically read what the page shows/);
  assert.match(technicalPrivacy, /not on technical isolation/);
  assert.doesNotMatch(technicalPrivacy, /same-origin<code>POST/);
  assert.match(verify, /only when the page is hidden/);
  assert.doesNotMatch(privacy, /No ads, analytics or accounts/);

  for (const route of await generatedRoutes()) {
    const html = await readFile(resolve(dist, route.outputFile), "utf8");
    assert.doesNotMatch(
      html,
      /\b(?:this site|the site|the application) does not (?:run|use) analytics\b/i,
      `${route.path} must not claim that analytics is absent`,
    );
  }

  assert.match(technicalPrivacy, /automatic edge injection/);
  assert.match(technicalPrivacy, /static\.cloudflareinsights\.com\/beacon\.min\.js/);
  assert.match(technicalPrivacy, /\/cdn-cgi\/rum/);
  assert.match(
    technicalPrivacy,
    /Analytics measurements must not contain selected files/,
  );
  assert.match(technicalPrivacy, /results or other user content/);

  assert.match(verify, /static\.cloudflareinsights\.com\/beacon\.min\.js/);
  assert.match(verify, /\/cdn-cgi\/rum/);
  assert.match(verify, /distinctive sentinel values/);
  assert.match(verify, /request payload/);
});

test("robots and the generated sitemap match the route manifest", async () => {
  const routes = await generatedRoutes();
  const robots = await readFile(resolve(dist, "robots.txt"), "utf8");
  assert.match(robots, /User-agent:\s*\*/i);
  assert.match(robots, /Allow:\s*\//i);
  assert.match(
    robots,
    /Sitemap:\s*https:\/\/privateimagetotext\.com\/sitemap\.xml/i,
  );

  const sitemap = await readFile(resolve(dist, "sitemap.xml"), "utf8");
  const sitemapUrls = Array.from(
    sitemap.matchAll(/<loc>([^<]+)<\/loc>/g),
    (match) => match[1],
  );
  assert.deepEqual(
    sitemapUrls,
    routes.map((route) => route.canonicalUrl),
  );
  assert.equal(countMatches(sitemap, /<url>/g), routes.length);
  for (const route of routes) {
    const entry = sitemap.match(
      new RegExp(
        `<url>\\s*<loc>${escapeRegExp(route.canonicalUrl)}</loc>([\\s\\S]*?)</url>`,
      ),
    )?.[1];
    assert.ok(entry !== undefined, `${route.path} should have a sitemap entry`);
    assert.ok(route.lastModified);
    assert.match(entry, new RegExp(`<lastmod>${escapeRegExp(route.lastModified)}</lastmod>`));
    assert.deepEqual([...entry.matchAll(/<image:loc>([^<]+)<\/image:loc>/g)].map((match) => match[1]), route.images.map((src) => `https://privateimagetotext.com${src}`));
  }
  assert.doesNotMatch(sitemap, /<changefreq>|<priority>/);
});

test("guide documents expose strict-CSP-compatible article and breadcrumb semantics", async () => {
  const routes = await generatedRoutes();
  const guideRoutes = routes.filter((route) => route.routeType === "guide");
  assert.ok(guideRoutes.length > 0);

  for (const route of guideRoutes) {
    const html = await readFile(resolve(dist, route.outputFile), "utf8");
    assert.equal(
      countMatches(
        html,
        /<article\b[^>]*>/gi,
      ),
      1,
      route.path,
    );
    assert.match(
      html,
      /<nav\b(?=[^>]*\baria-label="Breadcrumb")[^>]*>/i,
    );
    assert.doesNotMatch(html, /itemscope|itemtype=/i);
    assert.doesNotMatch(html, /Publication date set on first deployment/i);
    // Publication and modification are independent facts. The original
    // three dated guides have a recorded publication date; the new PDF
    // draft has a real content-edit date but has not been published.
    const publishedGuides = new Set([
      "/guides/screenshot-to-text",
      "/guides/copy-error-message-from-image",
      "/guides/private-ocr-for-sensitive-documents",
    ]);
    if (publishedGuides.has(route.path)) {
      assert.equal(articleDate(html, "datePublished"), "2026-08-08");
    } else {
      assert.doesNotMatch(html, /data-article-date="datePublished"/i);
    }
    const visibleUpdated = articleDate(html, "dateModified");
    if (visibleUpdated) {
      assert.equal(Date.parse(`${visibleUpdated}T00:00:00Z`), Date.parse(route.lastModified));
    }
    assert.match(html, /aria-label="Guide actions"/i);
    assert.match(html, />Related guides</i);
  }

  const ocrGuide = await generatedRouteHtml("/guides/improve-ocr-accuracy");
  assert.match(ocrGuide, /href="\/"[^>]*>Open Extract text/i);
  const steganographyGuide = await generatedRouteHtml(
    "/guides/hide-message-in-image",
  );
  assert.match(steganographyGuide, /href="\/hide-message"[^>]*>Open Hide message/i);
  const mediaGuide = await generatedRouteHtml("/guides/view-photo-metadata");
  assert.match(mediaGuide, /href="\/media-inspector"[^>]*>Open Media Inspector/i);
});

test("the Guides hub and each tool expose crawlable category-specific guide links", async () => {
  const hub = await generatedRouteHtml("/guides");
  assert.match(hub, />Extract text and OCR</);
  assert.match(hub, />Hide and reveal messages</);
  assert.match(hub, />Media metadata and origin clues</);
  assert.match(hub, /href="\/"[^>]*>Open Extract text/i);
  assert.match(hub, /href="\/hide-message"[^>]*>Open Hide message/i);
  assert.match(hub, /href="\/media-inspector"[^>]*>Open Media Inspector/i);

  const toolLinks = [
    [
      "/",
      [
        "/guides/improve-ocr-accuracy",
        "/guides/photo-scan-to-text",
        "/guides/receipt-to-text",
        "/guides/offline-ocr-without-internet",
        "/guides/ocr-in-other-languages",
        "/guides/batch-ocr-multiple-images",
      ],
    ],
    [
      "/hide-message",
      [
        "/guides/hide-message-in-image",
        "/guides/reveal-hidden-message-from-image",
        "/guides/share-image-with-hidden-message",
      ],
    ],
    [
      "/media-inspector",
      [
        "/guides/view-photo-metadata",
        "/guides/remove-photo-metadata-before-sharing",
        "/guides/check-image-ai-metadata-content-credentials",
        "/guides/check-photo-location-before-posting",
      ],
    ],
  ];

  for (const [pathname, links] of toolLinks) {
    const html = await generatedRouteHtml(pathname);
    for (const link of links) {
      assert.ok(html.includes(`href="${link}"`), `${pathname} should link to ${link}`);
    }
  }
});

test("each tool document links to every other tool outside its workspace", async () => {
  const routes = await generatedRoutes();
  const tools = routes.filter((route) => route.routeType === "tool");
  assert.ok(tools.length >= 3, "expected at least three public tools");
  for (const tool of tools) {
    const html = await generatedRouteHtml(tool.path);
    const directory = html.match(
      /<section class="guide-section tool-directory"[\s\S]*?<\/section>/,
    )?.[0];
    assert.ok(directory, `${tool.path} should render the tool directory`);
    for (const other of tools) {
      const link = new RegExp(`<a\\b[^>]*href="${escapeRegExp(other.path)}"[^>]*>`);
      if (other.path === tool.path) {
        assert.doesNotMatch(directory, link, `${tool.path} should not list itself`);
        continue;
      }
      const anchor = directory.match(link)?.[0];
      assert.ok(anchor, `${tool.path} should link to ${other.path}`);
      // Leaving a tool in the same tab would discard its unsaved work.
      assert.match(anchor, /target="_blank"/);
      assert.match(anchor, /rel="noopener noreferrer"/);
    }
  }

  const notFound = await readFile(resolve(dist, "404.html"), "utf8");
  for (const tool of tools) {
    assert.ok(notFound.includes(`href="${tool.path}"`), `404 should link to ${tool.path}`);
  }
});

// Capture evidence lives only in the private repository; the public source
// snapshot omits it, so this check runs here and in CI but skips there.
const guideEvidenceRoot = resolve(root, "docs/guide-evidence");
test("published guide figures match their capture evidence and size budget", {
  skip: !existsSync(guideEvidenceRoot) && "capture evidence is kept in the private repository",
}, async () => {
  const records = [];
  const collect = (value) => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") {
      if (typeof value.src === "string" && "sha256" in value && "bytes" in value) records.push(value);
      Object.values(value).forEach(collect);
    }
  };
  for (const name of (await readdir(guideEvidenceRoot)).filter((file) => file.endsWith(".json"))) {
    collect(JSON.parse(await readFile(resolve(guideEvidenceRoot, name), "utf8")));
  }
  const bySrc = new Map(records.map((record) => [record.src, record]));
  const figures = [...new Set((await generatedRoutes()).flatMap((route) => route.images))];
  assert.ok(figures.length > 0);
  let total = 0;
  for (const src of figures) {
    const bytes = await readFile(resolve(dist, `.${src}`));
    total += bytes.length;
    const record = bySrc.get(src);
    assert.ok(record, `${src} needs a capture record in docs/guide-evidence`);
    assert.equal(bytes.length, record.bytes, `${src} bytes differ from its capture record`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), record.sha256, `${src} hash differs from its capture record`);
  }
  // Every tool visit precaches all figures for offline use; keep the average modest.
  assert.ok(total / figures.length <= 30_000, `average guide figure is ${Math.round(total / figures.length)} bytes`);
});

test("titles and descriptions fit search result snippets", async () => {
  for (const route of await generatedRoutes()) {
    assert.ok(route.title.length <= 60, `${route.path} title is ${route.title.length} characters`);
    assert.ok(
      route.description.length <= 160,
      `${route.path} description is ${route.description.length} characters`,
    );
  }
});

test("build contains the verified same-origin OCR and offline assets", async () => {
  const required = [
    "ocr/worker.min.js",
    "ocr/core/tesseract-core-lstm.wasm.js",
    "ocr/core/tesseract-core-simd-lstm.wasm.js",
    "ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js",
    "ocr/TESSDATA-LICENSE.txt",
    "steg/jpeg-v2-codec.wasm",
    "steg/libjpeg-turbo-LICENSE.md",
    "c2pa/LICENSE.txt",
    "sw.js",
    "404.html",
    "document-manifest.json",
    "manifest.webmanifest",
    "og.png",
    "sitemap.xml",
    "_headers",
    ".well-known/security.txt",
  ];

  for (const relativePath of required) {
    const details = await stat(resolve(dist, relativePath));
    assert.ok(details.size > 0, `${relativePath} should not be empty`);
  }

  const languages = JSON.parse(await readFile(resolve(root, "src/config/ocr-languages.json"), "utf8"));
  assert.equal(languages.models.length, 12);
  for (const model of languages.models) {
    assert.equal((await stat(resolve(dist, model.path.slice(1)))).size, model.bytes);
  }
  const jpegCodec = await stat(resolve(dist, "steg/jpeg-v2-codec.wasm"));
  assert.equal(jpegCodec.size, 253_687);
  const securityText = await readFile(
    resolve(dist, ".well-known/security.txt"),
    "utf8",
  );
  assert.match(
    securityText,
    /^Contact: mailto:contact@privateimagetotext\.com$/m,
  );
  assert.match(
    securityText,
    /^Canonical: https:\/\/privateimagetotext\.com\/\.well-known\/security\.txt$/m,
  );
  assert.equal(countMatches(securityText, /^Contact:/gm), 1);
  assert.equal(countMatches(securityText, /^Expires:/gm), 1);
  const expires = securityText.match(/^Expires:\s*(.+)$/m)?.[1];
  assert.ok(expires, "security.txt should declare an expiry");
  assert.ok(
    Date.parse(expires) > Date.now(),
    "security.txt expiry should be in the future",
  );
  assert.match(securityText, /^Preferred-Languages: en$/m);
  await assert.rejects(
    stat(resolve(dist, "ocr/lang/eng.traineddata.gz")),
    (error) => error?.code === "ENOENT",
  );
});

test("service worker caches and validates each generated route independently", async () => {
  const routes = await generatedRoutes();
  const serviceWorker = await readFile(resolve(dist, "sw.js"), "utf8");
  assert.match(serviceWorker, /localtext-shell-v10/);
  assert.match(serviceWorker, /localtext-ocr-v5/);
  assert.doesNotMatch(serviceWorker, /__LOCALTEXT_PUBLIC_ROUTE_DOCUMENTS__/);
  assert.doesNotMatch(serviceWorker, /__LOCALTEXT_GUIDE_FIGURES__/);
  assert.doesNotMatch(serviceWorker, /["']\/og(?:\/|\.png)/);
  for (const src of routes.flatMap((route) => route.images)) assert.ok(serviceWorker.includes(JSON.stringify(src)));
  assert.doesNotMatch(serviceWorker, /rootResponse\.clone\(\)/);
  assert.match(serviceWorker, /isExpectedShellDocument/);
  assert.match(serviceWorker, /SHELL_NOT_FOUND_CACHE_KEY/);
  assert.match(serviceWorker, /fetch\(path, \{ cache: "no-cache" \}\)/);
  for (const route of routes) {
    assert.ok(
      serviceWorker.includes(
        JSON.stringify({ path: route.path, canonicalUrl: route.canonicalUrl, figures: route.images, routeType: route.routeType }).slice(0, -1),
      ),
    );
  }
  assert.match(serviceWorker, /ocr\/lang\/eng\/[a-f0-9]+\.traineddata\.gz/);
  assert.doesNotMatch(serviceWorker, /eng\.traineddata\.gz/);
  assert.match(serviceWorker, /OCR_ASSET_PATHS\.has\(url\.pathname\)/);
  assert.doesNotMatch(serviceWorker, /url\.pathname\.startsWith\("\/ocr\/"\)/);
  assert.match(serviceWorker, /localtext-jpeg-v2-v1/);
  assert.match(serviceWorker, /application\/wasm/);
  assert.match(
    serviceWorker,
    /1c8326b7278e5f0afa003a9bf95ffe280f2e733160d1458f0be54f9cb9c1968a/,
  );
});

test("compiled application contains required product copy and no old portfolio", async () => {
  const assetDirectory = resolve(dist, "assets");
  const javascriptFiles = (await readdir(assetDirectory)).filter((filename) =>
    filename.endsWith(".js"),
  );
  const compiled = (
    await Promise.all(
      javascriptFiles.map((filename) =>
        readFile(resolve(assetDirectory, filename), "utf8"),
      ),
    )
  ).join("\n");

  assert.match(compiled, /Extract text from images\. Nothing uploaded\./);
  assert.match(
    compiled,
    /This site does not upload your image or recognised text\./,
  );
  assert.match(compiled, /OCR languages/);
  assert.doesNotMatch(compiled, /Monogram Terminal|SIMON\/\//);
});

test("future static headers keep the strict OCR-compatible boundary", async () => {
  const headers = await readFile(resolve(dist, "_headers"), "utf8");
  const sourceHeaders = await readFile(
    resolve(root, "public", "_headers"),
    "utf8",
  );
  assert.equal(headers, sourceHeaders);
  const [productionDefaults] = headers.split(/\r?\n\r?\n/);
  const productionCsp = productionDefaults.match(
    /^\s*Content-Security-Policy:\s*(.+)$/m,
  )?.[1];
  assert.ok(productionCsp);
  const scriptSource = cspDirective(productionCsp, "script-src");
  const connectSource = cspDirective(productionCsp, "connect-src");

  assert.equal(
    scriptSource,
    `script-src 'self' 'wasm-unsafe-eval' ${CLOUDFLARE_BEACON_URL} ${CLOUDFLARE_BEACON_VERSIONED_PREFIX}`,
  );
  assert.equal(connectSource, "connect-src 'self'");
  assert.equal(countMatches(scriptSource, /static\.cloudflareinsights\.com/g), 2);
  assert.doesNotMatch(
    scriptSource,
    /https:\/\/static\.cloudflareinsights\.com\/?(?:\s|;|$)/,
    "the beacon host must never be allowed wholesale",
  );
  assert.doesNotMatch(
    scriptSource,
    /'unsafe-inline'|'unsafe-eval'|(?:^|\s)\*(?:\s|$)|(?:^|\s)https:(?:\s|$)|\*\.cloudflare/i,
  );
  assert.doesNotMatch(connectSource, /cloudflareinsights\.com/i);
  assert.match(headers, /default-src 'self'/);
  assert.match(headers, /connect-src 'self'/);
  assert.match(headers, /worker-src 'self' blob:/);
  assert.match(headers, /img-src 'self' blob: data:/);
  assert.match(headers, /object-src 'none'/);
  assert.match(headers, /Content-Type: application\/wasm/);
  assert.doesNotMatch(productionDefaults, /X-Robots-Tag:\s*noindex/i);
  assert.match(
    headers,
    /https:\/\/:version\.:subdomain\.workers\.dev\/\*[\s\S]*X-Robots-Tag:\s*noindex/i,
  );
});

test("local preview stays non-indexable and emulates Cloudflare document routing", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts["serve:local"],
    "vite preview --host 127.0.0.1 --port 5173 --strictPort",
  );

  const launcher = await readFile(resolve(root, "start-local.ps1"), "utf8");
  assert.match(launcher, /& \$pnpm run build/);
  assert.match(launcher, /& \$pnpm run serve:local/);
  assert.doesNotMatch(launcher, /& \$pnpm run dev/);

  const viteConfig = await readFile(resolve(root, "vite.config.ts"), "utf8");
  assert.match(viteConfig, /const localCsp = \[/);
  assert.match(viteConfig, /localPreviewSecurityHeaders/);
  assert.match(viteConfig, /cloudflarePagesDocumentRouting/);
  assert.match(viteConfig, /X-Robots-Tag/);
  assert.match(
    viteConfig,
    /script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' 'unsafe-inline'/,
  );
  assert.equal(
    viteConfig.match(/'unsafe-inline'/g)?.length,
    1,
    "unsafe-inline must remain development-only",
  );
  assert.doesNotMatch(viteConfig, /static\.cloudflareinsights\.com|cdn-cgi\/rum/);
});


test("public OCR samples match the original fixture provenance and explicit cache allowlist", async () => {
  const manifest = JSON.parse(await readFile(resolve(root, "public/samples/manifest.json"), "utf8"));
  const sw = await readFile(resolve(dist, "sw.js"), "utf8");
  assert.equal(manifest.samples.length, 4);
  for (const sample of manifest.samples) {
    const source = await readFile(resolve(root, sample.source));
    const published = await readFile(resolve(dist, sample.path.slice(1)));
    assert.deepEqual(published, source);
    assert.equal(createHash("sha256").update(published).digest("hex"), sample.sha256);
    assert.ok(sw.includes(`"${sample.path}"`));
  }
  assert.doesNotMatch(sw, /pathname\.startsWith\(["']\/samples\//);
});
