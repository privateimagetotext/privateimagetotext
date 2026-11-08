import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const imageFixture = path.join(currentDirectory, "fixtures", "localtext-ocr.png");

test("Media Inspector reads, verifies, reports and clears a local image", async ({
  page,
  baseURL,
}) => {
  const requests: Array<{ url: string; method: string }> = [];
  page.on("request", (request) => {
    requests.push({ url: request.url(), method: request.method() });
  });

  await page.goto("/media-inspector");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Inspect photo and video metadata. Nothing uploaded.",
    }),
  ).toBeVisible();

  await page
    .getByLabel("Choose a media file to inspect")
    .setInputFiles(imageFixture);

  await expect(page.getByText("Inspection complete", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("PNG image", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^[a-f0-9]{64}$/)).toBeVisible();

  await page.getByRole("tab", { name: "Privacy" }).click();
  await expect(
    page.getByRole("heading", {
      name: "No recognised privacy fields were found",
    }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Origin & AI clues" }).click();
  await expect(
    page.getByRole("heading", {
      name: "No embedded Content Credential found",
    }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Network policy: embedded credentials only")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No AI generation metadata found" }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON report" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("localtext-ocr-inspection.json");
  const reportPath = await download.path();
  expect(reportPath).not.toBeNull();
  const report = JSON.parse(await readFile(reportPath!, "utf8"));
  expect(report.reportVersion).toBe(1);
  expect(report.inspection.format.kind).toBe("png");
  expect(report.inspection.file.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(report.provenance).toMatchObject({
    status: "not-found",
    networkPolicy: "embedded-only",
  });

  await expect(
    page.getByRole("button", { name: "Create metadata-removed copy" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Create metadata-removed copy" }).click();
  const cleanResult = page.locator(".clean-copy-result");
  await expect(
    cleanResult.getByRole("heading", { name: "Metadata-removed copy is ready" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(cleanResult.getByText("localtext-ocr-clean.png", { exact: true })).toBeVisible();
  await expect(cleanResult.getByText(/^PNG image$/)).toHaveCount(2);
  await expect(cleanResult.getByText(/^[a-f0-9]{64}$/)).toHaveCount(2);
  await expect(
    cleanResult.getByRole("heading", { name: /Removed structural carriers/ }),
  ).toBeVisible();
  await expect(
    cleanResult.getByRole("heading", { name: /Preserved rendering structure/ }),
  ).toBeVisible();
  await expect(cleanResult.getByText(/output credential check returned not found/i)).toBeVisible();

  const cleanDownloadPromise = page.waitForEvent("download");
  await cleanResult.getByRole("button", { name: "Download metadata-removed copy" }).click();
  const cleanDownload = await cleanDownloadPromise;
  expect(cleanDownload.suggestedFilename()).toBe("localtext-ocr-clean.png");
  const cleanDownloadPath = await cleanDownload.path();
  expect(cleanDownloadPath).not.toBeNull();
  const cleanBytes = await readFile(cleanDownloadPath!);
  expect([...cleanBytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

  const sourcePreviewUrl = await page
    .getByRole("img", { name: "Local preview of localtext-ocr.png" })
    .getAttribute("src");
  const cleanPreviewUrl = await cleanResult
    .getByRole("img", { name: "Local preview of localtext-ocr-clean.png" })
    .getAttribute("src");
  expect(sourcePreviewUrl).toMatch(/^blob:/);
  expect(cleanPreviewUrl).toMatch(/^blob:/);
  expect(cleanPreviewUrl).not.toBe(sourcePreviewUrl);
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose one media file" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async (url) => {
        try {
          const response = await fetch(url);
          return response.ok;
        } catch {
          return false;
        }
      }, sourcePreviewUrl!),
    )
    .toBe(false);
  await expect
    .poll(() =>
      page.evaluate(async (url) => {
        try {
          const response = await fetch(url);
          return response.ok;
        } catch {
          return false;
        }
      }, cleanPreviewUrl!),
    )
    .toBe(false);

  const expectedOrigin = new URL(baseURL!).origin;
  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests) {
    expect(new URL(request.url).origin).toBe(expectedOrigin);
    expect(request.method).toBe("GET");
    expect(request.url).not.toContain("localtext-ocr.png");
  }
  expect(
    requests.some((request) =>
      /\/assets\/c2pa[^/]*\.wasm$/i.test(new URL(request.url).pathname),
    ),
  ).toBe(true);
});

test("Media Inspector rejects renamed non-media without reading it as an image", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const trackedWindow = window as typeof window & {
      __mediaInspectorObjectUrlCount?: number;
    };
    const createObjectURL = URL.createObjectURL;
    trackedWindow.__mediaInspectorObjectUrlCount = 0;
    URL.createObjectURL = function trackedCreateObjectURL(object) {
      trackedWindow.__mediaInspectorObjectUrlCount =
        (trackedWindow.__mediaInspectorObjectUrlCount ?? 0) + 1;
      return createObjectURL.call(URL, object);
    };
  });
  await page.goto("/media-inspector");
  await page.getByLabel("Choose a media file to inspect").setInputFiles({
    name: "renamed-private.png",
    mimeType: "image/png",
    buffer: Buffer.from("this is not an image"),
  });

  await expect(
    page.getByRole("heading", {
      name: "This file could not be safely inspected",
    }),
  ).toBeVisible();
  await expect(page.getByText(/supported image, video or audio signature/i)).toBeVisible();
  await expect(page.getByText("Inspection complete", { exact: true })).toHaveCount(0);
  await expect(page.locator(".media-preview img, .media-preview video, .media-preview audio")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create metadata-removed copy" })).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __mediaInspectorObjectUrlCount?: number })
          .__mediaInspectorObjectUrlCount,
    ),
  ).toBe(0);
});

test("Media Inspector results stay usable at narrow and wide viewport sizes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/media-inspector");
  await page
    .getByLabel("Choose a media file to inspect")
    .setInputFiles(imageFixture);
  await expect(page.getByText("Inspection complete", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Download JSON report" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Create metadata-removed copy" })).toBeEnabled();
  await page.getByRole("button", { name: "Create metadata-removed copy" }).click();
  const cleanResult = page.locator(".clean-copy-result");
  await expect(
    cleanResult.getByRole("heading", { name: "Metadata-removed copy is ready" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(cleanResult.getByRole("button", { name: "Download metadata-removed copy" })).toBeVisible();

  for (const width of [320, 375, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await expect(page.getByText("localtext-ocr.png", { exact: true })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Inspection result views" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Local preview of localtext-ocr.png" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download JSON report" })).toBeVisible();
    await expect(
      cleanResult.getByRole("img", { name: "Local preview of localtext-ocr-clean.png" }),
    ).toBeVisible();
    await expect(cleanResult.getByRole("button", { name: "Download metadata-removed copy" })).toBeVisible();
  }

  await page.setViewportSize({ width: 320, height: 900 });
  await page.getByRole("tab", { name: "Raw metadata" }).click();
  await expect(page.getByRole("searchbox", { name: "Filter metadata fields" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
});
