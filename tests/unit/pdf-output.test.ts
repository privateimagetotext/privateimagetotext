import { describe, expect, it } from "vitest";

import { createPdfSafeError, PdfError } from "../../src/features/pdf/errors";
import {
  buildPdfTextOutput,
  safePdfTextFilename,
} from "../../src/features/pdf/output";
import type {
  PdfDocumentResult,
  PdfPageResult,
} from "../../src/features/pdf/types";
import { PDF_LIMITS } from "../../src/features/pdf/validation";

function page(
  pageNumber: number,
  overrides: Partial<PdfPageResult> = {},
): PdfPageResult {
  return {
    pageNumber,
    status: "complete",
    method: "embedded-text",
    raw: `raw ${pageNumber}`,
    cleaned: `cleaned ${pageNumber}`,
    edited: `edited ${pageNumber}`,
    confidence: null,
    elapsedMs: 10,
    textLayerAssessment: null,
    warnings: [],
    error: null,
    render: null,
    ...overrides,
  };
}

function documentResult(
  selectedPages: readonly number[],
  pages: readonly PdfPageResult[],
  outcome: PdfDocumentResult["outcome"] = "complete",
): PdfDocumentResult {
  return {
    documentId: "document-1",
    operationId: "operation-1",
    outcome,
    selectedPages,
    pages,
    embeddedTextPageCount: 0,
    ocrPageCount: 0,
    emptyPageCount: 0,
    failedPageCount: 0,
    skippedOrUnprocessedPageCount: 0,
    elapsedMs: 0,
    totalOutputCharacters: pages.reduce(
      (total, result) => total + result.edited.length,
      0,
    ),
    error: null,
  };
}

function expectCode(operation: () => unknown, code: string) {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(PdfError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("PDF text output", () => {
  it("preserves selected pages in ascending document order with markers", () => {
    const output = buildPdfTextOutput(
      documentResult([3, 1, 2], [page(2), page(3), page(1)]),
      "report.pdf",
    );

    expect(output.combinedText).toBe(
      [
        "--- Page 1 ---\nedited 1",
        "--- Page 2 ---\nedited 2",
        "--- Page 3 ---\nedited 3",
      ].join("\n\n"),
    );
    expect(output.characterCount).toBe(output.combinedText.length);
    expect(output.wordCount).toBe(output.combinedText.trim().split(/\s+/u).length);
    expect(output.filename).toBe("report-pdf-text.txt");
  });

  it("includes a safe PDF page label", () => {
    const output = buildPdfTextOutput(
      documentResult([3], [page(3, { pageLabel: "iii" })]),
      "source.pdf",
    );
    expect(output.combinedText.startsWith("--- Page 3 (label: iii) ---")).toBe(
      true,
    );
  });

  it("uses edited text, including an intentional empty edit", () => {
    const output = buildPdfTextOutput(
      documentResult(
        [1, 2],
        [
          page(1, { cleaned: "engine text", edited: "user correction" }),
          page(2, { cleaned: "remove me", edited: "" }),
        ],
      ),
      "source.pdf",
    );
    expect(output.combinedText).toContain("--- Page 1 ---\nuser correction");
    expect(output.combinedText).toContain("--- Page 2 — empty ---");
    expect(output.combinedText).not.toContain("engine text");
    expect(output.combinedText).not.toContain("remove me");
  });

  it("marks failures, skipped pages and cancelled pages without omission", () => {
    const failed = page(2, {
      status: "failed",
      method: "ocr",
      raw: "",
      cleaned: "",
      edited: "",
      error: createPdfSafeError("PDF_PAGE_OCR_FAILED", { pageNumber: 2 }),
    });
    const skipped = page(3, {
      status: "skipped",
      method: "none",
      raw: "",
      cleaned: "",
      edited: "",
    });
    const notProcessed = page(4, {
      status: "not-processed",
      method: "none",
      raw: "",
      cleaned: "",
      edited: "",
    });
    const output = buildPdfTextOutput(
      documentResult([1, 2, 3, 4], [page(1), failed, skipped, notProcessed], "cancelled"),
      "source.pdf",
    );

    expect(output.combinedText).toContain("--- Page 1 ---\nedited 1");
    expect(output.combinedText).toContain("--- Page 2 — failed ---");
    expect(output.combinedText).toContain("--- Page 3 — skipped ---");
    expect(output.combinedText).toContain("--- Page 4 — not processed ---");
  });

  it("marks a missing selected-page record as not processed", () => {
    const output = buildPdfTextOutput(
      documentResult([1, 5], [page(1)]),
      "source.pdf",
    );
    expect(output.combinedText).toContain("--- Page 5 — not processed ---");
  });

  it("removes controls and bidi characters from page labels", () => {
    const output = buildPdfTextOutput(
      documentResult(
        [1],
        [page(1, { pageLabel: "\u202E secret\nlabel\u0000" })],
      ),
      "source.pdf",
    );
    expect(
      output.combinedText.startsWith("--- Page 1 (label: secretlabel) ---"),
    ).toBe(true);
    expect(output.combinedText).not.toContain("\u0000");
    expect(output.combinedText).not.toContain("\u202E");
  });

  it("rejects edited page content over the per-page limit without truncation", () => {
    const oversized = "x".repeat(PDF_LIMITS.maxPageTextCharacters + 1);
    expectCode(
      () =>
        buildPdfTextOutput(
          documentResult([1], [page(1, { edited: oversized })]),
          "source.pdf",
        ),
      "PDF_PAGE_TEXT_LIMIT_EXCEEDED",
    );
  });

  it("rejects combined edited content over the operation limit", () => {
    const fullPage = "x".repeat(PDF_LIMITS.maxPageTextCharacters);
    const pages = Array.from({ length: 9 }, (_, index) =>
      page(index + 1, { edited: index === 8 ? "x" : fullPage }),
    );
    expectCode(
      () =>
        buildPdfTextOutput(
          documentResult(
            pages.map((result) => result.pageNumber),
            pages,
          ),
          "source.pdf",
        ),
      "PDF_TOTAL_TEXT_LIMIT_EXCEEDED",
    );
  });
});

describe("PDF output filenames", () => {
  it.each([
    ["Meeting notes.PDF", "Meeting-notes-pdf-text.txt"],
    ["../folder/Ａ report:*?.pdf", "A-report-pdf-text.txt"],
    ["invoice\u202Etxt.exe", "invoicetxt-pdf-text.txt"],
    ["CON.pdf", "private-image-to-text-pdf-text.txt"],
    ["\u202E.pdf", "private-image-to-text-pdf-text.txt"],
  ])("sanitises %j at the existing filename boundary", (source, expected) => {
    expect(safePdfTextFilename(source)).toBe(expected);
  });
});
