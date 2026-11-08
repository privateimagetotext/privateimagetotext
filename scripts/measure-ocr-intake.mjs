import { chromium } from "@playwright/test";
import { Resvg } from "@resvg/resvg-js";
import { mkdir, writeFile } from "node:fs/promises";

// Run against an already built preview, before and after changing the UI.
// Baseline timings use the earliest possible scripted click, excluding human
// reading/scrolling delay; passive baseline has no automatic time-to-text.
const mode = process.argv[2];
if (!["before", "after"].includes(mode)) throw new Error("Use before or after");
const baseURL = process.env.OCR_INTAKE_URL ?? "http://127.0.0.1:4185";
const buffer = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="320">
  <rect width="900" height="320" fill="white"/>
  <g font-family="Arial" font-size="36" fill="black">
    <text x="40" y="90">Local OCR timing test</text>
    <text x="40" y="155">Invoice number 7429</text>
    <text x="40" y="220">Total due 125 dollars</text>
  </g></svg>`).render().asPng();
const browser = await chromium.launch();
const trials = [];
try {
  let passiveObservation;
  for (let trial = mode === "before" ? -1 : 0; trial < 3; trial += 1) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(baseURL);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate((bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], "timing-900x320.png", { type: "image/png" }));
      window.ocrTiming = { start: performance.now(), firstTextMs: null, clickMs: null };
      const check = () => {
        if (document.querySelector(".result-editor textarea")?.value?.trim()) {
          window.ocrTiming.firstTextMs = performance.now() - window.ocrTiming.start;
        } else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
      document.querySelector(".dropzone").dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
    }, [...buffer]);
    if (mode === "before") {
      const extract = page.getByRole("button", { name: "Extract text", exact: true });
      await extract.waitFor();
      if (trial === -1) {
        await page.waitForTimeout(3000);
        if (await page.locator(".result-editor textarea").count()) throw new Error("Baseline unexpectedly auto-ran");
        passiveObservation = "No text after 3 seconds without clicking";
        console.log(passiveObservation);
        await context.close();
        continue;
      }
      await extract.click();
      await page.evaluate(() => { window.ocrTiming.clickMs = performance.now() - window.ocrTiming.start; });
    }
    await page.waitForFunction(() => window.ocrTiming.firstTextMs !== null, undefined, { timeout: 120_000 });
    trials.push({ trial: trial + 1, ...await page.evaluate(() => window.ocrTiming), text: await page.locator(".result-editor textarea").inputValue() });
    await context.close();
  }
} finally { await browser.close(); }
const report = {
  mode, measuredAt: new Date().toISOString(), browser: "Playwright Chromium", viewport: "1280x800",
  image: "900x320 synthetic printed text", cache: "fresh browser context per trial, local preview",
  ...(mode === "before" ? { passiveObservation: "Separate passive trial: no text after 3 seconds without clicking. All timed trials start at drop; script clicks as soon as possible, including automatic scroll." } : {}),
  trials, medianMs: [...trials].sort((a, b) => a.firstTextMs - b.firstTextMs)[1].firstTextMs,
};
await mkdir("tmp/ocr-intake", { recursive: true });
await writeFile(`tmp/ocr-intake/${mode}.json`, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
