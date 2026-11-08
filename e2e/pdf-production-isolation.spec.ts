import { expect, test } from "@playwright/test";

const representativeRoutes = [
  "/",
  "/hide-message",
  "/media-inspector",
  "/guides",
  "/guides/improve-ocr-accuracy",
  "/privacy",
  "/privacy/technical",
  "/verify",
] as const;

test("ordinary public routes never request or prepare PDF foundations", async ({
  page,
  context,
}) => {
  const pdfRequests: string[] = [];
  context.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/pdf/6.2.108/")) pdfRequests.push(request.url());
  });

  for (const route of representativeRoutes) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expect(page.locator("h1"), route).toHaveCount(1);
  }
  await page.waitForTimeout(500);
  expect(pdfRequests).toEqual([]);
  const cacheNames = await page.evaluate(async () => caches.keys());
  expect(cacheNames).not.toContain("localtext-pdf-v1-pdfjs-6.2.108");
  expect(cacheNames.some((name) => name.startsWith("localtext-pdf-"))).toBe(false);
});
