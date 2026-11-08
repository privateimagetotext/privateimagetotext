import { expect, test } from "@playwright/test";
import {
  annotateEnvironment,
  assertPrivateRuntime,
  harnessOrigin,
  observeRuntime,
  openHarness,
  runScenario,
} from "./helpers";

type Phase1bPage = {
  pageNumber: number;
  status: string;
  method: string;
  raw: string;
  cleaned: string;
  edited: string;
  textLayerAssessment: { classification: string } | null;
  warnings: string[];
  render: { rotation: number } | null;
};

type Phase1bDocumentResult = {
  outcome: string;
  selectedPages: number[];
  pages: Phase1bPage[];
  embeddedTextPageCount: number;
  ocrPageCount: number;
  skippedOrUnprocessedPageCount: number;
};

type Phase1bInstrumentation = {
  textExtractions: number;
  renders: number;
  ocrAdapters: number;
  ocrRecognitions: number;
  ocrCancellations: number;
  ocrDisposals: number;
};

type Phase1bEnvelope<T = Phase1bDocumentResult> = {
  result: T;
  instrumentation: Phase1bInstrumentation;
  workerReleased: boolean;
  workerActiveAfter: number;
};

function envelope<T = Phase1bDocumentResult>(value: Record<string, unknown>) {
  return value as unknown as Phase1bEnvelope<T>;
}

test("hybrid extraction stays sequential, private and worker-backed", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(600_000);
  const runtime = await observeRuntime(page);
  await openHarness(page);

  const selectable = envelope(
    await runScenario(page, "selectable.pdf", "phase1b-automatic"),
  );
  expect(selectable.result.outcome).toBe("complete");
  expect(selectable.result.pages).toHaveLength(2);
  expect(selectable.result.pages.map(({ method }) => method)).toEqual([
    "embedded-text",
    "embedded-text",
  ]);
  expect(selectable.result.pages[0].textLayerAssessment?.classification).toBe(
    "usable",
  );
  expect(selectable.result.pages[0].cleaned).toContain(
    "PDF PHASE ZERO SELECTABLE 271828",
  );
  expect(selectable.instrumentation.renders).toBe(0);
  expect(selectable.instrumentation.ocrAdapters).toBe(0);
  expect(selectable.instrumentation.ocrRecognitions).toBe(0);
  expect(selectable.workerReleased).toBe(true);

  const scanned = envelope(
    await runScenario(page, "scanned.pdf", "phase1b-automatic"),
  );
  expect(scanned.result.pages).toHaveLength(1);
  expect(scanned.result.pages[0].method).toBe("ocr");
  expect(scanned.result.pages[0].textLayerAssessment?.classification).toBe(
    "empty",
  );
  expect(scanned.result.pages[0].cleaned).toContain("SENTINEL");
  expect(scanned.instrumentation.textExtractions).toBe(1);
  expect(scanned.instrumentation.renders).toBe(1);
  expect(scanned.instrumentation.ocrAdapters).toBe(1);
  expect(scanned.instrumentation.ocrRecognitions).toBe(1);
  expect(scanned.instrumentation.ocrDisposals).toBe(1);
  expect(scanned.workerReleased).toBe(true);

  const mixed = envelope(
    await runScenario(page, "mixed.pdf", "phase1b-automatic"),
  );
  expect(mixed.result.pages.map(({ pageNumber }) => pageNumber)).toEqual([1, 2]);
  expect(mixed.result.pages.map(({ method }) => method)).toEqual([
    "embedded-text",
    "ocr",
  ]);
  expect(mixed.result.pages[0].cleaned).toContain(
    "MIXED SELECTABLE PAGE 112358",
  );
  expect(mixed.result.pages[1].cleaned).toContain("SENTINEL");
  expect(mixed.result.embeddedTextPageCount).toBe(1);
  expect(mixed.result.ocrPageCount).toBe(1);
  expect(mixed.instrumentation.textExtractions).toBe(2);
  expect(mixed.instrumentation.renders).toBe(1);
  expect(mixed.instrumentation.ocrRecognitions).toBe(1);
  expect(mixed.workerReleased).toBe(true);

  const cancelled = envelope(
    await runScenario(
      page,
      "selectable.pdf",
      "phase1b-cancel-after-one",
    ),
  );
  expect(cancelled.result.outcome).toBe("cancelled");
  expect(cancelled.result.pages[0].status).toBe("complete");
  expect(cancelled.result.pages[1].status).toBe("not-processed");
  expect(cancelled.result.skippedOrUnprocessedPageCount).toBe(1);
  expect(cancelled.instrumentation.textExtractions).toBe(1);
  expect(cancelled.instrumentation.renders).toBe(0);
  expect(cancelled.instrumentation.ocrAdapters).toBe(0);
  expect(cancelled.workerReleased).toBe(true);

  const workerState = await page.evaluate(() => window.__PDF_PHASE0__.workerEvidence);
  expect(workerState.active).toBe(0);
  expect(workerState.constructed).toBe(workerState.terminated);
  expect(workerState.urls.length).toBeGreaterThanOrEqual(4);
  expect(workerState.moduleWorkers).toBe(workerState.constructed);
  expect(
    workerState.urls.every((url) => new URL(url).origin === harnessOrigin),
  ).toBe(true);
  expect(runtime.workerUrls.some((url) => /pdf\.worker/.test(url))).toBe(true);

  await assertPrivateRuntime(page, runtime, [
    "selectable.pdf",
    "scanned.pdf",
    "mixed.pdf",
    "PDF PHASE ZERO SELECTABLE 271828",
    "MIXED SELECTABLE PAGE 112358",
    "SENTINEL",
    "phase0-only",
  ]);

  await testInfo.attach("pdf-phase1b-browser-evidence", {
    contentType: "application/json",
    body: Buffer.from(
      JSON.stringify({
        environment: {
          ...annotateEnvironment(testInfo),
          browserVersion: browser.version(),
          userAgent: await page.evaluate(() => navigator.userAgent),
        },
        selectable,
        scanned,
        mixed,
        cancelled,
        workerState,
        requests: runtime.requests.map(({ method, resourceType, url }) => ({
          method,
          resourceType,
          pathname: new URL(url).pathname,
        })),
      }),
    ),
  });
});

test("forced modes, page selection, rotation and OCR limits use the production engine", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Extended deterministic coverage runs in desktop Chromium.");
  test.setTimeout(600_000);
  const runtime = await observeRuntime(page);
  await openHarness(page);

  const embeddedOnly = envelope(
    await runScenario(page, "mixed.pdf", "phase1b-embedded-only"),
  );
  expect(embeddedOnly.result.pages.map(({ method }) => method)).toEqual([
    "embedded-text",
    "embedded-text",
  ]);
  expect(embeddedOnly.instrumentation.textExtractions).toBe(2);
  expect(embeddedOnly.instrumentation.renders).toBe(0);
  expect(embeddedOnly.instrumentation.ocrAdapters).toBe(0);
  expect(embeddedOnly.instrumentation.ocrRecognitions).toBe(0);

  const ocrAll = envelope(
    await runScenario(page, "scanned.pdf", "phase1b-ocr-all"),
  );
  expect(ocrAll.result.pages[0].method).toBe("ocr");
  expect(ocrAll.result.pages[0].cleaned).toContain("SENTINEL");
  expect(ocrAll.instrumentation.textExtractions).toBe(0);
  expect(ocrAll.instrumentation.renders).toBe(1);
  expect(ocrAll.instrumentation.ocrRecognitions).toBe(1);

  const selectedRange = envelope(
    await runScenario(page, "selectable.pdf", "phase1b-page-range"),
  );
  expect(selectedRange.result.selectedPages).toEqual([2]);
  expect(selectedRange.result.pages).toHaveLength(1);
  expect(selectedRange.result.pages[0].pageNumber).toBe(2);
  expect(selectedRange.instrumentation.textExtractions).toBe(1);
  expect(selectedRange.instrumentation.renders).toBe(0);

  const rotated = envelope(
    await runScenario(page, "rotated.pdf", "phase1b-automatic"),
  );
  expect(rotated.result.pages[0].method).toBe("ocr");
  expect(rotated.result.pages[0].render?.rotation).toBe(90);
  expect(rotated.result.pages[0].cleaned).toContain("SENTINEL");

  const limited = envelope<{
    automaticCode: string;
    ocrAllCode: string;
    afterAutomatic: Phase1bInstrumentation;
  }>(await runScenario(page, "benchmark-26.pdf", "phase1b-ocr-limit"));
  expect(limited.result.automaticCode).toBe("PDF_OCR_PAGE_LIMIT_EXCEEDED");
  expect(limited.result.ocrAllCode).toBe("PDF_OCR_PAGE_LIMIT_EXCEEDED");
  expect(limited.result.afterAutomatic.textExtractions).toBe(26);
  expect(limited.result.afterAutomatic.renders).toBe(0);
  expect(limited.result.afterAutomatic.ocrAdapters).toBe(0);
  expect(limited.instrumentation.renders).toBe(0);
  expect(limited.instrumentation.ocrRecognitions).toBe(0);

  const forced = envelope<{
    initial: Phase1bDocumentResult;
    forced: Phase1bPage;
    unrelatedPageUnchanged: boolean;
  }>(await runScenario(page, "mixed.pdf", "phase1b-force-ocr"));
  expect(forced.result.initial.pages.map(({ method }) => method)).toEqual([
    "embedded-text",
    "ocr",
  ]);
  expect(forced.result.forced.pageNumber).toBe(1);
  expect(forced.result.forced.method).toBe("ocr");
  expect(forced.result.forced.status).toBe("complete");
  expect(forced.result.unrelatedPageUnchanged).toBe(true);
  expect(forced.instrumentation.renders).toBe(2);
  expect(forced.instrumentation.ocrRecognitions).toBe(2);

  expect(
    [embeddedOnly, ocrAll, selectedRange, rotated, limited, forced].every(
      ({ workerReleased }) => workerReleased,
    ),
  ).toBe(true);
  await assertPrivateRuntime(page, runtime, [
    "mixed.pdf",
    "scanned.pdf",
    "selectable.pdf",
    "rotated.pdf",
    "benchmark-26.pdf",
    "MIXED SELECTABLE PAGE 112358",
    "SENTINEL",
    "phase0-only",
  ]);
});
