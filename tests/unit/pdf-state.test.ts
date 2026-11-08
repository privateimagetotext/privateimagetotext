import { describe, expect, it } from "vitest";

import { createPdfSafeError } from "../../src/features/pdf/errors";
import { PDF_LIMITS } from "../../src/features/pdf/validation";
import {
  defaultPdfExtractionSettings,
  initialPdfState,
  pdfReducer,
  type PdfState,
} from "../../src/features/pdf/state";
import type {
  PdfDocumentResult,
  PdfPageResult,
  PdfProgress,
} from "../../src/features/pdf/types";

function readyState(documentId = "document-1") {
  let state = pdfReducer(initialPdfState, {
    type: "documentValidationStarted",
    documentId,
  });
  state = pdfReducer(state, {
    type: "documentReady",
    document: { documentId, pageCount: 3, pageLabels: ["i", "1", "2"] },
  });
  return state;
}

function operationState(
  documentId = "document-1",
  operationId = "operation-1",
) {
  return pdfReducer(readyState(documentId), {
    type: "operationStarted",
    documentId,
    operationId,
    selectedPages: [1, 2, 3],
    settings: defaultPdfExtractionSettings,
    preflighting: true,
  });
}

function pageResult(
  pageNumber: number,
  overrides: Partial<PdfPageResult> = {},
): PdfPageResult {
  return {
    pageNumber,
    status: "complete",
    method: "embedded-text",
    raw: `Raw page ${pageNumber}`,
    cleaned: `Page ${pageNumber}`,
    edited: `Page ${pageNumber}`,
    confidence: null,
    elapsedMs: 20,
    textLayerAssessment: null,
    warnings: [],
    error: null,
    render: null,
    ...overrides,
  };
}

function documentResult(
  pages: readonly PdfPageResult[],
  overrides: Partial<PdfDocumentResult> = {},
): PdfDocumentResult {
  return {
    documentId: "document-1",
    operationId: "operation-1",
    outcome: pages.some((page) => page.status === "failed")
      ? "partial"
      : "complete",
    selectedPages: [1, 2, 3],
    pages,
    embeddedTextPageCount: pages.filter(
      (page) => page.method === "embedded-text" && page.status === "complete",
    ).length,
    ocrPageCount: pages.filter(
      (page) => page.method === "ocr" && page.status === "complete",
    ).length,
    emptyPageCount: pages.filter(
      (page) => page.status === "complete" && page.edited.length === 0,
    ).length,
    failedPageCount: pages.filter((page) => page.status === "failed").length,
    skippedOrUnprocessedPageCount: pages.filter(
      (page) => page.status === "skipped" || page.status === "not-processed",
    ).length,
    elapsedMs: 100,
    totalOutputCharacters: pages.reduce(
      (total, page) => total + page.edited.length,
      0,
    ),
    error: null,
    ...overrides,
  };
}

function progress(overall: number, pageValue = overall): PdfProgress {
  return {
    stage: "Inspecting existing PDF text",
    phase: "preflight",
    overall,
    currentSelectedPageIndex: 1,
    totalSelectedPages: 3,
    pageNumber: 1,
    pageValue,
    isPreflighting: true,
    isProducingResults: false,
  };
}

function reducePage(state: PdfState, result: PdfPageResult) {
  return pdfReducer(state, {
    type: "pageResult",
    documentId: "document-1",
    operationId: "operation-1",
    result,
  });
}

describe("PDF reducer document lifecycle", () => {
  it("keeps result navigation and per-page retries independent of pending page ranges", () => {
    const result = documentResult([pageResult(1), pageResult(2), pageResult(3)]);
    let state = pdfReducer(operationState(), {
      type: "operationCompleted", documentId: "document-1", operationId: "operation-1", result,
    });
    state = pdfReducer(state, {
      type: "selectionChanged", documentId: "document-1", selectedPages: [2],
    });
    state = pdfReducer(state, {
      type: "activeResultPageChanged", documentId: "document-1", pageNumber: 1,
    });
    expect(state.activeResultPage).toBe(1);
    state = pdfReducer(state, {
      type: "singlePageOperationStarted", documentId: "document-1", operationId: "operation-2", pageNumber: 1,
    });
    expect(state.currentOperationId).toBe("operation-2");
    expect(state.status).toBe("processing");
    state = pdfReducer(state, {
      type: "singlePageOperationCompleted", documentId: "document-1", operationId: "operation-2", pageNumber: 1,
      result: pageResult(1, { method: "ocr", edited: "Retry succeeded", languages: ["spa"] }),
    });
    expect(state.result?.pages[0].edited).toBe("Retry succeeded");
    expect(state.result?.selectedPages).toEqual([1, 2, 3]);
    expect(state.selectedPages).toEqual([2]);
  });

  it("represents validation, loading, password and ready states", () => {
    let state = pdfReducer(initialPdfState, {
      type: "documentValidationStarted",
      documentId: "document-1",
    });
    expect(state).toMatchObject({
      status: "validating",
      document: { documentId: "document-1", pageCount: 0 },
    });

    state = pdfReducer(state, {
      type: "documentLoadingStarted",
      documentId: "document-1",
    });
    expect(state.status).toBe("loading-document");

    state = pdfReducer(state, {
      type: "passwordRequired",
      documentId: "document-1",
    });
    expect(state.status).toBe("password-required");

    state = pdfReducer(state, {
      type: "documentReady",
      document: { documentId: "document-1", pageCount: 3, pageLabels: null },
    });
    expect(state).toMatchObject({
      status: "ready",
      document: { documentId: "document-1", pageCount: 3 },
      pages: {},
      result: null,
    });
  });

  it("records current document validation and open failures but ignores stale ones", () => {
    for (const lifecycle of [
      "validating",
      "loading-document",
      "password-required",
    ] as const) {
      let state = pdfReducer(initialPdfState, {
        type: "documentValidationStarted",
        documentId: "document-1",
      });
      if (lifecycle !== "validating") {
        state = pdfReducer(state, {
          type: "documentLoadingStarted",
          documentId: "document-1",
        });
      }
      if (lifecycle === "password-required") {
        state = pdfReducer(state, {
          type: "passwordRequired",
          documentId: "document-1",
        });
      }
      expect(state.status).toBe(lifecycle);

      const error = createPdfSafeError("PDF_OPEN_FAILED");
      const failed = pdfReducer(state, {
        type: "documentFailed",
        documentId: "document-1",
        error,
      });
      expect(failed).toMatchObject({
        status: "error",
        document: { documentId: "document-1", pageCount: 0 },
        currentOperationId: null,
        pages: {},
        error,
      });
      expect(
        pdfReducer(failed, {
          type: "documentFailed",
          documentId: "document-stale",
          error: createPdfSafeError("PDF_WORKER_FAILED"),
        }),
      ).toBe(failed);
    }
  });

  it("clears page results when a new PDF replaces the document", () => {
    let state = reducePage(operationState(), pageResult(1));
    state = pdfReducer(state, {
      type: "documentValidationStarted",
      documentId: "document-2",
    });

    expect(state).toMatchObject({
      status: "validating",
      document: { documentId: "document-2", pageCount: 0 },
      currentOperationId: null,
      pages: {},
      result: null,
      activeResultPage: null,
    });
  });

  it("clears every document and result field explicitly", () => {
    const state = pdfReducer(reducePage(operationState(), pageResult(1)), {
      type: "clear",
    });
    expect(state).toEqual(initialPdfState);
  });
});

describe("PDF reducer operation lifecycle", () => {
  it("starts preflight with selected pending pages and PDF defaults", () => {
    const state = operationState();
    expect(state.status).toBe("preflighting");
    expect(state.currentOperationId).toBe("operation-1");
    expect(state.settings).toEqual({
      mode: "automatic",
      preset: "adaptive-document",
      contentMode: "document",
      autoDeskew: true,
      languages: ["eng"],
    });
    expect(Object.values(state.pages).map((page) => page.status)).toEqual([
      "pending",
      "pending",
      "pending",
    ]);
    expect(state.pages[1].pageLabel).toBe("i");
  });

  it("tracks page stages and keeps overall progress monotonic and bounded", () => {
    let state = operationState();
    state = pdfReducer(state, {
      type: "pageStatusChanged",
      documentId: "document-1",
      operationId: "operation-1",
      pageNumber: 1,
      status: "checking-text",
    });
    expect(state.pages[1].status).toBe("checking-text");
    expect(state.status).toBe("preflighting");

    state = pdfReducer(state, {
      type: "progressChanged",
      documentId: "document-1",
      operationId: "operation-1",
      progress: progress(0.4, 1.5),
    });
    state = pdfReducer(state, {
      type: "progressChanged",
      documentId: "document-1",
      operationId: "operation-1",
      progress: progress(0.2, -1),
    });
    expect(state.progress).toMatchObject({ overall: 0.4, pageValue: 0 });
  });

  it("stores embedded-text and OCR page completions independently", () => {
    let state = operationState();
    state = reducePage(state, pageResult(1));
    state = reducePage(
      state,
      pageResult(2, {
        method: "ocr",
        confidence: 92.5,
        render: {
          requestedScale: 300 / 72,
          scale: 300 / 72,
          effectiveDpi: 300,
          width: 2550,
          height: 3300,
          rotation: 0,
          downscaled: false,
          warnings: [],
        },
      }),
    );

    expect(state.pages[1].method).toBe("embedded-text");
    expect(state.pages[2]).toMatchObject({ method: "ocr", confidence: 92.5 });
    expect(state.activeResultPage).toBe(1);
  });

  it("records a page failure without turning the operation into a fatal error", () => {
    const failure = pageResult(2, {
      status: "failed",
      method: "ocr",
      raw: "",
      cleaned: "",
      edited: "",
      error: createPdfSafeError("PDF_PAGE_OCR_FAILED", { pageNumber: 2 }),
    });
    const state = reducePage(operationState(), failure);
    expect(state.status).toBe("preflighting");
    expect(state.pages[2]).toMatchObject({
      status: "failed",
      error: { code: "PDF_PAGE_OCR_FAILED", scope: "page" },
    });
    expect(state.error).toBeNull();
  });

  it("represents a partial document as complete workflow state with counts", () => {
    const complete = pageResult(1);
    const failed = pageResult(2, {
      status: "failed",
      method: "ocr",
      raw: "",
      cleaned: "",
      edited: "",
      error: createPdfSafeError("PDF_PAGE_OCR_FAILED", { pageNumber: 2 }),
    });
    const notProcessed = pageResult(3, {
      status: "not-processed",
      method: "none",
      raw: "",
      cleaned: "",
      edited: "",
    });
    const result = documentResult([complete, failed, notProcessed]);
    const state = pdfReducer(operationState(), {
      type: "operationCompleted",
      documentId: "document-1",
      operationId: "operation-1",
      result,
    });

    expect(state.status).toBe("complete");
    expect(state.result).toMatchObject({
      outcome: "partial",
      failedPageCount: 1,
      skippedOrUnprocessedPageCount: 1,
    });
    expect(state.error).toBeNull();
  });

  it("preserves completed pages and marks unfinished pages on cancellation", () => {
    let state = reducePage(operationState(), pageResult(1));
    state = pdfReducer(state, {
      type: "pageStatusChanged",
      documentId: "document-1",
      operationId: "operation-1",
      pageNumber: 2,
      status: "recognising",
    });
    state = pdfReducer(state, {
      type: "operationCancelled",
      documentId: "document-1",
      operationId: "operation-1",
    });

    expect(state.status).toBe("cancelled");
    expect(state.pages[1]).toMatchObject({
      status: "complete",
      edited: "Page 1",
    });
    expect(state.pages[2].status).toBe("not-processed");
    expect(state.pages[3].status).toBe("not-processed");
    expect(state.progress).toBeNull();
  });

  it("rejects an oversized edit without changing the page and accepts a subsequent valid correction", () => {
    const result = documentResult([pageResult(1), pageResult(2), pageResult(3)]);
    const complete = pdfReducer(operationState(), {
      type: "operationCompleted", documentId: "document-1", operationId: "operation-1", result,
    });
    const rejected = pdfReducer(complete, {
      type: "editPageText", documentId: "document-1", operationId: "operation-1", pageNumber: 1,
      value: "x".repeat(PDF_LIMITS.maxPageTextCharacters + 1),
    });
    expect(rejected.error?.code).toBe("PDF_PAGE_TEXT_LIMIT_EXCEEDED");
    expect(rejected.pages).toBe(complete.pages);
    expect(rejected.result).toBe(result);
    const corrected = pdfReducer(rejected, {
      type: "editPageText", documentId: "document-1", operationId: "operation-1", pageNumber: 1, value: "Valid correction",
    });
    expect(corrected.pages[1].edited).toBe("Valid correction");
    expect(corrected.error).toBeNull();
  });

  it("rejects edits exceeding the aggregate output cap while preserving every earlier page", () => {
    const fullPage = "x".repeat(PDF_LIMITS.maxPageTextCharacters);
    const pages = Array.from({ length: 8 }, (_, index) => pageResult(index + 1, { edited: fullPage }));
    pages[0] = pageResult(1, { edited: fullPage.slice(0, -1) });
    pages.push(pageResult(9, { edited: "" }));
    const result = documentResult(pages, { selectedPages: pages.map((page) => page.pageNumber) });
    const complete = pdfReducer(operationState(), {
      type: "operationCompleted", documentId: "document-1", operationId: "operation-1", result,
    });
    const rejected = pdfReducer(complete, {
      type: "editPageText", documentId: "document-1", operationId: "operation-1", pageNumber: 9, value: "ab",
    });
    expect(rejected.error?.code).toBe("PDF_TOTAL_TEXT_LIMIT_EXCEEDED");
    expect(rejected.pages).toBe(complete.pages);
    expect(rejected.result).toBe(result);
    const atLimit = pdfReducer(rejected, {
      type: "editPageText", documentId: "document-1", operationId: "operation-1", pageNumber: 9, value: "a",
    });
    expect(atLimit.error).toBeNull();
    expect(atLimit.result?.totalOutputCharacters).toBe(PDF_LIMITS.maxTotalTextCharacters);
  });

  it("edits only a completed page and keeps the document result in sync", () => {
    const result = documentResult([pageResult(1), pageResult(2), pageResult(3)]);
    let state = pdfReducer(operationState(), {
      type: "operationCompleted",
      documentId: "document-1",
      operationId: "operation-1",
      result,
    });
    const originalCharacters = state.result!.totalOutputCharacters;
    state = pdfReducer(state, {
      type: "editPageText",
      documentId: "document-1",
      operationId: "operation-1",
      pageNumber: 2,
      value: "A user edit",
    });

    expect(state.pages[2].edited).toBe("A user edit");
    expect(state.pages[1].edited).toBe("Page 1");
    expect(state.result!.pages[1].edited).toBe("A user edit");
    expect(state.result!.totalOutputCharacters).toBe(
      originalCharacters + "A user edit".length - "Page 2".length,
    );

    state = pdfReducer(state, {
      type: "editPageText",
      documentId: "document-1",
      operationId: "operation-1",
      pageNumber: 2,
      value: "",
    });
    expect(state.result).toMatchObject({ emptyPageCount: 1 });
    state = pdfReducer(state, {
      type: "editPageText",
      documentId: "document-1",
      operationId: "operation-1",
      pageNumber: 2,
      value: "Restored text",
    });
    expect(state.result).toMatchObject({ emptyPageCount: 0 });
  });

  it("atomically replaces one forced page while preserving the document result", () => {
    const initialResult = documentResult([
      pageResult(1),
      pageResult(2),
      pageResult(3),
    ]);
    let state = pdfReducer(operationState(), {
      type: "operationCompleted",
      documentId: "document-1",
      operationId: "operation-1",
      result: initialResult,
    });
    state = pdfReducer(state, {
      type: "singlePageOperationStarted",
      documentId: "document-1",
      operationId: "operation-2",
      pageNumber: 2,
    });

    expect(state).toMatchObject({
      status: "processing",
      currentOperationId: "operation-2",
      singlePageOperationPage: 2,
      selectedPages: [1, 2, 3],
      result: initialResult,
    });
    expect(state.pages[2].status).toBe("pending");
    expect(state.pages[1].edited).toBe("Page 1");

    const forced = pageResult(2, {
      method: "ocr",
      edited: "Forced OCR page 2",
      cleaned: "Forced OCR page 2",
      raw: "Forced OCR page 2",
      elapsedMs: 55,
    });
    state = pdfReducer(state, {
      type: "singlePageOperationCompleted",
      documentId: "document-1",
      operationId: "operation-2",
      pageNumber: 2,
      result: forced,
    });

    expect(state.status).toBe("complete");
    expect(state.singlePageOperationPage).toBeNull();
    expect(state.pages[2]).toBe(forced);
    expect(state.result?.pages[1]).toBe(forced);
    expect(state.result).toMatchObject({
      operationId: "operation-2",
      embeddedTextPageCount: 2,
      ocrPageCount: 1,
      elapsedMs: initialResult.elapsedMs + 55,
    });
    expect(state.result?.totalOutputCharacters).toBe(
      "Page 1".length + "Forced OCR page 2".length + "Page 3".length,
    );
    expect(state.currentOperationId).toBe(state.result?.operationId);
  });

  it("preserves prior edited text when single-page reprocessing is cancelled or fails", () => {
    const initialResult = documentResult([
      pageResult(1),
      pageResult(2),
      pageResult(3),
    ]);
    let state = pdfReducer(operationState(), {
      type: "operationCompleted",
      documentId: "document-1",
      operationId: "operation-1",
      result: initialResult,
    });
    state = pdfReducer(state, {
      type: "editPageText",
      documentId: "document-1",
      operationId: "operation-1",
      pageNumber: 2,
      value: "A user edit",
    });
    const editedResult = state.result;
    const editedResultPage = editedResult!.pages[1];
    state = pdfReducer(state, {
      type: "singlePageOperationStarted",
      documentId: "document-1",
      operationId: "operation-2",
      pageNumber: 2,
    });
    state = pdfReducer(state, {
      type: "singlePageOperationCancelled",
      documentId: "document-1",
      operationId: "operation-2",
      pageNumber: 2,
    });
    expect(state.pages[2]).toBe(editedResultPage);
    expect(state.result).toBe(editedResult);

    state = pdfReducer(state, {
      type: "singlePageOperationStarted",
      documentId: "document-1",
      operationId: "operation-3",
      pageNumber: 2,
    });
    const failed = pageResult(2, {
      status: "failed",
      method: "ocr",
      raw: "",
      cleaned: "",
      edited: "",
      elapsedMs: 30,
      error: createPdfSafeError("PDF_PAGE_OCR_FAILED", { pageNumber: 2 }),
    });
    state = pdfReducer(state, {
      type: "singlePageOperationFailed",
      documentId: "document-1",
      operationId: "operation-3",
      pageNumber: 2,
      result: failed,
    });
    expect(state.status).toBe("complete");
    expect(state.pages[2]).toBe(editedResultPage);
    expect(state.pages[2].edited).toBe("A user edit");
    expect(state.result).toBe(editedResult);
    expect(state.error).toEqual(failed.error);
  });

  it("replaces a failed page when a retry has no useful prior result", () => {
    const priorFailure = pageResult(2, {
      status: "failed",
      method: "ocr",
      raw: "",
      cleaned: "",
      edited: "",
      error: createPdfSafeError("PDF_PAGE_OCR_FAILED", { pageNumber: 2 }),
    });
    const initialResult = documentResult([
      pageResult(1),
      priorFailure,
      pageResult(3, {
        status: "not-processed",
        method: "none",
        raw: "",
        cleaned: "",
        edited: "",
      }),
    ]);
    let state = pdfReducer(operationState(), {
      type: "operationCompleted",
      documentId: "document-1",
      operationId: "operation-1",
      result: initialResult,
    });
    state = pdfReducer(state, {
      type: "activeResultPageChanged",
      documentId: "document-1",
      pageNumber: 3,
    });
    expect(state.activeResultPage).toBe(3);
    state = pdfReducer(state, {
      type: "activeResultPageChanged",
      documentId: "document-1",
      pageNumber: 2,
    });
    expect(state.activeResultPage).toBe(2);
    state = pdfReducer(state, {
      type: "singlePageOperationStarted",
      documentId: "document-1",
      operationId: "operation-2",
      pageNumber: 2,
    });
    const retryFailure = {
      ...priorFailure,
      elapsedMs: 45,
      error: createPdfSafeError("PDF_PAGE_RENDER_FAILED", { pageNumber: 2 }),
    };
    state = pdfReducer(state, {
      type: "singlePageOperationFailed",
      documentId: "document-1",
      operationId: "operation-2",
      pageNumber: 2,
      result: retryFailure,
    });

    expect(state.pages[2]).toBe(retryFailure);
    expect(state.result?.pages[1]).toBe(retryFailure);
    expect(state.result).toMatchObject({
      operationId: "operation-2",
      outcome: "partial",
      failedPageCount: 1,
    });
    expect(state.activeResultPage).toBe(2);
  });

  it("fails closed when a forced replacement would exceed the document text cap", () => {
    const selectedPages = Array.from({ length: 9 }, (_, index) => index + 1);
    const largePages = selectedPages.map((pageNumber) =>
      pageResult(pageNumber, {
        raw: pageNumber === 9 ? "" : "A".repeat(249_999),
        cleaned: pageNumber === 9 ? "" : "A".repeat(249_999),
        edited: pageNumber === 9 ? "" : "A".repeat(249_999),
      }),
    );
    let state = pdfReducer(readyState(), {
      type: "operationStarted",
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages,
      settings: defaultPdfExtractionSettings,
      preflighting: false,
    });
    const initialResult = documentResult(largePages, { selectedPages });
    state = pdfReducer(state, {
      type: "operationCompleted",
      documentId: "document-1",
      operationId: "operation-1",
      result: initialResult,
    });
    state = pdfReducer(state, {
      type: "singlePageOperationStarted",
      documentId: "document-1",
      operationId: "operation-2",
      pageNumber: 9,
    });
    state = pdfReducer(state, {
      type: "singlePageOperationCompleted",
      documentId: "document-1",
      operationId: "operation-2",
      pageNumber: 9,
      result: pageResult(9, {
        method: "ocr",
        raw: "B".repeat(20),
        cleaned: "B".repeat(20),
        edited: "B".repeat(20),
      }),
    });

    expect(state).toMatchObject({
      status: "complete",
      error: { code: "PDF_TOTAL_TEXT_LIMIT_EXCEEDED" },
      pages: {
        9: {
          status: "complete",
          raw: "",
          cleaned: "",
          edited: "",
          error: null,
        },
      },
      result: {
        operationId: "operation-1",
        outcome: "complete",
        failedPageCount: 0,
        error: null,
      },
    });
    expect(state.result).toBe(initialResult);
    expect(state.result!.totalOutputCharacters).toBe(249_999 * 8);
  });
});

describe("PDF reducer stale-event protection", () => {
  it.each(["complete", "cancelled", "error"] as const)(
    "ignores late transient and terminal events after %s",
    (terminal) => {
      let state = operationState();
      if (terminal === "complete") {
        state = pdfReducer(state, {
          type: "operationCompleted",
          documentId: "document-1",
          operationId: "operation-1",
          result: documentResult([pageResult(1), pageResult(2), pageResult(3)]),
        });
      } else if (terminal === "cancelled") {
        state = pdfReducer(state, {
          type: "operationCancelled",
          documentId: "document-1",
          operationId: "operation-1",
        });
      } else {
        state = pdfReducer(state, {
          type: "operationFailed",
          documentId: "document-1",
          operationId: "operation-1",
          error: createPdfSafeError("PDF_INTERNAL_PROCESSING_ERROR"),
        });
      }
      const terminalState = state;
      const lateActions = [
        {
          type: "pageStatusChanged" as const,
          documentId: "document-1",
          operationId: "operation-1",
          pageNumber: 1,
          status: "recognising" as const,
        },
        {
          type: "progressChanged" as const,
          documentId: "document-1",
          operationId: "operation-1",
          progress: progress(0.95),
        },
        {
          type: "pageResult" as const,
          documentId: "document-1",
          operationId: "operation-1",
          result: pageResult(1, { edited: "late result" }),
        },
        {
          type: "operationCancelled" as const,
          documentId: "document-1",
          operationId: "operation-1",
        },
      ];
      for (const action of lateActions) {
        expect(pdfReducer(terminalState, action)).toBe(terminalState);
      }
    },
  );

  it("ignores stale operation progress, results, cancellation and editing", () => {
    const state = operationState();
    const actions = [
      {
        type: "progressChanged" as const,
        documentId: "document-1",
        operationId: "operation-old",
        progress: progress(0.9),
      },
      {
        type: "pageResult" as const,
        documentId: "document-1",
        operationId: "operation-old",
        result: pageResult(1),
      },
      {
        type: "operationCancelled" as const,
        documentId: "document-1",
        operationId: "operation-old",
      },
      {
        type: "editPageText" as const,
        documentId: "document-1",
        operationId: "operation-old",
        pageNumber: 1,
        value: "stale edit",
      },
    ];

    for (const action of actions) expect(pdfReducer(state, action)).toBe(state);
  });

  it("ignores every late event from a replaced document", () => {
    let state = operationState();
    state = pdfReducer(state, {
      type: "documentValidationStarted",
      documentId: "document-2",
    });
    const replaced = state;

    state = pdfReducer(state, {
      type: "documentReady",
      document: { documentId: "document-1", pageCount: 3, pageLabels: null },
    });
    state = pdfReducer(state, {
      type: "pageResult",
      documentId: "document-1",
      operationId: "operation-1",
      result: pageResult(1),
    });

    expect(state).toBe(replaced);
    expect(state.document?.documentId).toBe("document-2");
    expect(state.pages).toEqual({});
  });
});
