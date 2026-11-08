import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  chooseCarrier,
  explicitDownload,
  fixturePath,
  generatePng,
  mutateEncodedPng,
  revealFile,
} from "./steganography-helpers";

async function primaryNavigationLink(page: Page, name: string) {
  const menuButton = page.getByRole("button", { name: "Open navigation menu", exact: true });
  if (await menuButton.isVisible()) await menuButton.click();
  return page.getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name, exact: true });
}

test.describe("Private Image to Text steganography", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Full suite is Chromium-focused");

  test("plain hide, explicit PNG download, clear and exact reveal", async ({ page }) => {
    const exact = "Unicode π🙂\nline two\n  final spacing  ";
    const sourceBefore = await readFile(fixturePath);
    let downloads = 0;
    page.on("download", () => { downloads += 1; });

    await page.goto("/hide-message");
    await expect(page).toHaveTitle("Hide Text in an Image — Free, Private Steganography");
    await chooseCarrier(page, "plain-source.png");
    await generatePng(page, exact);
    expect(downloads).toBe(0);
    const download = await explicitDownload(page);
    expect(downloads).toBe(1);
    expect(download.suggestedFilename()).toBe("plain-source-encoded.png");
    const outputPath = await download.path();
    expect(outputPath).not.toBeNull();
    const output = await readFile(outputPath!);
    expect(Array.from(output.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    expect(await readFile(fixturePath)).toEqual(sourceBefore);

    await page.getByRole("button", { name: "Clear" }).last().click();
    await expect(page.getByRole("button", { name: "Choose image", exact: true })).toBeFocused();
    const revealed = await revealFile(page, outputPath!);
    await expect(revealed).toHaveValue(exact);
    await expect(revealed).toHaveAttribute("readonly", "");
  });

  test("plain JPEG v2 hide, .jpg download, clear and exact reveal", async ({ page }) => {
    const exact = "JPEG v2 exact π";
    await page.goto("/hide-message");
    await page.locator('input[type="file"]').setInputFiles(
      resolve(process.cwd(), "tests/fixtures/jpeg-v2/libjpeg-testorig.jpg"),
    );
    await page.getByRole("radio", { name: /^JPEG — advanced/i }).check();
    await page.getByRole("radio", { name: /^No password/i }).check();
    await page.getByRole("textbox", { name: "Message" }).fill(exact);
    await page.getByRole("button", { name: "Create JPEG with hidden message" }).click();
    await expect(page.getByRole("heading", { name: "Download your hidden-message image" })).toBeVisible();
    await expect(page.getByText("libjpeg-testorig-encoded.jpg")).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download JPEG" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("libjpeg-testorig-encoded.jpg");
    const downloadedPath = await download.path();
    expect(downloadedPath).not.toBeNull();
    const encoded = await readFile(downloadedPath!);
    expect(encoded.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(encoded.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));

    await page.getByRole("button", { name: "Clear" }).last().click();
    await page.getByRole("radio", { name: /Reveal a message/i }).check();
    await page.locator('input[type="file"]').setInputFiles({
      name: "libjpeg-testorig-encoded.jpg",
      mimeType: "image/jpeg",
      buffer: encoded,
    });
    const revealed = page.getByLabel("Message text");
    await expect(revealed).toHaveValue(exact);
    await expect(revealed).toHaveAttribute("readonly", "");
  });

  test("encrypted hide, wrong-password retry and exact reveal", async ({ page }) => {
    const exact = "Encrypted 秘密\n🙂";
    const password = "pässphrase-012";
    await page.goto("/hide-message");
    await chooseCarrier(page, "encrypted-source.png");
    await generatePng(page, exact, password);
    const download = await explicitDownload(page);
    const outputPath = await download.path();
    expect(outputPath).not.toBeNull();
    await page.getByRole("button", { name: "Clear" }).last().click();
    await page.getByRole("radio", { name: /Reveal a message/ }).check();
    await page.locator('input[type="file"]').setInputFiles(outputPath!);
    const field = page.getByLabel("Password", { exact: true });
    await expect(field).toBeFocused();
    await field.fill("incorrect-pass-012");
    await page.getByRole("button", { name: "Reveal message", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "The password is incorrect or the hidden message has been damaged.",
    );
    await expect(field).toBeFocused();
    await field.fill(password);
    await page.getByRole("button", { name: "Reveal message", exact: true }).click();
    await expect(page.getByLabel("Message text")).toHaveValue(exact);
  });

  test("detects plain payload damage and authenticated encrypted damage", async ({ page }) => {
    await page.goto("/hide-message");
    await chooseCarrier(page);
    await generatePng(page, "plain damage check");
    const plainDownload = await explicitDownload(page);
    const plainBytes = await readFile((await plainDownload.path())!);
    const damagedPlain = await mutateEncodedPng(page, plainBytes, "payload");
    await page.getByRole("button", { name: "Clear" }).last().click();
    await page.getByRole("radio", { name: /Reveal a message/ }).check();
    await page.locator('input[type="file"]').setInputFiles({
      name: "damaged-plain.png",
      mimeType: "image/png",
      buffer: damagedPlain,
    });
    await expect(page.getByRole("alert")).toContainText("hidden message is damaged");


    await page.getByRole("radio", { name: /Hide a message/ }).check();
    await chooseCarrier(page);
    await generatePng(page, "encrypted damage check", "pässphrase-012");
    const encryptedDownload = await explicitDownload(page);
    const encryptedBytes = await readFile((await encryptedDownload.path())!);
    for (const target of ["header-nonce", "payload"] as const) {
      const changed = await mutateEncodedPng(page, encryptedBytes, target);
      await page.getByRole("button", { name: "Clear" }).last().click();
      await page.getByRole("radio", { name: /Reveal a message/ }).check();
      await page.locator('input[type="file"]').setInputFiles({
        name: `damaged-${target}.png`,
        mimeType: "image/png",
        buffer: changed,
      });
      await page.getByLabel("Password", { exact: true }).fill("pässphrase-012");
      await page.getByRole("button", { name: "Reveal message", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText(
        "The password is incorrect or the hidden message has been damaged.",
      );
    }
  });

  test("rejects malformed JPEG, accepts ordinary JPEG as no-message, and keeps workflows independent", async ({ page }) => {
    const hideMessageHeading = page.getByRole("heading", {
      name: "Hide a message inside an image.",
      exact: true,
    });
    const workspace = page.getByRole("region", {
      name: "Hide or reveal a message in your browser",
      exact: true,
    });
    const imageInput = workspace.locator('input[type="file"]');

    await page.goto("/");
    await (await primaryNavigationLink(page, "Hide message")).click();
    await expect(page).toHaveURL(/\/hide-message$/);
    await expect(hideMessageHeading).toBeVisible();
    await expect(workspace.getByRole("button", { name: "Choose image", exact: true })).toBeVisible();
    await expect(imageInput).toHaveValue("");
    await workspace.getByRole("radio", { name: /Reveal a message/ }).check();
    await imageInput.setInputFiles({
      name: "not-png.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    });
    await expect(page.getByRole("alert")).toContainText(/JPEG|image/i);
    await imageInput.setInputFiles(
      resolve(process.cwd(), "tests/fixtures/jpeg-v2/libjpeg-testorig.jpg"),
    );
    await expect(page.getByRole("heading", { name: "No compatible hidden message found" })).toBeVisible();
    await expect(page.getByText(/No supported LTSG PNG v1 or JPEG v2 format marker was found/)).toBeAttached();
    await (await primaryNavigationLink(page, "Extract text")).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Add an image" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/hide-message$/);
    await expect(hideMessageHeading).toBeVisible();
    await expect(imageInput).toHaveValue("");
  });

  test("does not expose distinctive content through storage, caches, URLs, metadata, requests or logs", async ({ page, context }) => {
    const filenameMarker = "filename-privacy-marker.png";
    const messageMarker = "message-privacy-marker-π";
    const passwordMarker = "password-marker-012";
    const markers = [filenameMarker, messageMarker, passwordMarker];
    const network: string[] = [];
    const consoleMessages: string[] = [];
    page.on("request", (request) => {
      network.push([
        request.url(),
        request.method(),
        request.postData() ?? "",
        JSON.stringify(request.headers()),
      ].join("\n"));
    });
    page.on("console", (message) => consoleMessages.push(message.text()));
    await page.goto("/hide-message");
    await chooseCarrier(page, filenameMarker);
    await generatePng(page, messageMarker, passwordMarker);
    const browserEvidence = await page.evaluate(async () => {
      const cacheEvidence: string[] = [];
      for (const cacheName of await caches.keys()) {
        cacheEvidence.push(cacheName);
        const cache = await caches.open(cacheName);
        for (const request of await cache.keys()) {
          cacheEvidence.push(request.url);
          const response = await cache.match(request);
          const type = response?.headers.get("content-type") ?? "";
          if (response && (type.includes("text") || type.includes("javascript") || type.includes("json"))) {
            cacheEvidence.push(await response.clone().text());
          }
        }
      }
      const databases = indexedDB.databases ? await indexedDB.databases() : [];
      return {
        url: location.href,
        title: document.title,
        metadata: Array.from(document.head.querySelectorAll("meta"), (node) => node.outerHTML),
        local: { ...localStorage },
        session: { ...sessionStorage },
        cookies: document.cookie,
        databases: databases.map((database) => database.name),
        caches: cacheEvidence,
      };
    });
    const cookies = await context.cookies();
    const evidence = JSON.stringify({ browserEvidence, cookies, network, consoleMessages });
    for (const marker of markers) expect(evidence).not.toContain(marker);
    expect(network.every((entry) => entry.includes("\nGET\n"))).toBe(true);
    expect(network.some((entry) => /\/ocr\//.test(entry))).toBe(false);
  });

  test("works offline directly without preparing OCR", async ({ page, context }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto("/hide-message");
    await expect(page.locator(".header-offline-status summary")).toHaveText("Image OCR offline: setup needed", { timeout: 30_000 });
    // Go offline only once the service worker has finished caching this route's
    // document and every asset the build declares for it; the header text above
    // appears before that background preparation completes.
    const worker = await readFile("dist/sw.js", "utf8");
    const declaration = worker.match(/\{"path":"\/hide-message"[^\n]*?"assets":(\[[^\]]*\])/);
    expect(declaration).not.toBeNull();
    const routeAssets = ["/hide-message", ...JSON.parse(declaration![1]) as string[]];
    await expect.poll(() => page.evaluate(async (paths) => {
      const cache = await caches.open("localtext-shell-v10");
      const keys = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
      return paths.every((path) => keys.has(path));
    }, routeAssets), { timeout: 30_000 }).toBe(true);
    expect(requests.some((url) => url.includes("/ocr/"))).toBe(false);
    await context.setOffline(true);
    await page.reload();
    await chooseCarrier(page, "offline-source.png");
    await generatePng(page, "offline exact 🙂", "offline-pass-012");
    const download = await explicitDownload(page);
    const outputPath = await download.path();
    await page.getByRole("button", { name: "Clear" }).last().click();
    const revealed = await revealFile(page, outputPath!, "offline-pass-012");
    await expect(revealed).toHaveValue("offline exact 🙂");
    expect(requests.some((url) => url.includes("/ocr/"))).toBe(false);
    const cacheUrls = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        urls.push(...(await cache.keys()).map((request) => request.url));
      }
      return urls;
    });
    expect(cacheUrls.every((url) => !url.includes("blob:") && !url.includes("offline-source"))).toBe(true);
  });

  test("is keyboard accessible, responsive, dark-theme safe and free of serious Axe issues", async ({ page }) => {
    await page.goto("/hide-message");
    await page.evaluate(() => document.documentElement.dataset.theme = "dark");
    for (const width of [320, 375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 640, height: 720 });
    await page.evaluate(() => { document.body.style.zoom = "2"; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.evaluate(() => { document.body.style.zoom = ""; });
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    const { AxeBuilder } = await import("@axe-core/playwright");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
  });
});
