import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync, brotliCompressSync } from "node:zlib";

// Run after a production build (optionally `vite build --sourcemap`). Count
// independently compressed responses, not one concatenated/compressed bundle.
const dist = path.resolve("dist");
const output = process.argv[2] ?? "tmp/route-bundles.json";
const manifest = JSON.parse(await readFile(path.join(dist, ".vite/manifest.json"), "utf8"));
const documents = JSON.parse(await readFile(path.join(dist, "document-manifest.json"), "utf8"));
const chunks = {};
for (const file of (await readdir(path.join(dist, "assets"))).filter(file => file.endsWith(".js"))) {
  const bytes = await readFile(path.join(dist, "assets", file));
  let sources = [];
  try {
    const map = JSON.parse(await readFile(path.join(dist, "assets", `${file}.map`), "utf8"));
    sources = map.sources.map((source, index) => ({ source, originalBytes: Buffer.byteLength(map.sourcesContent?.[index] ?? "") }));
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  chunks[`assets/${file}`] = { raw: bytes.length, gzip: gzipSync(bytes).length, brotli: brotliCompressSync(bytes).length, sources };
}
const routes = {};
for (const route of documents) {
  const html = await readFile(path.join(dist, route.outputFile), "utf8");
  const files = new Set([...html.matchAll(/(?:src|href)="\/(assets\/[^"?]+\.js)"/g)].map(match => match[1]));
  const visit = file => {
    files.add(file);
    const entry = Object.values(manifest).find(entry => entry.file === file);
    for (const key of entry?.imports ?? []) {
      if (!manifest[key]) throw new Error(`Missing manifest import ${key}`);
      if (!files.has(manifest[key].file)) visit(manifest[key].file);
    }
  };
  for (const file of files) visit(file);
  routes[route.path] = { files: [...files], ...Object.fromEntries(["raw", "gzip", "brotli"].map(metric => [metric, [...files].reduce((sum, file) => sum + chunks[file][metric], 0)])) };
}
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ units: "bytes", scope: "HTML entry/modulepreloads and their static imports; excludes on-demand runtimes and background offline preparation", routes, chunks }, null, 2) + "\n");
console.table(Object.entries(routes).map(([route, size]) => ({ route, rawKB: (size.raw / 1000).toFixed(2), gzipKB: (size.gzip / 1000).toFixed(2), brotliKB: (size.brotli / 1000).toFixed(2) })));
console.log(`Wrote ${output}`);
