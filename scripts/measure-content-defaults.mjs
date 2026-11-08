import { chromium } from "@playwright/test";
import ts from "typescript";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Deterministic thumbnail fixtures for unit tests, plus real browser readback timing.
// No network: all inputs and the production heuristic are read from this checkout.
const fixtures = [
  { name: "screenshot", path: "e2e/fixtures/ocr-corpus/clean-screenshot.png", mime: "image/png" },
  { name: "phone-page", path: "tests/fixtures/content-defaults/phone-page.jpg", mime: "image/jpeg" },
  { name: "terminal", path: "e2e/fixtures/ocr-corpus/code-terminal.png", mime: "image/png" },
];
const source = await readFile("src/features/ocr/content-defaults.ts", "utf8");
const moduleText = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const browser = await chromium.launch();
const report = { measuredAt: new Date().toISOString(), browser: browser.version(),
  method: "50 warmed trials after 10 warm-ups; cold is first call per fixture. Includes thumbnail canvas draw/readback and classification; excludes source decoding, preview preparation and OCR.", fixtures: [] };
try {
  const page = await browser.newPage();
  for (const fixture of fixtures) {
    const bytes = await readFile(fixture.path);
    const measured = await page.evaluate(async ({ imageUrl, moduleText }) => {
      const { suggestContentDefaults, CONTENT_SAMPLE_SIDE } = await import(`data:text/javascript;base64,${btoa(moduleText)}`);
      const image = new Image();
      image.src = imageUrl;
      await image.decode();
      const preview = document.createElement("canvas");
      const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
      preview.width = Math.round(image.naturalWidth * scale);
      preview.height = Math.round(image.naturalHeight * scale);
      preview.getContext("2d").drawImage(image, 0, 0, preview.width, preview.height);
      const start = performance.now();
      const decision = suggestContentDefaults(preview);
      const coldMs = performance.now() - start;
      for (let index = 0; index < 10; index++) suggestContentDefaults(preview);
      const times = [];
      for (let index = 0; index < 50; index++) {
        const started = performance.now();
        suggestContentDefaults(preview);
        times.push(performance.now() - started);
      }
      times.sort((a, b) => a - b);
      const sample = document.createElement("canvas");
      const sampleScale = Math.min(1, CONTENT_SAMPLE_SIDE / Math.max(preview.width, preview.height));
      sample.width = Math.round(preview.width * sampleScale);
      sample.height = Math.round(preview.height * sampleScale);
      const context = sample.getContext("2d", { alpha: false });
      context.fillStyle = "white";
      context.fillRect(0, 0, sample.width, sample.height);
      context.drawImage(preview, 0, 0, sample.width, sample.height);
      return { decision, coldMs, medianMs: times[25], p95Ms: times[47],
        source: [image.naturalWidth, image.naturalHeight], width: sample.width, height: sample.height,
        pixels: [...context.getImageData(0, 0, sample.width, sample.height).data] };
    }, { imageUrl: `data:${fixture.mime};base64,${bytes.toString("base64")}`, moduleText });
    const { pixels, ...summary } = measured;
    // Uncompressed, top-down 32-bit BMP avoids introducing a decoder dependency.
    const bmp = Buffer.alloc(54 + pixels.length);
    bmp.write("BM"); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10);
    bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(measured.width, 18); bmp.writeInt32LE(-measured.height, 22);
    bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(32, 28); bmp.writeUInt32LE(pixels.length, 34);
    for (let offset = 0; offset < pixels.length; offset += 4) {
      bmp[54 + offset] = pixels[offset + 2]; bmp[55 + offset] = pixels[offset + 1];
      bmp[56 + offset] = pixels[offset]; bmp[57 + offset] = 255;
    }
    const fixturePath = `tests/fixtures/content-defaults/${fixture.name}.bmp`;
    if (process.argv.includes("--refresh-fixtures")) await writeFile(fixturePath, bmp);
    else if (!(await readFile(fixturePath)).equals(bmp)) throw new Error(`Thumbnail drift: ${fixturePath}`);
    report.fixtures.push({ ...fixture, sha256: createHash("sha256").update(bytes).digest("hex"), ...summary });
  }
} finally { await browser.close(); }
await writeFile("docs/d2-content-defaults-timing.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
