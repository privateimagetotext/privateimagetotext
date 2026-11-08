/* global AbortSignal, fetch */
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");
const destination = path.join(root, "tmp/pdf-release-corpus");
const manifestBytes = await readFile(path.join(import.meta.dirname, "corpus.json"));
const manifest = JSON.parse(manifestBytes);
const verifyOnly = process.argv.includes("--verify-only");
if (process.argv.slice(2).some((argument) => argument !== "--verify-only")) {
  throw new Error("Usage: node tools/pdf-release/prepare-corpus.mjs [--verify-only]");
}
const maximumBytes = 25 * 1024 * 1024;
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function verify(entry, bytes) {
  if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
    throw new Error(`${entry.id}: pinned size/hash mismatch. Review the source revision; do not silently refresh the manifest.`);
  }
  if (!/%PDF-(?:1\.[0-9]|2\.[0-9])/.test(bytes.subarray(0, 1024).toString("latin1"))) {
    throw new Error(`${entry.id}: missing PDF signature`);
  }
}

async function download(entry) {
  const source = new URL(entry.source.url);
  if (source.protocol !== "https:") throw new Error("Corpus sources must use HTTPS");
  const response = await fetch(source, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok || !response.body) throw new Error(`${entry.id}: download returned ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximumBytes) throw new Error(`${entry.id}: download exceeds the corpus size cap`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

await mkdir(destination, { recursive: true });
const records = [];
for (const entry of manifest.cases) {
  if (!/^[a-z0-9_-]+\.pdf$/.test(entry.filename) || entry.bytes > maximumBytes) {
    throw new Error(`Invalid corpus entry: ${entry.id}`);
  }
  const filename = path.join(destination, entry.filename);
  let bytes;
  let action = "verified-existing";
  try {
    bytes = await readFile(filename);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (verifyOnly) throw new Error(`${entry.id}: missing fixture; run preparation first`);
    if (entry.source.base64Path) {
      bytes = Buffer.from(await readFile(path.join(root, entry.source.base64Path), "utf8"), "base64");
      action = "decoded-pinned-upstream";
    } else if (entry.source.generatedPath) {
      try {
        bytes = await readFile(path.join(root, entry.source.generatedPath));
      } catch {
        throw new Error(`${entry.id}: generate the existing synthetic fixtures with pnpm run prepare:pdf-phase0 first`);
      }
      action = "copied-synthetic";
    } else {
      bytes = await download(entry);
      action = "downloaded-public-source";
    }
    verify(entry, bytes);
    await writeFile(filename, bytes);
  }
  verify(entry, bytes);
  records.push({ id: entry.id, kind: entry.kind, bytes: bytes.length, sha256: entry.sha256, action });
  process.stdout.write(`${entry.id}: ${action}\n`);
}
await writeFile(path.join(destination, "preparation.json"), `${JSON.stringify({
  checkedAt: new Date().toISOString(),
  corpusManifestSha256: sha256(manifestBytes),
  records,
}, null, 2)}\n`);
process.stdout.write(`Verified ${records.length} pinned PDFs (${records.reduce((total, entry) => total + entry.bytes, 0)} bytes).\n`);
