import type { PdfProgress as PdfProgressValue } from "../../features/pdf/types";

function phaseLabel(progress: PdfProgressValue | null) {
  if (!progress) return "Starting local PDF processing…";
  if (progress.phase === "preflight") return "Checking which pages already contain usable text…";
  if (progress.phase === "rendering") return "Preparing the selected PDF page…";
  if (progress.phase === "preparing") return "Improving the selected page locally…";
  if (progress.phase === "loading-ocr") return "Loading selected OCR language support…";
  if (progress.phase === "recognising") return "Recognising text on this page…";
  if (progress.phase === "embedded-text") return "Reading existing PDF text…";
  return "Finishing the page-marked text…";
}

export function PdfProgress({
  progress,
  selectedCount,
  processingPage,
  onCancel,
}: {
  readonly progress: PdfProgressValue | null;
  readonly selectedCount: number;
  readonly processingPage: number | null;
  readonly onCancel: () => void;
}) {
  const position = progress?.currentSelectedPageIndex;
  const current = position === null || position === undefined ? null : position + 1;
  const percent = progress?.overall === null || progress?.overall === undefined
    ? null
    : Math.round(progress.overall * 100);
  return (
    <section className="pdf-progress" aria-labelledby="pdf-progress-title">
      <div className="pdf-progress__heading">
        <div>
          <p className="section-index">Local processing</p>
          <h2 id="pdf-progress-title">{phaseLabel(progress)}</h2>
          {processingPage ?? progress?.pageNumber ? (
            <p>
              Page {processingPage ?? progress?.pageNumber}
              {current ? ` · ${current} of ${progress?.totalSelectedPages ?? selectedCount}` : ""}
            </p>
          ) : null}
        </div>
        <strong>{percent === null ? "Working" : `${percent}%`}</strong>
      </div>
      {percent === null ? (
        <div className="indeterminate-progress" aria-hidden="true" />
      ) : (
        <progress max="1" value={progress?.overall ?? 0} aria-label="Document processing progress">
          {percent}%
        </progress>
      )}
      {progress?.pageValue !== null && progress?.pageValue !== undefined ? (
        <progress
          className="pdf-progress__page"
          max="1"
          value={progress.pageValue}
          aria-label={`Page ${progress.pageNumber ?? processingPage ?? ""} progress`}
        />
      ) : null}
      <button className="button button--quiet" type="button" onClick={onCancel}>
        Cancel processing
      </button>
    </section>
  );
}
