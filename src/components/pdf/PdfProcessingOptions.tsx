import type { RefObject } from "react";
import { DEFAULT_OCR_LANGUAGES, usesNonLatinScript } from "../../config/ocr-languages";
import { OcrLanguagePicker } from "../OcrLanguagePicker";
import type { OcrLanguageStatus, ShellCacheStatus } from "../../lib/service-worker";
import {
  ENHANCEMENT_PRESETS,
  OCR_CONTENT_MODES,
} from "../../config/product";
import type { PdfExtractionSettings } from "../../features/pdf/types";
import { PDF_LIMITS } from "../../features/pdf/validation";

const modes = [
  {
    id: "automatic",
    label: "Automatic — recommended",
    description:
      "Use existing PDF text when it appears usable. OCR pages that appear scanned or uncertain.",
  },
  {
    id: "embedded-text-only",
    label: "Existing PDF text only",
    description:
      "Extract the selectable text already stored in the PDF. Scanned pages may return no text.",
  },
  {
    id: "ocr-all",
    label: "OCR selected pages",
    description:
      "Render and recognise every selected page. This is slower and may be less accurate than a good existing text layer.",
  },
] as const;

export function PdfProcessingOptions({
  pageCount,
  selectedCount,
  selectionKind,
  rangeValue,
  selectionError,
  settings,
  languageStatus,
  shellStatus,
  onPrepareLanguages,
  busy,
  selectionRef,
  onSelectionKind,
  onRange,
  onSettings,
  onStart,
}: {
  readonly pageCount: number;
  readonly selectedCount: number;
  readonly selectionKind: "all" | "range";
  readonly rangeValue: string;
  readonly selectionError: string | null;
  readonly settings: PdfExtractionSettings;
  readonly languageStatus: OcrLanguageStatus;
  readonly shellStatus: ShellCacheStatus;
  readonly onPrepareLanguages: () => void;
  readonly busy: boolean;
  readonly selectionRef: RefObject<HTMLFieldSetElement | null>;
  readonly onSelectionKind: (kind: "all" | "range") => void;
  readonly onRange: (value: string) => void;
  readonly onSettings: (settings: PdfExtractionSettings) => void;
  readonly onStart: () => void;
}) {
  const rangeErrorId = "pdf-range-error";
  const rangeHelpId = "pdf-range-help";
  const showOcr = settings.mode !== "embedded-text-only";
  return (
    <section className="pdf-options" aria-labelledby="pdf-options-title">
      <div className="pdf-section-heading">
        <div>
          <p className="section-index">Choose pages and method</p>
          <h2 id="pdf-options-title">Processing options</h2>
        </div>
        <strong>{selectedCount} of {pageCount} pages selected</strong>
      </div>

      <fieldset ref={selectionRef} className="pdf-fieldset" tabIndex={-1}>
        <legend>Pages</legend>
        <div className="pdf-inline-radios">
          <label>
            <input
              type="radio"
              name="pdf-page-selection"
              checked={selectionKind === "all"}
              disabled={busy}
              onChange={() => onSelectionKind("all")}
            />
            <span>All pages</span>
          </label>
          <label>
            <input
              type="radio"
              name="pdf-page-selection"
              checked={selectionKind === "range"}
              disabled={busy}
              onChange={() => onSelectionKind("range")}
            />
            <span>Page range</span>
          </label>
        </div>
        {selectionKind === "range" ? (
          <label className="pdf-field" htmlFor="pdf-page-range">
            <span id="pdf-range-label">Pages to process</span>
            <input
              id="pdf-page-range"
              aria-labelledby="pdf-range-label"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={rangeValue}
              disabled={busy}
              aria-invalid={Boolean(selectionError) || undefined}
              aria-describedby={`${rangeHelpId}${selectionError ? ` ${rangeErrorId}` : ""}`}
              onChange={(event) => onRange(event.currentTarget.value)}
            />
            <small id={rangeHelpId}>Examples: 1-5 or 1-5, 8, 11-14</small>
          </label>
        ) : null}
        {selectionError ? (
          <p id={rangeErrorId} className="pdf-field-error" role="alert">
            {selectionError}
          </p>
        ) : null}
        <small>Up to {PDF_LIMITS.maxSelectedPages} selected pages per operation.</small>
      </fieldset>

      <fieldset className="pdf-fieldset">
        <legend>Extraction method</legend>
        <div className="pdf-choice-grid">
          {modes.map((mode) => (
            <label key={mode.id} className="pdf-choice-card">
              <input
                type="radio"
                name="pdf-extraction-method"
                value={mode.id}
                checked={settings.mode === mode.id}
                disabled={busy}
                onChange={() => onSettings({ ...settings, mode: mode.id })}
              />
              <span><strong>{mode.label}</strong><small>{mode.description}</small></span>
            </label>
          ))}
        </div>
      </fieldset>

      {showOcr ? (
        <fieldset className="pdf-fieldset">
          <legend>OCR options</legend>
          <p className="pdf-fieldset__intro">
            Choose the languages printed on scanned pages. Existing PDF text is extracted independently of these choices.
          </p>
          <OcrLanguagePicker source="PDF"
            value={settings.languages ?? DEFAULT_OCR_LANGUAGES}
            onChange={(languages) => onSettings({ ...settings, languages })}
            disabled={busy} cacheStatus={languageStatus} shellStatus={shellStatus}
            onPrepare={onPrepareLanguages} />
          {usesNonLatinScript(settings.languages) ? <p className="pdf-fieldset__intro">Text cleanup is disabled for Hindi and Thai selections. The result preserves the original OCR text; content types and image enhancements still apply.</p> : null}
          <div className="pdf-control-grid">
            <label className="pdf-field">
              <span>Enhancement</span>
              <select
                value={settings.preset}
                disabled={busy}
                onChange={(event) =>
                  onSettings({
                    ...settings,
                    preset: event.currentTarget.value as PdfExtractionSettings["preset"],
                  })
                }
              >
                {ENHANCEMENT_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.label}</option>
                ))}
              </select>
              <small>{ENHANCEMENT_PRESETS.find((item) => item.id === settings.preset)?.description}</small>
            </label>
            <label className="pdf-field">
              <span>Content type</span>
              <select
                value={settings.contentMode}
                disabled={busy}
                onChange={(event) =>
                  onSettings({
                    ...settings,
                    contentMode: event.currentTarget.value as PdfExtractionSettings["contentMode"],
                  })
                }
              >
                {OCR_CONTENT_MODES.map((mode) => (
                  <option key={mode.id} value={mode.id}>{mode.label}</option>
                ))}
              </select>
              <small>{OCR_CONTENT_MODES.find((item) => item.id === settings.contentMode)?.description}</small>
            </label>
            <label className="pdf-check-field">
              <input
                type="checkbox"
                checked={settings.autoDeskew}
                disabled={busy}
                onChange={(event) => onSettings({ ...settings, autoDeskew: event.currentTarget.checked })}
              />
              <span><strong>Automatic deskew</strong><small>Correct small page skews before OCR where supported.</small></span>
            </label>
          </div>
        </fieldset>
      ) : null}

      <div className="pdf-start-row">
        <div>
          <p>Processing happens one page at a time on this device and may take several minutes.</p>
          <small>Up to {PDF_LIMITS.maxOcrPagesPerRun} pages requiring OCR can be processed in one operation.</small>
        </div>
        <button
          className="button button--primary"
          type="button"
          disabled={busy || selectedCount === 0 || Boolean(selectionError)}
          onClick={onStart}
        >
          Process selected pages
        </button>
      </div>
    </section>
  );
}
