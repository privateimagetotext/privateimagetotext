import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

// Windows Nirmala UI supplies the Indic and Thai glyphs. Only raster PNGs ship
// with the tests; no system font is redistributed or loaded by the website.
const cases = [
  { id: "spa", family: "Latin", text: "El texto permanece en este dispositivo.", font: "Arial" },
  { id: "hin", family: "Devanagari", text: "नमस्ते दुनिया", font: "Nirmala UI" },
  { id: "tha", family: "Thai", text: "ภาษาไทย", font: "Nirmala UI" },
];
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await mkdir("e2e/fixtures/languages", { recursive: true });
  for (const fixture of cases) {
    const url = await page.evaluate(({ text, font }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1500; canvas.height = 260;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "black"; ctx.font = `64px "${font}"`;
      ctx.fillText(text, 60, 150);
      return canvas.toDataURL("image/png");
    }, fixture);
    await writeFile(`e2e/fixtures/languages/${fixture.id}.png`, Buffer.from(url.split(",")[1], "base64"));
  }
  await writeFile("e2e/fixtures/languages/manifest.json", JSON.stringify(cases, null, 2) + "\n");
} finally { await browser.close(); }
