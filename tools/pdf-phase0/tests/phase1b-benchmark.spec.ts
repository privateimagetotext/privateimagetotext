import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  observeRuntime,
  openHarness,
  repositoryRoot,
  runScenario,
} from "./helpers";

type BenchmarkEnvelope = {
  result: {
    result: {
      outcome: string;
      ocrPageCount: number;
      skippedOrUnprocessedPageCount: number;
    };
    benchmark: {
      requestedPages: number;
      processedPages: number;
      cancelled: boolean;
      preflightMs: number;
      ocrWorkerColdLoadMs: number | null;
      totalMs: number;
      perPageMedianMs: number | null;
      warmPageMedianMs: number | null;
      embeddedTextPageCount: number;
      ocrPageCount: number;
      sentinelRate: number;
      peakCanvasBytes: number;
      pageElapsedMs: number[];
    };
  };
  instrumentation: {
    textExtractions: number;
    renders: number;
    ocrAdapters: number;
    ocrRecognitions: number;
  };
  workerReleased: boolean;
  canvasZeroed: boolean;
};

function benchmarkEnvelope(value: Record<string, unknown>) {
  return value as unknown as BenchmarkEnvelope;
}

test("records Phase 1B hybrid 1/10/25-page and cancellation evidence", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(900_000);
  const runtime = await observeRuntime(page);
  await openHarness(page);
  const runs: BenchmarkEnvelope[] = [];

  for (const pageCount of [1, 10, 25]) {
    const run = benchmarkEnvelope(
      await runScenario(page, `benchmark-${pageCount}.pdf`, "phase1b-benchmark"),
    );
    expect(run.result.result.outcome).toBe("complete");
    expect(run.result.benchmark.requestedPages).toBe(pageCount);
    expect(run.result.benchmark.processedPages).toBe(pageCount);
    expect(run.result.benchmark.ocrPageCount).toBe(pageCount);
    expect(run.result.benchmark.embeddedTextPageCount).toBe(0);
    expect(run.result.benchmark.sentinelRate).toBe(1);
    expect(run.result.benchmark.preflightMs).toBeGreaterThanOrEqual(0);
    expect(run.result.benchmark.totalMs).toBeGreaterThanOrEqual(
      run.result.benchmark.preflightMs,
    );
    expect(run.result.benchmark.pageElapsedMs).toHaveLength(pageCount);
    expect(run.instrumentation.textExtractions).toBe(pageCount);
    expect(run.instrumentation.renders).toBe(pageCount);
    expect(run.instrumentation.ocrAdapters).toBe(1);
    expect(run.instrumentation.ocrRecognitions).toBe(pageCount);
    expect(run.workerReleased).toBe(true);
    expect(run.canvasZeroed).toBe(true);
    runs.push(run);
  }

  const cancellation = benchmarkEnvelope(
    await runScenario(page, "benchmark-10.pdf", "phase1b-benchmark", {
      cancelAfterOne: true,
    }),
  );
  expect(cancellation.result.result.outcome).toBe("cancelled");
  expect(cancellation.result.benchmark.cancelled).toBe(true);
  expect(cancellation.result.benchmark.requestedPages).toBe(10);
  expect(cancellation.result.benchmark.processedPages).toBe(1);
  expect(cancellation.result.result.skippedOrUnprocessedPageCount).toBe(9);
  expect(cancellation.instrumentation.textExtractions).toBe(10);
  expect(cancellation.instrumentation.renders).toBe(1);
  expect(cancellation.instrumentation.ocrRecognitions).toBe(1);
  expect(cancellation.workerReleased).toBe(true);
  expect(cancellation.canvasZeroed).toBe(true);

  expect(runtime.externalRequests).toEqual([]);
  expect(runtime.pageErrors).toEqual([]);
  expect(
    runtime.consoleMessages.filter((message) =>
      /fake worker|content security policy|securitypolicyviolation|refused to/i.test(
        message,
      ),
    ),
  ).toEqual([]);

  const evidence = {
    environment: {
      project: testInfo.project.name,
      browserVersion: browser.version(),
      userAgent: await page.evaluate(() => navigator.userAgent),
      deviceEmulation: false,
    },
    runs: runs.map(({ result, instrumentation, workerReleased, canvasZeroed }) => ({
      benchmark: result.benchmark,
      outcome: result.result.outcome,
      instrumentation,
      workerReleased,
      canvasZeroed,
    })),
    cancellation: {
      benchmark: cancellation.result.benchmark,
      outcome: cancellation.result.result.outcome,
      skippedOrUnprocessedPageCount:
        cancellation.result.result.skippedOrUnprocessedPageCount,
      instrumentation: cancellation.instrumentation,
      workerReleased: cancellation.workerReleased,
      canvasZeroed: cancellation.canvasZeroed,
    },
  };
  const outputDirectory = path.join(repositoryRoot, "tmp", "pdf-phase1b");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, "benchmark-chromium.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  await testInfo.attach("pdf-phase1b-benchmark-evidence", {
    contentType: "application/json",
    body: Buffer.from(JSON.stringify(evidence)),
  });
});
