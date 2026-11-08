import { OCR_LANGUAGES } from "../config/ocr-languages";
import type { OcrLanguageStatus } from "./service-worker";
import type { OcrModelStatus, ShellCacheStatus } from "./service-worker";

function imageReadiness(shell: ShellCacheStatus, model: OcrModelStatus | null, languages?: OcrLanguageStatus) {
  if (shell === "guide-ready") return {
    label: "Offline: this guide ready", headerLabel: "Offline: guide ready",
    description: "This guide and its figures are cached in this browser. Open a tool while connected to prepare the full site and its optional processing assets.",
  };
  if (shell === "unavailable") return {
    label: "Offline: unavailable", headerLabel: "Offline: unavailable",
    description: "Offline caching is unavailable in this browser or preview environment.",
  };
  if (shell === "failed" || (languages ? languages.failed : model === "OCR preparation failed")) return {
    label: "Offline: preparation failed", headerLabel: "Offline: setup failed",
    description: "Offline preparation failed; reconnect and reload to retry the site cache, or use Prepare offline OCR to retry the model.",
  };
  if (shell === "missing") return {
    label: "Offline: site not yet cached", headerLabel: "Offline: setup needed",
    description: "The site files are not cached; reconnect and reload before preparing offline OCR.",
  };
  if (shell === "ready" && languages) {
    const names = OCR_LANGUAGES.filter(model => languages.ready.includes(model.id)).map(model => model.label).join(", ");
    const preparingNames = OCR_LANGUAGES.filter(model => languages.preparing.includes(model.id)).map(model => model.label).join(", ");
    if (languages.preparing.length) return {
      label: `Offline: preparing ${preparingNames}…`, headerLabel: `Offline: preparing ${preparingNames}…`,
      description: `${names ? `Downloaded and cached: ${names}. ` : ""}Downloading and checking ${preparingNames} and the OCR engine for offline use.`,
    };
    if (names) return { label: `Offline: ready for ${names}`, headerLabel: `Offline: ready for ${names}`,
      description: `Downloaded and cached in this browser: ${names}, plus the site files and OCR engine. To add another language, select it in the image OCR language picker and choose Download selected languages while connected.` };
    return { label: "Offline: site ready, models not yet cached", headerLabel: "Offline: setup needed",
      description: "Select languages in the image OCR language picker, then choose Download selected languages while connected. Models also download automatically when you start OCR." };
  }
  if (shell === "checking" || shell === "preparing" || model === null || model === "Preparing English OCR model") return {
    label: "Offline: preparing…", headerLabel: "Offline: preparing…",
    description: "The browser is checking or preparing the site files and English OCR model for offline image recognition.",
  };
  if (model === "English OCR available offline") return {
    label: "Offline: ready", headerLabel: "Offline: ready",
    description: "The site files and English OCR model are cached for offline image recognition in this browser.",
  };
  return {
    label: "Offline: site ready, English model not yet cached", headerLabel: "Offline: setup needed",
    description: "The site is cached; use Prepare offline OCR while connected to save the English model too.",
  };
}

export function offlineReadiness(shell: ShellCacheStatus, model: OcrModelStatus | null, languages?: OcrLanguageStatus) {
  const readiness = imageReadiness(shell, model, languages);
  const guideOnly = shell === "guide-ready";
  // The shared header observes image OCR assets, not the optional runtimes for
  // every tool. Keep its label, explanation and announcement equally scoped.
  const headerLabel = guideOnly
    ? readiness.headerLabel
    : readiness.headerLabel.replace(/^Offline:/u, "Image OCR offline:");
  return {
    ...readiness,
    headerLabel,
    headerDescription: guideOnly
      ? readiness.description
      : `Image OCR only. ${readiness.description} PDF tools have separate preparation checks. Browser storage may be cleared or evicted.`,
    headerAnnouncement: guideOnly ? readiness.label : headerLabel,
  };
}
