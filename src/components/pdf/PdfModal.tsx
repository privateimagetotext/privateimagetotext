import {
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export type PdfModalProps = {
  readonly titleId: string;
  readonly descriptionId?: string;
  readonly eyebrow?: string;
  readonly title: string;
  readonly children: ReactNode;
  readonly actions: ReactNode;
  readonly onCancel: () => void;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
};

export function PdfModal({
  titleId,
  descriptionId,
  eyebrow,
  title,
  children,
  actions,
  onCancel,
  initialFocusRef,
  returnFocusRef,
}: PdfModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const background = [
      document.querySelector<HTMLElement>(".app-header"),
      document.querySelector<HTMLElement>("#main-content"),
      document.querySelector<HTMLElement>(".app-footer"),
    ].filter((element): element is HTMLElement => element !== null);
    const previousInert = background.map((element) => element.inert);
    const previousOverflow = document.body.style.overflow;
    background.forEach((element) => {
      element.inert = true;
    });
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => {
      const target =
        initialFocusRef?.current ??
        dialog?.querySelector<HTMLElement>(FOCUSABLE) ??
        dialog;
      target?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((control) => control.getClientRects().length > 0);
      if (controls.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      background.forEach((element, index) => {
        element.inert = previousInert[index];
      });
      window.requestAnimationFrame(() =>
        returnFocusRef?.current?.focus({ preventScroll: true }),
      );
    };
  }, [initialFocusRef, onCancel, returnFocusRef]);

  return createPortal(
    <div className="dialog-backdrop pdf-dialog-backdrop">
      <button
        className="pdf-dialog-backdrop__dismiss"
        type="button"
        tabIndex={-1}
        aria-label="Close dialog"
        onClick={onCancel}
      />
      <div
        ref={dialogRef}
        className="confirm-dialog pdf-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 id={titleId}>{title}</h2>
        <div className="pdf-dialog__body">{children}</div>
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>,
    document.body,
  );
}
