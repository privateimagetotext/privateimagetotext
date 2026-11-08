import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  annotateEnvironment,
  assertPrivateRuntime,
  harnessOrigin,
  observeRuntime,
  openHarness,
  repositoryRoot,
  runScenario,
} from "./helpers";

test("real worker, selectable text, scanned OCR and cleanup", async ({ page, browser }, testInfo) => {
  test.setTimeout(360_000);
  const evidence = await observeRuntime(page);
  await openHarness(page);

  const selectable = await runScenario(page, "selectable.pdf", "selectable");
  expect(selectable.realWorker).toBe(true);
  expect(selectable.pageCount).toBe(2);
  expect(selectable.sentinelFound).toBe(true);
  expect(selectable.unicodePreserved).toBe(true);
  expect(selectable.hasLineEnding).toBe(true);
  expect(selectable.firstTransform).toHaveLength(6);

  const scanned = await runScenario(page, "scanned.pdf", "scanned");
  expect(scanned.realWorker).toBe(true);
  expect(scanned.textLayerItems).toBe(0);
  expect(scanned.sentinelFound).toBe(true);
  expect(Number(scanned.width)).toBeLessThanOrEqual(4_096);
  expect(Number(scanned.height)).toBeLessThanOrEqual(4_096);
  expect(Number(scanned.width) * Number(scanned.height)).toBeLessThanOrEqual(4_096 ** 2);

  const font = await runScenario(page, "cmap-font.pdf", "font");
  expect(font.unicodePreserved).toBe(true);
  expect(font.textEqual).toBe(true);

  const cleanup = await runScenario(page, "selectable.pdf", "cleanup");
  expect(cleanup.noWorkerGrowth).toBe(true);
  expect(cleanup.canvasZeroed).toBe(true);

  const workerState = await page.evaluate(() => window.__PDF_PHASE0__.workerEvidence);
  expect(workerState.active).toBe(0);
  expect(workerState.constructed).toBeGreaterThan(0);
  expect(workerState.constructed).toBe(workerState.terminated);
  expect(workerState.urls.every((url) => new URL(url).origin === harnessOrigin)).toBe(true);
  expect(evidence.workerUrls.some((url) => /pdf\.worker/.test(url))).toBe(true);

  await assertPrivateRuntime(page, evidence, [
    "selectable.pdf",
    "scanned.pdf",
    "cmap-font.pdf",
    "PDF PHASE ZERO SELECTABLE 271828",
    "SENTINEL 314159",
    "CMAP SUPPORT SENTINEL 97531",
    "日本",
    "phase0-only",
  ]);

  const environment = {
    ...annotateEnvironment(testInfo),
    browserVersion: browser.version(),
    userAgent: await page.evaluate(() => navigator.userAgent),
    platform: await page.evaluate(() => navigator.platform),
  };
  const outputDirectory = path.join(repositoryRoot, "tmp", "pdf-phase0");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, `browser-${testInfo.project.name}.json`),
    `${JSON.stringify({ environment, selectable, scanned, font, cleanup, workerState }, null, 2)}\n`,
  );

  await testInfo.attach("pdf-phase0-core-evidence", {
    contentType: "application/json",
    body: Buffer.from(JSON.stringify({
      environment,
      selectable,
      scanned,
      font,
      cleanup,
      workerState,
      requests: evidence.requests.map(({ method, resourceType, url }) => ({
        method,
        resourceType,
        pathname: new URL(url).pathname,
      })),
    })),
  });
});
