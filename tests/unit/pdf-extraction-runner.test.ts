import { describe, expect, it, vi } from "vitest";

import { PdfError } from "../../src/features/pdf/errors";
import {
  runPdfExtraction,
  runSinglePdfPage,
  type PdfExtractionRunnerContext,
  type PdfOcrAdapter,
} from "../../src/features/pdf/extraction-runner";
import type {
  PdfDocumentSession,
  PdfRenderOptions,
  PdfTextItem,
} from "../../src/features/pdf/types";

function textItem(str: string): PdfTextItem {
  return {
    str,
    dir: "ltr",
    transform: [10, 0, 0, 10, 10, 20],
    width: Math.max(10, str.length * 5),
    height: 10,
  };
}

function preparedCanvas() {
  const canvas = document.createElement("canvas");
  const pixels = new Uint8ClampedArray(2 * 2 * 4).fill(255);
  const context = {
    getImageData: vi.fn(() => ({ data: pixels })),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  Object.defineProperty(canvas, "getContext", {
    configurable: true,
    value: vi.fn(() => context),
  });
  return canvas;
}

function fakeDocument(
  textByPage: ReadonlyMap<number, readonly PdfTextItem[]>,
  options: {
    pageCount?: number;
    failRenderPage?: number;
    downscaledRender?: boolean;
  } = {},
) {
  const pageCount = options.pageCount ?? Math.max(1, ...textByPage.keys());
  const renderCanvases: HTMLCanvasElement[] = [];
  const documentSession: PdfDocumentSession = {
    pageCount,
    pageLabels: Array.from({ length: pageCount }, (_, index) =>
      index === 2 ? "iii" : String(index + 1),
    ),
    extractText: vi.fn(async (pageNumber) => ({
      pageNumber,
      items: textByPage.get(pageNumber) ?? [],
    })),
    renderPage: vi.fn(async (pageNumber, renderOptions: PdfRenderOptions = {}) => {
      if (pageNumber === options.failRenderPage) {
        throw new PdfError("PDF_PAGE_RENDER_FAILED", { pageNumber });
      }
      const canvas = renderOptions.canvas ?? preparedCanvas();
      renderCanvases.push(canvas);
      canvas.width = 2;
      canvas.height = 2;
      return {
        pageNumber,
        originalWidth: 612,
        originalHeight: 792,
        rotation: pageNumber === 3 ? 90 : 0,
        requestedScale: 300 / 72,
        scale: 300 / 72,
        effectiveDpi: 300,
        width: 2,
        height: 2,
        estimatedRgbaBytes: 16,
        downscaled: options.downscaledRender ?? false,
        renderDurationMs: 1,
        canvas,
        release: vi.fn(() => {
          canvas.width = 0;
          canvas.height = 0;
        }),
      };
    }),
    cancelRender: vi.fn(),
    destroy: vi.fn(async () => undefined),
  };
  return { documentSession, renderCanvases };
}

function fakeOcr(texts: readonly string[] = ["OCR page text"]): PdfOcrAdapter {
  let index = 0;
  return {
    recognise: vi.fn(async (_canvas, _request, onProgress) => {
      onProgress({ stage: "Loading English offline model", value: 0.5 });
      onProgress({ stage: "Recognising text", value: 1 });
      return {
        text: texts[Math.min(index++, texts.length - 1)],
        confidence: 92,
        rotateRadians: 0,
      };
    }),
    cancel: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
}

function runnerContext(
  documentSession: PdfDocumentSession,
  ocrAdapter = fakeOcr(),
  controller = new AbortController(),
  ocrReadiness = vi.fn(() => true),
) {
  let clock = 0;
  const context: PdfExtractionRunnerContext = {
    document: documentSession,
    canvas: preparedCanvas(),
    signal: controller.signal,
    isOcrSupportReady: ocrReadiness,
    getOcrAdapter: vi.fn(() => ocrAdapter),
    now: () => ++clock,
  };
  return { context, ocrAdapter, controller, ocrReadiness };
}

const normalDigitalText =
  "This ordinary selectable PDF page contains enough meaningful text for reliable local extraction.";

describe("PDF extraction runner", () => {
  it("passes selected PDF languages to readiness, recognition and result provenance", async () => {
    const { documentSession } = fakeDocument(new Map([[1, []]]));
    const { context, ocrAdapter, ocrReadiness } = runnerContext(documentSession);
    const result = await runPdfExtraction(context, {
      documentId: "document-1", operationId: "spanish-run", selectedPages: [1],
      settings: { mode: "ocr-all", languages: ["spa", "eng"] },
    });
    expect(ocrReadiness).toHaveBeenCalledWith(["spa", "eng"]);
    expect(ocrAdapter.recognise).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ languages: ["spa", "eng"] }), expect.any(Function));
    expect(result.pages[0].languages).toEqual(["spa", "eng"]);
  });

  it("preserves Hindi OCR text without applying Latin cleanup, including page retries", async () => {
    const raw = "भारत\n  परीक्षण -\nपाठ\n";
    const { documentSession } = fakeDocument(new Map([[1, []]]));
    const { context } = runnerContext(documentSession, fakeOcr([raw]));
    const result = await runSinglePdfPage(context, {
      documentId: "document-1", operationId: "hindi-run", pageNumber: 1,
      method: "ocr", settings: { languages: ["hin"] },
    });
    expect(result.cleaned).toBe(raw);
    expect(result.edited).toBe(raw);
    expect(result.languages).toEqual(["hin"]);
  });

  it("rejects invalid language selections before rendering or starting an OCR worker", async () => {
    const { documentSession } = fakeDocument(new Map([[1, []]]));
    const { context, ocrAdapter } = runnerContext(documentSession);
    for (const languages of [[], ["bogus"], ["eng", "eng"], ["eng", "spa", "deu", "fra"]]) {
      await expect(runPdfExtraction(context, {
        documentId: "document-1", operationId: "invalid-run", selectedPages: [1],
        settings: { mode: "ocr-all", languages },
      })).rejects.toMatchObject({ code: "PDF_OCR_LANGUAGE_INVALID" });
    }
    expect(documentSession.renderPage).not.toHaveBeenCalled();
    expect(ocrAdapter.recognise).not.toHaveBeenCalled();
  });

  it("uses usable embedded text automatically without rendering or OCR", async () => {
    const { documentSession } = fakeDocument(
      new Map([[1, [textItem(normalDigitalText)]]]),
    );
    const { context, ocrAdapter, ocrReadiness } =
      runnerContext(documentSession);

    const result = await runPdfExtraction(context, {
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: [1],
    });

    expect(result.outcome).toBe("complete");
    expect(result.pages[0]).toMatchObject({
      method: "embedded-text",
      status: "complete",
      edited: normalDigitalText,
    });
    expect(result.embeddedTextPageCount).toBe(1);
    expect(documentSession.renderPage).not.toHaveBeenCalled();
    expect(ocrAdapter.recognise).not.toHaveBeenCalled();
    expect(ocrReadiness).not.toHaveBeenCalled();
  });

  it("OCRs empty automatic pages and never merges embedded and OCR text", async () => {
    const { documentSession } = fakeDocument(new Map([[1, []]]));
    const { context, ocrAdapter } = runnerContext(
      documentSession,
      fakeOcr(["Only the OCR result"]),
    );

    const result = await runPdfExtraction(context, {
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: [1],
    });

    expect(result.pages[0]).toMatchObject({
      method: "ocr",
      raw: "Only the OCR result",
      cleaned: "Only the OCR result",
    });
    expect(result.pages[0].warnings).toContain("NO_EMBEDDED_TEXT");
    expect(ocrAdapter.recognise).toHaveBeenCalledOnce();
  });

  it.each([0xE000, 0xF0A3, 0xF8FF, 0xF0000, 0xFFFFD, 0x100000, 0x10FFFD, 0xFFFD])(
    "warns for code point %i while retaining usable embedded output exactly",
    async (codePoint) => {
      const text = `${normalDigitalText} Symbol: ${String.fromCodePoint(codePoint)}`;
      const { documentSession } = fakeDocument(new Map([[1, [textItem(text)]]]));
      const { context, ocrAdapter } = runnerContext(documentSession);
      const result = await runPdfExtraction(context, {
        documentId: "document-1",
        operationId: "operation-1",
        selectedPages: [1],
      });

      expect(result.pages[0]).toMatchObject({
        method: "embedded-text",
        raw: text,
        cleaned: text,
        edited: text,
        textLayerAssessment: { classification: "usable", reasonCodes: ["normal-text"] },
        warnings: ["UNMAPPED_TEXT_CHARACTERS"],
      });
      expect(documentSession.renderPage).not.toHaveBeenCalled();
      expect(ocrAdapter.recognise).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["before BMP private use", String.fromCodePoint(0xDFFF)],
    ["after BMP private use", String.fromCodePoint(0xF900)],
    ["before plane15 private use", String.fromCodePoint(0xEFFFF)],
    ["after plane15 private use", String.fromCodePoint(0xFFFFE)],
    ["before plane16 private use", String.fromCodePoint(0xFFFFF)],
    ["after plane16 private use", String.fromCodePoint(0x10FFFE)],
    ["last Unicode code point", String.fromCodePoint(0x10FFFF)],
    ["mathematical symbols", "0 ≤ n < w; ≥ ≠ ± ∑"],
    ["CJK text", "日本語 中文 漢字"],
    ["Arabic text", "مرحبا بالعالم"],
  ])("does not emit the unmapped-character warning for %s", async (_name, value) => {
    const text = `${normalDigitalText} ${value}`;
    const { documentSession } = fakeDocument(new Map([[1, [textItem(text)]]]));
    const { context } = runnerContext(documentSession);
    const result = await runPdfExtraction(context, {
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: [1],
      settings: { mode: "embedded-text-only" },
    });

    expect(result.pages[0].raw).toBe(text);
    expect(result.pages[0].cleaned).toBe(text);
    expect(result.pages[0].warnings).not.toContain("UNMAPPED_TEXT_CHARACTERS");
  });

  it("drops the output warning after a successful OCR repair", async () => {
    const embedded = `${normalDigitalText} 0 \uF0A3 n`;
    const repaired = `${normalDigitalText} 0 ≤ n`;
    const { documentSession } = fakeDocument(new Map([[1, [textItem(embedded)]]]));
    const { context } = runnerContext(documentSession, fakeOcr([repaired]));
    const result = await runPdfExtraction(context, {
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: [1],
    });
    expect(result.pages[0].warnings).toEqual(["UNMAPPED_TEXT_CHARACTERS"]);

    const replacement = await runSinglePdfPage(context, {
      documentId: "document-1",
      operationId: "retry-1",
      pageNumber: 1,
      method: "ocr",
      settings: { preset: "original" },
    });
    expect(replacement).toMatchObject({ method: "ocr", raw: repaired, cleaned: repaired, edited: repaired });
    expect(replacement.warnings).not.toContain("UNMAPPED_TEXT_CHARACTERS");
  });

  it("checks OCR-all output even without an embedded text assessment", async () => {
    const text = "Recognised output with \u{100000} and \uFFFD symbols";
    const { documentSession } = fakeDocument(new Map());
    const { context } = runnerContext(documentSession, fakeOcr([text]));
    const result = await runPdfExtraction(context, {
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: [1],
      settings: { mode: "ocr-all", preset: "original" },
    });

    expect(result.pages[0]).toMatchObject({
      method: "ocr",
      raw: text,
      cleaned: text,
      edited: text,
      textLayerAssessment: null,
      warnings: ["UNMAPPED_TEXT_CHARACTERS"],
    });
    expect(documentSession.extractText).not.toHaveBeenCalled();
  });

  it("does not carry unmapped source characters into a clean Automatic OCR warning", async () => {
    const { documentSession } = fakeDocument(new Map([[1, [textItem("\uFFFD\uFFFD\uF0A3")]]]));
    const { context } = runnerContext(documentSession, fakeOcr(["Repaired text with 0 ≤ n"]));
    const result = await runPdfExtraction(context, {
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: [1],
      settings: { preset: "original" },
    });

    expect(result.pages[0]).toMatchObject({
      method: "ocr",
      raw: "Repaired text with 0 ≤ n",
      textLayerAssessment: { classification: "invalid" },
      warnings: ["TEXT_LAYER_INVALID"],
    });
  });

  it("chooses embedded then OCR methods in mixed document order", async () => {
    const { documentSession, renderCanvases } = fakeDocument(
      new Map([
        [1, [textItem(normalDigitalText)]],
        [2, []],
      ]),
    );
    const { context } = runnerContext(documentSession, fakeOcr(["Scanned page"]));

    const result = await runPdfExtraction(context, {
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: [1, 2],
    });

    expect(result.pages.map((page) => page.method)).toEqual([
      "embedded-text",
      "ocr",
    ]);
    expect(result.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(renderCanvases).toEqual([context.canvas]);
  });

  it("never renders or initialises OCR in existing-text-only mode", async () => {
    const { documentSession } = fakeDocument(
      new Map([
        [1, [textItem(normalDigitalText)]],
        [2, []],
      ]),
    );
    const { context, ocrAdapter, ocrReadiness } =
      runnerContext(documentSession);

    const result = await runPdfExtraction(context, {
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: [1, 2],
      settings: { mode: "embedded-text-only" },
    });

    expect(result.pages.map((page) => page.method)).toEqual([
      "embedded-text",
      "embedded-text",
    ]);
    expect(result.pages[1].status).toBe("complete");
    expect(result.pages[1].warnings).toContain("NO_EMBEDDED_TEXT");
    expect(documentSession.renderPage).not.toHaveBeenCalled();
    expect(ocrAdapter.recognise).not.toHaveBeenCalled();
    expect(context.getOcrAdapter).not.toHaveBeenCalled();
    expect(ocrReadiness).not.toHaveBeenCalled();
  });

  it("checks offline OCR readiness after Automatic preflight and before rendering", async () => {
    const { documentSession } = fakeDocument(new Map([[1, []]]));
    const ocrReadiness = vi.fn(() => false);
    const { context, ocrAdapter } = runnerContext(
      documentSession,
      fakeOcr(),
      new AbortController(),
      ocrReadiness,
    );

    await expect(
      runPdfExtraction(context, {
        documentId: "document-1",
        operationId: "operation-1",
        selectedPages: [1],
      }),
    ).rejects.toMatchObject({
      code: "PDF_OCR_SUPPORT_UNAVAILABLE_OFFLINE",
    });
    expect(documentSession.extractText).toHaveBeenCalledOnce();
    expect(ocrReadiness).toHaveBeenCalledOnce();
    expect(
      vi.mocked(documentSession.extractText).mock.invocationCallOrder[0],
    ).toBeLessThan(ocrReadiness.mock.invocationCallOrder[0]);
    expect(documentSession.renderPage).not.toHaveBeenCalled();
    expect(ocrAdapter.recognise).not.toHaveBeenCalled();
  });

  it("checks offline OCR readiness in OCR-all before its first render", async () => {
    const { documentSession } = fakeDocument(new Map());
    const ocrReadiness = vi.fn(() => false);
    const { context, ocrAdapter } = runnerContext(
      documentSession,
      fakeOcr(),
      new AbortController(),
      ocrReadiness,
    );

    await expect(
      runPdfExtraction(context, {
        documentId: "document-1",
        operationId: "operation-1",
        selectedPages: [1],
        settings: { mode: "ocr-all" },
      }),
    ).rejects.toMatchObject({
      code: "PDF_OCR_SUPPORT_UNAVAILABLE_OFFLINE",
    });
    expect(documentSession.extractText).not.toHaveBeenCalled();
    expect(ocrReadiness).toHaveBeenCalledOnce();
    expect(documentSession.renderPage).not.toHaveBeenCalled();
    expect(ocrAdapter.recognise).not.toHaveBeenCalled();
  });

  it("OCR-all recognises every selected page without inspecting embedded text", async () => {
    const { documentSession } = fakeDocument(
      new Map([
        [1, [textItem(normalDigitalText)]],
        [2, [textItem("Another selectable page with useful text content.")]],
      ]),
    );
    const { context, ocrAdapter } = runnerContext(
      documentSession,
      fakeOcr(["OCR one", "OCR two"]),
    );

    const result = await runPdfExtraction(context, {
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: [1, 2],
      settings: { mode: "ocr-all", preset: "original" },
    });

    expect(result.pages.map((page) => page.raw)).toEqual(["OCR one", "OCR two"]);
    expect(documentSession.extractText).not.toHaveBeenCalled();
    expect(ocrAdapter.recognise).toHaveBeenCalledTimes(2);
  });

  it("preflights the automatic OCR-page cap before rendering or OCR", async () => {
    const pages = Array.from({ length: 26 }, (_, index) => index + 1);
    const { documentSession } = fakeDocument(new Map(), { pageCount: 26 });
    const { context, ocrAdapter } = runnerContext(documentSession);

    await expect(
      runPdfExtraction(context, {
        documentId: "document-1",
        operationId: "operation-1",
        selectedPages: pages,
      }),
    ).rejects.toMatchObject({
      code: "PDF_OCR_PAGE_LIMIT_EXCEEDED",
      details: {
        selectedPageCount: 26,
        requiredOcrPageCount: 26,
        permittedOcrPageCount: 25,
      },
    });
    expect(documentSession.extractText).toHaveBeenCalledTimes(26);
    expect(documentSession.renderPage).not.toHaveBeenCalled();
    expect(ocrAdapter.recognise).not.toHaveBeenCalled();
  });

  it("rejects an oversized OCR-all selection before starting work", async () => {
    const pages = Array.from({ length: 26 }, (_, index) => index + 1);
    const { documentSession } = fakeDocument(new Map(), { pageCount: 26 });
    const { context, ocrAdapter } = runnerContext(documentSession);

    await expect(
      runPdfExtraction(context, {
        documentId: "document-1",
        operationId: "operation-1",
        selectedPages: pages,
        settings: { mode: "ocr-all" },
      }),
    ).rejects.toMatchObject({
      code: "PDF_OCR_PAGE_LIMIT_EXCEEDED",
      details: {
        selectedPageCount: 26,
        requiredOcrPageCount: 26,
        permittedOcrPageCount: 25,
      },
    });
    expect(documentSession.renderPage).not.toHaveBeenCalled();
    expect(ocrAdapter.recognise).not.toHaveBeenCalled();
  });

  it("does not let explicit undefined settings bypass safe defaults", async () => {
    const pages = Array.from({ length: 26 }, (_, index) => index + 1);
    const { documentSession } = fakeDocument(new Map(), { pageCount: 26 });
    const { context, ocrAdapter } = runnerContext(documentSession);

    await expect(
      runPdfExtraction(context, {
        documentId: "document-1",
        operationId: "operation-1",
        selectedPages: pages,
        settings: {
          mode: undefined,
          preset: undefined,
          contentMode: undefined,
          autoDeskew: undefined,
        },
      }),
    ).rejects.toMatchObject({ code: "PDF_OCR_PAGE_LIMIT_EXCEEDED" });
    expect(documentSession.renderPage).not.toHaveBeenCalled();
    expect(ocrAdapter.recognise).not.toHaveBeenCalled();
  });

  it("keeps completed pages and continues after a page-level failure", async () => {
    const { documentSession } = fakeDocument(new Map(), {
      pageCount: 3,
      failRenderPage: 2,
    });
    const { context } = runnerContext(
      documentSession,
      fakeOcr(["First page", "Third page"]),
    );

    const result = await runPdfExtraction(context, {
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: [1, 2, 3],
      settings: { mode: "ocr-all", preset: "original" },
    });

    expect(result.outcome).toBe("partial");
    expect(result.pages.map((page) => page.status)).toEqual([
      "complete",
      "failed",
      "complete",
    ]);
    expect(result.pages[1].error?.code).toBe("PDF_PAGE_RENDER_FAILED");
  });

  it("forces one page through OCR without inspecting other pages", async () => {
    const { documentSession } = fakeDocument(
      new Map([
        [1, [textItem(normalDigitalText)]],
        [2, [textItem("Selectable result that is deliberately overridden.")]],
      ]),
    );
    const { context } = runnerContext(documentSession, fakeOcr(["Forced OCR"]));
    const statuses: string[] = [];

    const page = await runSinglePdfPage(context, {
      documentId: "document-1",
      operationId: "retry-1",
      pageNumber: 2,
      method: "ocr",
      settings: { preset: "original" },
      onPageStatus: (_pageNumber, status) => statuses.push(status),
    });

    expect(page).toMatchObject({ pageNumber: 2, method: "ocr", raw: "Forced OCR" });
    expect(documentSession.extractText).not.toHaveBeenCalled();
    expect(documentSession.renderPage).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe("complete");
  });

  it("emits a failed terminal retry status with elapsed time", async () => {
    const { documentSession } = fakeDocument(new Map(), {
      failRenderPage: 1,
    });
    const { context } = runnerContext(documentSession);
    const statuses: string[] = [];

    const page = await runSinglePdfPage(context, {
      documentId: "document-1",
      operationId: "retry-1",
      pageNumber: 1,
      method: "ocr",
      settings: { preset: "original" },
      onPageStatus: (_pageNumber, status) => statuses.push(status),
    });

    expect(page.status).toBe("failed");
    expect(page.elapsedMs).toBeGreaterThan(0);
    expect(statuses.at(-1)).toBe("failed");
  });

  it("preserves automatic text assessment evidence on OCR failure", async () => {
    const { documentSession } = fakeDocument(new Map([[1, []]]), {
      failRenderPage: 1,
    });
    const { context } = runnerContext(documentSession);

    const result = await runPdfExtraction(context, {
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: [1],
    });

    expect(result.pages[0]).toMatchObject({
      status: "failed",
      elapsedMs: expect.any(Number),
      textLayerAssessment: {
        classification: "empty",
        reasonCodes: ["empty-text-layer"],
      },
    });
    expect(result.pages[0].elapsedMs).toBeGreaterThan(0);
  });

  it("preserves bounded render evidence when recognition fails", async () => {
    const { documentSession } = fakeDocument(new Map([[1, []]]), {
      downscaledRender: true,
    });
    const failingOcr: PdfOcrAdapter = {
      recognise: vi.fn(async () => {
        throw new Error("content must not escape");
      }),
      cancel: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    const { context } = runnerContext(documentSession, failingOcr);

    const result = await runPdfExtraction(context, {
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: [1],
    });

    expect(result.pages[0]).toMatchObject({
      status: "failed",
      error: { code: "PDF_PAGE_OCR_FAILED" },
      render: { width: 2, height: 2, downscaled: true },
      warnings: ["PAGE_RENDER_REDUCED"],
    });
    expect(JSON.stringify(result.pages[0])).not.toContain(
      "content must not escape",
    );
  });

  it("does not OCR-fallback when a text layer exceeds the page safety limit", async () => {
    const oversized = "A".repeat(250_001);
    const { documentSession } = fakeDocument(
      new Map([[1, [textItem(oversized)]]]),
    );
    const { context, ocrAdapter } = runnerContext(documentSession);

    const result = await runPdfExtraction(context, {
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: [1],
    });

    expect(result.pages[0].status).toBe("failed");
    expect(result.pages[0].error?.code).toBe("PDF_PAGE_TEXT_LIMIT_EXCEEDED");
    expect(result.pages[0].error?.pageNumber).toBe(1);
    expect(documentSession.renderPage).not.toHaveBeenCalled();
    expect(ocrAdapter.recognise).not.toHaveBeenCalled();
  });

  it("stops at the combined text cap without truncating the rejected page", async () => {
    const pageText = `${"A".repeat(249_998)}. `;
    const entries = Array.from({ length: 9 }, (_, index) => [
      index + 1,
      [textItem(pageText)],
    ] as const);
    const { documentSession } = fakeDocument(new Map(entries), { pageCount: 9 });
    const { context } = runnerContext(documentSession);

    const result = await runPdfExtraction(context, {
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: Array.from({ length: 9 }, (_, index) => index + 1),
      settings: { mode: "embedded-text-only" },
    });

    expect(result.outcome).toBe("error");
    expect(result.error?.code).toBe("PDF_TOTAL_TEXT_LIMIT_EXCEEDED");
    expect(result.pages.slice(0, 8).every((page) => page.status === "complete")).toBe(true);
    expect(result.pages[8]).toMatchObject({ status: "failed", raw: "", edited: "" });
    expect(result.totalOutputCharacters).toBe(249_999 * 8);
  });

  it("returns cancellation with completed pages preserved and later pages marked", async () => {
    const { documentSession } = fakeDocument(new Map(), { pageCount: 3 });
    const { context, controller } = runnerContext(
      documentSession,
      fakeOcr(["First page", "late"]),
    );
    const statuses: string[] = [];
    const progressStages: string[] = [];

    const result = await runPdfExtraction(context, {
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: [1, 2, 3],
      settings: { mode: "ocr-all", preset: "original" },
      onPageResult: () => controller.abort(),
      onPageStatus: (_pageNumber, status) => statuses.push(status),
      onProgress: (progress) => progressStages.push(progress.stage),
    });

    expect(result.outcome).toBe("cancelled");
    expect(result.pages.map((page) => page.status)).toEqual([
      "complete",
      "not-processed",
      "not-processed",
    ]);
    expect(result.pages[0].edited).toBe("First page");
    expect(statuses).not.toContain("complete");
    expect(progressStages).not.toContain("Finished this PDF page");
  });

  it("emits bounded monotonic progress without document content", async () => {
    const { documentSession } = fakeDocument(
      new Map([
        [1, [textItem(normalDigitalText)]],
        [2, []],
      ]),
    );
    const { context } = runnerContext(documentSession, fakeOcr(["OCR secret"]));
    const progress: Array<Record<string, unknown>> = [];

    await runPdfExtraction(context, {
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: [1, 2],
      onProgress: (value) => progress.push(value as unknown as Record<string, unknown>),
    });

    const values = progress.map((value) => Number(value.overall));
    expect(values.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(values.every((value, index) => index === 0 || value >= values[index - 1])).toBe(true);
    expect(values.at(-1)).toBe(1);
    const serialised = JSON.stringify(progress);
    expect(serialised).not.toContain(normalDigitalText);
    expect(serialised).not.toContain("OCR secret");
    expect(serialised).not.toContain("filename");
  });
});
