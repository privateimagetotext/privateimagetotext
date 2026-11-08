import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { concat, embedRedLsb, encodeRgbaPng } from "../tests/fixtures/stego-analysis/png-encoder";

const MESSAGE = "flag{bit_planes_are_fun}";
const zipTail = concat(Uint8Array.of(0x50, 0x4b, 0x03, 0x04), new TextEncoder().encode("secret.txt-payload"));

function fixturePng() {
  const width = 64;
  const height = 48;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      rgba[i] = (x * 4) & 0xfe;
      rgba[i + 1] = (y * 5) & 0xff;
      rgba[i + 2] = ((x + y) * 3) & 0xff;
      rgba[i + 3] = 255;
    }
  }
  embedRedLsb(rgba, new TextEncoder().encode(MESSAGE));
  return Buffer.from(encodeRgbaPng(rgba, width, height, { filter: "mixed", after: zipTail }));
}

async function chooseFixture(page: Page, name = "challenge.png") {
  await page.getByLabel("Choose a file to analyse").setInputFiles({ name, mimeType: "image/png", buffer: fixturePng() });
  await expect(page.getByRole("heading", { level: 2, name })).toBeFocused();
}

/** The build's offline asset list for one route, read from the generated service worker. */
async function routeOfflineAssets(path: string): Promise<string[]> {
  const worker = await readFile("dist/sw.js", "utf8");
  const match = worker.match(new RegExp(`\\{"path":"${path.replace(/[/]/g, "\\/")}"[^\\n]*?"assets":(\\[[^\\]]*\\])`));
  if (!match) throw new Error(`No offline route declaration for ${path}`);
  return JSON.parse(match[1]) as string[];
}

async function waitForQuiet(count: () => number, quietMs: number, timeoutMs = 30_000) {
  const started = Date.now();
  let last = count();
  let lastChange = Date.now();
  while (Date.now() - lastChange < quietMs) {
    if (Date.now() - started > timeoutMs) throw new Error("Network did not go quiet");
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (count() !== last) {
      last = count();
      lastChange = Date.now();
    }
  }
}

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
}

test("bit planes, LSB extraction, trailing bytes and Clear work locally", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/steganography-analysis");
  await expect(page.getByRole("heading", { level: 1, name: "Analyse an image for hidden data. Nothing uploaded." })).toBeVisible();
  await chooseFixture(page);

  const planes = page.getByRole("region", { name: "Bit planes" });
  await expect(planes).toContainText("Pixels were read from the PNG data by this tool");
  await expect(page.locator(".stego-viewer canvas")).toHaveJSProperty("width", 64);
  await page.getByLabel("View", { exact: true }).selectOption({ label: "Red plane 0 (least significant)" });
  await expect(page.locator("#stego-viewer-help")).toContainText("Red plane 0");
  // The first pixel's red LSB is the top bit of "f" (0x66): 0, so the plane starts black.
  await expect.poll(() => page.locator(".stego-viewer canvas").evaluate((canvas: HTMLCanvasElement) =>
    Array.from(canvas.getContext("2d")!.getImageData(0, 0, 2, 1).data))).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);

  const extract = page.getByRole("region", { name: "Extract bits (LSB)" });
  await extract.getByRole("checkbox", { name: "Green" }).uncheck();
  await extract.getByRole("checkbox", { name: "Blue" }).uncheck();
  await extract.getByRole("button", { name: "Extract bits" }).click();
  await expect(extract.getByRole("region", { name: "Strings in extracted bytes" })).toContainText(MESSAGE);
  await expect(extract.getByRole("region", { name: "Extracted bytes as hex" })).toContainText("66 6c 61 67 7b");
  const binDownload = page.waitForEvent("download");
  await extract.getByRole("button", { name: "Download .bin" }).click();
  const bin = await binDownload;
  expect(bin.suggestedFilename()).toBe("challenge-lsb.bin");
  const binBytes = await readFile((await bin.path())!);
  expect(binBytes.byteLength).toBe((64 * 48) / 8);
  expect(binBytes.subarray(0, MESSAGE.length).toString("latin1")).toBe(MESSAGE);

  const bytes = page.getByRole("region", { name: "File bytes" });
  await expect(bytes).toContainText(`${zipTail.byteLength} bytes follow the PNG IEND chunk`);
  await expect(bytes).toContainText("ZIP local file header signature");
  const tailDownload = page.waitForEvent("download");
  await bytes.getByRole("button", { name: "Download trailing bytes" }).click();
  const tail = await tailDownload;
  expect(tail.suggestedFilename()).toBe("challenge-trailing-data.bin");
  expect(Array.from(await readFile((await tail.path())!))).toEqual(Array.from(zipTail));
  await expect(bytes.getByRole("region", { name: "Strings in the file" })).toContainText("secret.txt-payload");
  await bytes.getByLabel("Minimum length").selectOption("4");
  await expect(bytes.getByRole("region", { name: "Strings in the file" })).toContainText("IEND");
  await bytes.getByLabel("Filter listed strings").fill("SECRET");
  await expect(bytes.getByRole("region", { name: "Strings in the file" })).toContainText("secret.txt-payload");
  await expect(bytes.getByRole("region", { name: "Strings in the file" })).not.toContainText("IEND");
  await expect(bytes).toContainText(/1 of \d+ listed strings match/);

  const facts = page.getByRole("region", { name: "File facts" });
  await expect(facts).toContainText("64 × 48, colour type 6, 8-bit, not interlaced");
  await expect(facts).toContainText(/[0-9a-f]{64}/);

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByRole("button", { name: "Choose file" })).toBeFocused();
  await expect(page.getByText(MESSAGE)).toHaveCount(0);
  await expect(page.locator(".stego-viewer")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the plane viewer is keyboard operable and wraps", async ({ page }) => {
  await page.goto("/steganography-analysis");
  await chooseFixture(page);
  const viewer = page.getByRole("group", { name: /view 1 of 47/ });
  await viewer.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("group", { name: /^Alpha channel only, view 47 of 47/ })).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("]");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#stego-viewer-help")).toContainText("Red plane 7 (most significant) · view 4 of 47");
  await page.keyboard.press("End");
  await expect(page.locator("#stego-viewer-help")).toContainText("view 47 of 47");
  // Buttons work too.
  await page.getByRole("button", { name: "Next view" }).click();
  await expect(page.locator("#stego-viewer-help")).toContainText("Normal image · view 1 of 47");
});

test("non-image files still get byte analysis", async ({ page }) => {
  await page.goto("/steganography-analysis");
  await page.getByLabel("Choose a file to analyse").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("nothing to see here\u0000password=hunter2\u0000"),
  });
  await expect(page.getByRole("region", { name: "Bit planes" })).toContainText("This file is not a PNG, JPEG, WebP, BMP or GIF image.");
  await expect(page.getByRole("region", { name: "Strings in the file" })).toContainText("password=hunter2");
  await expect(page.getByRole("region", { name: "File bytes" })).toContainText("Trailing-data checks support PNG and JPEG files.");
});

test("a real JPEG decodes through the browser and reports clean trailing data", async ({ page }) => {
  await page.goto("/steganography-analysis");
  await page.getByLabel("Choose a file to analyse").setInputFiles("tests/fixtures/jpeg-v2/libjpeg-testorig.jpg");
  await expect(page.getByRole("region", { name: "Bit planes" })).toContainText("Pixels came from the browser's image decoder");
  await expect(page.getByRole("region", { name: "Bit planes" })).toContainText("JPEG is lossy");
  await expect(page.getByRole("region", { name: "File bytes" })).toContainText("No bytes follow the EOI marker.");
  await expect(page.getByRole("region", { name: "File facts" })).toContainText("JPEG markers");
});

test("analysis makes no network requests beyond the route's own same-origin assets", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const requests: { url: string; fromServiceWorker: boolean }[] = [];
  context.on("request", (request) => requests.push({ url: request.url(), fromServiceWorker: request.serviceWorker() !== null }));
  await page.goto("/steganography-analysis");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(page.getByRole("button", { name: "Choose file" })).toBeEnabled();
  // The service worker prepares the route's offline copy in the background
  // (sequential fetches, invisible to networkidle). Wait until every asset the
  // build declares for this route is cached, then until requests go quiet.
  const routeAssets = await routeOfflineAssets("/steganography-analysis");
  expect(routeAssets.some((asset) => /stego-analysis\.worker-/.test(asset))).toBe(true);
  await expect.poll(() => page.evaluate(async (assets) => {
    const cache = await caches.open("localtext-shell-v10");
    const keys = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
    return assets.every((asset) => keys.has(asset));
  }, routeAssets), { timeout: 30_000 }).toBe(true);
  await waitForQuiet(() => requests.length, 1_500);

  const beforeAnalysis = requests.length;
  await chooseFixture(page);
  await page.getByRole("region", { name: "Extract bits (LSB)" }).getByRole("button", { name: "Extract bits" }).click();
  await expect(page.getByRole("heading", { name: "Extracted bytes", exact: true })).toBeVisible();
  const during = requests.slice(beforeAnalysis);
  const describe = during.map((request) => `${request.fromServiceWorker ? "[sw] " : ""}${request.url}`).join("\n");
  // Only the worker script may load during analysis: no data URLs, blobs, other origins or other assets.
  expect(during.every(({ url }) => new URL(url).origin === origin && /\/assets\/stego-analysis\.worker-[^/]+\.js$/.test(new URL(url).pathname)), describe).toBe(true);
  // The page creates the worker once; the cached service-worker copy serves it, so no
  // second fetch reaches the network.
  expect(during.filter(({ fromServiceWorker }) => !fromServiceWorker), describe).toHaveLength(1);
  expect(during.filter(({ fromServiceWorker }) => fromServiceWorker), describe).toHaveLength(0);
  expect(requests.filter(({ url }) => !url.startsWith("data:") && new URL(url).origin !== origin)).toEqual([]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
});

test("works offline after one online visit", async ({ page, context }) => {
  await page.goto("/steganography-analysis");
  await expect.poll(() => page.evaluate(async () => {
    const cache = await caches.open("localtext-shell-v10");
    const keys = (await cache.keys()).map((request) => request.url);
    return keys.some((url) => /StegoAnalysisPage-.*\.js$/.test(url)) && keys.some((url) => /stego-analysis\.worker-.*\.js$/.test(url));
  }), { timeout: 30_000 }).toBe(true);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.clearBrowserCache");
  await context.setOffline(true);
  await page.reload();
  await chooseFixture(page);
  await page.getByRole("region", { name: "Extract bits (LSB)" }).getByRole("button", { name: "Extract bits" }).click();
  await expect(page.getByRole("heading", { name: "Extracted bytes", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "File bytes" })).toContainText("ZIP local file header signature");
  await context.setOffline(false);
});

test("390 px layout has no horizontal scroll and passes Axe", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/steganography-analysis");
  expect(await seriousViolations(page)).toEqual([]);
  await chooseFixture(page);
  await page.getByRole("region", { name: "Extract bits (LSB)" }).getByRole("button", { name: "Extract bits" }).click();
  await expect(page.getByRole("heading", { name: "Extracted bytes", exact: true })).toBeVisible();
  await page.locator("#stego-facts details").first().evaluate((element: HTMLDetailsElement) => { element.open = true; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await seriousViolations(page)).toEqual([]);
});

test("leaving the route drops the analysis", async ({ page }) => {
  await page.goto("/steganography-analysis");
  await chooseFixture(page);
  await page.locator(".stego-explainer").getByRole("link", { name: "Hide message", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Hide a message inside an image." })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("button", { name: "Choose file" })).toBeVisible();
  await expect(page.getByText("challenge.png")).toHaveCount(0);
});

test("a PNG decompression bomb stops at the image's expected size", async ({ page }) => {
  test.slow();
  // 4,096 × 4,096 8-bit grey needs 16,781,312 inflated bytes; this IDAT inflates to 1 GiB.
  const { createDeflate } = await import("node:zlib");
  const deflate = createDeflate({ level: 9 });
  const parts: Buffer[] = [];
  deflate.on("data", (chunk: Buffer) => parts.push(chunk));
  const finished = new Promise((resolve) => deflate.on("end", resolve));
  const zeros = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < 1024; i += 1) {
    if (!deflate.write(zeros)) await new Promise((resolve) => deflate.once("drain", resolve));
  }
  deflate.end();
  await finished;
  const { pngChunk } = await import("../tests/fixtures/stego-analysis/png-encoder");
  const header = Buffer.alloc(13);
  header.writeUInt32BE(4096, 0);
  header.writeUInt32BE(4096, 4);
  header[8] = 8;
  const bomb = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header), pngChunk("IDAT", Buffer.concat(parts)), pngChunk("IEND"),
  ]);
  const crashes: string[] = [];
  page.on("crash", () => crashes.push("crash"));
  await page.goto("/steganography-analysis");
  await page.getByLabel("Choose a file to analyse").setInputFiles({ name: "bomb.png", mimeType: "image/png", buffer: bomb });
  await expect(page.getByRole("region", { name: "Bit planes" })).toContainText("more bytes than the image needs", { timeout: 60_000 });
  expect(crashes).toEqual([]);
});

test.describe("committed CTF-style fixtures reveal their flags through the UI", () => {
  const dir = "tests/fixtures/stego-analysis/";

  async function open(page: Page, name: string) {
    await page.goto("/steganography-analysis");
    await page.getByLabel("Choose a file to analyse").setInputFiles(`${dir}${name}`);
    await expect(page.getByRole("heading", { level: 2, name })).toBeFocused();
    return page.getByRole("region", { name: "Extract bits (LSB)" });
  }

  test("RGB, bit 0, rows, MSB-first (defaults)", async ({ page }) => {
    const extract = await open(page, "lsb-rgb-rows.png");
    await extract.getByRole("button", { name: "Extract bits" }).click();
    await expect(extract.getByRole("region", { name: "Strings in extracted bytes" })).toContainText("flag{rgb_rows_msb_first}");
  });

  test("B, G, R order, columns, LSB-first", async ({ page }) => {
    const extract = await open(page, "lsb-bgr-columns-lsb-first.png");
    await extract.getByRole("radio", { name: "B, G, R, A" }).check();
    await extract.getByRole("radio", { name: /^Columns/ }).check();
    await extract.getByRole("radio", { name: "LSB-first" }).check();
    await extract.getByRole("button", { name: "Extract bits" }).click();
    await expect(extract.getByRole("region", { name: "Strings in extracted bytes" })).toContainText("flag{bgr_columns_lsb_first}");
    await expect(extract).toContainText("BGR bit 0, columns, LSB-first");
  });

  test("green, bits 1 and 0", async ({ page }) => {
    const extract = await open(page, "lsb-green-two-bits.png");
    await extract.getByRole("checkbox", { name: "Red" }).uncheck();
    await extract.getByRole("checkbox", { name: "Blue" }).uncheck();
    await extract.getByRole("checkbox", { name: "1", exact: true }).check();
    await extract.getByRole("button", { name: "Extract bits" }).click();
    await expect(extract.getByRole("region", { name: "Strings in extracted bytes" })).toContainText("flag{green_bits_1_and_0}");
  });

  test("A, B, G, R order read from the bottom row", async ({ page }) => {
    const extract = await open(page, "lsb-abgr-bottom-up.png");
    await extract.getByRole("checkbox", { name: "Alpha" }).check();
    await extract.getByRole("radio", { name: "A, B, G, R" }).check();
    await extract.getByRole("radio", { name: /^Rows from the bottom/ }).check();
    await extract.getByRole("button", { name: "Extract bits" }).click();
    await expect(extract.getByRole("region", { name: "Strings in extracted bytes" })).toContainText("flag{abgr_from_the_bottom}");
  });

  test("16-bit PNG: the flag appears only with the low byte", async ({ page }) => {
    const extract = await open(page, "lsb-16bit-low-byte.png");
    const planes = page.getByRole("region", { name: "Bit planes" });
    await expect(planes).toContainText("using their high byte");
    await extract.getByRole("button", { name: "Extract bits" }).click();
    await expect(extract.getByRole("heading", { name: "Extracted bytes", exact: true })).toBeVisible();
    await expect(extract.getByRole("region", { name: "Strings in extracted bytes" }).or(extract.getByText("No printable strings"))).not.toContainText("flag{sixteen_bit_lsb}");
    await planes.getByRole("radio", { name: /^Low byte/ }).check();
    await expect(planes).toContainText("using their low byte");
    await expect(extract.getByRole("heading", { name: "Extracted bytes", exact: true })).toHaveCount(0);
    await extract.getByRole("button", { name: "Extract bits" }).click();
    await expect(extract.getByRole("region", { name: "Strings in extracted bytes" })).toContainText("flag{sixteen_bit_lsb}");
  });

  test("rapid key presses settle on the last view", async ({ page }) => {
    await open(page, "plane-blue-5.png");
    const viewer = page.locator(".stego-viewer");
    await viewer.focus();
    await page.keyboard.press("Home");
    // Blue plane 5 is view 22: normal, opaque, inverted, 8 red, 8 green, then blue 7, 6, 5.
    for (let i = 0; i < 21; i += 1) await page.keyboard.press("ArrowRight", { delay: 0 });
    await expect(page.locator("#stego-viewer-help")).toContainText("Blue plane 5 · view 22 of 47");
    const canvas = page.locator(".stego-viewer canvas");
    await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) =>
      Array.from(element.getContext("2d")!.getImageData(9, 21, 1, 1).data))).toEqual([255, 255, 255, 255]);
    expect(await canvas.evaluate((element: HTMLCanvasElement) =>
      Array.from(element.getContext("2d")!.getImageData(3, 21, 1, 1).data))).toEqual([0, 0, 0, 255]);
  });

  test("a word drawn in blue plane 5", async ({ page }) => {
    await open(page, "plane-blue-5.png");
    await page.getByLabel("View", { exact: true }).selectOption({ label: "Blue plane 5" });
    const canvas = page.locator(".stego-viewer canvas");
    // Top-left of the F (x 8–12, y 20–24) is white; the gap left of it is black.
    await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) =>
      Array.from(element.getContext("2d")!.getImageData(9, 21, 1, 1).data))).toEqual([255, 255, 255, 255]);
    expect(await canvas.evaluate((element: HTMLCanvasElement) =>
      Array.from(element.getContext("2d")!.getImageData(3, 21, 1, 1).data))).toEqual([0, 0, 0, 255]);
  });

  test("a ZIP after IEND and text after EOI", async ({ page }) => {
    await open(page, "trailing-zip.png");
    const bytes = page.getByRole("region", { name: "File bytes" });
    await expect(bytes).toContainText("They start with a ZIP local file header signature.");
    const download = page.waitForEvent("download");
    await bytes.getByRole("button", { name: "Download trailing bytes" }).click();
    const zip = await readFile((await (await download).path())!);
    expect(zip.subarray(0, 4).toString("latin1")).toBe("PK\u0003\u0004");
    expect(zip.toString("latin1")).toContain("flag{zip_after_iend}");

    await open(page, "trailing-text.jpg");
    await expect(bytes).toContainText("20 bytes follow the JPEG EOI marker");
    await expect(bytes.getByRole("region", { name: "First trailing bytes as hex" })).toContainText("flag{text_after");
  });
});

test("browser-decoded images with transparency carry an honest warning", async ({ page }) => {
  await page.goto("/steganography-analysis");
  const bytes = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(16, 16);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "rgba(200, 40, 40, 0.5)";
    context.fillRect(0, 0, 16, 16);
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: 1 });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByLabel("Choose a file to analyse").setInputFiles({ name: "alpha.webp", mimeType: "image/webp", buffer: Buffer.from(bytes) });
  const planes = page.getByRole("region", { name: "Bit planes" });
  await expect(planes).toContainText("Pixels came from the browser's image decoder");
  await expect(planes).toContainText("the browser alters or discards colour under transparent and semi-transparent pixels");
});
