import { useId, useRef } from "react";
import { PdfModal } from "./PdfModal";

export type PdfConfirmation = {
  readonly kind: "clear" | "replace" | "reprocess" | "restart";
  readonly pageNumber?: number;
};

export function PdfConfirmDialog({
  confirmation,
  onConfirm,
  onCancel,
  returnFocusRef,
}: {
  readonly confirmation: PdfConfirmation;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly returnFocusRef: React.RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const copy =
    confirmation.kind === "clear"
      ? {
          eyebrow: "Clear workspace",
          title: "Clear this PDF and its results?",
          body: "Clear removes this PDF and its results from the workspace. Downloaded files and clipboard history are outside this page’s control.",
          action: "Clear PDF",
        }
      : confirmation.kind === "replace"
        ? {
            eyebrow: "Replace PDF",
            title: "Replace the current PDF?",
            body: "The current results and edits will be removed before the replacement PDF is opened.",
            action: "Replace PDF",
          }
        : confirmation.kind === "restart"
          ? {
              eyebrow: "Process again",
              title: "Replace the current results?",
              body: "Processing the selected pages again will replace current generated results and edits.",
              action: "Process again",
            }
          : {
              eyebrow: "Replace page text",
              title: `Reprocess page ${confirmation.pageNumber}?`,
              body: `Page ${confirmation.pageNumber} has edits. A successful new extraction will replace that page’s edited text. If the attempt fails or is cancelled, the current text will be retained.`,
              action: "Reprocess page",
            };

  return (
    <PdfModal
      titleId={titleId}
      descriptionId={descriptionId}
      eyebrow={copy.eyebrow}
      title={copy.title}
      onCancel={onCancel}
      initialFocusRef={cancelRef}
      returnFocusRef={returnFocusRef}
      actions={
        <>
          <button
            ref={cancelRef}
            className="button button--quiet"
            type="button"
            onClick={onCancel}
          >
            Keep current work
          </button>
          <button
            className={
              confirmation.kind === "clear"
                ? "button pdf-button--danger"
                : "button button--primary"
            }
            type="button"
            onClick={onConfirm}
          >
            {copy.action}
          </button>
        </>
      }
    >
      <p id={descriptionId}>{copy.body}</p>
    </PdfModal>
  );
}
