import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const dist = path.resolve(repositoryRoot, "dist");

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

test("the explicitly PDF-disabled build excludes the workspace route and chunk", async () => {
  const files = await filesWithin(dist);
  const relativeFiles = files.map((file) =>
    path.relative(dist, file).replaceAll("\\", "/"),
  );
  await assert.rejects(
    stat(path.resolve(dist, "pdf-to-text.html")),
    (error) => error?.code === "ENOENT",
  );
  assert.equal(
    relativeFiles.some((file) => /PdfOcrPage|pdf-to-text/i.test(file)),
    false,
  );

  const viteManifest = await readFile(
    path.resolve(dist, ".vite", "manifest.json"),
    "utf8",
  );
  assert.doesNotMatch(viteManifest, /PdfOcrPage|pdf-to-text|PDF to Text Preview/i);

  const publicRoutes = JSON.parse(
    await readFile(path.resolve(dist, "document-manifest.json"), "utf8"),
  );
  assert.equal(publicRoutes.length, 21);
  assert.equal(
    publicRoutes.some(({ path: routePath }) => routePath === "/pdf-to-text"),
    false,
  );

  const sitemap = await readFile(path.resolve(dist, "sitemap.xml"), "utf8");
  const serviceWorker = await readFile(path.resolve(dist, "sw.js"), "utf8");
  assert.doesNotMatch(sitemap, /pdf-to-text/i);
  assert.doesNotMatch(serviceWorker, /pdf-to-text/i);

  const searchableApplication = (
    await Promise.all(
      files
        .filter((file) => /\.(?:html|js|css|json|xml)$/.test(file))
        .filter((file) => !file.includes(`${path.sep}pdf${path.sep}6.2.108${path.sep}`))
        .map((file) => readFile(file, "utf8")),
    )
  ).join("\n");
  assert.doesNotMatch(
    searchableApplication,
    /\/pdf-to-text|PdfOcrPage|PDF to Text Preview/i,
  );
});
