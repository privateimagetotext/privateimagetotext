import { test, expect } from "@playwright/test";

test("a first guide visit caches its own figures and later tool visits prepare the full app", async ({ page, context }) => {
  await page.goto("/guides/improve-ocr-accuracy");
  await expect(page.getByText("Offline: this guide ready", { exact: true })).toHaveCount(1);
  const cached = await page.evaluate(async () => (await (await caches.open("localtext-shell-v10")).keys()).map(request => new URL(request.url).pathname));
  expect(cached).toContain("/guides/improve-ocr-accuracy/document.webp");
  expect(cached).toContain("/guides/improve-ocr-accuracy/code.webp");
  expect(cached).not.toContain("/");
  expect(cached.some(path => path.startsWith("/og/"))).toBe(false);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("Offline: this guide ready", { exact: true })).toHaveCount(1);
  for (const image of await page.locator(".guide-figures img").all()) {
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  }
  await context.setOffline(false);
  await page.getByRole("link", { name: "Open the tool", exact: true }).click();
  await expect.poll(() => page.evaluate(async () => Boolean(await (await caches.open("localtext-shell-v10")).match("/guides/screenshot-to-text"))), { timeout: 60_000 }).toBe(true);
});

test("guide navigation keeps unique social metadata and functioning section links", async ({ page }) => {
  await page.goto("/guides/screenshot-to-text");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://privateimagetotext.com/og/guides/screenshot-to-text.png");
  await page.getByRole("link", { name: /Improve OCR accuracy/ }).first().click();
  await expect(page).toHaveURL(/\/guides\/improve-ocr-accuracy$/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://privateimagetotext.com/og/guides/improve-ocr-accuracy.png");
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute("content", "https://privateimagetotext.com/og/guides/improve-ocr-accuracy.png");
  await page.getByRole("link", { name: "How OCR accuracy is measured", exact: true }).click();
  await expect(page).toHaveURL(/#ocr-accuracy-measurement$/);
  await expect(page.locator("#ocr-accuracy-measurement")).toBeInViewport();
  for (const image of await page.locator(".guide-figures img").all()) {
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === Number(img.getAttribute("width")) && img.naturalHeight === Number(img.getAttribute("height")))).toBe(true);
  }
});

const newGuides = [
  { path: "/guides/check-photo-location-before-posting", heading: "How to check a photo for location data before you post it", from: "/media-inspector", link: /Check a photo for location data/ },
  { path: "/guides/offline-ocr-without-internet", heading: "Offline OCR: how to extract text from an image with no internet connection", from: "/", link: /Read Offline OCR without internet/ },
  { path: "/guides/ocr-in-other-languages", heading: "How to extract text from images in Spanish, Hindi, Thai and other languages without uploading", from: "/", link: /Read OCR in other languages/ },
  { path: "/guides/batch-ocr-multiple-images", heading: "How to extract text from multiple images at once without uploading them", from: "/", link: /Read Batch OCR for multiple images/ },
];

for (const guide of newGuides) {
  test(`${guide.path} is reachable from its tool and renders real figures, FAQs and social metadata`, async ({ page }) => {
    await page.goto(guide.from);
    await page.getByRole("link", { name: guide.link }).click();
    await expect(page).toHaveURL(new RegExp(`${guide.path}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(guide.heading);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", `https://privateimagetotext.com/og${guide.path}.png`);
    await expect(page.getByRole("heading", { name: "Frequently asked questions" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Before you rely on this" })).toBeVisible();
    const images = await page.locator(".guide-figures img").all();
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === Number(img.getAttribute("width")) && img.naturalHeight === Number(img.getAttribute("height")))).toBe(true);
    }
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}

test("the location guide's workflow: GPS is flagged, then absent from the verified clean copy", async ({ page }) => {
  const { locationExampleJpeg } = await import("../scripts/guide-location-fixture.mjs");
  const { readFile } = await import("node:fs/promises");
  const buffer = locationExampleJpeg(await readFile("tests/fixtures/jpeg-v2/libjpeg-testorig.jpg"));
  await page.goto("/media-inspector");
  await page.getByLabel("Choose a media file to inspect").setInputFiles({ name: "location-example.jpg", mimeType: "image/jpeg", buffer });
  await expect(page.getByText("Inspection complete", { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tab", { name: /^Privacy/ }).click();
  await expect(page.getByRole("heading", { name: "Location information is embedded" })).toBeVisible();
  await page.getByRole("tab", { name: "Raw metadata" }).click();
  await page.getByRole("searchbox", { name: "Filter metadata fields" }).fill("gps");
  await expect(page.getByText("-31.960555555555555", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Filter metadata fields" }).fill("");
  await page.getByRole("button", { name: "Create metadata-removed copy", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Metadata-removed copy is ready" })).toBeVisible({ timeout: 60_000 });
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download metadata-removed copy", exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/-clean\.jpe?g$/);
  await page.locator('input[type="file"]').setInputFiles((await download.path())!);
  await expect(page.getByText("Inspection complete", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /^Privacy/ }).click();
  await expect(page.getByRole("heading", { name: "No recognised privacy fields were found" })).toBeVisible();
  await page.getByRole("tab", { name: "Raw metadata" }).click();
  await expect(page.getByRole("tabpanel").getByText("jpeg.app0", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Filter metadata fields" }).fill("gps");
  await expect(page.getByRole("tabpanel").getByText(/^0 of \d+ fields shown$/)).toBeVisible();
  await expect(page.getByRole("tabpanel").getByText(/GPS/)).toHaveCount(0);
});

// Guide bodies load with the guide route only. These cover the paths where
// that chunk is not already in memory.
const cachedGuideChunk = (page: import("@playwright/test").Page) => page.evaluate(async () => {
  const cache = await caches.open("localtext-shell-v10");
  return (await cache.keys()).some(request => /\/assets\/GuidePage-[^/]+\.js$/.test(new URL(request.url).pathname));
});

test("client navigation from the homepage loads a guide and its HowTo structured data", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("link", { name: /Read Receipt to text/ }).click();
  await expect(page).toHaveURL(/\/guides\/receipt-to-text$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How to extract text from a receipt image");
  await expect.poll(() => page.locator('script[type="application/ld+json"]').evaluate(script =>
    JSON.parse(script.textContent ?? "")["@graph"].find((node: { "@type": string }) => node["@type"] === "HowTo")?.step?.length ?? 0))
    .toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("after visiting only the guides index, a guide still opens offline", async ({ page, context }) => {
  await page.goto("/guides");
  await expect(page.getByText("Offline: this guide ready", { exact: true })).toHaveCount(1, { timeout: 60_000 });
  await expect.poll(() => cachedGuideChunk(page), { timeout: 60_000 }).toBe(true);
  await context.setOffline(true);
  try {
    await page.locator(`a[href="/guides/receipt-to-text"]`).first().click();
    await expect(page).toHaveURL(/\/guides\/receipt-to-text$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("How to extract text from a receipt image");
    await expect(page.getByRole("heading", { name: "Before you rely on this" })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("after a tool visit prepares the app, a guide opens offline by client navigation", async ({ page, context }) => {
  await page.goto("/");
  await expect.poll(() => cachedGuideChunk(page), { timeout: 90_000 }).toBe(true);
  await context.setOffline(true);
  try {
    await page.getByRole("link", { name: /Read Batch OCR for multiple images/ }).click();
    await expect(page).toHaveURL(/\/guides\/batch-ocr-multiple-images$/);
    await expect(page.getByRole("heading", { name: "Add images and run the batch" })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
