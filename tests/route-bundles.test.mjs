import { webcrypto } from "node:crypto";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import test from "node:test";
import vm from "node:vm";
import { buildAssetAllowlist, staticRouteFiles } from "../scripts/bundle-manifest.mjs";

const manifest = JSON.parse(await readFile("dist/.vite/manifest.json", "utf8"));
const documents = JSON.parse(await readFile("dist/document-manifest.json", "utf8"));
const worker = await readFile("dist/sw.js", "utf8");
const allowlist = buildAssetAllowlist(manifest);

test("every emitted chunk and worker dependency is in the generated offline allowlist", async () => {
  for (const file of await readdir("dist/assets")) {
    if (!/\.(?:js|wasm|css)$/.test(file)) continue;
    assert.ok(allowlist.includes(`/assets/${file}`), `Unlisted output: ${file}`);
    assert.ok(worker.includes(JSON.stringify(`/assets/${file}`)));
  }
  assert.doesNotMatch(worker, /__LOCALTEXT_BUILD_ASSETS__/);
  assert.ok(Object.values(manifest).some(entry => entry.isWorkerEntry));
});

test("initial homepage JavaScript stays within 200,000 gzip bytes", async () => {
  const files = staticRouteFiles(manifest, "src/pages/ToolPage.tsx").filter(file => file.endsWith(".js"));
  const sizes = await Promise.all(files.map(async file => gzipSync(await readFile(`dist/${file}`)).length));
  assert.ok(sizes.reduce((sum, size) => sum + size, 0) <= 200_000, `Initial gzip JS: ${sizes.reduce((sum, size) => sum + size, 0)}`);
});

// The opening of every guide's introduction (plain-ASCII prefix), read from
// the guide body sources, so the check covers each guide and survives edits.
const guideSourceFiles = [
  ...(await readdir("src/config/guide-content")).filter(name => name.endsWith(".ts") && name !== "meta.ts")
    .map(name => `src/config/guide-content/${name}`),
  "src/config/pdf-guide.ts",
];
const guideBodySentences = (await Promise.all(guideSourceFiles.map(async file => {
  const match = (await readFile(file, "utf8")).match(/introduction:\s*(["'`])([^"'`$\\]{40,})/);
  return match && /^[\x20-\x7e]+$/.test(match[2].slice(0, 40)) ? match[2].slice(0, 40) : undefined;
}))).filter(Boolean);

test("guide bodies stay out of the homepage's initial JavaScript and load with the guide route", async () => {
  const read = files => Promise.all(files.filter(file => file.endsWith(".js")).map(file => readFile(`dist/${file}`, "utf8")));
  const homepage = (await read(staticRouteFiles(manifest, "src/pages/ToolPage.tsx"))).join("\n");
  const guideRoute = (await read(staticRouteFiles(manifest, "src/pages/GuidePage.tsx"))).join("\n");
  assert.ok(guideBodySentences.length >= 10, `Too few guide introductions found: ${guideBodySentences.length}`);
  for (const sentence of guideBodySentences) {
    assert.ok(!homepage.includes(sentence), `Guide body text in homepage JS: ${sentence}`);
    assert.ok(guideRoute.includes(sentence), `Guide body text missing from the guide route: ${sentence}`);
  }
});

test("every guide document preloads the guide chunk, and tool visits prepare it for offline guides", async () => {
  const guideFiles = staticRouteFiles(manifest, "src/pages/GuidePage.tsx").map(file => `/${file}`);
  const commonAssets = JSON.parse(worker.match(/const SHELL_COMMON_ASSETS = (\[[^\n]*\]);/)[1]);
  for (const file of guideFiles) assert.ok(commonAssets.includes(file), `Shell common assets omit ${file}`);
  const guides = documents.filter(route => route.routeType === "guide");
  assert.ok(guides.length > 0);
  for (const route of guides) {
    const html = await readFile(`dist/${route.outputFile}`, "utf8");
    assert.ok(html.includes(`href="/${manifest["src/pages/GuidePage.tsx"].file}"`), `${route.path} should preload the guide chunk`);
  }
});

test("direct routes preload their own tool only; documents and guides preload no tool chunk", async () => {
  const toolFiles = ["ToolPage", "HideMessagePage", "MediaInspectorPage", "StegoAnalysisPage", "PdfOcrPage"]
    .map(name => manifest[`src/pages/${name}.tsx`]?.file).filter(Boolean);
  for (const route of documents) {
    const html = await readFile(`dist/${route.outputFile}`, "utf8");
    for (const file of toolFiles) {
      const expected = route.routeType === "tool" && manifest[route.sourceFile]?.file === file;
      assert.equal(html.includes(`href="/${file}"`), expected, `${route.path}: ${file}`);
    }
    assert.doesNotMatch(html, /href="[^"]*(?:steganography\.worker|jpeg-v2-codec|c2pa_bg)[^"]*"/);
  }
  const common = staticRouteFiles(manifest, "index.html");
  for (const file of toolFiles) assert.ok(!common.includes(file));
});

test("manifest traversal rejects absent imports and unsafe paths", () => {
  assert.throws(() => staticRouteFiles({ a: { file: "assets/a.js", imports: ["missing"] } }, "a"), /Missing/);
  assert.throws(() => buildAssetAllowlist({ a: { file: "https://other.test/a.js" } }), /Unsafe/);
  assert.throws(() => buildAssetAllowlist({ a: { file: "assets/../a.js" } }), /Unsafe/);
  assert.throws(() => buildAssetAllowlist({ a: { file: "assets/a.js", dynamicImports: ["missing"] } }), /Missing/);
});

test("OCR cache validation measures decoded bytes for compressed responses", async () => {
  const validate = vm.runInNewContext(`${worker}\nisValidOcrResponse;`, {
    self: { addEventListener() {} }, crypto: webcrypto,
  });
  const response = bytes => new globalThis.Response(bytes, { headers: {
    "Content-Type": "text/javascript", "Content-Encoding": "gzip", "Content-Length": "1000",
  } });
  const bytes = await readFile("public/ocr/worker.min.js");
  assert.equal(await validate("/ocr/worker.min.js", response(bytes)), true);
  bytes[100] ^= 1;
  assert.equal(await validate("/ocr/worker.min.js", response(bytes)), false);
  assert.equal(await validate("/ocr/worker.min.js", response(new Uint8Array(500))), false);
  assert.equal(await validate("/ocr/unknown.js", response(new Uint8Array(110_000))), false);
});
