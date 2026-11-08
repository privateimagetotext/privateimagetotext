import { PdfError } from "./errors";
import {
  runPdfExtraction,
  runSinglePdfPage,
  type PdfExtractionRequest,
  type PdfExtractionRunnerContext,
  type PdfOcrAdapter,
  type PdfSinglePageRequest,
} from "./extraction-runner";
import type {
  PdfDocumentResult,
  PdfDocumentSession,
  PdfPageResult,
} from "./types";

type ActiveOperation<T> = {
  readonly token: object;
  readonly controller: AbortController;
  readonly promise: Promise<T>;
};

/** Defers the Tesseract module as well as its worker/core/model until OCR is used. */
class LazyLocalTesseractAdapter implements PdfOcrAdapter {
  private adapterPromise: Promise<PdfOcrAdapter> | null = null;
  private adapter: PdfOcrAdapter | null = null;
  private readonly stopped = new AbortController();
  private disposed = false;

  async recognise(
    ...args: Parameters<PdfOcrAdapter["recognise"]>
  ): ReturnType<PdfOcrAdapter["recognise"]> {
    if (this.disposed) throw new PdfError("PDF_OPERATION_CANCELLED");
    let abort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new PdfError("PDF_OPERATION_CANCELLED"));
      this.stopped.signal.addEventListener("abort", abort, { once: true });
    });
    try {
      const adapter = await Promise.race([this.getAdapter(), cancelled]);
      if (this.disposed) throw new PdfError("PDF_OPERATION_CANCELLED");
      return await adapter.recognise(...args);
    } finally {
      if (abort) this.stopped.signal.removeEventListener("abort", abort);
    }
  }

  async cancel() {
    this.disposed = true;
    this.stopped.abort();
    await this.adapter?.cancel();
  }

  async dispose() {
    this.disposed = true;
    this.stopped.abort();
    await this.adapter?.dispose();
  }

  private getAdapter() {
    if (this.disposed) {
      return Promise.reject(new PdfError("PDF_OPERATION_CANCELLED"));
    }
    this.adapterPromise ??= import("../ocr/tesseract-adapter").then(
      ({ LocalTesseractAdapter }) => {
        if (this.disposed) {
          throw new PdfError("PDF_OPERATION_CANCELLED");
        }
        this.adapter = new LocalTesseractAdapter();
        return this.adapter;
      },
    );
    return this.adapterPromise;
  }
}

export type PdfExtractionSessionDependencies = {
  readonly createCanvas: () => HTMLCanvasElement;
  readonly createOcrAdapter: () => PdfOcrAdapter;
  readonly isOcrSupportReady: (
    signal: AbortSignal,
    languages: readonly string[],
  ) => boolean | Promise<boolean>;
  readonly now: () => number;
};

const defaultDependencies: PdfExtractionSessionDependencies = {
  createCanvas: () => document.createElement("canvas"),
  createOcrAdapter: () => new LazyLocalTesseractAdapter(),
  isOcrSupportReady: () => true,
  now: () => performance.now(),
};

function zeroCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

/** Owns non-serializable resources for one open PDF document. */
export class PdfExtractionSession {
  private readonly dependencies: PdfExtractionSessionDependencies;
  private canvas: HTMLCanvasElement | null = null;
  private ocrAdapter: PdfOcrAdapter | null = null;
  private active: ActiveOperation<unknown> | null = null;
  private disposed = false;
  private disposePromise: Promise<void> | null = null;

  constructor(
    private readonly documentSession: PdfDocumentSession,
    dependencies: Partial<PdfExtractionSessionDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  run(request: PdfExtractionRequest): Promise<PdfDocumentResult> {
    return this.start((context) => runPdfExtraction(context, request));
  }

  processPage(request: PdfSinglePageRequest): Promise<PdfPageResult> {
    return this.start((context) => runSinglePdfPage(context, request));
  }

  async cancel() {
    const active = this.active;
    if (!active) return;
    active.controller.abort();
    this.documentSession.cancelRender();
    const adapter = this.ocrAdapter;
    this.ocrAdapter = null;
    if (adapter) await adapter.cancel().catch(() => undefined);
    await active.promise.catch(() => undefined);
    zeroCanvas(this.canvas);
  }

  dispose() {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.disposePromise = (async () => {
      const active = this.active;
      await this.cancel();
      await active?.promise.catch(() => undefined);
      const adapter = this.ocrAdapter;
      this.ocrAdapter = null;
      await adapter?.dispose().catch(() => undefined);
      zeroCanvas(this.canvas);
      this.canvas = null;
      await this.documentSession.destroy();
    })();
    return this.disposePromise;
  }

  private start<T>(
    operation: (context: PdfExtractionRunnerContext) => Promise<T>,
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new PdfError("PDF_DESTROYED"));
    if (this.active) {
      return Promise.reject(new PdfError("PDF_OPERATION_IN_PROGRESS"));
    }
    const controller = new AbortController();
    const token = {};
    const canvas = this.canvas ?? this.dependencies.createCanvas();
    this.canvas = canvas;
    const context: PdfExtractionRunnerContext = {
      document: this.documentSession,
      canvas,
      signal: controller.signal,
      isOcrSupportReady: (languages) =>
        this.dependencies.isOcrSupportReady(controller.signal, languages),
      getOcrAdapter: () => {
        if (controller.signal.aborted) {
          throw new PdfError("PDF_OPERATION_CANCELLED");
        }
        this.ocrAdapter ??= this.dependencies.createOcrAdapter();
        return this.ocrAdapter;
      },
      now: this.dependencies.now,
    };
    const promise = operation(context).finally(() => {
      if (this.active?.token === token) this.active = null;
      zeroCanvas(canvas);
    });
    this.active = { token, controller, promise };
    return promise;
  }
}
