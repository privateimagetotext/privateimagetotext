import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { locationExampleJpeg } from "./guide-location-fixture.mjs";

// Real browser operations only: no mocked recognition or inspector results.
// Start the local site first; GUIDE_BASE_URL can select a production preview.
const baseURL = process.env.GUIDE_BASE_URL || "http://127.0.0.1:4174";
const group = process.argv[2] || "steganography";
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1, colorScheme: "dark", reducedMotion: "reduce" });
const page = await context.newPage();
const converter = await context.newPage();
const records = [];
await mkdir("tmp/guide-evidence", { recursive: true });

async function figure(locator, slug, filename) {
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("Manrope");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
  const png = await locator.screenshot({ animations: "disabled" });
  const { guideFigureQuality } = await import("./guide-figure-quality.mjs");
  const quality = guideFigureQuality(`/guides/${slug}/${filename}.webp`);
  const result = await converter.evaluate(async ({ data, quality }) => {
    const bitmap = await createImageBitmap(await (await fetch(data)).blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    return { data: canvas.toDataURL("image/webp", quality), width: canvas.width, height: canvas.height };
  }, { data: `data:image/png;base64,${png.toString("base64")}`, quality });
  const bytes = Buffer.from(result.data.split(",")[1], "base64");
  if (bytes.length > 150_000) throw new Error(`Figure too large: ${filename}: ${bytes.length}`);
  const src = `/guides/${slug}/${filename}.webp`;
  await mkdir(path.dirname(`public${src}`), { recursive: true });
  await writeFile(`public${src}`, bytes);
  const record = { src, width: result.width, height: result.height, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), encodedQuality: quality };
  records.push(record); console.log(record);
  return record;
}

// Captures a page region spanning several elements, such as a header status
// button and its absolutely positioned explanation.
async function figureUnion(locators, slug, filename, padding = 12) {
  const boxes = await Promise.all(locators.map((locator) => locator.boundingBox()));
  if (boxes.some((box) => box === null)) throw new Error(`figureUnion: an element for ${filename} is not visible`);
  const left = Math.max(0, Math.min(...boxes.map((box) => box.x)) - padding);
  const top = Math.max(0, Math.min(...boxes.map((box) => box.y)) - padding);
  const right = Math.max(...boxes.map((box) => box.x + box.width)) + padding;
  const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + padding;
  return figure({ screenshot: (options) => page.screenshot({ ...options, clip: { x: left, y: top, width: right - left, height: bottom - top } }) }, slug, filename);
}

try {
  if (group === "steganography") {
    await page.goto(`${baseURL}/hide-message`);
    await page.locator('input[type="file"]').setInputFiles("tests/fixtures/jpeg-v2/libjpeg-testorig.jpg");
    await expect(page.getByText(/Message size:/)).toBeVisible();
    await figure(page.locator(".steg-source-preview"), "share-image-with-hidden-message", "cover");
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Meet by the rose garden at 10:30.");
    await page.getByLabel("Password", { exact: true }).fill("rose garden example 2026");
    await page.getByLabel("Confirm password").fill("rose garden example 2026");
    await page.getByRole("button", { name: "Create PNG with hidden message", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Download your hidden-message image" })).toBeVisible({ timeout: 60_000 });
    await figure(page.locator(".steg-result img"), "share-image-with-hidden-message", "generated");
    await figure(page.locator(".steg-result"), "hide-message-in-image", "created");
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PNG", exact: true }).click();
    const download = await pending;
    await mkdir("tmp/guide-evidence", { recursive: true });
    await download.saveAs("tmp/guide-evidence/rose-hidden.png");
    await page.getByRole("radio", { name: /Reveal a message/ }).check();
    await page.locator('input[type="file"]').setInputFiles("tmp/guide-evidence/rose-hidden.png");
    await page.getByLabel("Password", { exact: true }).fill("rose garden example 2026");
    await page.getByRole("button", { name: "Reveal message", exact: true }).click();
    await expect(page.getByLabel("Message text")).toHaveValue("Meet by the rose garden at 10:30.");
    await figure(page.locator(".steg-result"), "reveal-hidden-message-from-image", "revealed");
    records.push({ result: "Password-protected downloaded PNG reopened and revealed exactly", message: "Meet by the rose garden at 10:30.", source: "tests/fixtures/jpeg-v2/libjpeg-testorig.jpg", outputSha256: createHash("sha256").update(await readFile("tmp/guide-evidence/rose-hidden.png")).digest("hex") });
  } else if (group === "ocr") {
    for (const mode of ["document", "code"]) {
      await page.goto(`${baseURL}/`);
      await page.getByLabel("Choose image file", { exact: true }).setInputFiles("e2e/fixtures/ocr-corpus/code-terminal.png");
      await page.getByLabel(/^Content type/).selectOption(mode);
      await page.getByLabel(/^Enhancement/).selectOption("original");
      await page.getByRole("button", { name: "Re-run OCR", exact: true }).click();
      const result = page.getByRole("textbox", { name: /^Tidied/ });
      await expect(result).toHaveValue(/ERR-4097/, { timeout: 120_000 });
      const tidied = await result.inputValue();
      await figure(page.locator(".result-editor"), "improve-ocr-accuracy", mode);
      await page.getByRole("button", { name: "Original OCR", exact: true }).click();
      const raw = await page.getByRole("textbox", { name: "Original OCR", exact: true }).inputValue();
      records.push({ source: "e2e/fixtures/ocr-corpus/code-terminal.png", mode, enhancement: "original", raw, tidied });
    }
  } else if (group === "pdf") {
    const { default: PDFDocument } = await import("pdfkit");
    const chunks = [];
    const document = new PDFDocument({ size: "A4", margin: 60 });
    const finished = new Promise((resolve, reject) => { document.on("data", chunk => chunks.push(chunk)); document.on("end", resolve); document.on("error", reject); });
    document.fontSize(20).text("LOCAL PDF EXAMPLE");
    document.moveDown().fontSize(12).text("Reference: PDF-2048\nThis synthetic document contains selectable text.\nCheck the source before exporting.");
    document.end(); await finished;
    await writeFile("tmp/guide-evidence/example.pdf", Buffer.concat(chunks));
    await page.goto(`${baseURL}/pdf-to-text`);
    await page.getByLabel("Choose one PDF").setInputFiles("tmp/guide-evidence/example.pdf");
    await expect(page.getByRole("button", { name: "Process selected pages", exact: true })).toBeEnabled({ timeout: 60_000 });
    await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
    const result = page.getByLabel("Editable text for page 1");
    await expect(result).toHaveValue(/PDF-2048/, { timeout: 60_000 });
    await figure(result, "pdf-to-text", "page-text");
    records.push({ source: "Synthetic one-page selectable PDF generated by this script", result: await result.inputValue() });
  } else if (group === "remaining-ocr") {
    const examples = [
      { slug: "copy-error-message-from-image", input: "e2e/fixtures/ocr-corpus/code-terminal.png", mode: "code", preset: "original" },
      { slug: "private-ocr-for-sensitive-documents", input: "e2e/fixtures/ocr-corpus/clean-screenshot.png", mode: "screenshot", preset: "original" },
      { slug: "photo-scan-to-text", input: "e2e/fixtures/ocr-corpus/uneven-lighting.png", mode: "document", preset: "adaptive-document" },
      { slug: "receipt-to-text", input: "e2e/fixtures/ocr-corpus/receipt.png", mode: "document", preset: "original" },
    ];
    for (const example of examples) {
      await page.goto(`${baseURL}/`);
      await page.getByLabel("Choose image file", { exact: true }).setInputFiles(example.input);
      await page.getByLabel(/^Content type/).selectOption(example.mode);
      await page.getByLabel(/^Enhancement/).selectOption(example.preset);
      await page.getByRole("button", { name: "Re-run OCR", exact: true }).click();
      const result = page.getByRole("textbox", { name: /^Tidied/ });
      await expect(result).not.toHaveValue("", { timeout: 120_000 });
      await figure(page.locator(".result-editor"), example.slug, "recognised-text");
      records.push({ ...example, tidied: await result.inputValue() });
    }
  } else if (group === "preview") {
    await page.goto(`${baseURL}/guides/screenshot-to-text`);
    await page.evaluate(() => document.fonts.ready);
    await page.locator(".guide-figures img").scrollIntoViewIfNeeded();
    await expect(page.locator(".guide-figures img")).toBeVisible();
    await expect.poll(() => page.locator(".guide-figures img").evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await page.screenshot({ path: "tmp/guide-evidence/screenshot-guide-full.png", fullPage: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: "tmp/guide-evidence/screenshot-guide-preview.png" });
    records.push({ result: "Screenshot guide loaded with its real figure", url: `${baseURL}/guides/screenshot-to-text` });
  } else if (group === "screenshot") {
    await page.goto(`${baseURL}/`);
    await page.getByRole("button", { name: "Screenshot", exact: true }).click();
    await expect(page.getByRole("textbox", { name: /^Tidied/ })).toHaveValue(/SCREEN-7429/, { timeout: 120_000 });
    await figure(page.locator(".result-editor"), "screenshot-to-text", "recognised-text");
    records.push({ source: "public/samples/clean-screenshot.png", action: "Screenshot sample button", tidied: await page.getByRole("textbox", { name: /^Tidied/ }).inputValue() });
  } else if (group === "inspector") {
    const fixturePath = "tmp/guide-evidence/CA.jpg";
    const expectedHash = "e71bff58fc57640803e6e65f7534e2fb0c2f99018c85276cc14b30f04427cc76";
    let fixture;
    try { fixture = await readFile(fixturePath); } catch {
      const response = await fetch("https://raw.githubusercontent.com/contentauth/c2pa-rs/main/sdk/tests/fixtures/CA.jpg");
      if (!response.ok) throw new Error("Public C2PA fixture unavailable");
      fixture = Buffer.from(await response.arrayBuffer());
    }
    if (createHash("sha256").update(fixture).digest("hex") !== expectedHash) throw new Error("C2PA fixture changed; review source and guide claims before recapturing");
    await writeFile(fixturePath, fixture);
    await page.goto(`${baseURL}/media-inspector`);
    await page.getByLabel("Choose a media file to inspect").setInputFiles("tmp/guide-evidence/CA.jpg");
    await expect(page.getByText("Inspection complete", { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("tab", { name: "Origin & AI clues" }).click();
    await expect(page.locator(".credential-details")).toBeVisible({ timeout: 60_000 });
    await figure(page.locator(".provenance-result"), "check-image-ai-metadata-content-credentials", "credential-result");
    const reportPending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download JSON report" }).click();
    const reportDownload = await reportPending;
    await reportDownload.saveAs("tmp/guide-evidence/credential-report.json");
    const report = JSON.parse(await readFile("tmp/guide-evidence/credential-report.json", "utf8"));
    records.push({ source: "https://github.com/contentauth/c2pa-rs/blob/main/sdk/tests/fixtures/CA.jpg", sourceSha256: createHash("sha256").update(await readFile("tmp/guide-evidence/CA.jpg")).digest("hex"), provenance: report.provenance });
    // Add a harmless text metadata field to an existing synthetic PNG fixture.
    const source = await readFile("e2e/fixtures/localtext-ocr.png");
    const payload = Buffer.from("Comment\0Guide example: private meeting location", "latin1");
    const chunk = Buffer.alloc(payload.length + 12);
    chunk.writeUInt32BE(payload.length); chunk.write("tEXt", 4, "ascii"); payload.copy(chunk, 8);
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4, -4)) { crc ^= byte; for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
    await writeFile("tmp/guide-evidence/metadata-example.png", Buffer.concat([source.subarray(0, -12), chunk, source.subarray(-12)]));
    await page.locator('input[type="file"]').setInputFiles("tmp/guide-evidence/metadata-example.png");
    await expect(page.getByText("Inspection complete", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Raw metadata" }).click();
    await expect(page.getByText("Guide example: private meeting location", { exact: true })).toBeVisible();
    await figure(page.getByRole("tabpanel"), "view-photo-metadata", "raw-metadata");
    await expect(page.getByRole("button", { name: "Create metadata-removed copy", exact: true })).toBeEnabled({ timeout: 60_000 });
    await page.getByRole("button", { name: "Create metadata-removed copy", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Metadata-removed copy is ready" })).toBeVisible({ timeout: 60_000 });
    await figure(page.locator(".clean-copy-result"), "remove-photo-metadata-before-sharing", "verified-copy");
    const cleanPending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download metadata-removed copy", exact: true }).click();
    await (await cleanPending).saveAs("tmp/guide-evidence/metadata-example-clean.png");
    await page.locator('input[type="file"]').setInputFiles("tmp/guide-evidence/metadata-example-clean.png");
    await expect(page.getByText("Inspection complete", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Origin & AI clues" }).click();
    await expect(page.getByRole("heading", { name: "No embedded Content Credential found" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("tab", { name: "Raw metadata" }).click();
    await expect(page.getByText("Guide example: private meeting location", { exact: true })).toHaveCount(0);
    records.push({ source: "Synthetic PNG with a Comment text chunk", result: "Downloaded clean copy reopened; comment absent and no embedded Content Credential found", outputSha256: createHash("sha256").update(await readFile("tmp/guide-evidence/metadata-example-clean.png")).digest("hex") });
  } else if (group === "location") {
    // Synthetic GPS sample: libjpeg test photograph plus EXIF pointing at a public park.
    const sourcePath = "tmp/guide-evidence/location-example.jpg";
    await writeFile(sourcePath, locationExampleJpeg(await readFile("tests/fixtures/jpeg-v2/libjpeg-testorig.jpg")));
    const slug = "check-photo-location-before-posting";
    await page.goto(`${baseURL}/media-inspector`);
    await page.getByLabel("Choose a media file to inspect").setInputFiles(sourcePath);
    await expect(page.getByText("Inspection complete", { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("tab", { name: /^Privacy/ }).click();
    await expect(page.getByRole("heading", { name: "Location information is embedded" })).toBeVisible();
    await figure(page.getByRole("tabpanel"), slug, "privacy-findings");
    await page.getByRole("tab", { name: "Raw metadata" }).click();
    await page.getByRole("searchbox", { name: "Filter metadata fields" }).fill("gps");
    await expect(page.getByText("-31.960555555555555", { exact: true })).toBeVisible();
    await figure(page.getByRole("tabpanel"), slug, "gps-fields");
    const gpsFields = await page.getByRole("tabpanel").innerText();
    await page.getByRole("searchbox", { name: "Filter metadata fields" }).fill("");
    await expect(page.getByRole("button", { name: "Create metadata-removed copy", exact: true })).toBeEnabled({ timeout: 60_000 });
    await page.getByRole("button", { name: "Create metadata-removed copy", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Metadata-removed copy is ready" })).toBeVisible({ timeout: 60_000 });
    const cleanPending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download metadata-removed copy", exact: true }).click();
    await (await cleanPending).saveAs("tmp/guide-evidence/location-example-clean.jpg");
    await page.locator('input[type="file"]').setInputFiles("tmp/guide-evidence/location-example-clean.jpg");
    await expect(page.getByText("Inspection complete", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: /^Privacy/ }).click();
    await expect(page.getByRole("heading", { name: "No recognised privacy fields were found" })).toBeVisible();
    await figure(page.getByRole("tabpanel"), slug, "clean-copy-privacy");
    await page.getByRole("tab", { name: "Raw metadata" }).click();
    await expect(page.getByRole("tabpanel").getByText("jpeg.app0", { exact: true })).toBeVisible();
    await page.getByRole("searchbox", { name: "Filter metadata fields" }).fill("gps");
    await expect(page.getByRole("tabpanel").getByText(/^0 of \d+ fields shown$/)).toBeVisible();
    await expect(page.getByRole("tabpanel").getByText(/GPS/)).toHaveCount(0);
    records.push({
      source: "tests/fixtures/jpeg-v2/libjpeg-testorig.jpg plus synthetic EXIF (scripts/guide-location-fixture.mjs)",
      sourceSha256: createHash("sha256").update(await readFile(sourcePath)).digest("hex"),
      gpsFields,
      result: "Downloaded metadata-removed copy reopened; no recognised privacy fields and no GPS fields",
      outputSha256: createHash("sha256").update(await readFile("tmp/guide-evidence/location-example-clean.jpg")).digest("hex"),
    });
  } else if (group === "offline") {
    const slug = "offline-ocr-without-internet";
    const header = page.locator(".header-offline-status summary");
    await page.goto(`${baseURL}/`);
    const prepare = page.getByRole("button", { name: "Prepare offline OCR", exact: true });
    await prepare.scrollIntoViewIfNeeded();
    await expect(prepare).toBeEnabled({ timeout: 60_000 });
    await prepare.click();
    await expect(header).toHaveText("Image OCR offline: ready for English", { timeout: 120_000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await header.click();
    const explanation = page.locator(".header-offline-status p");
    await expect(explanation).toBeVisible();
    await figureUnion([header, explanation], slug, "ready-status");
    records.push({ header: await header.innerText(), explanation: await explanation.innerText() });
    await header.click();
    const requests = [];
    page.on("request", (request) => requests.push(request.url()));
    await context.setOffline(true);
    await page.reload();
    await page.getByLabel("Choose image file", { exact: true }).setInputFiles("e2e/fixtures/ocr-corpus/clean-screenshot.png");
    const result = page.getByRole("textbox", { name: /^Tidied/ });
    await expect(result).toHaveValue(/SCREEN-7429/, { timeout: 120_000 });
    await expect(header).toHaveText("Image OCR offline: ready for English");
    await figureUnion([page.locator(".trust-markers"), page.getByRole("heading", { name: "Recognised text" }), result], slug, "offline-result");
    const origin = new URL(baseURL).origin;
    records.push({
      source: "e2e/fixtures/ocr-corpus/clean-screenshot.png", network: "Playwright context.setOffline(true) before reload",
      tidied: await result.inputValue(),
      crossOriginRequestsWhileOffline: requests.filter((url) => !url.startsWith(origin) && !url.startsWith("data:") && !url.startsWith("blob:")),
    });
    await context.setOffline(false);
  } else if (group === "languages") {
    const slug = "ocr-in-other-languages";
    await page.goto(`${baseURL}/`);
    const picker = page.locator(".ocr-language-picker");
    await picker.locator("summary").click();
    await page.getByRole("checkbox", { name: /^Spanish/ }).check();
    // A narrower viewport keeps the picker legible when the figure is shown on phones.
    await page.setViewportSize({ width: 640, height: 1000 });
    await figure(picker, slug, "language-picker");
    await page.setViewportSize({ width: 1280, height: 1000 });
    const examples = [
      { id: "spa", label: /^Spanish/, expected: /El texto permanece en este dispositivo/, file: "spanish-result" },
      { id: "hin", label: /^Hindi/, expected: /नमस्ते दुनिया/, file: "hindi-result" },
    ];
    for (const example of examples) {
      await page.goto(`${baseURL}/`);
      await picker.locator("summary").click();
      await page.getByRole("checkbox", { name: example.label }).check();
      await page.getByRole("checkbox", { name: /^English/ }).uncheck();
      await page.getByLabel("Choose image file", { exact: true }).setInputFiles(`e2e/fixtures/languages/${example.id}.png`);
      const result = page.getByRole("textbox", { name: /^Tidied/ });
      await expect(result).toHaveValue(example.expected, { timeout: 120_000 });
      await picker.locator("summary").click();
      const locators = [page.getByRole("heading", { name: "Image", exact: true }), page.getByRole("heading", { name: "Recognised text" }), result];
      if (example.id === "hin") locators.unshift(page.locator(".workspace-section > p.caveat"));
      await figureUnion(locators, slug, example.file);
      records.push({ source: `e2e/fixtures/languages/${example.id}.png`, languages: [example.id], tidied: await result.inputValue() });
    }
  } else if (group === "batch") {
    const slug = "batch-ocr-multiple-images";
    const inputs = ["clean-screenshot.png", "receipt.png", "code-terminal.png"].map((name) => `e2e/fixtures/ocr-corpus/${name}`);
    await page.goto(`${baseURL}/`);
    await page.getByLabel("Choose image file", { exact: true }).setInputFiles(inputs);
    const batch = page.getByRole("region", { name: "Image batch" });
    await expect(batch.getByText("3/10 images", { exact: false })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Process pending images", exact: true }).click();
    for (const name of ["clean-screenshot.png", "receipt.png", "code-terminal.png"]) {
      await expect(batch.getByRole("button", { name: new RegExp(`${name.replace(".", "\\.")} Complete$`) })).toBeVisible({ timeout: 180_000 });
    }
    await figure(batch, slug, "batch-complete");
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Combined text .txt", exact: true }).click();
    const download = await pending;
    await download.saveAs("tmp/guide-evidence/image-batch.txt");
    const combined = await readFile("tmp/guide-evidence/image-batch.txt", "utf8");
    if (!combined.includes("--- clean-screenshot.png ---") || !combined.includes("SCREEN-7429")) throw new Error("Combined batch text did not contain the expected sections");
    records.push({ sources: inputs, action: "Process pending images, then Combined text .txt", filename: download.suggestedFilename(), combined });
  } else throw new Error(`Unknown capture group ${group}`);
  await mkdir("docs/guide-evidence", { recursive: true });
  await writeFile(`docs/guide-evidence/${group}.json`, JSON.stringify({ viewport: { width: 1280, height: 1000 }, theme: "dark", captured: new Date().toISOString(), records }, null, 2) + "\n");
} finally { await browser.close(); }
