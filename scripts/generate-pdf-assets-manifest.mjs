import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const packageRoot = path.join(repositoryRoot, "node_modules", "pdfjs-dist");
const manifestPath = path.join(repositoryRoot, "scripts", "pdf-assets.manifest.json");
const packageVersion = "6.2.108";
const runtimeRoot = `/pdf/${packageVersion}/`;
const destinationRoot = `public/pdf/${packageVersion}/`;

const directoryCategories = new Map([
  ["cmaps", "cmap"],
  ["standard_fonts", "standard-font"],
  ["iccs", "icc"],
  ["wasm", "wasm"],
]);
const excludedRuntimeFiles = new Set([
  "wasm/quickjs-eval.js",
  "wasm/quickjs-eval.wasm",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function contentTypeFor(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".mjs" || extension === ".js") return "text/javascript";
  if (extension === ".wasm") return "application/wasm";
  if (extension === ".ttf") return "font/ttf";
  if (extension === ".otf") return "font/otf";
  if (extension === ".txt") return "text/plain";
  return "application/octet-stream";
}

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

async function entryFor(sourceRelative, destinationRelative, category, licence) {
  const sourcePath = path.join(repositoryRoot, sourceRelative);
  const bytes = await readFile(sourcePath);
  return {
    source: sourceRelative.replaceAll("\\", "/"),
    destination: destinationRelative.replaceAll("\\", "/"),
    runtimePath: `/${destinationRelative.replaceAll("\\", "/").replace(/^public\//, "")}`,
    bytes: bytes.length,
    sha256: sha256(bytes),
    contentType: contentTypeFor(destinationRelative),
    category,
    offlineRequired: true,
    licence,
  };
}

const packageMetadata = JSON.parse(
  await readFile(path.join(packageRoot, "package.json"), "utf8"),
);
if (packageMetadata.version !== packageVersion) {
  throw new Error(
    `Expected pdfjs-dist ${packageVersion}, received ${packageMetadata.version}.`,
  );
}

const assets = [
  await entryFor(
    "node_modules/pdfjs-dist/build/pdf.mjs",
    `${destinationRoot}api/pdf.mjs`,
    "api",
    "PDFJS-LICENSE.txt",
  ),
  await entryFor(
    "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
    `${destinationRoot}worker/pdf.worker.min.mjs`,
    "worker",
    "PDFJS-LICENSE.txt",
  ),
  await entryFor(
    "node_modules/pdfjs-dist/LICENSE",
    `${destinationRoot}PDFJS-LICENSE.txt`,
    "licence",
    "PDFJS-LICENSE.txt",
  ),
];

for (const [directory, category] of directoryCategories) {
  const sourceDirectory = path.join(packageRoot, directory);
  for (const file of await filesWithin(sourceDirectory)) {
    const withinPackage = path.relative(packageRoot, file).replaceAll("\\", "/");
    if (excludedRuntimeFiles.has(withinPackage)) continue;
    const filename = path.basename(file);
    assets.push(
      await entryFor(
        `node_modules/pdfjs-dist/${withinPackage}`,
        `${destinationRoot}${withinPackage}`,
        filename.startsWith("LICENSE") ? "licence" : category,
        filename.startsWith("LICENSE")
          ? withinPackage
          : category === "cmap"
            ? "cmaps/LICENSE"
            : category === "standard-font"
              ? "standard_fonts/LICENSE_FOXIT and LICENSE_LIBERATION"
              : category === "icc"
                ? "iccs/LICENSE"
                : "wasm/LICENSE_*",
      ),
    );
  }
}

assets.sort((left, right) => left.runtimePath.localeCompare(right.runtimePath));
const categories = Object.fromEntries(
  [...new Set(assets.map((asset) => asset.category))]
    .sort()
    .map((category) => {
      const selected = assets.filter((asset) => asset.category === category);
      return [
        category,
        {
          files: selected.length,
          bytes: selected.reduce((sum, asset) => sum + asset.bytes, 0),
        },
      ];
    }),
);
const manifest = {
  schemaVersion: 1,
  package: "pdfjs-dist",
  packageVersion,
  packageBuild: "0365cbde028bd92e58f2dab1bb70cd30ac7acfd7",
  runtimeRoot,
  cacheVersion: `localtext-pdf-v1-pdfjs-${packageVersion}`,
  assets,
  summary: {
    files: assets.length,
    bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
    categories,
  },
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(
  `Generated reviewed PDF asset manifest for ${manifest.summary.files} files / ${manifest.summary.bytes} bytes.\n`,
);
