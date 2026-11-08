import { formatFileSize } from "../../features/ocr/validation";

export function PdfDocumentSummary({
  name,
  size,
  pageCount,
  selectedCount,
  passwordProtected,
  busy,
  onReplace,
  onClear,
}: {
  readonly name: string;
  readonly size: number;
  readonly pageCount: number;
  readonly selectedCount: number;
  readonly passwordProtected: boolean;
  readonly busy: boolean;
  readonly onReplace: () => void;
  readonly onClear: () => void;
}) {
  return (
    <section className="pdf-document-summary" aria-labelledby="pdf-document-title">
      <div className="pdf-document-summary__heading">
        <div>
          <p className="section-index">Open PDF</p>
          <h2 id="pdf-document-title">{name}</h2>
        </div>
        <div className="pdf-document-summary__actions">
          <button className="text-button" type="button" onClick={onReplace}>
            Replace PDF
          </button>
          <button className="text-button text-button--danger" type="button" onClick={onClear}>
            Clear PDF
          </button>
        </div>
      </div>
      <dl className="pdf-summary-facts">
        <div><dt>Size</dt><dd>{formatFileSize(size)}</dd></div>
        <div><dt>Pages</dt><dd>{pageCount}</dd></div>
        <div><dt>Selected</dt><dd>{selectedCount}</dd></div>
        <div><dt>Protection</dt><dd>{passwordProtected ? "Password accepted" : "No password requested"}</dd></div>
        <div><dt>Processing</dt><dd>{busy ? "Local operation active" : "Ready"}</dd></div>
      </dl>
    </section>
  );
}
