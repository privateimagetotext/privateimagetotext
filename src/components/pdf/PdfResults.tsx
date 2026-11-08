import { useEffect, useMemo, useRef, type RefObject } from "react";
import type {
  PdfDocumentResult,
  PdfForcedExtractionMethod,
  PdfPageResult,
  PdfPageStatus,
} from "../../features/pdf/types";
import { resultCounts } from "../../features/ocr/text";
import { PdfPagePreview, type PdfPreviewRender } from "./PdfPagePreview";

const statusLabels: Record<PdfPageStatus, string> = {
  pending: "Pending",
  "checking-text": "Checking PDF text",
  rendering: "Preparing page",
  preparing: "Improving page",
  "loading-ocr": "Loading OCR",
  recognising: "Recognising",
  complete: "Complete",
  failed: "Failed",
  skipped: "Skipped",
  "not-processed": "Not processed",
};

const warningLabels = {
  NO_EMBEDDED_TEXT: "No existing text was found.",
  TEXT_LAYER_UNCERTAIN: "The existing text layer may be incomplete or unreliable.",
  TEXT_LAYER_INVALID: "The existing text layer appeared invalid.",
  UNMAPPED_TEXT_CHARACTERS: "Some extracted characters may not represent the original symbols. Compare symbols with the PDF and correct the text before use.",
  EMPTY_PAGE_TEXT: "This extraction returned no text.",
  PAGE_RENDER_REDUCED: "This large page was reduced before OCR.",
} as const;

function methodLabel(page: PdfPageResult | undefined) {
  if (!page || page.method === "none") return "Not selected yet";
  if (page.method === "embedded-text") return "PDF text";
  return "OCR";
}

function editorActions(page: PdfPageResult) {
  const actions: { label: string; method: PdfForcedExtractionMethod }[] = [];
  if (page.status === "complete" && page.method === "embedded-text") {
    actions.push({
      label: page.edited.length === 0 ? "Try OCR" : "Force OCR for this page",
      method: "ocr",
    });
  } else if (page.status === "complete" && page.method === "ocr") {
    actions.push({ label: "Re-run OCR for this page", method: "ocr" });
    actions.push({ label: "Use existing PDF text for this page", method: "embedded-text" });
  } else if (page.status === "failed") {
    if (page.method === "ocr") {
      actions.push({ label: "Retry OCR", method: "ocr" });
      actions.push({ label: "Try existing PDF text", method: "embedded-text" });
    } else {
      actions.push({ label: "Retry existing text", method: "embedded-text" });
      actions.push({ label: "Try OCR", method: "ocr" });
    }
  } else if (page.status === "not-processed" || page.status === "skipped" || page.status === "pending") {
    actions.push({ label: "Use existing PDF text", method: "embedded-text" });
    actions.push({ label: "Use OCR", method: "ocr" });
  }
  return actions;
}

export function PdfResults({
  result,
  selectedPages,
  workflowPages,
  activePageNumber,
  processingPage,
  attemptError,
  attemptErrorPage,
  busy,
  resultRef,
  onSelectPage,
  onEdit,
  onReprocess,
  onCopy,
  onDownload,
  renderPreview,
}: {
  readonly result: PdfDocumentResult;
  readonly selectedPages: readonly number[];
  readonly workflowPages: Readonly<Record<number, PdfPageResult>>;
  readonly activePageNumber: number | null;
  readonly processingPage: number | null;
  readonly attemptError: string | null;
  readonly attemptErrorPage: number | null;
  readonly busy: boolean;
  readonly resultRef: RefObject<HTMLElement | null>;
  readonly onSelectPage: (pageNumber: number) => void;
  readonly onEdit: (pageNumber: number, value: string) => void;
  readonly onReprocess: (pageNumber: number, method: PdfForcedExtractionMethod) => void;
  readonly onCopy: () => void;
  readonly onDownload: () => void;
  readonly renderPreview: PdfPreviewRender;
}) {
  const buttonRefs = useRef(new Map<number, HTMLButtonElement>());
  const resultPages = useMemo(
    () => new Map(result.pages.map((page) => [page.pageNumber, page] as const)),
    [result.pages],
  );
  const activePage = activePageNumber ? resultPages.get(activePageNumber) : undefined;
  const outputText = result.pages
    .filter((page) => page.status === "complete")
    .map((page) => page.edited)
    .join("\n");
  const counts = resultCounts(outputText);

  useEffect(() => {
    if (activePageNumber) {
      buttonRefs.current.get(activePageNumber)?.scrollIntoView({ block: "nearest" });
    }
  }, [activePageNumber]);

  const chooseByKey = (event: React.KeyboardEvent, index: number) => {
    let next = index;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = Math.min(selectedPages.length - 1, index + 1);
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = selectedPages.length - 1;
    else return;
    event.preventDefault();
    const pageNumber = selectedPages[next];
    onSelectPage(pageNumber);
    buttonRefs.current.get(pageNumber)?.focus();
  };

  return (
    <section
      ref={resultRef}
      className="pdf-results"
      aria-labelledby="pdf-results-title"
      tabIndex={-1}
    >
      <div className="pdf-results__heading">
        <div>
          <p className="section-index">Page-marked result</p>
          <h2 id="pdf-results-title">
            {result.outcome === "complete" ? "Selected pages processed" : result.outcome === "cancelled" ? "Processing cancelled — completed pages retained" : "Partial result — review page warnings"}
          </h2>
        </div>
        <div className="pdf-result-actions">
          <button className="button button--primary" type="button" onClick={onCopy}>Copy all</button>
          <button className="button button--quiet" type="button" onClick={onDownload}>Download .txt</button>
        </div>
      </div>
      <p className="pdf-assessment">Compare important text with your original PDF. Automatic can miss errors in an existing text layer or choose OCR when PDF text is better. Use the page actions below to try the other method.</p>
      <dl className="pdf-result-summary">
        <div><dt>Selected</dt><dd>{result.selectedPages.length}</dd></div>
        <div><dt>PDF text</dt><dd>{result.embeddedTextPageCount}</dd></div>
        <div><dt>OCR</dt><dd>{result.ocrPageCount}</dd></div>
        <div><dt>Empty</dt><dd>{result.emptyPageCount}</dd></div>
        <div><dt>Failed</dt><dd>{result.failedPageCount}</dd></div>
        <div><dt>Not processed</dt><dd>{result.skippedOrUnprocessedPageCount}</dd></div>
        <div><dt>Characters</dt><dd>{result.totalOutputCharacters.toLocaleString("en-AU")}</dd></div>
        <div><dt>Words</dt><dd>{counts.words.toLocaleString("en-AU")}</dd></div>
        <div><dt>Elapsed</dt><dd>{(result.elapsedMs / 1000).toFixed(1)}s</dd></div>
      </dl>

      <div className="pdf-page-workspace">
        <nav className="pdf-page-list" aria-label="Selected PDF pages">
          <ol>
            {selectedPages.map((pageNumber, index) => {
              const workflow = workflowPages[pageNumber];
              const saved = resultPages.get(pageNumber);
              const status = workflow?.status ?? saved?.status ?? "not-processed";
              const confidence = saved?.method === "ocr" && saved.confidence !== null
                ? `${Math.round(saved.confidence)}% confidence`
                : null;
              return (
                <li key={pageNumber}>
                  <button
                    ref={(element) => {
                      if (element) buttonRefs.current.set(pageNumber, element);
                      else buttonRefs.current.delete(pageNumber);
                    }}
                    type="button"
                    aria-current={activePageNumber === pageNumber ? "page" : undefined}
                    className={activePageNumber === pageNumber ? "is-active" : ""}
                    onClick={() => onSelectPage(pageNumber)}
                    onKeyDown={(event) => chooseByKey(event, index)}
                  >
                    <span><strong>Page {pageNumber}</strong>{saved?.pageLabel ? <small>Label {saved.pageLabel}</small> : null}</span>
                    <span>
                      <strong>{processingPage === pageNumber ? "Processing" : methodLabel(saved)}</strong>
                      <small>{statusLabels[status]}{confidence ? ` · ${confidence}` : ""}</small>
                    </span>
                    {(saved?.warnings.length ?? 0) > 0 || saved?.error ? <span className="pdf-page-warning" aria-label="Warning">!</span> : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="pdf-page-comparison">
        <PdfPagePreview
          pages={selectedPages}
          pageNumber={activePageNumber}
          onSelectPage={onSelectPage}
          renderPage={renderPreview}
          busy={busy}
        />
        <article className="pdf-page-editor" aria-live="off">
          {activePage ? (
            <>
              <header>
                <div>
                  <p className="section-index">Active result</p>
                  <h3>Page {activePage.pageNumber}{activePage.pageLabel ? ` · ${activePage.pageLabel}` : ""}</h3>
                </div>
                <span className={`pdf-method-badge pdf-method-badge--${activePage.method}`}>
                  {methodLabel(activePage)}
                </span>
              </header>
              {activePage.textLayerAssessment ? (
                <p className="pdf-assessment">
                  Existing text assessment (method hint): {activePage.textLayerAssessment.classification.replace("-", " ")}.
                </p>
              ) : null}
              {activePage.confidence !== null ? (
                <p>OCR engine confidence: {Math.round(activePage.confidence)}%. This is a review hint, not a measured accuracy rate. Check important names, numbers and punctuation.</p>
              ) : null}
              {activePage.warnings.length > 0 ? (
                <ul className="pdf-page-warnings">
                  {activePage.warnings.map((warning) => <li key={warning}>{warningLabels[warning]}</li>)}
                </ul>
              ) : null}
              {activePage.error ? <p className="pdf-control-error" role="alert">{activePage.error.message} {activePage.error.retryable ? "You can retry this page." : ""}</p> : null}
              {attemptErrorPage === activePage.pageNumber && attemptError ? (
                <p className="pdf-control-error" role="alert">{attemptError}</p>
              ) : null}
              {activePage.status === "complete" ? (
                <label className="pdf-page-text" htmlFor={`pdf-page-text-${activePage.pageNumber}`}>
                  <span id="pdf-active-text-label">Editable text for page {activePage.pageNumber}</span>
                  <textarea
                    id={`pdf-page-text-${activePage.pageNumber}`}
                    aria-labelledby="pdf-active-text-label"
                    aria-describedby="pdf-active-text-help"
                    value={activePage.edited}
                    disabled={busy}
                    spellCheck={false}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    placeholder={activePage.edited.length === 0 ? "This page returned no text." : undefined}
                    onChange={(event) => onEdit(activePage.pageNumber, event.currentTarget.value)}
                  />
                  <small id="pdf-active-text-help">{activePage.edited !== activePage.cleaned ? "Edited in this tab. Changes are not saved after Clear or navigation." : "Generated text. Review and correct it before use."}</small>
                </label>
              ) : (
                <div className="pdf-empty-editor">
                  <strong>{statusLabels[activePage.status]}</strong>
                  <p>This page does not currently contain editable generated text.</p>
                </div>
              )}
              <div className="pdf-page-actions">
                {editorActions(activePage).map((action) => (
                  <button
                    key={action.method}
                    className="button button--quiet"
                    type="button"
                    disabled={busy}
                    onClick={() => onReprocess(activePage.pageNumber, action.method)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
              {processingPage === activePage.pageNumber ? (
                <p className="pdf-attempt-note" role="status">A new extraction attempt is running. The previous result is retained until a replacement succeeds.</p>
              ) : null}
            </>
          ) : (
            <div className="pdf-empty-editor"><strong>Choose a page</strong><p>Select a page from the list to review it.</p></div>
          )}
        </article>
        </div>
      </div>
    </section>
  );
}
