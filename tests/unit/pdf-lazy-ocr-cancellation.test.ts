import { expect, it, vi } from "vitest";
import { PdfExtractionSession } from "../../src/features/pdf/extraction-session";
import type { PdfDocumentSession } from "../../src/features/pdf/types";

it("cancels PDF OCR while its lazy module import is stalled and ignores a late module", async () => {
  let resolveModule!: (value: { LocalTesseractAdapter: typeof Adapter }) => void;
  const constructed = vi.fn();
  class Adapter {
    constructor() { constructed(); }
  }
  const moduleLoaded = new Promise<{ LocalTesseractAdapter: typeof Adapter }>((resolve) => {
    resolveModule = resolve;
  });
  const importing = vi.fn(() => moduleLoaded);
  vi.doMock("../../src/features/ocr/tesseract-adapter", importing);
  const canvas = document.createElement("canvas");
  const context = {
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(16).fill(255) })),
    putImageData: vi.fn(),
  };
  Object.defineProperty(canvas, "getContext", { value: () => context });
  const documentSession: PdfDocumentSession = {
    pageCount: 1,
    pageLabels: null,
    extractText: async (pageNumber) => ({ pageNumber, items: [] }),
    renderPage: async (pageNumber) => {
      canvas.width = 2;
      canvas.height = 2;
      return {
        pageNumber,
        originalWidth: 2,
        originalHeight: 2,
        rotation: 0,
        requestedScale: 1,
        scale: 1,
        effectiveDpi: 300,
        width: 2,
        height: 2,
        estimatedRgbaBytes: 16,
        downscaled: false,
        renderDurationMs: 0,
        canvas,
        release: () => { canvas.width = 0; canvas.height = 0; },
      };
    },
    cancelRender: vi.fn(),
    destroy: vi.fn(async () => undefined),
  };
  const session = new PdfExtractionSession(documentSession, { createCanvas: () => canvas });
  try {
    const running = session.run({
      documentId: "lazy-cancel-document",
      operationId: "lazy-cancel-operation",
      selectedPages: [1],
      settings: { mode: "ocr-all", preset: "original" },
    });
    await vi.waitFor(() => expect(importing).toHaveBeenCalledOnce());
    await session.cancel();
    await expect(running).resolves.toMatchObject({ outcome: "cancelled" });
    expect(documentSession.destroy).not.toHaveBeenCalled();
    expect(canvas.width).toBe(0);
    resolveModule({ LocalTesseractAdapter: Adapter });
    await moduleLoaded;
    await Promise.resolve();
    expect(constructed).not.toHaveBeenCalled();
  } finally {
    await session.dispose();
    vi.doUnmock("../../src/features/ocr/tesseract-adapter");
  }
});
