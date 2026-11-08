import { describe, expect, it, vi } from "vitest";
import { PdfPreviewRenderer } from "../../src/features/pdf/preview-renderer";
import type { PdfDocumentSession, PdfRenderedPage } from "../../src/features/pdf/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function page(pageNumber: number): PdfRenderedPage {
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 150;
  return {
    pageNumber, originalWidth: 60, originalHeight: 90, rotation: 0,
    requestedScale: 5 / 3, scale: 5 / 3, effectiveDpi: 120,
    width: 100, height: 150, estimatedRgbaBytes: 60_000,
    downscaled: false, renderDurationMs: 1, canvas,
    release: vi.fn(() => { canvas.width = 0; canvas.height = 0; }),
  };
}

function harness() {
  const renderPage = vi.fn<PdfDocumentSession["renderPage"]>();
  const session: PdfDocumentSession = {
    pageCount: 5, pageLabels: null, renderPage,
    extractText: vi.fn(async () => ({ pageNumber: 1, items: [] })),
    cancelRender: vi.fn(), destroy: vi.fn(async () => undefined),
  };
  return { renderPage, session, renderer: new PdfPreviewRenderer(session) };
}

describe("PDF preview renderer resource ownership", () => {
  it("renders at preview resolution without reusing an extraction canvas", async () => {
    const { renderer, renderPage } = harness();
    const rendered = page(2);
    renderPage.mockResolvedValue(rendered);
    await expect(renderer.render(2, new AbortController().signal)).resolves.toBe(rendered);
    expect(renderPage).toHaveBeenCalledExactlyOnceWith(2, {
      signal: expect.any(AbortSignal), targetDpi: 120,
    });
    await renderer.stop();
    expect(rendered.release).toHaveBeenCalledOnce();
    expect(rendered.canvas.width).toBe(0);
    expect(rendered.canvas.height).toBe(0);
    await renderer.stop();
    expect(rendered.release).toHaveBeenCalledOnce();
  });

  it("serializes rapid page changes and skips queued pages superseded before rendering", async () => {
    const { renderer, renderPage } = harness();
    const first = deferred<PdfRenderedPage>();
    const latest = page(3);
    renderPage.mockReturnValueOnce(first.promise).mockResolvedValueOnce(latest);
    const firstRender = renderer.render(1, new AbortController().signal);
    const firstCancelled = expect(firstRender).rejects.toMatchObject({ code: "PDF_RENDER_CANCELLED" });
    await Promise.resolve();
    expect(renderPage).toHaveBeenCalledTimes(1);
    const firstSignal = renderPage.mock.calls[0][1]!.signal!;
    const skippedRender = renderer.render(2, new AbortController().signal);
    const skippedCancelled = expect(skippedRender).rejects.toMatchObject({ code: "PDF_RENDER_CANCELLED" });
    const lastRender = renderer.render(3, new AbortController().signal);
    expect(firstSignal.aborted).toBe(true);
    await Promise.resolve();
    expect(renderPage).toHaveBeenCalledTimes(1);
    const obsolete = page(1);
    first.resolve(obsolete);
    await firstCancelled;
    await skippedCancelled;
    await expect(lastRender).resolves.toBe(latest);
    expect(renderPage.mock.calls.map(([number]) => number)).toEqual([1, 3]);
    expect(obsolete.release).toHaveBeenCalledOnce();
    expect(latest.release).not.toHaveBeenCalled();
    await renderer.dispose();
    expect(latest.release).toHaveBeenCalledOnce();
  });

  it("drains cancelled rendering before the caller starts extraction", async () => {
    const { renderer, renderPage, session } = harness();
    const pending = deferred<PdfRenderedPage>();
    renderPage.mockReturnValueOnce(pending.promise);
    const rendering = renderer.render(1, new AbortController().signal);
    const cancelled = expect(rendering).rejects.toMatchObject({ code: "PDF_RENDER_CANCELLED" });
    await Promise.resolve();
    const handoff = renderer.stop().then(() => session.extractText(1));
    expect(renderPage.mock.calls[0][1]!.signal!.aborted).toBe(true);
    await Promise.resolve();
    expect(session.extractText).not.toHaveBeenCalled();
    const obsolete = page(1);
    pending.resolve(obsolete);
    await cancelled;
    await handoff;
    expect(obsolete.release).toHaveBeenCalledOnce();
    expect(session.extractText).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("releases a late success after caller abort and can render again", async () => {
    const { renderer, renderPage } = harness();
    const pending = deferred<PdfRenderedPage>();
    renderPage.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(page(2));
    const controller = new AbortController();
    const rendering = renderer.render(1, controller.signal);
    const cancelled = expect(rendering).rejects.toMatchObject({ code: "PDF_RENDER_CANCELLED" });
    await Promise.resolve();
    controller.abort();
    expect(renderPage.mock.calls[0][1]!.signal!.aborted).toBe(true);
    const obsolete = page(1);
    pending.resolve(obsolete);
    await cancelled;
    expect(obsolete.release).toHaveBeenCalledOnce();
    await expect(renderer.render(2, new AbortController().signal)).resolves.toMatchObject({ pageNumber: 2 });
    expect(renderPage).toHaveBeenCalledTimes(2);
    await renderer.dispose();
  });

  it("dispose drains pending work and rejects further renders without destroying the shared document", async () => {
    const { renderer, renderPage, session } = harness();
    const pending = deferred<PdfRenderedPage>();
    renderPage.mockReturnValueOnce(pending.promise);
    const rendering = renderer.render(1, new AbortController().signal);
    const cancelled = expect(rendering).rejects.toMatchObject({ code: "PDF_RENDER_CANCELLED" });
    await Promise.resolve();
    let disposed = false;
    const disposal = renderer.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);
    await expect(renderer.render(2, new AbortController().signal)).rejects.toMatchObject({ code: "PDF_RENDER_CANCELLED" });
    const obsolete = page(1);
    pending.resolve(obsolete);
    await cancelled;
    await disposal;
    expect(obsolete.release).toHaveBeenCalledOnce();
    expect(renderPage).toHaveBeenCalledTimes(1);
    expect(session.destroy).not.toHaveBeenCalled();
  });

  it("does not disturb a current preview for an already-aborted request", async () => {
    const { renderer, renderPage } = harness();
    const active = page(1);
    renderPage.mockResolvedValue(active);
    await renderer.render(1, new AbortController().signal);
    const controller = new AbortController();
    controller.abort();
    await expect(renderer.render(2, controller.signal)).rejects.toMatchObject({ code: "PDF_RENDER_CANCELLED" });
    expect(renderPage).toHaveBeenCalledTimes(1);
    expect(active.release).not.toHaveBeenCalled();
    await renderer.dispose();
  });

  it("allows a retry after the PDF worker rejects rendering", async () => {
    const { renderer, renderPage } = harness();
    renderPage.mockRejectedValueOnce(new Error("synthetic worker failure")).mockResolvedValueOnce(page(1));
    await expect(renderer.render(1, new AbortController().signal)).rejects.toThrow("synthetic worker failure");
    await expect(renderer.render(1, new AbortController().signal)).resolves.toMatchObject({ pageNumber: 1 });
    expect(renderPage).toHaveBeenCalledTimes(2);
    await renderer.dispose();
  });
});
