import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function filesWithin(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesWithin(fullPath)));
    else files.push(fullPath);
  }
  return files;
}

test("the explicitly PDF-disabled build includes only verified non-public PDF foundations", async () => {
  const distRoot = path.join(repositoryRoot, "dist");
  const distFiles = await filesWithin(distRoot);
  const relativeFiles = distFiles.map((file) =>
    path.relative(distRoot, file).replaceAll("\\", "/"),
  );
  assert.equal(
    relativeFiles
      .filter((file) => !file.startsWith("pdf/6.2.108/"))
      .some((file) => /phase0|pdf-to-text|pdfjs/i.test(file)),
    false,
  );

  const pdfAssetManifest = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "scripts", "pdf-assets.manifest.json"),
      "utf8",
    ),
  );
  const expectedPdfFiles = new Set(
    pdfAssetManifest.assets.map((asset) => asset.runtimePath.slice(1)),
  );
  const actualPdfFiles = new Set(
    relativeFiles.filter((file) => file.startsWith("pdf/")),
  );
  assert.deepEqual(actualPdfFiles, expectedPdfFiles);
  for (const asset of pdfAssetManifest.assets) {
    const bytes = await readFile(path.join(distRoot, asset.runtimePath.slice(1)));
    assert.equal(bytes.length, asset.bytes, asset.runtimePath);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      asset.sha256,
      asset.runtimePath,
    );
  }

  const manifest = await readFile(
    path.join(distRoot, ".vite", "manifest.json"),
    "utf8",
  );
  assert.doesNotMatch(manifest, /pdfjs-dist|pdf\.worker|pdf-phase0/i);

  const routes = JSON.parse(
    await readFile(path.join(distRoot, "document-manifest.json"), "utf8"),
  );
  assert.equal(routes.length, 21);
  assert.equal(routes.some((route) => route.path === "/pdf-to-text"), false);

  // The release feature is now compile-time gated. The rendered route,
  // navigation and bundle assertions below verify that the standard build is off.

  const prohibited = /pdf-to-text|pdf-phase0|\/pdfjs\//i;
  for (const source of [
    path.join(repositoryRoot, "src", "config", "routes.ts"),
    path.join(repositoryRoot, "public", "sw.js"),
    path.join(distRoot, "sitemap.xml"),
    path.join(distRoot, "document-manifest.json"),
  ]) {
    assert.doesNotMatch(await readFile(source, "utf8"), prohibited, source);
  }

  for (const html of distFiles.filter((file) => file.endsWith(".html"))) {
    assert.doesNotMatch(await readFile(html, "utf8"), prohibited, html);
  }

  const publicDocuments = [
    path.join(repositoryRoot, "src", "App.tsx"),
    path.join(repositoryRoot, "src", "config", "routes.ts"),
    path.join(distRoot, "sitemap.xml"),
    ...distFiles.filter((file) => file.endsWith(".html")),
  ];
  for (const source of publicDocuments) {
    assert.doesNotMatch(await readFile(source, "utf8"), /pdf-to-text/i, source);
  }

  const serviceWorker = await readFile(path.join(distRoot, "sw.js"), "utf8");
  assert.doesNotMatch(serviceWorker, /__LOCALTEXT_PDF_CACHE_ASSETS__/);
  assert.match(serviceWorker, /localtext-pdf-v1-pdfjs-6\.2\.108/);
  for (const asset of pdfAssetManifest.assets) {
    assert.ok(serviceWorker.includes(JSON.stringify(asset.runtimePath)));
  }

  const searchableBuild = (
    await Promise.all(
      distFiles
        .filter((file) => /\.(?:html|js|css|json|xml)$/.test(file))
        .filter((file) => path.basename(file) !== "sw.js")
        .map((file) => readFile(file, "utf8")),
    )
  ).join("\n");
  assert.doesNotMatch(searchableBuild, /\/pdf\/6\.2\.108\//);
});
