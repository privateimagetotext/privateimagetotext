// Re-encode published guide figures at the WebP quality in
// guide-figure-quality.mjs, using the same Chromium canvas encoder as
// capture-guide-figures.mjs. Dimensions never change. A figure is rewritten
// only when it shrinks by at least MIN_SAVING, and its capture record in
// docs/guide-evidence/ is updated with the new bytes, hash and encodedQuality,
// so a second run never re-encodes it again (no compounding loss).
//
// Usage: node scripts/optimise-guide-figures.mjs [--dry-run]
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { guideFigureQuality } from "./guide-figure-quality.mjs";

const MIN_SAVING = 0.05;
const dryRun = process.argv.includes("--dry-run");
// Resolve from this file so the script works from any working directory.
// GUIDE_FIGURES_ROOT points it at another checkout (for example a merge preview).
const repositoryRoot = process.env.GUIDE_FIGURES_ROOT
  ? path.resolve(process.env.GUIDE_FIGURES_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(repositoryRoot, "public");
const evidenceRoot = path.join(repositoryRoot, "docs/guide-evidence");

async function webpFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return webpFiles(full);
    return entry.name.endsWith(".webp") ? [full] : [];
  }));
  return nested.flat();
}

// Capture records are the objects that carry src, bytes and sha256.
function captureRecords(value, found = []) {
  if (Array.isArray(value)) value.forEach((item) => captureRecords(item, found));
  else if (value && typeof value === "object") {
    if (typeof value.src === "string" && "sha256" in value && "bytes" in value) found.push(value);
    Object.values(value).forEach((item) => captureRecords(item, found));
  }
  return found;
}

const evidence = await Promise.all((await readdir(evidenceRoot))
  .filter((name) => name.endsWith(".json"))
  .map(async (name) => {
    const file = path.join(evidenceRoot, name);
    return { file, data: JSON.parse(await readFile(file, "utf8")), changed: false };
  }));
const recordsBySrc = new Map();
for (const document of evidence) {
  for (const record of captureRecords(document.data)) {
    if (recordsBySrc.has(record.src)) throw new Error(`${record.src}: more than one capture record`);
    recordsBySrc.set(record.src, { record, document });
  }
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {},
);
const page = await browser.newPage();
let before = 0;
let after = 0;
const pending = [];
try {
  for (const file of (await webpFiles(path.join(publicRoot, "guides"))).sort()) {
    const src = `/${path.relative(publicRoot, file).split(path.sep).join("/")}`;
    const original = await readFile(file);
    before += original.length;
    const entry = recordsBySrc.get(src);
    const quality = guideFigureQuality(src);
    if (!entry) {
      // Without a record the re-encode could not be marked, and a later run
      // would compress the figure again. Capture it properly instead.
      console.warn(`skip ${src}: no capture record in docs/guide-evidence`);
      after += original.length;
      continue;
    }
    if (typeof entry.record.encodedQuality === "number" && entry.record.encodedQuality <= quality) {
      console.log(`skip ${src}: already encoded at ${entry.record.encodedQuality}`);
      after += original.length;
      continue;
    }
    const result = await page.evaluate(async ({ data, quality }) => {
      const bitmap = await createImageBitmap(await (await fetch(data)).blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      return { data: canvas.toDataURL("image/webp", quality), width: canvas.width, height: canvas.height };
    }, { data: `data:image/webp;base64,${original.toString("base64")}`, quality });
    const encoded = Buffer.from(result.data.split(",")[1], "base64");
    if (result.width !== entry.record.width || result.height !== entry.record.height) {
      throw new Error(`${src}: dimensions ${result.width}x${result.height} do not match the record`);
    }
    if (encoded.length > original.length * (1 - MIN_SAVING)) {
      console.log(`keep ${src}: ${original.length} -> ${encoded.length} bytes is under ${MIN_SAVING * 100}% saving`);
      after += original.length;
      continue;
    }
    after += encoded.length;
    console.log(`${dryRun ? "would write" : "write"} ${src}: ${original.length} -> ${encoded.length} bytes at ${quality}`);
    pending.push({ file, encoded, entry, quality });
  }
} finally {
  await browser.close();
}

// Nothing is written until every figure has been encoded and checked, so an
// error part-way leaves figures and evidence untouched and consistent.
if (!dryRun) {
  for (const { file, encoded, entry, quality } of pending) {
    await writeFile(file, encoded);
    Object.assign(entry.record, {
      bytes: encoded.length,
      sha256: createHash("sha256").update(encoded).digest("hex"),
      encodedQuality: quality,
    });
    entry.document.changed = true;
  }
  for (const document of evidence) {
    if (document.changed) await writeFile(document.file, `${JSON.stringify(document.data, null, 2)}\n`);
  }
}
console.log(`total ${before} -> ${after} bytes (${Math.round((1 - after / before) * 100)}% smaller)${dryRun ? ", dry run" : ""}`);
