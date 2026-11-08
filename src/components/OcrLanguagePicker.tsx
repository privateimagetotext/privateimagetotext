import { languageDownloadSize, MAX_OCR_LANGUAGES, OCR_LANGUAGES } from "../config/ocr-languages";
import type { OcrLanguageStatus, ShellCacheStatus } from "../lib/service-worker";

export function OcrLanguagePicker({ value, onChange, disabled, cacheStatus, shellStatus, onPrepare, source = "image" }: {
  value: readonly string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  cacheStatus: OcrLanguageStatus;
  shellStatus: ShellCacheStatus;
  onPrepare: () => void;
  source?: "image" | "PDF";
}) {
  const names = OCR_LANGUAGES.filter(model => value.includes(model.id)).map(model => model.label).join(", ");
  const { ready, preparing, failed } = cacheStatus;
  const downloading = preparing.length > 0;
  const allReady = value.every(id => ready.includes(id));
  const preparingNames = OCR_LANGUAGES.filter(model => preparing.includes(model.id)).map(model => model.label).join(", ");
  let downloadStatus = source === "PDF"
    ? "Download the selected languages while connected, then process the selected PDF pages."
    : "Download the selected languages while connected, then add an image to start OCR.";
  if (shellStatus === "unavailable") {
    downloadStatus = "Offline downloads are unavailable in this browser or preview. You can still run OCR while connected.";
  } else if (shellStatus === "failed" || shellStatus === "missing") {
    downloadStatus = "Reload this page while connected to prepare the site before downloading languages.";
  } else if (shellStatus !== "ready") {
    downloadStatus = "Preparing the site for offline use…";
  } else if (downloading) {
    downloadStatus = `Downloading and checking ${preparingNames} and the OCR engine…`;
  } else if (allReady) {
    downloadStatus = `Ready for ${names}. Downloaded and cached in this browser for offline OCR.`;
  } else if (failed) {
    downloadStatus = "The download could not finish. Check your connection and available browser storage, then retry.";
  }
  return <details className="ocr-language-picker">
    <summary>Languages: {names}</summary>
    <fieldset disabled={disabled || downloading}>
    <legend>OCR languages</legend>
    <p>Choose up to three languages. Selecting a language does not download it. English is the default; choices reset when you leave or reload this page.</p>
    <div className="ocr-language-options">
      {OCR_LANGUAGES.map(model => <label key={model.id}>
        <input type="checkbox" checked={value.includes(model.id)}
          disabled={value.includes(model.id) ? value.length === 1 : value.length >= MAX_OCR_LANGUAGES}
          onChange={event => onChange(event.currentTarget.checked ? [...value, model.id] : value.filter(id => id !== model.id))} />
        <span>{model.label}<small>{languageDownloadSize(model.bytes)} · {ready.includes(model.id) ? "downloaded and cached" : preparing.includes(model.id) ? "preparing…" : "download needed"}</small></span>
      </label>)}
    </div>
    <div className="ocr-language-download">
      <button className="button button--quiet" type="button"
        disabled={shellStatus !== "ready" || allReady}
        onClick={onPrepare}>
        {downloading ? "Downloading…" : allReady ? "Selected languages downloaded" : "Download selected languages"}
      </button>
      <p role="status">{downloadStatus}</p>
    </div>
    <p>{source === "PDF" ? "You can also process your PDF straight away" : "You can also add an image straight away"}: OCR downloads any missing selected models automatically. All downloads come from this site. The sizes above are for models; the first download also includes the shared OCR engine.</p>
    <p>Cached languages remain available until browser storage is cleared or removed. After changing languages, re-run OCR to update existing results.</p>
    </fieldset>
  </details>;
}
