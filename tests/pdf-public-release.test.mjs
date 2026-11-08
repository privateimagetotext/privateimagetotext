import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const dist = path.resolve(import.meta.dirname, "../dist");
const read = (file) => readFile(path.join(dist, file), "utf8");

test("PDF verification guidance follows the build's public discovery", async () => {
  const routes = JSON.parse(await read("document-manifest.json"));
  const verify = routes.find((route) => route.path === "/verify");
  assert.ok(verify);
  const html = await read(verify.outputFile);
  const publicPdf = routes.some((route) => route.path === "/pdf-to-text");
  if (!publicPdf) {
    assert.doesNotMatch(html, /pdf-verification-title|Check PDF text extraction|href="\/pdf-to-text"/);
    return;
  }

  assert.match(html, /href="#pdf-verification-title"/);
  const section = html.match(/<section\b[^>]*aria-labelledby="pdf-verification-title"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  assert.ok(section, "public verification must contain its PDF-specific section");
  assert.match(section, /<h2 id="pdf-verification-title">Check PDF text extraction<\/h2>/);
  assert.match(section, /href="\/pdf-to-text"/);
  const text = section.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  assert.match(text, /Visiting the tool should not load the PDF reader or OCR runtime/);
  assert.match(text, /Existing PDF text only/);
  assert.match(text, /OCR files should load only when OCR is needed or you explicitly prepare them/);
  assert.match(text, /PDF bytes, filenames, passwords, extracted text and edits must not appear/);
  assert.match(text, /\/pdf\/.*\/ocr\/.*same-site support assets, not uploads/);
  assert.match(text, /localStorage, sessionStorage, IndexedDB, cookies and Cache Storage/);
  assert.match(text, /PDF reader and selected OCR language readiness separately/);
  assert.match(text, /offline message, not a remote fallback/);
  assert.match(text, /input should clear after submission or cancellation/);
  assert.match(text, /confirm Clear PDF/);
  assert.match(text, /Returning requires selecting the PDF again/);
  assert.match(text, /Clear cannot remove clipboard history or downloaded files/);
  assert.match(text, /does not guarantee secure memory erasure/);
});

test("the public PDF build exposes a complete tool and guide with lazy processing assets", async () => {
  const routes = JSON.parse(await read("document-manifest.json"));
  assert.equal(routes.length, 31);
  const tool = routes.find((route) => route.path === "/pdf-to-text");
  const guide = routes.find((route) => route.path === "/guides/pdf-to-text");
  assert.ok(tool);
  assert.ok(guide);
  const html = await read(tool.outputFile);
  assert.match(html, /<meta name="robots" content="index, follow"/);
  assert.ok(html.includes('rel="canonical" href="https://privateimagetotext.com/pdf-to-text"'));
  assert.doesNotMatch(html, /Internal release candidate|PDF to Text preview|still being tested/);
  assert.match(html, /href="\/guides\/pdf-to-text"/);
  assert.doesNotMatch(html, /pdf\.worker|eng\.traineddata/);
  const guideHtml = await read(guide.outputFile);
  assert.ok(guideHtml.includes('href="/pdf-to-text"'));
  assert.match(guideHtml, /Choose a PDF and a page range/);
  assert.doesNotMatch(guideHtml, /Page not found/);
  assert.match(guideHtml, /Publication date not recorded/);
  assert.match(guideHtml, /data-article-date="dateModified" dateTime="2026-10-29"/);

  const manifest = JSON.parse(await read(".vite/manifest.json"));
  const chunk = manifest["src/pages/PdfOcrPage.tsx"];
  assert.ok(chunk?.file);
  assert.ok(chunk.css?.length);
  assert.ok(html.includes(`rel="modulepreload" crossorigin href="/${chunk.file}"`));
  for (const css of chunk.css) assert.ok(html.includes(`rel="stylesheet" crossorigin href="/${css}"`));
  for (const route of routes.filter((route) => route !== tool)) {
    const otherHtml = await read(route.outputFile);
    assert.equal(otherHtml.includes(`rel="modulepreload" crossorigin href="/${chunk.file}"`), false, route.path);
  }
  const sitemap = await read("sitemap.xml");
  assert.ok(sitemap.includes("https://privateimagetotext.com/pdf-to-text</loc>"));
  assert.ok(sitemap.includes("https://privateimagetotext.com/guides/pdf-to-text</loc>"));
  const sw = await read("sw.js");
  assert.ok(sw.includes('"path":"/pdf-to-text","canonicalUrl":"https://privateimagetotext.com/pdf-to-text"'));
  assert.equal(sw.includes('"path":"/pdf-to-text","canonicalUrl":null'), false);
});
