import { expect, test } from "@playwright/test";
import { findGuideBySlug } from "../src/config/guides";

const screenshotToTextGuide = findGuideBySlug("screenshot-to-text")!;

test("JSON-LD survives hydration and follows client navigation under CSP", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const graph = () => page.locator('script[type="application/ld+json"]').evaluateAll((scripts) => {
    if (scripts.length !== 1) throw new Error(`Expected one block, got ${scripts.length}`);
    return JSON.parse(scripts[0].textContent ?? "")["@graph"];
  });
  await page.goto("/guides/screenshot-to-text");
  await expect.poll(async () => (await graph()).find((node: { "@type": string }) => node["@type"] === "HowTo")?.dateModified)
    .toBe(`${screenshotToTextGuide.dateModified}T00:00:00Z`);
  await page.getByRole("navigation", { name: "Guide actions" }).getByRole("link", { name: "Read the privacy explanation" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect.poll(async () => (await graph()).map((node: { "@type": string }) => node["@type"]))
    .toEqual(["WebSite", "Organization"]);
  await page.goBack();
  await expect.poll(async () => (await graph()).find((node: { "@type": string }) => node["@type"] === "HowTo")?.dateModified)
    .toBe(`${screenshotToTextGuide.dateModified}T00:00:00Z`);
  await page.goto("/");
  await expect.poll(async () => (await graph()).some((node: { "@type": string | string[] }) => node["@type"].includes("SoftwareApplication"))).toBe(true);
  const facts = page.getByRole("region", { name: "What this tool does" });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(facts.getByRole("heading", { level: 2 })).toBeVisible();
    await expect(facts.locator("dt")).toHaveCount(8);
    expect(await facts.evaluate((section) => section.scrollWidth <= section.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await facts.screenshot({ path: testInfo.outputPath(`ocr-facts-${width}.png`) });
  }
  await page.goto("/privacy/technical");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
  expect((await graph()).filter((node: { "@type": string }) => node["@type"] === "BreadcrumbList")).toHaveLength(1);
  expect(errors).toEqual([]);
});
