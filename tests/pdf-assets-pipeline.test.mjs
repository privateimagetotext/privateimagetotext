import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import {
  readAndVerifyPdfAssetSource,
  validatePdfAssetManifest,
  verifyPdfAssetBytes,
} from "../scripts/pdf-assets-validation.mjs";

const root = process.cwd();
const manifest = JSON.parse(
  await readFile(path.join(root, "scripts", "pdf-assets.manifest.json"), "utf8"),
);

function changed(mutator) {
  const copy = JSON.parse(JSON.stringify(manifest));
  mutator(copy);
  return copy;
}

test("PDF manifest pins the exact reviewed package, MIME set, and deterministic total", async () => {
  const installed = JSON.parse(
    await readFile(path.join(root, "node_modules", "pdfjs-dist", "package.json"), "utf8"),
  );
  assert.equal(installed.version, "6.2.108");
  assert.equal(manifest.packageVersion, installed.version);
  assert.equal(manifest.runtimeRoot, "/pdf/6.2.108/");
  assert.equal(manifest.cacheVersion, "localtext-pdf-v1-pdfjs-6.2.108");
  assert.equal(manifest.summary.files, 201);
  assert.equal(manifest.summary.bytes, 5_159_165);
  assert.deepEqual(manifest.summary.categories, {
    api: { files: 1, bytes: 853_537 },
    cmap: { files: 168, bytes: 1_165_667 },
    icc: { files: 1, bytes: 8_464 },
    licence: { files: 11, bytes: 43_994 },
    "standard-font": { files: 14, bytes: 774_339 },
    wasm: { files: 5, bytes: 1_050_766 },
    worker: { files: 1, bytes: 1_262_398 },
  });
  assert.ok(manifest.assets.every((asset) => asset.offlineRequired === true));
  validatePdfAssetManifest(manifest, root);
});

test("PDF manifest rejects duplicate and traversing paths", () => {
  assert.throws(
    () =>
      validatePdfAssetManifest(
        changed((copy) => {
          copy.assets[1].runtimePath = copy.assets[0].runtimePath;
        }),
        root,
      ),
    /duplicate runtime path/,
  );
  assert.throws(
    () =>
      validatePdfAssetManifest(
        changed((copy) => {
          copy.assets[1].destination = copy.assets[0].destination;
        }),
        root,
      ),
    /duplicate destination/,
  );
  assert.throws(
    () =>
      validatePdfAssetManifest(
        changed((copy) => {
          copy.assets[0].source = "node_modules/pdfjs-dist/../outside";
        }),
        root,
      ),
    /source path traversal/,
  );
  assert.throws(
    () =>
      validatePdfAssetManifest(
        changed((copy) => {
          copy.assets[0].destination = "public/pdf/6.2.108/../../outside";
        }),
        root,
      ),
    /destination path traversal/,
  );
  assert.throws(
    () =>
      validatePdfAssetManifest(
        changed((copy) => {
          copy.assets[0].runtimePath = "/pdf/6.2.108/../outside";
        }),
        root,
      ),
    /unsafe runtime path/,
  );
});

test("PDF manifest rejects version, category, and MIME drift", () => {
  for (const [field, value, expected] of [
    ["packageVersion", "6.2.109", /package identity\/version mismatch/],
    ["category", "viewer", /unknown category/],
    ["contentType", "text/html", /invalid MIME declaration/],
  ]) {
    assert.throws(
      () =>
        validatePdfAssetManifest(
          changed((copy) => {
            if (field === "packageVersion") copy.packageVersion = value;
            else copy.assets[0][field] = value;
          }),
          root,
        ),
      expected,
    );
  }
});

test("PDF source verification rejects missing, wrong-size, and wrong-hash bytes", async () => {
  const entry = validatePdfAssetManifest(manifest, root).entries[0];
  await assert.rejects(
    readAndVerifyPdfAssetSource(entry, async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }),
    /missing source file/,
  );
  const original = await readFile(entry.source);
  assert.throws(
    () => verifyPdfAssetBytes(entry.asset, original.subarray(1)),
    /byte mismatch/,
  );
  const changedBytes = Buffer.from(original);
  changedBytes[0] ^= 0xff;
  assert.throws(
    () => verifyPdfAssetBytes(entry.asset, changedBytes),
    /hash mismatch/,
  );
});

test("copied PDF runtime exactly matches sources and preserves licences", async () => {
  const validated = validatePdfAssetManifest(manifest, root);
  for (const { asset, source, destination } of validated.entries) {
    const [sourceBytes, destinationBytes] = await Promise.all([
      readFile(source),
      readFile(destination),
    ]);
    assert.deepEqual(destinationBytes, sourceBytes, asset.runtimePath);
  }
  const licence = manifest.assets.find(
    (asset) => asset.runtimePath === "/pdf/6.2.108/PDFJS-LICENSE.txt",
  );
  assert.ok(licence);
  assert.deepEqual(
    await readFile(path.join(root, licence.destination)),
    await readFile(path.join(root, licence.source)),
  );
});

test("verification mode does not mutate copied assets", async () => {
  const samplePaths = manifest.assets.slice(0, 12).map((asset) =>
    path.join(root, asset.destination),
  );
  const before = await Promise.all(samplePaths.map(async (file) => (await stat(file)).mtimeMs));
  execFileSync(process.execPath, [path.join(root, "scripts", "copy-pdf-assets.mjs"), "--verify"], {
    cwd: root,
    stdio: "pipe",
  });
  const after = await Promise.all(samplePaths.map(async (file) => (await stat(file)).mtimeMs));
  assert.deepEqual(after, before);
});
