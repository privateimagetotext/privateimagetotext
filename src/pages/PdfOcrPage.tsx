import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { routes } from "../config/routes";
import { HelpfulGuides } from "../components/HelpfulGuides";
import { ToolDirectory } from "../components/ToolDirectory";
import { PdfConfirmDialog } from "../components/pdf/PdfConfirmDialog";
import { PdfDocumentSummary } from "../components/pdf/PdfDocumentSummary";
import { PdfDropzone } from "../components/pdf/PdfDropzone";
import { PdfOfflineStatus } from "../components/pdf/PdfOfflineStatus";
import { PdfPasswordDialog } from "../components/pdf/PdfPasswordDialog";
import { PdfProcessingOptions } from "../components/pdf/PdfProcessingOptions";
import { PdfProgress } from "../components/pdf/PdfProgress";
import { PdfResults } from "../components/pdf/PdfResults";
import { PdfPagePreview } from "../components/pdf/PdfPagePreview";
import { PDF_LIMITS } from "../features/pdf/validation";
import { pdfCopy } from "../config/tool-copy";
import {
  usePdfOcrWorkspace,
  type PdfWorkspaceDependencies,
} from "../hooks/usePdfOcrWorkspace";
import "../styles/pdf-ocr.css";

export type PdfOcrPageProps = {
  readonly workspaceDependencies?: Partial<PdfWorkspaceDependencies>;
};

export function PdfOcrPage({ workspaceDependencies }: PdfOcrPageProps) {
  const workspace = usePdfOcrWorkspace(workspaceDependencies);
  const selectionButtonRef = useRef<HTMLButtonElement>(null);
  const selectionFieldsetRef = useRef<HTMLFieldSetElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const dialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const [progressAnnouncement, setProgressAnnouncement] = useState("");
  const [previewPage, setPreviewPage] = useState(1);
  const sourcePage = workspace.state.selectedPages.includes(previewPage)
    ? previewPage
    : workspace.state.selectedPages[0] ?? null;

  useEffect(() => {
    if (workspace.selectionFocusVersion === 0) return;
    const target = workspace.state.document
      ? selectionFieldsetRef.current
      : selectionButtonRef.current;
    window.requestAnimationFrame(() => target?.focus({ preventScroll: true }));
  }, [workspace.selectionFocusVersion, workspace.state.document]);

  useEffect(() => {
    if (workspace.resultFocusVersion === 0) return;
    window.requestAnimationFrame(() => resultRef.current?.focus({ preventScroll: true }));
  }, [workspace.resultFocusVersion]);

  useEffect(() => {
    const progress = workspace.state.progress;
    if (!progress) {
      setProgressAnnouncement("");
      return;
    }
    const page = progress.pageNumber ? ` Page ${progress.pageNumber}.` : "";
    setProgressAnnouncement(`${progress.stage}.${page}`);
  }, [workspace.state.progress?.pageNumber, workspace.state.progress?.phase, workspace.state.progress?.stage]);

  const activeError = workspace.activeError?.message ?? null;
  const fileError = workspace.fileSummary ? null : activeError;
  const processingPage = workspace.state.singlePageOperationPage;

  const rememberDialogFocus = () => {
    dialogReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : selectionButtonRef.current;
  };

  return (
    <main id="main-content" className="pdf-page">
      {!__PDF_OCR_PUBLIC__ ? <section className="pdf-preview-notice" aria-labelledby="pdf-preview-title">
        <div>
          <p className="eyebrow">Internal release candidate</p>
          <p id="pdf-preview-title" className="pdf-preview-notice__title">PDF to Text preview</p>
        </div>
        <p>This workspace is still being tested and is not enabled on the public site.</p>
      </section> : null}

      <section className="pdf-hero" aria-labelledby="pdf-title">
        <div>
          <p className="eyebrow">Private local PDF extraction</p>
          <h1 id="pdf-title">Extract text from a PDF. Nothing uploaded.</h1>
        </div>
        <div className="pdf-hero__copy">
          <p>{pdfCopy.introduction}</p>
          <p className="pdf-constraints">
            One PDF · Up to {PDF_LIMITS.maxFileBytes / (1024 * 1024)} MiB · Up to {PDF_LIMITS.maxDocumentPages} document pages · Up to {PDF_LIMITS.maxSelectedPages} selected pages · 12 OCR languages
          </p>
          <p>Up to {PDF_LIMITS.maxOcrPagesPerRun} pages requiring OCR can be processed in one operation.</p>
          {__PDF_OCR_PUBLIC__ && routes.guide.pdfToText ? <p><Link to={routes.guide.pdfToText} target="_blank" rel="noopener noreferrer">Read the PDF to text guide (opens in a new tab)</Link></p> : null}
        </div>
      </section>

      <section className="pdf-workspace" aria-labelledby="pdf-workspace-title">
        <div className="pdf-section-heading">
          <div>
            <p className="eyebrow">PDF to text workspace</p>
            <h2 id="pdf-workspace-title">One document. Every selected page reviewable.</h2>
          </div>
          <span className="pdf-local-badge">Local browser processing</span>
        </div>

        <PdfDropzone
          inputVersion={workspace.inputVersion}
          pickerRequestVersion={workspace.pickerRequestVersion}
          hidden={Boolean(workspace.fileSummary)}
          busy={workspace.busy}
          error={fileError}
          selectionButtonRef={selectionButtonRef}
          onFiles={workspace.receiveFiles}
        />

        <PdfOfflineStatus
          pdfStatus={workspace.pdfAssetStatus}
          languageStatus={workspace.languageStatus}
          languages={workspace.state.settings.languages ?? ["eng"]}
          preparing={workspace.preparingOffline}
          supportSize={workspace.pdfSupportSize}
          onPrepare={() => void workspace.prepareOffline()}
        />

        {workspace.fileSummary && workspace.state.document ? (
          <>
            <PdfDocumentSummary
              name={workspace.fileSummary.name}
              size={workspace.fileSummary.size}
              pageCount={workspace.state.document.pageCount}
              selectedCount={workspace.state.selectedPages.length}
              passwordProtected={workspace.fileSummary.passwordProtected}
              busy={workspace.busy}
              onReplace={workspace.requestReplace}
              onClear={() => {
                rememberDialogFocus();
                workspace.requestClear();
              }}
            />

            {activeError ? (
              <div className="pdf-document-error" role="alert" tabIndex={-1}>
                <strong>PDF action needs attention</strong>
                <p>{activeError}</p>
                {workspace.activeError?.retryable ? <small>You can adjust the controls or try again.</small> : null}
              </div>
            ) : null}

            <PdfProcessingOptions
              pageCount={workspace.state.document.pageCount}
              selectedCount={workspace.state.selectedPages.length}
              selectionKind={workspace.selectionKind}
              rangeValue={workspace.rangeValue}
              selectionError={workspace.selectionError}
              settings={workspace.state.settings}
              languageStatus={workspace.languageStatus}
              shellStatus={workspace.shellStatus}
              onPrepareLanguages={workspace.prepareLanguages}
              busy={workspace.busy}
              selectionRef={selectionFieldsetRef}
              onSelectionKind={workspace.setSelectionKind}
              onRange={workspace.changeRange}
              onSettings={workspace.updateSettings}
              onStart={() => {
                rememberDialogFocus();
                workspace.requestStart();
              }}
            />

            {!workspace.state.result ? <PdfPagePreview
              key={workspace.state.document.documentId}
              pages={workspace.state.selectedPages}
              pageNumber={sourcePage}
              onSelectPage={setPreviewPage}
              renderPage={workspace.renderPreview}
              busy={workspace.busy}
            /> : null}

            {workspace.operationActive ? (
              <PdfProgress
                progress={workspace.state.progress}
                selectedCount={workspace.state.selectedPages.length}
                processingPage={processingPage}
                onCancel={() => void workspace.cancelOperation()}
              />
            ) : null}

            {workspace.staleLanguagePages.length > 0 ? <p className="pdf-attempt-note" role="status">OCR languages changed. Saved text and edits on page{workspace.staleLanguagePages.length === 1 ? "" : "s"} {workspace.staleLanguagePages.join(", ")} still use the previous languages. Re-run OCR for a page or process the selected pages to apply the new choice.</p> : null}
            {workspace.state.result ? (
              <PdfResults
                result={workspace.state.result}
                selectedPages={workspace.state.result.selectedPages}
                renderPreview={workspace.renderPreview}
                workflowPages={workspace.state.pages}
                activePageNumber={workspace.state.activeResultPage}
                processingPage={processingPage}
                attemptError={workspace.state.error?.message ?? null}
                attemptErrorPage={workspace.attemptPageNumber}
                busy={workspace.operationActive}
                resultRef={resultRef}
                onSelectPage={workspace.selectResultPage}
                onEdit={workspace.editPage}
                onReprocess={(pageNumber, method) => {
                  rememberDialogFocus();
                  workspace.requestReprocess(pageNumber, method);
                }}
                onCopy={() => void workspace.copyAll()}
                onDownload={workspace.downloadAll}
              />
            ) : null}
          </>
        ) : null}
      </section>

      <section className="pdf-privacy" aria-labelledby="pdf-privacy-title">
        <div>
          <p className="eyebrow">Local-processing boundary</p>
          <h2 id="pdf-privacy-title">Your PDF stays in this browser</h2>
        </div>
        <div>
          <p>
            The selected PDF and extracted text are not uploaded. The browser may load verified PDF reader and selected OCR language support files from this same site. Copy places page-marked text in the system clipboard, and Download creates a local text file.
          </p>
          <p>
            Browser extensions, the operating system and clipboard tools remain outside this site’s control. Clear releases application references and processing resources; it is not described as secure memory erasure and cannot remove clipboard history or downloaded files.
          </p>
        </div>
      </section>

      <section className="pdf-limitations" aria-labelledby="pdf-limitations-title">
        <div>
          <p className="eyebrow">Processing limits</p>
          <h2 id="pdf-limitations-title">Plain text needs human review</h2>
        </div>
        <ul>
          <li>Automatic mode uses a heuristic text-layer assessment and can choose the less useful method.</li>
          <li>Tables, columns, vertical text and complex reading order may require correction.</li>
          <li>Interactive form values and annotations can be missing in both extraction modes.</li>
          <li>An existing text layer can include text that is not visible on the page. Compare the result with the original PDF.</li>
          <li>Choose up to three of 12 OCR languages. Select the languages used on the scanned pages before processing.</li>
          <li>Handwriting remains unreliable.</li>
          <li>Passwords cannot be recovered.</li>
          <li>Some malformed or unusually encoded PDFs cannot be processed.</li>
          <li>Large pages may be reduced within the {PDF_LIMITS.maxRenderedSide.toLocaleString("en-AU")}-pixel-side and {PDF_LIMITS.maxRenderedPixels.toLocaleString("en-AU")}-pixel rendering limits.</li>
          <li>Plain text does not preserve exact layout. The local page preview helps you compare the source and text; it does not include a thumbnail gallery or create searchable PDFs.</li>
        </ul>
      </section>

      <HelpfulGuides
        id="pdf-guides-title"
        guideSlugs={["pdf-to-text", "improve-ocr-accuracy", "private-ocr-for-sensitive-documents"]}
        eyebrow="Helpful PDF and OCR guides"
        title="How to get reliable text from a PDF"
      />

      <ToolDirectory id="other-tools-title" currentPath={routes.pdfToText} newTab />

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {workspace.announcement}
      </p>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {progressAnnouncement}
      </p>

      <PdfPasswordDialog
        open={Boolean(workspace.passwordPrompt)}
        incorrect={workspace.passwordPrompt?.incorrect ?? false}
        onSubmit={workspace.submitPassword}
        onCancel={workspace.cancelPassword}
        returnFocusRef={selectionButtonRef}
      />
      {workspace.confirmation ? (
        <PdfConfirmDialog
          confirmation={workspace.confirmation}
          onConfirm={workspace.confirmPending}
          onCancel={workspace.cancelPending}
          returnFocusRef={dialogReturnFocusRef}
        />
      ) : null}
    </main>
  );
}

export default PdfOcrPage;
