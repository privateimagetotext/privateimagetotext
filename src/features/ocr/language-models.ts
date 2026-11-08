import { selectedOcrLanguages } from "../../config/ocr-languages";

/** Verify the exact bytes passed to Tesseract, even without a service worker. */
export async function loadLanguageModels(ids: readonly string[], signal: AbortSignal) {
  const models = [];
  // Serial downloads bound transient memory on small devices.
  for (const model of selectedOcrLanguages(ids)) {
    const response = await fetch(new URL(model.path, window.location.origin), {
      signal, credentials: "same-origin", redirect: "error", cache: "no-cache",
    });
    if (!response.ok || response.headers.get("Content-Type")?.includes("text/html")) {
      throw new Error(`${model.label} model could not be loaded. Connect to prepare it for offline use.`);
    }
    const data = new Uint8Array(await response.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", data);
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    const compressedMatch = data.byteLength === model.bytes && hash === model.sha256;
    const decodedMatch = data.byteLength === model.uncompressedBytes && hash === model.uncompressedSha256;
    if (!compressedMatch && !decodedMatch) {
      throw new Error(`${model.label} model failed its integrity check. Reconnect and try again.`);
    }
    signal.throwIfAborted();
    models.push({ code: model.id, data });
  }
  return models;
}
