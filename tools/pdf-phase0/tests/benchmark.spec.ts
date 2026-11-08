import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertPrivateRuntime,
  observeRuntime,
  openHarness,
  repositoryRoot,
  runScenario,
} from "./helpers";

test("@benchmark sequential 1, 10 and 25 page OCR", async ({ page, context, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "CDP memory evidence is Chromium-specific.");
  test.setTimeout(1_200_000);
  const evidence = await observeRuntime(page);
  await openHarness(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const beforeMetrics = await cdp.send("Performance.getMetrics");
  const beforeDom = await cdp.send("Memory.getDOMCounters");

  const benchmarks = [];
  const cycleMetrics = [];
  for (const pageCount of [1, 10, 25]) {
    const result = await runScenario(
      page,
      `benchmark-${pageCount}.pdf`,
      "benchmark",
    );
    expect(result.requestedPages).toBe(pageCount);
    expect(result.processedPages).toBe(pageCount);
    expect(result.cancelled).toBe(false);
    expect(result.sentinelPassRate).toBe(1);
    expect((result.cleanup as Record<string, unknown>).workersAtBaseline).toBe(true);
    expect((result.cleanup as Record<string, unknown>).canvasZeroed).toBe(true);
    benchmarks.push(result);
    await cdp.send("HeapProfiler.collectGarbage");
    cycleMetrics.push({
      pageCount,
      performance: await cdp.send("Performance.getMetrics"),
      dom: await cdp.send("Memory.getDOMCounters"),
    });
  }

  const cancellation = await runScenario(page, "benchmark-25.pdf", "benchmark", {
    cancelAfterOne: true,
  });
  expect(cancellation.cancelled).toBe(true);
  expect(cancellation.processedPages).toBe(1);
  expect((cancellation.cleanup as Record<string, unknown>).workersAtBaseline).toBe(true);

  await cdp.send("HeapProfiler.collectGarbage");
  const afterMetrics = await cdp.send("Performance.getMetrics");
  const afterDom = await cdp.send("Memory.getDOMCounters");
  await assertPrivateRuntime(page, evidence, [
    "benchmark-1.pdf",
    "benchmark-10.pdf",
    "benchmark-25.pdf",
    "SENTINEL 314159",
  ]);

  const output = {
    userAgent: await page.evaluate(() => navigator.userAgent),
    platform: await page.evaluate(() => navigator.platform),
    benchmarks,
    cancellation,
    cdp: { beforeMetrics, afterMetrics, beforeDom, afterDom, cycleMetrics },
  };
  const outputDirectory = path.join(repositoryRoot, "tmp", "pdf-phase0");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, "benchmark-results.json"),
    `${JSON.stringify(output, null, 2)}\n`,
  );
  await testInfo.attach("pdf-phase0-benchmark", {
    contentType: "application/json",
    body: Buffer.from(JSON.stringify(output)),
  });
});
