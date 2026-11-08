import type {
  OcrLanguageStatus,
  PdfAssetStatus,
} from "../../lib/service-worker";
import { selectedOcrLanguages } from "../../config/ocr-languages";

function supportStatus(status: PdfAssetStatus | null) {
  if (status === "PDF reader preparation failed") return ["failed", "PDF reader preparation failed"] as const;
  if (status === "Preparing PDF reader assets") return ["preparing", "Preparing PDF reader"] as const;
  if (status === "PDF reader available offline") return ["ready", "PDF reader available offline"] as const;
  return ["missing", "PDF reader not prepared for offline use"] as const;
}

export function PdfOfflineStatus({
  pdfStatus,
  languageStatus,
  languages,
  preparing,
  supportSize,
  onPrepare,
}: {
  readonly pdfStatus: PdfAssetStatus | null;
  readonly languageStatus: OcrLanguageStatus;
  readonly languages: readonly string[];
  readonly preparing: boolean;
  readonly supportSize: string;
  readonly onPrepare: () => void;
}) {
  const [pdfKind, pdfLabel] = supportStatus(pdfStatus);
  const names = selectedOcrLanguages(languages).map((model) => model.label).join(", ");
  const ocrKind = languages.every((id) => languageStatus.ready.includes(id)) ? "ready"
    : languages.some((id) => languageStatus.preparing.includes(id)) ? "preparing"
      : languageStatus.failed ? "failed" : "missing";
  const ocrLabel = ocrKind === "ready" ? `${names} OCR available offline`
    : ocrKind === "preparing" ? `Preparing ${names} OCR`
      : ocrKind === "failed" ? "OCR preparation failed"
        : `${names} OCR not prepared for offline use`;
  const bothReady = pdfKind === "ready" && ocrKind === "ready";
  return (
    <section className="pdf-offline" aria-labelledby="pdf-offline-title">
      <div>
        <p className="section-index">Optional offline preparation</p>
        <h3 id="pdf-offline-title">Support files stay separate from your PDF</h3>
        <p>
          Digital PDF extraction needs the PDF reader. Scanned PDF OCR needs both the PDF reader and the selected OCR languages.
        </p>
      </div>
      <ul className="pdf-readiness-list">
        <li data-status={pdfKind}>
          <span aria-hidden="true" />
          <div><strong>PDF reader</strong><small>{pdfLabel} · {supportSize}</small></div>
        </li>
        <li data-status={ocrKind}>
          <span aria-hidden="true" />
          <div><strong>Selected OCR languages</strong><small>{ocrLabel}</small></div>
        </li>
      </ul>
      <button
        className="button button--quiet"
        type="button"
        disabled={preparing || bothReady}
        onClick={onPrepare}
      >
        {bothReady ? "Offline support prepared" : preparing ? "Preparing support…" : "Prepare PDF and OCR support"}
      </button>
      <small>
        Only verified same-site application, PDF reader and OCR support files are prepared. Selected PDFs and results are not placed in the offline cache.
      </small>
    </section>
  );
}
