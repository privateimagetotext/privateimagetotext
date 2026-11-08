import { useCallback, useEffect, useId, useRef, useState } from "react";
import { PdfModal } from "./PdfModal";

export type PdfPasswordDialogProps = {
  readonly open: boolean;
  readonly incorrect: boolean;
  readonly onSubmit: (password: string) => void;
  readonly onCancel: () => void;
  readonly returnFocusRef: React.RefObject<HTMLElement | null>;
};

export function PdfPasswordDialog({
  open,
  incorrect,
  onSubmit,
  onCancel,
  returnFocusRef,
}: PdfPasswordDialogProps) {
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();

  useEffect(() => {
    setPassword("");
    if (open && incorrect) {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [incorrect, open]);

  const cancel = useCallback(() => {
    setPassword("");
    onCancel();
  }, [onCancel]);

  if (!open) return null;

  return (
    <PdfModal
      titleId={titleId}
      descriptionId={descriptionId}
      eyebrow="Protected PDF"
      title="Enter the PDF password"
      onCancel={cancel}
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
      actions={
        <>
          <button className="button button--quiet" type="button" onClick={cancel}>
            Cancel
          </button>
          <button
            className="button button--primary"
            type="submit"
            form="pdf-password-form"
            disabled={password.length === 0}
          >
            Open PDF
          </button>
        </>
      }
    >
      <p id={descriptionId}>
        The password is used only to open this PDF in the current browser tab.
        It is not saved.
      </p>
      <form
        id="pdf-password-form"
        onSubmit={(event) => {
          event.preventDefault();
          const submitted = password;
          setPassword("");
          onSubmit(submitted);
        }}
      >
        <label className="pdf-field" htmlFor={`${titleId}-input`}>
          <span>Password</span>
          <input
            ref={inputRef}
            id={`${titleId}-input`}
            type="password"
            autoComplete="off"
            value={password}
            aria-invalid={incorrect || undefined}
            aria-describedby={incorrect ? errorId : descriptionId}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
        </label>
        {incorrect ? (
          <p id={errorId} className="pdf-field-error" role="alert">
            That password was not accepted.
          </p>
        ) : null}
      </form>
    </PdfModal>
  );
}
