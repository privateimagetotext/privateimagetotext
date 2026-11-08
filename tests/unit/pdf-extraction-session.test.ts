import { describe, expect, it, vi } from "vitest";

import { PdfError } from "../../src/features/pdf/errors";
import {
  PdfExtractionSession,
  type PdfExtractionSessionDependencies,
} from "../../src/features/pdf/extraction-session";
import type { PdfOcrAdapter } from "../../src/features/pdf/extraction-runner";
import type {
  PdfDocumentSession,
  PdfRenderOptions,
} from "../../src/features/pdf/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function canvas() {
  const value = document.createElement("canvas");
  const context = {
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(16).fill(255) })),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  Object.defineProperty(value, "getContext", {
    configurable: true,
    value: vi.fn(() => context),
  });
  return value;
}

function renderedPage(
  pageNumber: number,
  selectedCanvas: HTMLCanvasElement,
) {
  selectedCanvas.width = 2;
  selectedCanvas.height = 2;
  return {
    pageNumber,
    originalWidth: 612,
    originalHeight: 792,
    rotation: 0,
    requestedScale: 300 / 72,
    scale: 300 / 72,
    effectiveDpi: 300,
    width: 2,
    height: 2,
    estimatedRgbaBytes: 16,
    downscaled: false,
    renderDurationMs: 1,
    canvas: selectedCanvas,
    release: vi.fn(() => {
      selectedCanvas.width = 0;
      selectedCanvas.height = 0;
    }),
  };
}

function documentSession(
  renderImplementation?: PdfDocumentSession["renderPage"],
): PdfDocumentSession {
  return {
    pageCount: 3,
    pageLabels: null,
    extractText: vi.fn(async (pageNumber) => ({ pageNumber, items: [] })),
    renderPage:
      renderImplementation ??
      vi.fn(async (pageNumber, options: PdfRenderOptions = {}) =>
        renderedPage(pageNumber, options.canvas ?? canvas()),
      ),
    cancelRender: vi.fn(),
    destroy: vi.fn(async () => undefined),
  };
}

function ocrAdapter(text = "OCR result"): PdfOcrAdapter {
  return {
    recognise: vi.fn(async () => ({ text, confidence: 90, rotateRadians: 0 })),
    cancel: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
}

function dependencies(
  createOcrAdapter: () => PdfOcrAdapter,
  selectedCanvas = canvas(),
  isOcrSupportReady: PdfExtractionSessionDependencies["isOcrSupportReady"] =
    vi.fn(() => true),
): PdfExtractionSessionDependencies {
  let time = 0;
  return {
    createCanvas: vi.fn(() => selectedCanvas),
    createOcrAdapter,
    isOcrSupportReady,
    now: () => ++time,
  };
}

describe("PdfExtractionSession", () => {
  it("reuses one canvas and OCR adapter sequentially across pages", async () => {
    const document = documentSession();
    const adapter = ocrAdapter();
    const selectedCanvas = canvas();
    const createAdapter = vi.fn(() => adapter);
    const session = new PdfExtractionSession(
      document,
      dependencies(createAdapter, selectedCanvas),
    );

    const result = await session.run({
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: [1, 2],
      settings: { mode: "ocr-all", preset: "original" },
    });

    expect(result.outcome).toBe("complete");
    expect(createAdapter).toHaveBeenCalledOnce();
    expect(adapter.recognise).toHaveBeenCalledTimes(2);
    const renderCalls = vi.mocked(document.renderPage).mock.calls;
    expect(renderCalls[0][1]?.canvas).toBe(selectedCanvas);
    expect(renderCalls[1][1]?.canvas).toBe(selectedCanvas);
    expect(selectedCanvas.width).toBe(0);
    expect(selectedCanvas.height).toBe(0);
    await session.dispose();
  });

  it("checks the content-free OCR readiness dependency before rendering", async () => {
    const document = documentSession();
    const createAdapter = vi.fn(() => ocrAdapter());
    const readiness = vi.fn((_signal: AbortSignal) => false);
    const session = new PdfExtractionSession(
      document,
      dependencies(createAdapter, canvas(), readiness),
    );

    await expect(
      session.run({
        documentId: "document-1",
        operationId: "operation-1",
        selectedPages: [1],
        settings: { mode: "ocr-all" },
      }),
    ).rejects.toMatchObject({
      code: "PDF_OCR_SUPPORT_UNAVAILABLE_OFFLINE",
    });
    expect(readiness).toHaveBeenCalledOnce();
    expect(readiness.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
    expect(document.renderPage).not.toHaveBeenCalled();
    expect(createAdapter).not.toHaveBeenCalled();
    await session.dispose();
  });

  it("rejects concurrent operations instead of racing", async () => {
    const pending = deferred<never>();
    const render = vi.fn(async () => pending.promise);
    const document = documentSession(render);
    const session = new PdfExtractionSession(
      document,
      dependencies(() => ocrAdapter()),
    );
    const first = session.run({
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: [1],
      settings: { mode: "ocr-all" },
    });
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());

    await expect(
      session.run({
        documentId: "document-1",
        operationId: "operation-2",
        selectedPages: [2],
      }),
    ).rejects.toMatchObject({ code: "PDF_OPERATION_IN_PROGRESS" });

    pending.reject(new PdfError("PDF_RENDER_CANCELLED"));
    await first;
    await session.dispose();
  });

  it("cancels rendering, preserves the document, and returns a cancelled result", async () => {
    const render = vi.fn(
      async (_pageNumber: number, options: PdfRenderOptions = {}) =>
        new Promise<never>((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(new PdfError("PDF_RENDER_CANCELLED")),
            { once: true },
          );
        }),
    );
    const document = documentSession(render);
    const selectedCanvas = canvas();
    const session = new PdfExtractionSession(
      document,
      dependencies(() => ocrAdapter(), selectedCanvas),
    );
    const running = session.run({
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: [1, 2],
      settings: { mode: "ocr-all" },
    });
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());

    await session.cancel();
    const result = await running;

    expect(result.outcome).toBe("cancelled");
    expect(result.pages.every((page) => page.status === "not-processed")).toBe(true);
    expect(document.cancelRender).toHaveBeenCalledOnce();
    expect(document.destroy).not.toHaveBeenCalled();
    expect(selectedCanvas.width).toBe(0);
    await session.dispose();
  });

  it("terminates active OCR and renews the adapter for a later run", async () => {
    const firstRecognition = deferred<never>();
    const first = ocrAdapter();
    vi.mocked(first.recognise).mockImplementation(() => firstRecognition.promise);
    vi.mocked(first.cancel).mockImplementation(async () => {
      firstRecognition.reject(new Error("worker terminated"));
    });
    const second = ocrAdapter("Second run");
    const createAdapter = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const document = documentSession();
    const session = new PdfExtractionSession(
      document,
      dependencies(createAdapter),
    );
    const running = session.run({
      documentId: "document-1",
      operationId: "operation-1",
      selectedPages: [1],
      settings: { mode: "ocr-all", preset: "original" },
    });
    await vi.waitFor(() => expect(first.recognise).toHaveBeenCalledOnce());

    await session.cancel();
    await expect(running).resolves.toMatchObject({ outcome: "cancelled" });
    expect(first.cancel).toHaveBeenCalledOnce();

    const retry = await session.processPage({
      documentId: "document-1",
      operationId: "retry-1",
      pageNumber: 1,
      method: "ocr",
      settings: { preset: "original" },
    });
    expect(retry.raw).toBe("Second run");
    expect(createAdapter).toHaveBeenCalledTimes(2);
    await session.dispose();
  });

  it("disposal releases OCR, canvas, and the owned document exactly once", async () => {
    const document = documentSession();
    const adapter = ocrAdapter();
    const selectedCanvas = canvas();
    const session = new PdfExtractionSession(
      document,
      dependencies(() => adapter, selectedCanvas),
    );
    await session.processPage({
      documentId: "document-1",
      operationId: "operation-1",
      pageNumber: 1,
      method: "ocr",
      settings: { preset: "original" },
    });

    await session.dispose();
    await session.dispose();

    expect(adapter.dispose).toHaveBeenCalledOnce();
    expect(document.destroy).toHaveBeenCalledOnce();
    expect(selectedCanvas.width).toBe(0);
    expect(selectedCanvas.height).toBe(0);
    await expect(
      session.run({
        documentId: "document-1",
        operationId: "late",
        selectedPages: [1],
      }),
    ).rejects.toMatchObject({ code: "PDF_DESTROYED" });
  });
});
