import { describe, expect, it } from "vitest";

import {
  createPdfSafeError,
  PDF_ERROR_MESSAGES,
  PdfError,
  toPdfSafeError,
} from "../../src/features/pdf/errors";
import {
  PDF_LIMITS,
  inspectPdfSignature,
  planPdfRender,
  validatePdfSource,
} from "../../src/features/pdf/validation";

function expectCode(operation: () => unknown, code: string) {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(PdfError);
    expect((error as PdfError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("PDF source validation", () => {
  it("accepts a PDF signature at byte zero", () => {
    expect(inspectPdfSignature(new TextEncoder().encode("%PDF-1.7\n"))).toEqual({
      offset: 0,
      version: "1.7",
    });
  });

  it("accepts a signature after a bounded leading comment", () => {
    const prefix = new TextEncoder().encode("local prefix\n%PDF-2.0\n");
    expect(inspectPdfSignature(prefix)).toEqual({ offset: 13, version: "2.0" });
  });

  it("rejects invalid and out-of-bound signatures", () => {
    expectCode(
      () => inspectPdfSignature(new TextEncoder().encode("not a PDF")),
      "PDF_SIGNATURE_INVALID",
    );
    const late = new Uint8Array(PDF_LIMITS.signatureScanBytes + 16).fill(32);
    late.set(new TextEncoder().encode("%PDF-1.7"), PDF_LIMITS.signatureScanBytes);
    expectCode(() => inspectPdfSignature(late), "PDF_SIGNATURE_INVALID");
  });

  it("rejects empty and oversized files independently of image limits", async () => {
    await expect(validatePdfSource(new Blob())).rejects.toMatchObject({
      code: "PDF_FILE_EMPTY",
    });
    const oversized = new Blob([
      new Uint8Array(PDF_LIMITS.maxFileBytes + 1),
    ]);
    await expect(validatePdfSource(oversized)).rejects.toMatchObject({
      code: "PDF_FILE_TOO_LARGE",
    });
  });

  it("accepts the exact file-size boundary", async () => {
    const prefix = new TextEncoder().encode("%PDF-1.7\n");
    const source = new Blob([
      prefix,
      new Uint8Array(PDF_LIMITS.maxFileBytes - prefix.length),
    ]);
    await expect(validatePdfSource(source)).resolves.toMatchObject({
      offset: 0,
      version: "1.7",
    });
  });
});

describe("PDF render planning", () => {
  it("plans letter-size pages at 300 DPI", () => {
    const plan = planPdfRender(612, 792);
    expect(plan.requestedScale).toBeCloseTo(300 / 72);
    expect(plan.width).toBe(2_550);
    expect(plan.height).toBe(3_300);
    expect(plan.downscaled).toBe(false);
  });

  it("uses inherent rotated viewport dimensions", () => {
    const portrait = planPdfRender(612, 792);
    const rotated = planPdfRender(792, 612);
    expect(rotated.width).toBe(portrait.height);
    expect(rotated.height).toBe(portrait.width);
  });

  it("bounds oversized pages before canvas allocation", () => {
    const plan = planPdfRender(20_000, 10_000);
    expect(plan.downscaled).toBe(true);
    expect(plan.width).toBeLessThanOrEqual(PDF_LIMITS.maxRenderedSide);
    expect(plan.height).toBeLessThanOrEqual(PDF_LIMITS.maxRenderedSide);
    expect(plan.width * plan.height).toBeLessThanOrEqual(
      PDF_LIMITS.maxRenderedPixels,
    );
  });

  it.each([
    [0, 100],
    [-1, 100],
    [Number.NaN, 100],
    [Number.POSITIVE_INFINITY, 100],
    [Number.MAX_VALUE, Number.MAX_VALUE],
  ])("rejects unsafe dimensions %s x %s", (width, height) => {
    expectCode(() => planPdfRender(width, height), "PDF_LIMIT_EXCEEDED");
  });
});

describe("Phase 1B PDF limits and safe errors", () => {
  it("keeps every provisional processing limit in the Phase 1A source", () => {
    expect(PDF_LIMITS).toMatchObject({
      maxFileBytes: 25 * 1024 * 1024,
      maxDocumentPages: 100,
      maxSelectedPages: 50,
      maxOcrPagesPerRun: 25,
      targetDpi: 300,
      maxRenderedSide: 4_096,
      maxRenderedPixels: 16_777_216,
      maxPageTextCharacters: 250_000,
      maxTotalTextCharacters: 2_000_000,
      activePageConcurrency: 1,
      activeOcrConcurrency: 1,
    });
  });

  it("creates fixed serializable page errors without a raw cause", () => {
    const safe = createPdfSafeError("PDF_PAGE_OCR_FAILED", { pageNumber: 7 });
    expect(safe).toEqual({
      code: "PDF_PAGE_OCR_FAILED",
      message: PDF_ERROR_MESSAGES.PDF_PAGE_OCR_FAILED,
      pageNumber: 7,
      retryable: true,
      scope: "page",
    });
    expect(JSON.parse(JSON.stringify(safe))).toEqual(safe);
    expect(safe).not.toHaveProperty("cause");
  });

  it("provides reviewed retryable offline support errors", () => {
    expect(createPdfSafeError("PDF_READER_SUPPORT_UNAVAILABLE_OFFLINE")).toEqual({
      code: "PDF_READER_SUPPORT_UNAVAILABLE_OFFLINE",
      message:
        "The PDF reader is not available offline. Connect to the internet and prepare it first.",
      retryable: true,
      scope: "document",
    });
    expect(createPdfSafeError("PDF_OCR_SUPPORT_UNAVAILABLE_OFFLINE")).toEqual({
      code: "PDF_OCR_SUPPORT_UNAVAILABLE_OFFLINE",
      message:
        "The selected OCR languages are not available offline. Connect to the internet and prepare them first.",
      retryable: true,
      scope: "document",
    });
  });

  it("maps unknown errors to a reviewed content-free fallback", () => {
    const safe = toPdfSafeError(
      new Error("secret filename.pdf password and extracted text"),
    );
    expect(safe).toEqual({
      code: "PDF_INTERNAL_PROCESSING_ERROR",
      message: PDF_ERROR_MESSAGES.PDF_INTERNAL_PROCESSING_ERROR,
      retryable: false,
      scope: "document",
    });
    expect(JSON.stringify(safe)).not.toContain("secret");
  });
});
