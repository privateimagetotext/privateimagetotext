import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertPrivateRuntime,
  fixtureDirectory,
  observeRuntime,
  openHarness,
  repositoryRoot,
  runScenario,
} from "./helpers";

test("mixed, rotated, font, password, cancellation and privacy experiments", async ({ page }) => {
  test.setTimeout(600_000);
  const evidence = await observeRuntime(page);
  await openHarness(page);

  const mixed = await runScenario(page, "mixed.pdf", "mixed");
  expect(mixed.selectableSentinel).toBe(true);
  expect(mixed.scannedTextLayerItems).toBe(0);
  expect(mixed.scannedSentinel).toBe(true);

  const rotated = await runScenario(page, "rotated.pdf", "rotated");
  expect(rotated.rotation).toBe(90);
  expect(rotated.sentinelFound).toBe(true);

  const font = await runScenario(page, "cmap-font.pdf", "font");
  expect(font.unicodePreserved).toBe(true);
  expect(font.textEqual).toBe(true);
  expect((font.defaultFont as Record<string, unknown>).realWorker).toBe(true);
  expect((font.disableFontFace as Record<string, unknown>).realWorker).toBe(true);

  const renderCancellation = await runScenario(page, "scanned.pdf", "render-cancel");
  expect(renderCancellation.cancelled).toBe(true);

  await page.locator("#pdf-file").setInputFiles(path.join(fixtureDirectory, "password.pdf"));
  await page.locator("#scenario").selectOption("password");
  await page.locator("#run").click();
  await expect(page.locator("#password-panel")).toBeVisible();
  await expect(page.locator("#password-reason")).toHaveText("Password required");
  await page.locator("#password").fill("wrong-test-value");
  await page.locator("#submit-password").click();
  await expect(page.locator("#password")).toHaveValue("");
  await expect(page.locator("#password-reason")).toHaveText("Incorrect test password");
  await page.locator("#password").fill("phase0-only");
  await page.locator("#submit-password").click();
  await page.waitForFunction(
    () => window.__PDF_PHASE0__.lastResult !== null,
    undefined,
    { timeout: 60_000 },
  );
  const passwordOpened = await page.evaluate(() => window.__PDF_PHASE0__.lastResult!);
  expect(passwordOpened.opened).toBe(true);
  expect(passwordOpened.incorrectAttempts).toBe(1);
  expect(passwordOpened.sentinelFound).toBe(true);
  expect(passwordOpened.passwordFieldCleared).toBe(true);

  await page.reload();
  await page.locator("#pdf-file").setInputFiles(path.join(fixtureDirectory, "password.pdf"));
  await page.locator("#scenario").selectOption("password");
  await page.locator("#run").click();
  await expect(page.locator("#password-panel")).toBeVisible();
  await expect(page.locator("#password-reason")).toHaveText("Password required");
  await page.locator("#cancel-password").click();
  await page.waitForFunction(
    () => window.__PDF_PHASE0__.lastResult !== null,
    undefined,
    { timeout: 60_000 },
  );
  const passwordCancelled = await page.evaluate(() => window.__PDF_PHASE0__.lastResult!);
  expect(passwordCancelled.cancelled).toBe(true);
  expect(passwordCancelled.passwordFieldCleared).toBe(true);

  await assertPrivateRuntime(page, evidence, [
    "mixed.pdf",
    "rotated.pdf",
    "cmap-font.pdf",
    "password.pdf",
    "MIXED SELECTABLE PAGE 112358",
    "CMAP SUPPORT SENTINEL 97531",
    "日本",
    "PASSWORD FIXTURE OPEN 424242",
    "wrong-test-value",
    "phase0-only",
  ]);

  const outputDirectory = path.join(repositoryRoot, "tmp", "pdf-phase0");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, "privacy-evidence.json"),
    `${JSON.stringify(
      {
        mixed,
        rotated,
        font,
        renderCancellation,
        passwordOpened,
        passwordCancelled,
        requests: evidence.requests.map(({ method, resourceType, url }) => ({
          method,
          resourceType,
          pathname: new URL(url).pathname,
        })),
        consoleMessages: evidence.consoleMessages,
        workerUrls: evidence.workerUrls,
      },
      null,
      2,
    )}\n`,
  );
});
