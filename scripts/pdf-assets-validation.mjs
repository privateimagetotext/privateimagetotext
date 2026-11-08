import { createHash } from "node:crypto";
import path from "node:path";

export const PDF_ASSET_CATEGORIES = new Set([
  "api",
  "worker",
  "cmap",
  "standard-font",
  "icc",
  "wasm",
  "licence",
]);

export const PDF_ASSET_CONTENT_TYPES = new Set([
  "text/javascript",
  "application/wasm",
  "application/octet-stream",
  "font/ttf",
  "font/otf",
  "text/plain",
]);

export function rejectPdfAssetManifest(message) {
  throw new Error(`PDF asset manifest rejected: ${message}`);
}

export function pdfAssetSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isWithin(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

export function validatePdfAssetManifest(manifest, repositoryRoot) {
  if (manifest.schemaVersion !== 1) rejectPdfAssetManifest("unknown schema version");
  if (manifest.package !== "pdfjs-dist" || manifest.packageVersion !== "6.2.108") {
    rejectPdfAssetManifest("package identity/version mismatch");
  }
  if (manifest.runtimeRoot !== "/pdf/6.2.108/") {
    rejectPdfAssetManifest("unexpected runtime root");
  }
  if (manifest.cacheVersion !== "localtext-pdf-v1-pdfjs-6.2.108") {
    rejectPdfAssetManifest("unexpected cache version");
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    rejectPdfAssetManifest("empty asset set");
  }

  const packageRoot = path.resolve(repositoryRoot, "node_modules", "pdfjs-dist");
  const destinationRoot = path.resolve(repositoryRoot, "public", "pdf", "6.2.108");
  const runtimePaths = new Set();
  const destinations = new Set();
  const entries = manifest.assets.map((asset) => {
    if (
      typeof asset.source !== "string" ||
      !asset.source.startsWith("node_modules/pdfjs-dist/")
    ) {
      rejectPdfAssetManifest("source outside pdfjs-dist");
    }
    if (
      typeof asset.destination !== "string" ||
      !asset.destination.startsWith("public/pdf/6.2.108/")
    ) {
      rejectPdfAssetManifest("destination outside the versioned PDF root");
    }
    if (
      typeof asset.runtimePath !== "string" ||
      !asset.runtimePath.startsWith(manifest.runtimeRoot) ||
      asset.runtimePath.includes("?") ||
      asset.runtimePath.includes("#") ||
      asset.runtimePath.split("/").includes("..")
    ) {
      rejectPdfAssetManifest("unsafe runtime path");
    }
    if (!PDF_ASSET_CATEGORIES.has(asset.category)) {
      rejectPdfAssetManifest("unknown category");
    }
    if (!PDF_ASSET_CONTENT_TYPES.has(asset.contentType)) {
      rejectPdfAssetManifest("invalid MIME declaration");
    }
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0) {
      rejectPdfAssetManifest("invalid byte length");
    }
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
      rejectPdfAssetManifest("invalid SHA-256");
    }
    if (asset.offlineRequired !== true) {
      rejectPdfAssetManifest("asset is not marked offline-required");
    }
    if (runtimePaths.has(asset.runtimePath)) {
      rejectPdfAssetManifest("duplicate runtime path");
    }
    runtimePaths.add(asset.runtimePath);

    const source = path.resolve(repositoryRoot, asset.source);
    const destination = path.resolve(repositoryRoot, asset.destination);
    if (!isWithin(source, packageRoot)) rejectPdfAssetManifest("source path traversal");
    if (!isWithin(destination, destinationRoot)) {
      rejectPdfAssetManifest("destination path traversal");
    }
    if (destinations.has(destination)) rejectPdfAssetManifest("duplicate destination");
    destinations.add(destination);
    return { asset, source, destination };
  });

  return { packageRoot, destinationRoot, destinations, entries };
}

export function verifyPdfAssetBytes(asset, bytes, label = asset.source) {
  if (bytes.length !== asset.bytes) {
    rejectPdfAssetManifest(`byte mismatch for ${label}`);
  }
  if (pdfAssetSha256(bytes) !== asset.sha256) {
    rejectPdfAssetManifest(`hash mismatch for ${label}`);
  }
}

export async function readAndVerifyPdfAssetSource(entry, readBytes) {
  let bytes;
  try {
    bytes = await readBytes(entry.source);
  } catch (error) {
    if (error?.code === "ENOENT") rejectPdfAssetManifest("missing source file");
    throw error;
  }
  verifyPdfAssetBytes(entry.asset, bytes);
  return bytes;
}
