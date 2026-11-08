import { PdfError } from "./errors";
import type { PdfDocumentSession, PdfRenderedPage } from "./types";

/** One bounded preview at a time, sharing the existing local PDF worker. */
export class PdfPreviewRenderer {
  private tail: Promise<void> = Promise.resolve();
  private controller: AbortController | null = null;
  private rendered: PdfRenderedPage | null = null;
  private generation = 0;
  private disposed = false;

  constructor(private readonly document: PdfDocumentSession) {}

  async render(pageNumber: number, signal: AbortSignal): Promise<PdfRenderedPage> {
    if (this.disposed || signal.aborted) throw new PdfError("PDF_RENDER_CANCELLED");
    const previous = this.stop();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const task = previous.then(async () => {
      if (this.disposed || controller.signal.aborted || generation !== this.generation) {
        throw new PdfError("PDF_RENDER_CANCELLED");
      }
      // A fresh canvas avoids reusing a surface still owned by a cancelled task.
      // The adapter also applies the normal page-side and pixel-count limits.
      const rendered = await this.document.renderPage(pageNumber, {
        signal: controller.signal,
        targetDpi: 120,
      });
      if (this.disposed || controller.signal.aborted || generation !== this.generation) {
        rendered.release();
        throw new PdfError("PDF_RENDER_CANCELLED");
      }
      this.rendered = rendered;
      return rendered;
    });
    this.tail = task.then(() => undefined, () => undefined);
    try {
      return await task;
    } finally {
      signal.removeEventListener("abort", abort);
      if (this.controller === controller) this.controller = null;
    }
  }

  /** Drain before extraction: PDF.js permits only one page operation per session. */
  stop(): Promise<void> {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
    this.rendered?.release();
    this.rendered = null;
    return this.tail;
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return this.stop();
  }
}
