import languageManifest from "../src/config/ocr-languages.json" with { type: "json" };
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  publicRouteDocuments,
  publicRouteManifest,
} from "../src/config/routes";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(
  currentDirectory,
  "fixtures",
  "localtext-ocr.png",
);

const cropFixtures = [
  {
    name: "portrait",
    filename: "crop-portrait.png",
    sourceWidth: 320,
    sourceHeight: 640,
  },
  {
    name: "landscape",
    filename: "crop-landscape.png",
    sourceWidth: 800,
    sourceHeight: 400,
  },
] as const;

async function chooseImageFixture(page: Page, filename: string) {
  await page
    .getByLabel("Choose image file", { exact: true })
    .setInputFiles(path.join(currentDirectory, "fixtures", filename));
  await expect(page.getByText(filename, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy text" })).toBeEnabled({ timeout: 120_000 });
}

async function chooseFixture(page: Page) {
  await chooseImageFixture(page, path.basename(fixturePath));
}

async function extractFixture(page: Page) {
  await chooseFixture(page);
  const result = page.getByLabel("Tidied");
  await expect(result).toBeVisible({ timeout: 120_000 });
  await expect(result).toHaveValue(/LOCALTEXT\s+OFFLINE\s+OCR\s+TEST\s+7429/i, {
    timeout: 120_000,
  });
  return result;
}

const publicRoutes = publicRouteDocuments.map(
  ({ path: routePath, title, description, heading, routeType }) => ({
    path: routePath,
    title,
    description,
    h1: heading,
    routeType,
  }),
);
const CLOUDFLARE_BEACON_URL =
  "https://static.cloudflareinsights.com/beacon.min.js";
const CLOUDFLARE_RUM_PATH = "/cdn-cgi/rum";

test("real OCR remains local-preview-only and supports copy, download and Clear", async ({
  page,
  context,
  baseURL,
}) => {
  const requests: Array<{ url: string; method: string }> = [];
  const consoleMessages: string[] = [];
  page.on("request", (request) => {
    requests.push({ url: request.url(), method: request.method() });
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleMessages.push(message.text());
  });
  page.on("pageerror", (error) => consoleMessages.push(error.message));

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const response = await page.goto("/");
  const localCsp = response?.headers()["content-security-policy"] ?? "";
  expect(localCsp).toContain("connect-src 'self'");
  expect(localCsp).not.toContain(CLOUDFLARE_BEACON_URL);
  await extractFixture(page);

  await page.getByRole("button", { name: "Edit this version" }).click();
  const editor = page.getByLabel("Your edits");
  await editor.fill("LOCALTEXT VERIFIED 7429");
  await page.getByRole("button", { name: "Copy text" }).click();
  await expect(page.getByText("Text copied.")).toBeAttached();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
    "LOCALTEXT VERIFIED 7429",
  );

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .txt" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("localtext-ocr-ocr.txt");

  await page.getByRole("button", { name: "Clear", exact: true }).last().click();
  await expect(
    page.getByRole("heading", { name: "Add an image" }),
  ).toBeVisible();

  const expectedOrigin = new URL(baseURL!).origin;
  const externalRequests = requests.filter(
    (request) =>
      request.url.startsWith("http") &&
      new URL(request.url).origin !== expectedOrigin,
  );
  expect(externalRequests).toEqual([]);
  expect(
    requests.filter((request) => !["GET", "HEAD"].includes(request.method)),
  ).toEqual([]);
  expect(
    requests.some(
      (request) =>
        request.url.startsWith(CLOUDFLARE_BEACON_URL) ||
        new URL(request.url).pathname === CLOUDFLARE_RUM_PATH,
    ),
  ).toBe(false);
  expect(
    requests.some((request) => request.url.includes("/ocr/worker.min.js")),
  ).toBe(true);
  expect(
    requests.some(
      (request) =>
        new URL(request.url).pathname === languageManifest.models[0].path,
    ),
  ).toBe(true);
  expect(requests.filter((request) => request.url.endsWith(".gz"))
    .every((request) => new URL(request.url).pathname === languageManifest.models[0].path)).toBe(true);
  expect(consoleMessages).toEqual([]);
});

test("crop edge sliders remain usable during pointer drags", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await chooseFixture(page);
  await page.getByRole("button", { name: "Crop", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Choose the text area" });
  await expect(dialog).toBeVisible();

  const edges = [
    { name: /left edge/i, resetValue: "0" },
    { name: /top edge/i, resetValue: "0" },
    { name: /right edge/i, resetValue: "100" },
    { name: /bottom edge/i, resetValue: "100" },
  ];
  for (const { name, resetValue } of edges) {
    await page.getByRole("button", { name: "Reset crop" }).click();
    const slider = page.getByRole("slider", { name });
    await expect(slider).toHaveValue(resetValue);
    const bounds = await slider.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) continue;

    const y = bounds.y + bounds.height / 2;
    await page.mouse.move(bounds.x + bounds.width * 0.25, y);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.75, y, { steps: 8 });
    await page.mouse.up();

    await expect(dialog).toBeVisible();
    await expect(page.locator("#root")).not.toBeEmpty();
    await expect(slider).not.toHaveValue(resetValue);
  }

  await page.getByRole("button", { name: "Apply crop" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Crop", exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

for (const fixture of cropFixtures) {
  test(`crop overlay and extracted source area match for a ${fixture.name} image`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await chooseImageFixture(page, fixture.filename);
    await page.getByRole("button", { name: "Crop", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Choose the text area" });
    const image = dialog.getByRole("img", { name: "Image being cropped" });
    const mediaFrame = dialog.getByTestId("crop-media-frame");
    const overlay = dialog.locator(".crop-overlay");
    await expect(dialog).toBeVisible();
    await expect(image).toBeVisible();

    const [imageBox, frameBox, overlayBox] = await Promise.all([
      image.boundingBox(),
      mediaFrame.boundingBox(),
      overlay.boundingBox(),
    ]);
    expect(imageBox).not.toBeNull();
    expect(frameBox).not.toBeNull();
    expect(overlayBox).not.toBeNull();
    if (!imageBox || !frameBox || !overlayBox) return;

    for (const property of ["x", "y", "width", "height"] as const) {
      expect(
        Math.abs(imageBox[property] - frameBox[property]),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(overlayBox[property] - frameBox[property]),
      ).toBeLessThanOrEqual(1);
    }
    expect(imageBox.width / imageBox.height).toBeCloseTo(
      fixture.sourceWidth / fixture.sourceHeight,
      2,
    );

    const topLeftHandle = overlay.locator(
      '[data-crop-handle="top-left"]',
    );
    const handleBox = await topLeftHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    if (!handleBox) return;

    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      frameBox.x + frameBox.width * 0.25,
      frameBox.y + frameBox.height * 0.25,
      { steps: 8 },
    );
    await page.mouse.up();

    await expect(page.getByRole("slider", { name: /left edge/i })).toHaveValue(
      "25",
    );
    await expect(page.getByRole("slider", { name: /top edge/i })).toHaveValue(
      "25",
    );
    expect(Number(await topLeftHandle.getAttribute("cx"))).toBeCloseTo(25, 1);
    expect(Number(await topLeftHandle.getAttribute("cy"))).toBeCloseTo(25, 1);

    await page.getByRole("button", { name: "Apply crop" }).click();
    await expect(dialog).toBeHidden();

    const canvas = page.getByLabel("Locally prepared image preview");
    const expectedWidth = fixture.sourceWidth * 0.75;
    const expectedHeight = fixture.sourceHeight * 0.75;
    await expect
      .poll(() =>
        canvas.evaluate((element: HTMLCanvasElement) => ({
          width: element.width,
          height: element.height,
        })),
      )
      .toEqual({ width: expectedWidth, height: expectedHeight });

    const samples = await canvas.evaluate((element: HTMLCanvasElement) => {
      const context = element.getContext("2d");
      if (!context) return [];
      return [
        [1, 1],
        [Math.floor(element.width / 2), Math.floor(element.height / 2)],
        [element.width - 2, element.height - 2],
      ].map(([x, y]) =>
        Array.from(context.getImageData(x, y, 1, 1).data),
      );
    });
    expect(samples).toHaveLength(3);
    for (const [red, green, blue, alpha] of samples) {
      expect(red).toBeCloseTo(30, -1);
      expect(green).toBeCloseTo(180, -1);
      expect(blue).toBeCloseTo(90, -1);
      expect(alpha).toBe(255);
    }
  });
}

test("public routes expose complete metadata, accessible structure and navigation history", async ({
  page,
}) => {
  const renderErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") renderErrors.push(message.text());
  });
  page.on("pageerror", (error) => renderErrors.push(error.message));

  for (const route of publicRoutes) {
    const response = await page.goto(route.path);
    expect(response?.status()).toBe(200);
    expect(new URL(response!.url()).pathname).toBe(route.path);
    const localCsp = response?.headers()["content-security-policy"] ?? "";
    expect(localCsp).toContain("connect-src 'self'");
    expect(localCsp).not.toContain(CLOUDFLARE_BEACON_URL);
    expect(response?.headers()["x-robots-tag"]).toBe(
      "noindex, nofollow, noarchive, nosnippet",
    );
    const rawHtml = await response!.text();
    expect(rawHtml).toContain(`data-route-path="${route.path}"`);
    expect(rawHtml).toContain(`<title>${route.title}</title>`);
    expect(rawHtml).toContain(route.h1);
    const canonical = route.path === "/" ? "/" : route.path;
    await expect(page).toHaveTitle(route.title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", route.description);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://privateimagetotext.com${canonical}`);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", route.title);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", route.description);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", `https://privateimagetotext.com${canonical}`);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
      "content",
      route.routeType === "guide" ? "article" : "website",
    );
    await expect(page.getByRole("heading", { level: 1, name: route.h1 })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    if (route.routeType === "guide") {
      await expect(
        page.locator('article'),
      ).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Breadcrumb" }))
        .toBeVisible();
      await expect(page.getByRole("heading", { name: "Related guides" }))
        .toBeVisible();
    }
    await expect(
      page.locator(`script[src^="${CLOUDFLARE_BEACON_URL}"]`),
    ).toHaveCount(0);
    const contactLinks = page.locator(
      'a[href="mailto:contact@privateimagetotext.com"]',
    );
    expect(await contactLinks.count()).toBeGreaterThan(0);
    await expect(contactLinks.first()).toBeVisible();

    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  }

  await page.goto("/privacy");
  await page.getByRole("link", { name: "Read the technical privacy architecture" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Technical privacy architecture" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Your files and content stay in your browser." })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1, name: "Technical privacy architecture" })).toBeVisible();
  expect(renderErrors).toEqual([]);

  for (const missingPath of [
    "/missing-local-route",
    "/privacy/not-a-route",
    "/guides/not-a-guide",
  ]) {
    const missingResponse = await page.goto(missingPath);
    expect(missingResponse?.status()).toBe(404);
    expect(missingResponse?.headers()["content-security-policy"]).toContain(
      "connect-src 'self'",
    );
    expect(missingResponse?.headers()["x-robots-tag"]).toBe(
      "noindex, nofollow, noarchive, nosnippet",
    );
    const missingHtml = await missingResponse!.text();
    expect(missingHtml).toContain('data-route-path="/__not-found__"');
    expect(missingHtml).not.toContain('rel="canonical"');
    expect(missingHtml).not.toContain('property="og:url"');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "There is no page at this address" }),
    ).toBeVisible();
    await expect(page.locator('[aria-current="page"]')).toHaveCount(0);
  }

  const securityTextResponse = await page.request.get("/.well-known/security.txt");
  expect(securityTextResponse.status()).toBe(200);
  expect(securityTextResponse.headers()["content-type"]).toContain("text/plain");
  expect(await securityTextResponse.text()).toContain(
    "Contact: mailto:contact@privateimagetotext.com",
  );

  await page.goto("/privacy");
  await page.evaluate(() => {
    history.pushState({}, "", "/missing-client-route");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByRole("heading", { name: "There is no page at this address" })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await page.getByRole("link", { name: "Private Image to Text tool" }).click();
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://privateimagetotext.com/",
  );

  const trailingSlash = await page.request.get("/privacy/", {
    maxRedirects: 0,
  });
  expect(trailingSlash.status()).toBe(404);
  expect(
    renderErrors.filter(
      (message) =>
        message !==
        "Failed to load resource: the server responded with a status of 404 (Not Found)",
    ),
  ).toEqual([]);
});

test("responsive layout and keyboard menu remain usable", async ({ page }) => {
  await page.goto("/");
  for (const width of [320, 375, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  await page.setViewportSize({ width: 375, height: 812 });
  const menuButton = page.getByRole("button", {
    name: "Open navigation menu",
  });
  await menuButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Navigation menu" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Navigation menu" })).toBeHidden();
  await expect(menuButton).toBeFocused();
});

test("long-page tables of contents work with keyboard and compact layouts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/privacy");

  const desktopToc = page.locator(".content-page__toc-desktop");
  await expect(desktopToc).toBeVisible();
  const clearLink = desktopToc.getByRole("link", { name: "What Clear removes" });
  await clearLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#privacy-clear-title$/);
  await expect(page.locator("#privacy-clear-title")).toBeVisible();
  const desktopClearance = await page.evaluate(() => {
    const heading = document.querySelector("#privacy-clear-title");
    const header = document.querySelector(".app-header");
    if (!heading || !header) return -1;
    return heading.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
  });
  expect(desktopClearance).toBeGreaterThanOrEqual(0);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/privacy");
  const mobileToc = page.locator(".content-page__toc-mobile");
  await expect(mobileToc).toBeVisible();
  await mobileToc.locator("summary").click();
  await mobileToc.getByRole("link", { name: "Hosting and traffic analytics" }).click();
  await expect(page).toHaveURL(/#privacy-services-title$/);
  await expect(page.locator("#privacy-services-title")).toBeVisible();
});

test("cached application and OCR assets work after going offline", async ({
  page,
  context,
  baseURL,
}) => {
  test.slow();
  const renderErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") renderErrors.push(message.text());
  });
  page.on("pageerror", (error) => renderErrors.push(error.message));
  await page.goto("/");
  await extractFixture(page);
  await expect(
    page.locator(".offline-readiness"),
  ).toHaveText("Offline: ready for English", { timeout: 90_000 });

  const cachePaths = await page.evaluate(async () => {
    const keys = await caches.keys();
    const entries = await Promise.all(
      keys.map(async (key) => {
        const cache = await caches.open(key);
        return Promise.all((await cache.keys()).map((request) => request.url));
      }),
    );
    return entries.flat();
  });
  expect(
    cachePaths.some(
      (url) => new URL(url).pathname === languageManifest.models[0].path,
    ),
  ).toBe(true);
  expect(cachePaths.filter((url) => url.endsWith(".gz"))
    .every((url) => new URL(url).pathname === languageManifest.models[0].path)).toBe(true);
  expect(
    cachePaths.every((url) => {
      const parsed = new URL(url);
      return (
        parsed.origin === new URL(baseURL!).origin &&
        !parsed.search &&
        !parsed.hash
      );
    }),
  ).toBe(true);

  const cachedDocuments = await page.evaluate(async (paths) => {
    const cache = await caches.open("localtext-shell-v10");
    return Object.fromEntries(
      await Promise.all(
        paths.map(async (pathname) => [
          pathname,
          await (await cache.match(pathname))?.text(),
        ]),
      ),
    );
  }, publicRoutes.map(({ path: routePath }) => routePath));
  for (const route of publicRoutes) {
    expect(cachedDocuments[route.path]).toContain(
      `data-route-path="${route.path}"`,
    );
    expect(cachedDocuments[route.path]).toContain(
      `rel="canonical" href="https://privateimagetotext.com${route.path}"`,
    );
  }
  expect(new Set(Object.values(cachedDocuments)).size).toBe(publicRoutes.length);

  // Tool chunks are now cached on that tool's first visit.
  await page.goto("/media-inspector");
  await expect(page.getByLabel("Choose a media file to inspect")).toBeAttached();
  await expect.poll(() => page.evaluate(async () => {
    const cache = await caches.open("localtext-shell-v10");
    return (await cache.keys()).some(request => /MediaInspectorPage-.*\.js$/.test(request.url));
  })).toBe(true);
  await page.goto("/");
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Extract text from images. Nothing uploaded." })).toBeVisible();
  await extractFixture(page);
  for (const route of [
    publicRouteManifest.mediaInspector,
    publicRouteManifest.guideScreenshotToText,
    publicRouteManifest.privacyTechnical,
  ]) {
    await page.goto(route.path);
    await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `https://privateimagetotext.com${route.path}`,
    );
  }
  const offlineQuery = await page.goto("/privacy?offline=1");
  expect(offlineQuery?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: publicRouteManifest.privacy.heading,
    }),
  ).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://privateimagetotext.com/privacy",
  );
  expect(renderErrors).toEqual([]);
  const offlineTrailingSlash = await page.goto("/privacy/");
  expect(offlineTrailingSlash?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "There is no page at this address" })).toBeVisible();
  const offlineMissing = await page.goto("/missing-offline-route");
  expect(offlineMissing?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "There is no page at this address" })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  expect(
    renderErrors.filter(
      (message) =>
        message !==
        "Failed to load resource: the server responded with a status of 404 (Not Found)",
    ),
  ).toEqual([]);
  await context.setOffline(false);
});
