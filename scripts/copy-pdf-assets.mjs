import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PDF_ASSET_CATEGORIES,
  readAndVerifyPdfAssetSource,
  rejectPdfAssetManifest,
  validatePdfAssetManifest,
  verifyPdfAssetBytes,
} from "./pdf-assets-validation.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(repositoryRoot, "scripts", "pdf-assets.manifest.json");
const verifyOnly = process.argv.slice(2).includes("--verify");
function fail(message) {
  rejectPdfAssetManifest(message);
}

async function filesWithin(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesWithin(fullPath)));
    else files.push(fullPath);
  }
  return files;
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const validatedManifest = validatePdfAssetManifest(manifest, repositoryRoot);

const installed = JSON.parse(
  await readFile(
    path.join(repositoryRoot, "node_modules", "pdfjs-dist", "package.json"),
    "utf8",
  ),
);
if (installed.version !== manifest.packageVersion) {
  fail(`installed package is ${installed.version}`);
}

const { destinationRoot, destinations } = validatedManifest;
const verified = [];

if (!verifyOnly) {
  await rm(destinationRoot, { recursive: true, force: true });
}

for (const { asset, source, destination } of validatedManifest.entries) {
  const sourceBytes = await readAndVerifyPdfAssetSource(
    { asset, source },
    readFile,
  );

  if (verifyOnly) {
    let destinationBytes;
    try {
      destinationBytes = await readFile(destination);
    } catch (error) {
      if (error?.code === "ENOENT") fail(`missing copied asset ${asset.destination}`);
      throw error;
    }
    verifyPdfAssetBytes(asset, destinationBytes, asset.destination);
  } else {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, sourceBytes);
  }
  verified.push(asset);
}

const actualDestinations = new Set(
  (await filesWithin(destinationRoot)).map((file) => path.resolve(file)),
);
if (
  actualDestinations.size !== destinations.size ||
  [...actualDestinations].some((file) => !destinations.has(file))
) {
  fail("versioned destination contains missing or unexpected files");
}

const totalBytes = verified.reduce((sum, asset) => sum + asset.bytes, 0);
if (
  manifest.summary?.files !== verified.length ||
  manifest.summary?.bytes !== totalBytes
) {
  fail("manifest summary mismatch");
}
const categoryTotals = [...PDF_ASSET_CATEGORIES]
  .map((category) => {
    const selected = verified.filter((asset) => asset.category === category);
    return `${category}=${selected.length}/${selected.reduce((sum, asset) => sum + asset.bytes, 0)}`;
  })
  .join(", ");
process.stdout.write(
  `${verifyOnly ? "Verified" : "Prepared"} PDF.js ${manifest.packageVersion}: ${verified.length} files, ${totalBytes} bytes (${categoryTotals}).\n`,
);
