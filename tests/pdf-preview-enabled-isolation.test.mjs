import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const dist = path.resolve(repositoryRoot, "dist");

function countMatches(value, pattern) {
  return Array.from(value.matchAll(pattern)).length;
}

test("the enabled preview build emits one private PDF workspace document", async () => {
  const publicRoutes = JSON.parse(
    await readFile(path.resolve(dist, "document-manifest.json"), "utf8"),
  );
  assert.equal(publicRoutes.length, 21);
  assert.equal(
    publicRoutes.some(({ path: routePath }) => routePath === "/pdf-to-text"),
    false,
  );

  const sitemap = await readFile(path.resolve(dist, "sitemap.xml"), "utf8");
  assert.doesNotMatch(sitemap, /pdf-to-text/i);

  const previewHtml = await readFile(
    path.resolve(dist, "pdf-to-text.html"),
    "utf8",
  );
  assert.match(previewHtml, /data-route-path="\/pdf-to-text"/);
  assert.match(previewHtml, /<title>PDF to Text Preview — Private Local OCR<\/title>/);
  assert.match(
    previewHtml,
    /<meta name="robots" content="noindex, nofollow"\s*\/>/,
  );
  assert.equal(countMatches(previewHtml, /<h1\b/gi), 1);
  assert.doesNotMatch(previewHtml, /<link\b(?=[^>]*\brel="canonical")[^>]*>/i);
  assert.doesNotMatch(previewHtml, /<meta\b(?=[^>]*\bproperty="og:url")[^>]*>/i);
  assert.doesNotMatch(
    previewHtml,
    /pdf\.worker|\/pdf\/6\.2\.108\/|tesseract|eng\.traineddata/i,
  );

  const viteManifest = JSON.parse(
    await readFile(path.resolve(dist, ".vite", "manifest.json"), "utf8"),
  );
  const previewAsset = viteManifest["src/pages/PdfOcrPage.tsx"]?.file;
  assert.ok(previewAsset, "the PDF workspace must remain a separate lazy chunk");
  assert.match(
    previewHtml,
    new RegExp(
      `<link rel="modulepreload" crossorigin href="/${previewAsset.replaceAll(".", "\\.")}" />`,
    ),
  );

  for (const route of publicRoutes) {
    const html = await readFile(path.resolve(dist, route.outputFile), "utf8");
    assert.equal(
      html.includes(`href="/${previewAsset}"`),
      false,
      `${route.path} must not preload the PDF workspace`,
    );
  }

  const serviceWorker = await readFile(path.resolve(dist, "sw.js"), "utf8");
  assert.match(
    serviceWorker,
    /\{"path":"\/pdf-to-text","canonicalUrl":null,/,
  );
  assert.match(serviceWorker, /expected\.canonicalUrl === null/);
});
