import { Resvg } from "@resvg/resvg-js";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// Original synthetic text, drawn directly so the shipped OCR input has exact,
// reviewable lettering. Uses the same local font rendering as the OCR fixtures.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="400">
  <rect width="900" height="400" fill="white"/>
  <g fill="#172033" font-family="Arial" font-size="28">
    <text x="40" y="64" font-size="32" font-weight="bold">A little text to try</text>
    <text x="40" y="120">Turn a picture into editable text in your browser.</text>
    <text x="40" y="160">Check the result, then copy the parts you need.</text>
    <text x="40" y="220">Reference: OCR-7429    Amount: $125.50</text>
  </g>
  <g fill="#172033" font-family="Courier New" font-size="26">
    <text x="40" y="300">$ npm run build</text>
    <text x="40" y="340">Build complete: 3 files ready.</text>
  </g>
</svg>`;
const png = new Resvg(svg).render().asPng();
if (png.length > 120_000) throw new Error("The bundled sample exceeds 120 KB.");
const samplePath = new URL("../public/samples/sample.png", import.meta.url);
await writeFile(samplePath, png);

const manifestPath = new URL("../public/samples/manifest.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const entry = {
  path: "/samples/sample.png",
  source: "public/samples/sample.png",
  generator: "scripts/generate-ocr-sample.mjs",
  width: 900,
  height: 400,
  bytes: png.length,
  sha256: createHash("sha256").update(png).digest("hex"),
};
manifest.samples = [...manifest.samples.filter((sample) => sample.path !== entry.path), entry];
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated sample.png: 900 x 400, ${png.length} bytes`);
