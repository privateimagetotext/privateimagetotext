import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";

for (const [width, height] of [[390, 844], [1305, 924]]) {
  test(`FAQ, About and offline status at ${width}x${height}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    const status = page.locator(".offline-readiness:visible, .ocr-mobile-readiness:visible");
    await expect(status).toHaveText("Offline: site ready, models not yet cached");
    await expect(page.locator(".trust-markers li:visible")).toHaveCount(width < 640 ? 3 : 4);
    await expect(status).toHaveAttribute("aria-live", "polite");
    expect(await page.locator('[aria-live="polite"]:visible').allTextContents()).toEqual(
      expect.arrayContaining(["Offline: site ready, models not yet cached"]),
    );
    expect((await page.locator('[aria-live="polite"]:visible').allTextContents()).filter((text) => text.startsWith("Offline:"))).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const choose = await page.getByRole("button", { name: "Choose image", exact: true }).boundingBox();
    expect(choose!.y + choose!.height).toBeLessThanOrEqual(height);
    await mkdir("docs/screenshots", { recursive: true });
    await page.screenshot({ path: `docs/screenshots/b6-after-${width}x${height}.png` });
    const header = page.locator(".header-offline-status");
    const summary = header.locator("summary");
    await expect(summary).toHaveAccessibleName("Image OCR offline: setup needed");
    const target = await summary.boundingBox();
    expect(target!.height).toBeGreaterThanOrEqual(44);
    expect(target!.width).toBeGreaterThanOrEqual(44);
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(header).toHaveAttribute("open", "");
    await expect(header.locator("p")).toBeVisible();
    await page.screenshot({ path: `docs/screenshots/b6-explanation-${width}x${height}.png` });
    await page.keyboard.press("Enter");
    const faq = page.getByRole("region", { name: "Frequently asked questions" });
    await expect(faq.locator("details")).toHaveCount(8);
    await faq.locator("summary").first().click();
    await expect(faq.locator("details").first().locator("p")).toBeVisible();
    await expect(faq.locator("details").first().getByRole("link")).toHaveAttribute("href", "/verify");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Prepare offline OCR", exact: true }).click();
    await expect(status).toHaveText("Offline: ready for English", { timeout: 90_000 });
    await expect(summary).toHaveAccessibleName("Image OCR offline: ready for English");
    // Repeated cache replies must not mutate the live-region text again.
    const mutations = await status.evaluate(async (element) => {
      let count = 0;
      const observer = new MutationObserver(() => { count += 1; });
      observer.observe(element, { subtree: true, childList: true, characterData: true });
      const registration = await navigator.serviceWorker.ready;
      const worker = navigator.serviceWorker.controller ?? registration.active!;
      await new Promise<void>((resolve) => {
        let replies = 0;
        const listener = (event: MessageEvent) => {
          if (event.source === worker && event.data?.type === "OCR_CACHE_STATUS" && ++replies === 3) {
            navigator.serviceWorker.removeEventListener("message", listener);
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }
        };
        navigator.serviceWorker.addEventListener("message", listener);
        for (let index = 0; index < 3; index += 1) worker.postMessage({ type: "CHECK_OCR_CACHE" });
      });
      observer.disconnect();
      return count;
    });
    expect(mutations).toBe(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `docs/screenshots/b6-ready-${width}x${height}.png` });
    await context.setOffline(true);
    await page.reload();
    await expect(status).toHaveText("Offline: ready for English");
    await page.getByRole("navigation", { name: "Footer navigation" }).getByRole("link", { name: "About", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("About Private Image to Text");
    await expect(page.getByText("The source is not public yet.", { exact: false })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("About Private Image to Text");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(errors).toEqual([]);
  });
}
