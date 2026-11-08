import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(path.join(root, "scripts/jpeg-v2-assets.manifest.json"), "utf8"),
);

async function verifyFile(entry) {
  const absolute = path.join(root, entry.path);
  const [bytes, details] = await Promise.all([readFile(absolute), stat(absolute)]);
  if (details.size !== entry.bytes) {
    throw new Error(`JPEG v2 asset size mismatch: ${entry.path}`);
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== entry.sha256) {
    throw new Error(`JPEG v2 asset checksum mismatch: ${entry.path}`);
  }
  return bytes;
}

const archiveBytes = await verifyFile({
  path: manifest.libjpegTurbo.archive,
  bytes: manifest.libjpegTurbo.archiveBytes,
  sha256: manifest.libjpegTurbo.archiveSha256,
});
archiveBytes.fill(0);
await verifyFile(manifest.libjpegTurbo.license);
await verifyFile(manifest.wrapper);

for (const asset of manifest.assets) {
  const bytes = await verifyFile(asset);
  if (asset.path.endsWith(".wasm")) {
    const module = new WebAssembly.Module(bytes);
    const imports = WebAssembly.Module.imports(module);
    if (
      imports.some(
        (entry) =>
          entry.module !== "a" ||
          entry.kind !== "function" ||
          /wasi|socket|memory|thread/i.test(`${entry.module}:${entry.name}`),
      )
    ) {
      throw new Error("JPEG v2 WASM has an unreviewed import surface");
    }
  }
}

console.log("JPEG v2 pinned assets verified.");
