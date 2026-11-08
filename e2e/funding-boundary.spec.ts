import { expect, test } from "@playwright/test";

// The funding page and its footer link stay first-party, and client-side
// navigation never carries funding markup into a tool workspace.

const FUNDING_SELECTOR =
  "[data-funding-link], [data-funding-block], .paired-tools, .support-link, a[rel~='sponsored']";

test("the funding page loads only same-origin resources and links to the privacy pages", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== origin) foreign.push(request.url());
  });
  await page.goto("/funding");
  await expect(page.getByRole("heading", { level: 1, name: "How this site is funded" })).toBeVisible();
  await expect(page.getByText("There are currently no affiliate links on this site.")).toBeVisible();
  const main = page.locator("main");
  await expect(main.getByRole("link", { name: "Read the plain-language Privacy page" })).toHaveAttribute("href", "/privacy");
  await expect(main.getByRole("link", { name: "Verify that your files are not uploaded" })).toHaveAttribute("href", "/verify");
  await page.waitForLoadState("networkidle");
  expect(foreign).toEqual([]);
});

test("client-side navigation from the footer funding link to each tool shows no funding markup", async ({ page }) => {
  await page.goto("/guides/remove-photo-metadata-before-sharing");
  // A guide's footer may carry the one support link; its content may not.
  await expect(page.locator(FUNDING_SELECTOR)).toHaveCount(1);
  await expect(page.locator(".app-footer .support-link")).toHaveCount(1);
  await page.locator(".app-footer").getByRole("link", { name: "How this site is funded" }).click();
  await expect(page).toHaveURL(/\/funding$/);
  await expect(page).toHaveTitle(/How This Site Is Funded/);

  for (const [name, path] of [
    ["Extract text", "/"],
    ["Hide message", "/hide-message"],
    ["Media Inspector", "/media-inspector"],
    ["Steganography analysis", "/steganography-analysis"],
  ] as const) {
    await page.locator(".app-footer").getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/$" : `${path}$`}`));
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator(FUNDING_SELECTOR)).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(/affiliate|paid link/i);
    await page.goBack();
    await expect(page).toHaveURL(/\/funding$/);
    await expect(page.getByRole("heading", { level: 1, name: "How this site is funded" })).toBeVisible();
  }
});
