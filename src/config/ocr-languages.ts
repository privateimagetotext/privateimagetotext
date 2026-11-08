import manifest from "./ocr-languages.json" with { type: "json" };

export const OCR_LANGUAGES = manifest.models;
export const DEFAULT_OCR_LANGUAGES: readonly string[] = ["eng"];
export const MAX_OCR_LANGUAGES = 3;
export const OCR_LANGUAGE_NAMES = OCR_LANGUAGES.map(({ label }) => label).join(", ");
export function selectedOcrLanguages(ids: readonly string[] = DEFAULT_OCR_LANGUAGES) {
  if (ids.length < 1 || ids.length > MAX_OCR_LANGUAGES || new Set(ids).size !== ids.length) {
    throw new Error("Choose between one and three OCR languages.");
  }
  return ids.map(id => {
    const model = OCR_LANGUAGES.find(model => model.id === id);
    if (!model) throw new Error("Unsupported OCR language.");
    return model;
  });
}
export function usesNonLatinScript(ids: readonly string[] = DEFAULT_OCR_LANGUAGES) {
  return selectedOcrLanguages(ids).some(model => model.script !== "Latin");
}
export function languageDownloadSize(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}
