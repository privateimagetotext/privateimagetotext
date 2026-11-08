import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const packageRoot = path.join(repositoryRoot, "node_modules", "pdfjs-dist");
const publicRoot = path.join(repositoryRoot, "tmp", "pdf-phase0", "public");
const fixtureRoot = path.join(repositoryRoot, "tmp", "pdf-phase0", "fixtures");
const upstreamFixtureRoot = path.join(
  repositoryRoot,
  "tools",
  "pdf-phase0",
  "fixtures",
  "upstream",
);
const pdfRuntimeRoot = "/pdf/6.2.108";

const upstreamFixtures = [
  {
    file: "function_based_shading_cmyk.pdf",
    bytes: 3_266,
    sha256: "c624d33b595af80746dd96f6440d335a30b1bee3e484d9b0b2cfb0cd54c62be3",
  },
  {
    file: "jpx_smaskindata.pdf",
    bytes: 2_515,
    sha256: "a82813559c74f074b0caf92c80875fc018acb737269a2af5508c7e083b2a5fd3",
  },
  {
    file: "jbig2_file_header.pdf",
    bytes: 774,
    sha256: "5edb6045fc86ee5fa8e837685a35a57014764d1f72518e136e5e8f13fcf92c8d",
  },
];

await import("./generate-fixtures.mjs");
await mkdir(publicRoot, { recursive: true });
await mkdir(fixtureRoot, { recursive: true });

for (const fixture of upstreamFixtures) {
  const encoded = await readFile(
    path.join(upstreamFixtureRoot, `${fixture.file}.base64`),
    "utf8",
  );
  const bytes = Buffer.from(encoded.trim(), "base64");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== fixture.bytes || sha256 !== fixture.sha256) {
    throw new Error(`Verified decoder fixture mismatch: ${fixture.file}`);
  }
  await writeFile(path.join(fixtureRoot, fixture.file), bytes);
}

const proposedAssetClasses = ["cmaps", "standard_fonts", "iccs", "wasm"];
const evaluatedOnlyClasses = ["image_decoders"];
const assetClasses = [...proposedAssetClasses, ...evaluatedOnlyClasses];
await rm(path.join(publicRoot, "pdf"), { recursive: true, force: true });
await cp(path.join(repositoryRoot, "public", "pdf"), path.join(publicRoot, "pdf"), {
  recursive: true,
  force: true,
});
await rm(path.join(publicRoot, "ocr"), { recursive: true, force: true });
await cp(path.join(repositoryRoot, "public", "ocr"), path.join(publicRoot, "ocr"), {
  recursive: true,
  force: true,
});

const pdfAssetManifest = JSON.parse(
  await readFile(path.join(repositoryRoot, "scripts", "pdf-assets.manifest.json"), "utf8"),
);
const pdfAssetDeclaration = pdfAssetManifest.assets
  .map(
    (asset) =>
      `  ${JSON.stringify({
        path: asset.runtimePath,
        bytes: asset.bytes,
        sha256: asset.sha256,
        contentType: asset.contentType,
      })},`,
  )
  .join("\n");
const sourceServiceWorker = await readFile(
  path.join(repositoryRoot, "public", "sw.js"),
  "utf8",
);
const pdfAssetPlaceholder = "  // __LOCALTEXT_PDF_CACHE_ASSETS__";
if (!sourceServiceWorker.includes(pdfAssetPlaceholder)) {
  throw new Error("PDF service-worker manifest placeholder is missing.");
}
await writeFile(
  path.join(publicRoot, "sw.js"),
  sourceServiceWorker.replace(pdfAssetPlaceholder, pdfAssetDeclaration),
  "utf8",
);

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

async function inventoryFor(assetClass) {
  const source = path.join(packageRoot, assetClass);
  const files = await filesWithin(source);
  const details = await Promise.all(
    files.map(async (file) => {
      const metadata = await stat(file);
      const bytes = await readFile(file);
      return {
        file: path.relative(packageRoot, file).replaceAll("\\", "/"),
        bytes: metadata.size,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    }),
  );
  return {
    assetClass,
    source: `node_modules/pdfjs-dist/${assetClass}`,
    runtime: `${pdfRuntimeRoot}/${assetClass}/`,
    proposedForPhase1: proposedAssetClasses.includes(assetClass),
    fileCount: details.length,
    totalBytes: details.reduce((sum, item) => sum + item.bytes, 0),
    largest: details.sort((left, right) => right.bytes - left.bytes).slice(0, 5),
  };
}

const packageMetadata = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
const classes = await Promise.all(assetClasses.map(inventoryFor));
const workerPath = path.join(packageRoot, "build", "pdf.worker.min.mjs");
const workerContents = await readFile(workerPath);
const licencePaths = (await filesWithin(packageRoot)).filter((file) =>
  path.basename(file).startsWith("LICENSE"),
);
const licences = await Promise.all(
  licencePaths.map(async (file) => ({
    file: path.relative(packageRoot, file).replaceAll("\\", "/"),
    bytes: (await stat(file)).size,
  })),
);
const inventory = {
  pdfjsVersion: packageMetadata.version,
  generatedAt: new Date().toISOString(),
  worker: {
    source: "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
    runtime: `${pdfRuntimeRoot}/worker/pdf.worker.min.mjs`,
    bytes: workerContents.length,
    sha256: createHash("sha256").update(workerContents).digest("hex"),
    mime: "text/javascript",
  },
  classes,
  licences: {
    files: licences,
    totalBytes: licences.reduce((sum, licence) => sum + licence.bytes, 0),
  },
  totalProposedOfflineBytes:
    workerContents.length +
    classes
      .filter((entry) => entry.proposedForPhase1)
      .reduce((sum, entry) => sum + entry.totalBytes, 0) +
    (await stat(path.join(packageRoot, "LICENSE"))).size,
  mimeRequirements: {
    worker: "text/javascript",
    cmaps: "application/octet-stream",
    standardFonts: "font/ttf, font/otf, or application/octet-stream",
    icc: "application/vnd.iccprofile or application/octet-stream",
    wasm: "application/wasm for .wasm; text/javascript for fallbacks",
  },
};
await writeFile(
  path.join(repositoryRoot, "tmp", "pdf-phase0", "asset-inventory.json"),
  `${JSON.stringify(inventory, null, 2)}\n`,
);
process.stdout.write("Prepared versioned PDF.js, verified decoder, and OCR assets.\n");
