import type { DragEvent, RefObject } from "react";
import type { SteganographySourceImage, SteganographyWorkflow } from "../state";

type ImagePickerProps = {
  readonly workflow: SteganographyWorkflow;
  readonly source: SteganographySourceImage | null;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly chooseButtonRef: RefObject<HTMLButtonElement | null>;
  readonly isDragging: boolean;
  readonly busy: boolean;
  readonly onDraggingChange: (dragging: boolean) => void;
  readonly onFile: (file: File) => void;
  readonly onPaste: () => void;
  readonly onClear: () => void;
};

export function ImagePicker({
  workflow,
  source,
  inputRef,
  chooseButtonRef,
  isDragging,
  busy,
  onDraggingChange,
  onFile,
  onPaste,
  onClear,
}: ImagePickerProps) {
  const accepted = workflow === "reveal"
    ? "image/png,image/jpeg,.png,.jpg,.jpeg"
    : "image/png,image/jpeg,image/webp,image/bmp,.png,.jpg,.jpeg,.webp,.bmp";

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    onDraggingChange(false);
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <section className="steg-card" aria-labelledby="steg-image-title">
      <div className="steg-card__heading">
        <div>
          <span className="step-number">01</span>
          <h2 id="steg-image-title">
            {workflow === "hide" ? "Choose an image" : "Choose an image with a hidden message"}
          </h2>
        </div>
        {source ? (
          <button className="text-button text-button--danger" type="button" onClick={onClear}>
            Clear
          </button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        className="sr-only"
        tabIndex={-1}
        type="file"
        accept={accepted}
        aria-label={workflow === "hide" ? "Choose picture" : "Choose image with a hidden message"}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onFile(file);
          event.currentTarget.value = "";
        }}
      />

      <div
        className={`steg-dropzone${isDragging ? " is-dragging" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          onDraggingChange(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            onDraggingChange(false);
          }
        }}
        onDrop={drop}
      >
        <p className="steg-dropzone__title">
          {source
            ? source.name
            : workflow === "hide"
              ? "Paste, drop or choose the picture you want to use."
              : "Paste, drop or choose an image created with this tool or compatible software."}
        </p>
        <p>
          {workflow === "hide"
            ? "PNG, JPEG, WebP or BMP, up to 25 MiB. Your source picture is not overwritten."
            : "Supported PNG or JPEG files, up to 80 MiB."}
        </p>
        <div className="steg-dropzone__actions">
          <button
            ref={chooseButtonRef}
            className="button button--primary"
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {source ? "Replace image" : "Choose image"}
          </button>
          <button className="button button--quiet" type="button" disabled={busy} onClick={onPaste}>
            Paste image
          </button>
        </div>
      </div>

      {workflow === "hide" && !source ? <p>To try it, pick any photo from your device.</p> : null}

      {source ? (
        <dl className="steg-file-facts">
          <div><dt>Dimensions</dt><dd>{source.width} × {source.height}</dd></div>
          <div><dt>Type</dt><dd>{source.kind.toUpperCase()}</dd></div>
          <div><dt>Source</dt><dd>Unchanged</dd></div>
        </dl>
      ) : null}
    </section>
  );
}
