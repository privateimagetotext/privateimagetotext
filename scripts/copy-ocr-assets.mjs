import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(
  repositoryRoot,
  "scripts",
  "ocr-assets.manifest.json",
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

for (const asset of manifest.assets) {
  const source = resolve(repositoryRoot, asset.source);
  const destination = resolve(repositoryRoot, asset.destination);
  const sourceContents = await readFile(source);
  const actualHash = sha256(sourceContents);

  if (actualHash !== asset.sha256) {
    throw new Error(
      `OCR asset checksum mismatch for ${asset.source}: expected ${asset.sha256}, received ${actualHash}`,
    );
  }

  await mkdir(dirname(destination), { recursive: true });
  if (asset.transform === "tesseract-language-code") {
    // Tesseract.js 7.0.0's Lang[] API writes code.traineddata correctly, but
    // initializes with Lang.data instead of Lang.code. Patch only this pinned
    // upstream typo so verified in-memory bytes need no second model fetch.
    const before = 'return"string"==typeof t?t:t.data})).join("+")';
    const after = 'return"string"==typeof t?t:t.code})).join("+")';
    const sourceText = sourceContents.toString("utf8");
    if (sourceText.split(before).length !== 2) throw new Error("Tesseract language patch no longer applies exactly once");
    const output = Buffer.from("/* Modified by LocalText, 2026-09-17: initialise Lang objects with code, not data. */\n" + sourceText.replace(before, after));
    if (sha256(output) !== asset.outputSha256) throw new Error("Patched Tesseract worker checksum mismatch");
    await writeFile(destination, output);
  } else if (asset.transform === "gunzip") {
    const outputContents = gunzipSync(sourceContents);
    const outputHash = sha256(outputContents);
    if (outputHash !== asset.outputSha256) {
      throw new Error(
        `OCR asset output checksum mismatch for ${asset.destination}: expected ${asset.outputSha256}, received ${outputHash}`,
      );
    }
    await writeFile(destination, outputContents);
  } else {
    if (asset.transform) {
      throw new Error(`Unsupported OCR asset transform: ${asset.transform}`);
    }
    await writeFile(destination, sourceContents);
  }
}

for (const licence of manifest.licences) {
  const source = resolve(repositoryRoot, licence.source);
  const destination = resolve(repositoryRoot, licence.destination);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

const languages = JSON.parse(await readFile(resolve(repositoryRoot, "src/config/ocr-languages.json"), "utf8"));
for (const model of languages.models) {
  if (!/^\/ocr\/lang\/[a-z]{3}\/[a-f0-9]{16}\.traineddata\.gz$/.test(model.path)) throw new Error("Invalid model path");
  const bytes = await readFile(resolve(repositoryRoot, `public${model.path}`));
  const raw = gunzipSync(bytes);
  if (bytes.length !== model.bytes || sha256(bytes) !== model.sha256 || raw.length !== model.uncompressedBytes || sha256(raw) !== model.uncompressedSha256) {
    throw new Error(`OCR language checksum mismatch: ${model.id}`);
  }
  if (bytes.length > 5_000_000) throw new Error(`OCR model exceeds download budget: ${model.id}`);
}
process.stdout.write(`Verified ${languages.models.length} pinned language models.\n`);
process.stdout.write(
  `Prepared ${manifest.assets.length} verified local OCR assets.\n`,
);
