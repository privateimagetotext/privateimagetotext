import { expect, test } from "@playwright/test";

const tools = [
  { path: "/", name: "Image to text" },
  { path: "/pdf-to-text", name: "PDF to text" },
  { path: "/hide-message", name: "Hide a message" },
  { path: "/media-inspector", name: "Media Inspector" },
];

for (const tool of tools) {
  test(`${tool.path} offers the other tools without leaving its workspace`, async ({ page }) => {
    await page.goto(tool.path);
    const directory = page.getByRole("region", { name: "Other tools that keep your files in this browser" });
    const links = directory.getByRole("link");
    // tests/components/tool-directory.test.tsx enforces the exact tool set.
    for (const other of tools.filter((item) => item.path !== tool.path)) {
      await expect(directory.locator(`a[href="${other.path}"]`)).toHaveCount(1);
    }
    await expect(directory.locator(`a[href="${tool.path}"]`)).toHaveCount(0);

    // A page-lifetime marker shows the workspace document was not replaced.
    await page.evaluate(() => { (window as unknown as { workspaceMarker: number }).workspaceMarker = 42; });
    const first = links.first();
    await expect(first).toHaveAttribute("target", "_blank");
    await expect(first).toHaveAttribute("rel", "noopener noreferrer");
    const popupEvent = page.waitForEvent("popup");
    await first.click();
    const popup = await popupEvent;
    await popup.waitForLoadState("domcontentloaded");
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    await expect(popup.locator("h1")).toBeVisible();
    expect(new URL(popup.url()).pathname).not.toBe(tool.path);
    expect(new URL(page.url()).pathname).toBe(tool.path);
    expect(await page.evaluate(() => (window as unknown as { workspaceMarker?: number }).workspaceMarker)).toBe(42);
    await popup.close();
  });
}

for (const width of [320, 390]) {
  test(`homepage names the other tools above the image picker at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const strip = page.getByRole("navigation", { name: "Other tools" });
    for (const other of tools.slice(1)) {
      await expect(strip.locator(`a[href="${other.path}"]`)).toHaveCount(1);
    }
    for (const link of await strip.getByRole("link").all()) {
      await expect(link).toBeInViewport();
      await expect(link).toHaveAttribute("target", "_blank");
    }
    const stripBox = (await strip.boundingBox())!;
    const choose = (await page.getByRole("button", { name: "Choose image", exact: true }).boundingBox())!;
    expect(stripBox.y + stripBox.height).toBeLessThanOrEqual(choose.y);
    expect(choose.y + choose.height).toBeLessThanOrEqual(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`the not-found page leads to every tool at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const response = await page.goto("/no-such-page");
    expect(response?.status()).toBe(404);
    const picker = page.getByRole("region", { name: "Pick a tool" });
    for (const tool of tools) {
      await expect(picker.locator(`a[href="${tool.path}"]`)).toHaveCount(1);
    }
    await expect(page.getByRole("region", { name: "Popular guides" }).getByRole("link").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await picker.getByRole("link", { name: /Inspect a photo/ }).click();
    await expect(page).toHaveURL(/\/media-inspector$/);
    await expect(page.locator("h1")).toHaveText("Inspect photo and video metadata. Nothing uploaded.");
  });
}

for (const width of [1100, 1280, 1304]) {
  test(`the header shows the tools without the menu at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/media-inspector");
    const toolsNav = page.getByRole("navigation", { name: "Tools", exact: true });
    for (const tool of tools) await expect(toolsNav.locator(`a[href="${tool.path}"]`)).toBeVisible();
    await expect(toolsNav.locator('a[href="/media-inspector"]')).toHaveClass(/is-active/);
    await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeVisible();
    const geometry = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      return { word: box(".app-wordmark").right, navLeft: box(".app-header__tools").left, navRight: box(".app-header__tools").right, actions: box(".app-header__actions").left, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(geometry.navLeft).toBeGreaterThanOrEqual(geometry.word);
    expect(geometry.navRight).toBeLessThanOrEqual(geometry.actions);
    expect(geometry.overflow).toBe(false);
  });
}

test("the full navigation replaces the tool row on wide screens", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Tools", exact: true })).toBeHidden();
});
