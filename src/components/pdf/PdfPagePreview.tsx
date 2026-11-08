import { useEffect, useRef, useState } from "react";
import type { PdfRenderedPage } from "../../features/pdf/types";

export type PdfPreviewRender = (pageNumber: number, signal: AbortSignal) => Promise<PdfRenderedPage>;

export function PdfPagePreview({
  pages, pageNumber, onSelectPage, renderPage, busy,
}: {
  readonly pages: readonly number[];
  readonly pageNumber: number | null;
  readonly onSelectPage: (pageNumber: number) => void;
  readonly renderPage: PdfPreviewRender;
  readonly busy: boolean;
}) {
  const canvasHost = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [zoom, setZoom] = useState(100);
  const [retry, setRetry] = useState(0);
  const index = pageNumber === null ? -1 : pages.indexOf(pageNumber);

  useEffect(() => {
    if (busy || pageNumber === null) return;
    const controller = new AbortController();
    const host = canvasHost.current;
    let rendered: PdfRenderedPage | null = null;
    setStatus("loading");
    void renderPage(pageNumber, controller.signal).then((page) => {
      if (controller.signal.aborted) {
        page.release();
        return;
      }
      rendered = page;
      page.canvas.setAttribute("role", "img");
      page.canvas.setAttribute("aria-label", `Source PDF page ${pageNumber}`);
      host?.replaceChildren(page.canvas);
      setStatus("ready");
    }).catch(() => {
      if (!controller.signal.aborted) setStatus("error");
    });
    return () => {
      controller.abort();
      host?.replaceChildren();
      rendered?.release();
    };
  }, [busy, pageNumber, renderPage, retry]);

  return (
    <section className="pdf-source-preview" aria-label="PDF source preview">
      <header>
        <div>
          <p className="section-index">Original page</p>
          <h3>{pageNumber === null ? "Select pages to preview" : `Source page ${pageNumber}`}</h3>
        </div>
        <p>Rendered locally. Compare this page with its extracted text.</p>
      </header>
      <div className="pdf-preview-controls" role="group" aria-label="Source page navigation">
        <button className="button button--quiet" type="button" disabled={busy || index <= 0} onClick={() => onSelectPage(pages[index - 1])}>Previous page</button>
        <label className="pdf-field">
          <span>Preview page</span>
          <select aria-label="Preview page" value={pageNumber ?? ""} disabled={busy || pages.length === 0} onChange={(event) => onSelectPage(Number(event.target.value))}>
            {pages.length === 0 ? <option value="">No pages selected</option> : pages.map((page) => <option key={page} value={page}>Page {page}</option>)}
          </select>
        </label>
        <button className="button button--quiet" type="button" disabled={busy || index < 0 || index >= pages.length - 1} onClick={() => onSelectPage(pages[index + 1])}>Next page</button>
        <label className="pdf-field">
          <span>Preview zoom</span>
          <select aria-label="Preview zoom" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
            <option value={100}>Fit width</option>
            <option value={150}>150%</option>
            <option value={200}>200%</option>
          </select>
        </label>
      </div>
      <p className="pdf-preview-status" role="status" aria-live="polite">
        {busy ? "Preview paused while pages are processed." : pageNumber === null ? "Choose a valid page range to see a preview." : status === "loading" ? `Rendering source page ${pageNumber} locally…` : status === "error" ? `Source page ${pageNumber} could not be previewed. Text extraction is still available.` : `Source page ${pageNumber} ready.`}
      </p>
      {!busy && status === "error" ? <button className="button button--quiet" type="button" onClick={() => setRetry((value) => value + 1)}>Retry preview</button> : null}
      <div className="pdf-preview-viewport" tabIndex={status === "ready" && !busy ? 0 : -1} role="region" aria-label="Scrollable source page" hidden={busy || pageNumber === null || status !== "ready"}>
        <div className="pdf-preview-canvas" ref={canvasHost} style={{ width: `${zoom}%` }} />
      </div>
      <small>Annotations and interactive form values may be missing. Zoom enlarges this bounded preview; use a trusted PDF viewer for finer detail.</small>
    </section>
  );
}
