import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";

for (const width of [390, 1280]) {
  test(`Markdown can be reviewed, copied and downloaded at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const external: string[] = [];
    const origin = new URL(testInfo.project.use.baseURL!).origin;
    page.on("request", request => {
      if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) external.push(request.url());
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Terminal", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Tidied", exact: true })).toHaveValue(/ERR-4097/, { timeout: 120_000 });
    await page.getByLabel("Content type").selectOption("code");
    await page.getByRole("button", { name: "Re-run OCR", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Tidied", exact: true })).toHaveValue(/ERR-4097/, { timeout: 120_000 });
    await page.getByRole("button", { name: "Original OCR", exact: true }).click();
    const raw = await page.getByRole("textbox", { name: "Original OCR", exact: true }).inputValue();
    await page.getByRole("button", { name: "Markdown", exact: true }).click();
    const result = page.getByRole("textbox", { name: "Markdown", exact: true });
    const markdown = `\`\`\`\n${raw}${raw.endsWith("\n") ? "" : "\n"}\`\`\``;
    await expect(result).toHaveValue(markdown);
    await page.getByRole("button", { name: "Copy text", exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(markdown);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download .md", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("code-terminal-ocr.md");
    const destination = testInfo.outputPath("result.md");
    await download.saveAs(destination);
    expect(await readFile(destination, "utf8")).toBe(markdown);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator(".result-tabs").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`markdown-${width}.png`) });
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations.filter(item => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
    expect(external).toEqual([]);
    await page.getByRole("button", { name: "Clear", exact: true }).first().click();
    await expect(result).toHaveCount(0);
  });
}

for (const fixture of [
  { name: "two-column-document", anchors: ["COLUMN-A12", "COLUMN-B34"] },
  { name: "two-column-no-divider", anchors: ["LAYOUT-L17", "LAYOUT-R83"] },
  { name: "two-column-spanning-heading", anchors: ["LAYOUT-L21", "LAYOUT-R89"] },
]) {
  test(`Markdown separates the real ${fixture.name} recognition into columns`, async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Choose image file", { exact: true }).setInputFiles(path.resolve(`e2e/fixtures/ocr-corpus/${fixture.name}.png`));
    await expect(page.getByRole("textbox", { name: "Tidied", exact: true })).toBeVisible({ timeout: 120_000 });
    await page.getByLabel("Content type").selectOption("columns");
    await page.getByRole("button", { name: "Re-run OCR", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Tidied", exact: true })).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: "Markdown", exact: true }).click();
    const markdown = await page.getByRole("textbox", { name: "Markdown", exact: true }).inputValue();
    const sections = markdown.split("\n\n---\n\n");
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain(fixture.anchors[0]);
    expect(sections[1]).toContain(fixture.anchors[1]);
    if (fixture.name.endsWith("spanning-heading")) {
      expect(markdown.match(/LAYOUT-H55/g)).toHaveLength(1);
      expect(markdown.indexOf("LAYOUT-H55")).toBeLessThan(markdown.indexOf(fixture.anchors[0]));
    }
  });
}
