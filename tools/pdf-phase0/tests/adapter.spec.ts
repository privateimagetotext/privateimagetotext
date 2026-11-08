import { expect, test } from "@playwright/test";
import path from "node:path";

import {
  assertPrivateRuntime,
  fixtureDirectory,
  observeRuntime,
  openHarness,
  runScenario,
} from "./helpers";

test("production adapter password, cancellation, and repeated cleanup lifecycle", async ({
  page,
}) => {
  test.setTimeout(360_000);
  const evidence = await observeRuntime(page);
  await openHarness(page);

  await page.locator("#pdf-file").setInputFiles(path.join(fixtureDirectory, "password.pdf"));
  await page.locator("#scenario").selectOption("adapter-password");
  await page.locator("#run").click();
  await expect(page.locator("#password-reason")).toHaveText("Password required");
  await page.locator("#password").fill("adapter-wrong-secret");
  await page.locator("#submit-password").click();
  await expect(page.locator("#password")).toHaveValue("");
  await expect(page.locator("#password-reason")).toHaveText(
    "Incorrect test password",
  );
  await page.locator("#password").fill("phase0-only");
  await page.locator("#submit-password").click();
  await page.waitForFunction(() => window.__PDF_PHASE0__.lastResult !== null);
  const opened = await page.evaluate(() => window.__PDF_PHASE0__.lastResult!);
  expect(opened.opened).toBe(true);
  expect(opened.incorrectAttempts).toBe(1);
  expect(opened.passwordFieldCleared).toBe(true);

  await page.locator("#pdf-file").setInputFiles(path.join(fixtureDirectory, "password.pdf"));
  await page.locator("#scenario").selectOption("adapter-password");
  await page.locator("#run").click();
  await expect(page.locator("#password-reason")).toHaveText("Password required");
  await page.locator("#cancel-password").click();
  await page.waitForFunction(() => window.__PDF_PHASE0__.lastResult !== null);
  const cancelled = await page.evaluate(() => window.__PDF_PHASE0__.lastResult!);
  expect(cancelled.cancelled).toBe(true);
  expect(cancelled.passwordFieldCleared).toBe(true);

  const renderCancellation = await runScenario(
    page,
    "scanned.pdf",
    "adapter-render-cancel",
  );
  expect(renderCancellation.cancelled).toBe(true);
  expect(renderCancellation.cancellationCode).toBe("PDF_RENDER_CANCELLED");

  for (let cycle = 0; cycle < 5; cycle += 1) {
    const rendered = await runScenario(
      page,
      "jbig2_file_header.pdf",
      "decoder",
    );
    expect(rendered.rendered).toBe(true);
  }
  const workers = await page.evaluate(() => window.__PDF_PHASE0__.workerEvidence);
  expect(workers.active).toBe(0);
  expect(workers.constructed).toBe(workers.terminated);

  await assertPrivateRuntime(page, evidence, [
    "password.pdf",
    "scanned.pdf",
    "jbig2_file_header.pdf",
    "adapter-wrong-secret",
    "phase0-only",
    "PASSWORD FIXTURE OPEN 424242",
  ]);
});
