// Fetch only the existing same-origin bootstrap. Do not start a Tesseract
// worker, load a model, or change the adapter's on-demand initialisation.
export function scheduleOcrWorkerPrefetch() {
  let cancelled = false;
  const prefetch = () => {
    if (!cancelled && navigator.onLine) {
      void fetch("/ocr/worker.min.js", { cache: "force-cache" }).catch(() => undefined);
    }
  };
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(prefetch, { timeout: 3000 });
    return () => { cancelled = true; window.cancelIdleCallback(handle); };
  }
  const handle = globalThis.setTimeout(prefetch, 1500);
  return () => { cancelled = true; globalThis.clearTimeout(handle); };
}
