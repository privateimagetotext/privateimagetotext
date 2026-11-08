import { useEffect, useRef, useState, type DragEvent, type RefObject } from "react";
import { PDF_LIMITS } from "../../features/pdf/validation";

export function PdfDropzone({
  inputVersion,
  pickerRequestVersion,
  hidden = false,
  busy,
  error,
  selectionButtonRef,
  onFiles,
}: {
  readonly inputVersion: number;
  readonly pickerRequestVersion: number;
  readonly hidden?: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly selectionButtonRef: RefObject<HTMLButtonElement | null>;
  readonly onFiles: (files: FileList | readonly File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const errorId = "pdf-file-error";
  const helpId = "pdf-file-help";

  useEffect(() => {
    if (pickerRequestVersion > 0) inputRef.current?.click();
  }, [pickerRequestVersion]);

  const receiveDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    onFiles(event.dataTransfer.files);
  };

  return (
    <div className="pdf-dropzone-wrap">
      <input
        key={inputVersion}
        ref={inputRef}
        className="visually-hidden-input"
        type="file"
        accept=".pdf,application/pdf"
        aria-label="Choose one PDF"
        aria-describedby={`${helpId}${error ? ` ${errorId}` : ""}`}
        onChange={(event) => {
          if (event.currentTarget.files) onFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      {!hidden ? <div
        className={`pdf-dropzone${dragging ? " is-dragging" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDragging(false);
          }
        }}
        onDrop={receiveDrop}
      >
        <svg viewBox="0 0 112 88" role="img" aria-label="A PDF document becoming lines of text">
          <path d="M19 7h45l17 17v56H19z" />
          <path d="M64 7v18h17M31 42h37M31 53h37M31 64h25" />
          <path className="pdf-dropzone__arrow" d="M86 45h19m-7-7 7 7-7 7" />
        </svg>
        <div>
          <h3>Choose one PDF</h3>
          <p id={helpId}>Drop a local PDF here or choose it from this device.</p>
          <p className="pdf-dropzone__limits">
            Up to {PDF_LIMITS.maxFileBytes / (1024 * 1024)} MiB and {PDF_LIMITS.maxDocumentPages} document pages.
          </p>
        </div>
        <button
          ref={selectionButtonRef}
          className="button button--primary"
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          Choose PDF
        </button>
      </div> : null}
      {!hidden && error ? (
        <p id={errorId} className="pdf-control-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
