import { selectedOcrLanguages } from "../config/ocr-languages";
export type LocalStatus =
  | "Local processing"
  | "Preparing offline app"
  | "Offline app ready"
  | "Offline";

export type OcrModelStatus =
  | "Preparing English OCR model"
  | "English OCR available offline"
  | "English OCR not available offline"
  | "OCR preparation failed";

export type OcrLanguageStatus = { ready: readonly string[]; preparing: readonly string[]; failed: boolean };
let languageStatus: OcrLanguageStatus = { ready: [], preparing: [], failed: false };
const languageListeners = new Set<(status: OcrLanguageStatus) => void>();
function emitLanguageStatus(update: Partial<OcrLanguageStatus>) {
  languageStatus = { ...languageStatus, ...update };
  languageListeners.forEach(listener => listener(languageStatus));
}
export function subscribeOfflineLanguageStatus(listener: (status: OcrLanguageStatus) => void) {
  languageListeners.add(listener);
  listener(languageStatus);
  return () => { languageListeners.delete(listener); };
}

export type JpegCodecStatus =
  | "Preparing JPEG codec"
  | "JPEG codec available offline"
  | "JPEG codec not available offline";

export type PdfAssetStatus =
  | "Preparing PDF reader assets"
  | "PDF reader available offline"
  | "PDF reader not available offline"
  | "PDF reader preparation failed";

type StatusListener = (status: LocalStatus) => void;
type OcrStatusListener = (status: OcrModelStatus) => void;
type JpegCodecStatusListener = (status: JpegCodecStatus) => void;
type PdfAssetStatusListener = (status: PdfAssetStatus) => void;
export type ShellCacheStatus = "checking" | "preparing" | "ready" | "guide-ready" | "missing" | "failed" | "unavailable";
const shellStatusListeners = new Set<(status: ShellCacheStatus) => void>();
let currentShellStatus: ShellCacheStatus = "checking";

function emitShellCacheStatus(status: ShellCacheStatus) {
  if (currentShellStatus === status) return;
  currentShellStatus = status;
  shellStatusListeners.forEach((listener) => listener(status));
}

export function subscribeOfflineShellStatus(listener: (status: ShellCacheStatus) => void) {
  shellStatusListeners.add(listener);
  listener(currentShellStatus);
  return () => { shellStatusListeners.delete(listener); };
}

const ocrStatusListeners = new Set<OcrStatusListener>();
let currentOcrStatus: OcrModelStatus | null = null;
const jpegCodecStatusListeners = new Set<JpegCodecStatusListener>();
let currentJpegCodecStatus: JpegCodecStatus | null = null;
const pdfAssetStatusListeners = new Set<PdfAssetStatusListener>();
let currentPdfAssetStatus: PdfAssetStatus | null = null;
let pdfRequestSequence = 0;

function emitOcrStatus(status: OcrModelStatus) {
  if (currentOcrStatus === status) return;
  currentOcrStatus = status;
  ocrStatusListeners.forEach((listener) => listener(status));
}

function emitJpegCodecStatus(status: JpegCodecStatus) {
  currentJpegCodecStatus = status;
  jpegCodecStatusListeners.forEach((listener) => listener(status));
}

function emitPdfAssetStatus(status: PdfAssetStatus) {
  currentPdfAssetStatus = status;
  pdfAssetStatusListeners.forEach((listener) => listener(status));
}

function postToRegistration(
  registration: ServiceWorkerRegistration,
  message: { readonly type: string; readonly path?: string; readonly fontPaths?: string[] },
) {
  (navigator.serviceWorker.controller ?? registration.active)?.postMessage(
    message,
  );
}

function postWhenReady(message: { readonly type: string; readonly languages?: readonly string[] }) {
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.ready.then((registration) => {
    (navigator.serviceWorker.controller ?? registration.active)?.postMessage(
      message,
    );
  });
}

export async function registerLocalServiceWorker(listener: StatusListener, guidePath?: string, routePath?: string) {
  emitShellCacheStatus("checking");
  let shellReady = false;
  let shellPreparing = false;
  let preparationRequested = false;

  const emitShellStatus = () => {
    if (!navigator.onLine) {
      listener("Offline");
    } else if (shellReady) {
      listener("Offline app ready");
    } else if (shellPreparing) {
      listener("Preparing offline app");
    } else {
      listener("Local processing");
    }
  };

  let registration: ServiceWorkerRegistration | null = null;
  const checkShellCache = () => {
    if (!registration) return;
    postToRegistration(registration, { type: "CHECK_SHELL_CACHE", ...((guidePath ?? routePath) ? { path: guidePath ?? routePath } : {}) });
  };

  const updateOfflineState = () => emitShellStatus();
  const updateOnlineState = () => {
    preparationRequested = false;
    emitShellStatus();
    checkShellCache();
  };

  window.addEventListener("offline", updateOfflineState);
  window.addEventListener("online", updateOnlineState);

  const cleanupWindowListeners = () => {
    window.removeEventListener("offline", updateOfflineState);
    window.removeEventListener("online", updateOnlineState);
  };

  if (
    import.meta.env.DEV ||
    !("serviceWorker" in navigator) ||
    !window.isSecureContext
  ) {
    emitShellCacheStatus("unavailable");
    return cleanupWindowListeners;
  }

  try {
    registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });
    await navigator.serviceWorker.ready;
  } catch (error) {
    emitShellCacheStatus("failed");
    cleanupWindowListeners();
    throw error;
  }

  const handleMessage = (event: MessageEvent) => {
    const target = navigator.serviceWorker.controller ?? registration?.active;
    if (event.source !== target) return;
    if (String(event.data?.type).startsWith("SHELL_CACHE_") && event.data.path !== undefined && event.data.path !== (guidePath ?? routePath)) return;
    // Correlated PDF responses belong to their live request listener. Letting
    // this broadcast listener handle them would revive timed-out requests.
    if (event.data?.requestId && String(event.data?.type).startsWith("PDF_CACHE_")) return;
    if ((event.data?.type === "GUIDE_CACHE_READY" || event.data?.type === "GUIDE_CACHE_FAILED") && event.data.path === guidePath) {
      shellPreparing = false;
      emitShellCacheStatus(event.data.type === "GUIDE_CACHE_READY" ? "guide-ready" : "failed");
      emitShellStatus();
      return;
    }
    if (event.data?.type === "SHELL_CACHE_STATUS") {
      shellReady = event.data.ready === true;
      shellPreparing = false;

      if (
        !shellReady &&
        navigator.onLine &&
        !preparationRequested
      ) {
        preparationRequested = true;
        shellPreparing = true;
        emitShellCacheStatus("preparing");
        emitShellStatus();
        if (guidePath) {
          void document.fonts.ready.then(() => {
            const fontPaths = performance.getEntriesByType("resource")
              .map((entry) => new URL(entry.name))
              .filter((url) => url.origin === location.origin && /\.woff2?$/.test(url.pathname))
              .map((url) => url.pathname);
            postToRegistration(registration!, { type: "PREPARE_GUIDE_CACHE", path: guidePath, fontPaths });
          });
        } else postToRegistration(registration!, { type: "PREPARE_SHELL_CACHE", ...(routePath ? { path: routePath } : {}) });
        return;
      }

      emitShellCacheStatus(shellReady ? "ready" : "missing");
      emitShellStatus();
      return;
    }

    if (event.data?.type === "SHELL_CACHE_PREPARING") {
      shellReady = false;
      shellPreparing = true;
      emitShellCacheStatus("preparing");
      emitShellStatus();
      return;
    }

    if (event.data?.type === "SHELL_CACHE_FAILED") {
      shellReady = false;
      shellPreparing = false;
      emitShellCacheStatus("failed");
      emitShellStatus();
      return;
    }

    if (event.data?.type === "OCR_CACHE_PREPARING") {
      const preparing = event.data.languages ?? ["eng"];
      emitLanguageStatus({ preparing, failed: false });
      if (preparing.includes("eng")) emitOcrStatus("Preparing English OCR model");
      return;
    }

    if (event.data?.type === "OCR_CACHE_STATUS") {
      // Legacy workers only know the old English asset. They cannot attest to
      // the newly pinned models while a service-worker update is activating.
      emitLanguageStatus({ ready: Array.isArray(event.data.readyLanguages) ? event.data.readyLanguages : [], preparing: [], failed: false });
      emitOcrStatus(
        event.data.ready === true
          ? "English OCR available offline"
          : "English OCR not available offline",
      );
      return;
    }

    if (event.data?.type === "OCR_CACHE_FAILED") {
      emitLanguageStatus({ preparing: [], failed: true });
      emitOcrStatus("OCR preparation failed");
      return;
    }

    if (event.data?.type === "JPEG_CODEC_CACHE_PREPARING") {
      emitJpegCodecStatus("Preparing JPEG codec");
      return;
    }

    if (event.data?.type === "JPEG_CODEC_CACHE_STATUS") {
      emitJpegCodecStatus(
        event.data.ready === true
          ? "JPEG codec available offline"
          : "JPEG codec not available offline",
      );
      return;
    }

    if (event.data?.type === "JPEG_CODEC_CACHE_FAILED") {
      emitJpegCodecStatus("JPEG codec not available offline");
      return;
    }

    if (event.data?.type === "PDF_CACHE_PREPARING") {
      emitPdfAssetStatus("Preparing PDF reader assets");
      return;
    }

    if (event.data?.type === "PDF_CACHE_STATUS") {
      emitPdfAssetStatus(
        event.data.ready === true
          ? "PDF reader available offline"
          : "PDF reader not available offline",
      );
      return;
    }

    if (event.data?.type === "PDF_CACHE_FAILED") {
      emitPdfAssetStatus("PDF reader preparation failed");
    }
  };

  const handleControllerChange = () => {
    emitLanguageStatus({ ready: [], preparing: [], failed: false });
    emitShellCacheStatus("checking");
    shellReady = false;
    shellPreparing = false;
    preparationRequested = false;
    emitShellStatus();
    checkShellCache();
    // A replacement worker can delete support caches (including on rollback).
    // Invalidate remembered readiness, then check only channels already in use.
    if (currentOcrStatus !== null || ocrStatusListeners.size > 0 || languageListeners.size > 0) {
      emitOcrStatus("English OCR not available offline");
      checkOfflineOcrAssets();
    }
    if (currentJpegCodecStatus !== null || jpegCodecStatusListeners.size > 0) {
      emitJpegCodecStatus("JPEG codec not available offline");
      checkOfflineJpegCodecAsset();
    }
    if (currentPdfAssetStatus !== null || pdfAssetStatusListeners.size > 0) {
      emitPdfAssetStatus("PDF reader not available offline");
      void checkOfflinePdfAssets();
    }
  };

  navigator.serviceWorker.addEventListener("message", handleMessage);
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    handleControllerChange,
  );
  checkShellCache();

  return () => {
    cleanupWindowListeners();
    navigator.serviceWorker.removeEventListener("message", handleMessage);
    navigator.serviceWorker.removeEventListener(
      "controllerchange",
      handleControllerChange,
    );
  };
}

export function subscribeOfflineOcrStatus(listener: OcrStatusListener) {
  ocrStatusListeners.add(listener);
  if (currentOcrStatus !== null) listener(currentOcrStatus);
  return () => ocrStatusListeners.delete(listener);
}

export function checkOfflineOcrAssets() {
  postWhenReady({ type: "CHECK_OCR_CACHE" });
}

export function prepareOfflineOcrAssets(languages?: readonly string[]) {
  if (languages) selectedOcrLanguages(languages);
  postWhenReady(languages ? { type: "PREPARE_OCR_CACHE", languages } : { type: "PREPARE_OCR_CACHE" });
}

export function subscribeOfflineJpegCodecStatus(listener: JpegCodecStatusListener) {
  jpegCodecStatusListeners.add(listener);
  if (currentJpegCodecStatus !== null) listener(currentJpegCodecStatus);
  return () => jpegCodecStatusListeners.delete(listener);
}

export function checkOfflineJpegCodecAsset() {
  postWhenReady({ type: "CHECK_JPEG_CODEC_CACHE" });
}

export async function ensureOfflineJpegCodecAsset() {
  if (import.meta.env.DEV) return true;
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    return navigator.onLine;
  }

  const registration = await navigator.serviceWorker.ready;
  const target = navigator.serviceWorker.controller ?? registration.active;
  if (!target) return false;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("message", handleMessage);
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      resolve(ready);
    };
    const unavailable = () => {
      emitJpegCodecStatus("JPEG codec not available offline");
      finish(false);
    };
    const handleControllerChange = () => unavailable();
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== target) return;
      if (event.data?.type === "JPEG_CODEC_CACHE_STATUS") {
        finish(event.data.ready === true);
      } else if (event.data?.type === "JPEG_CODEC_CACHE_FAILED") {
        finish(false);
      }
    };
    const timeout = window.setTimeout(unavailable, 30_000);
    navigator.serviceWorker.addEventListener("message", handleMessage);
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    try { target.postMessage({ type: "PREPARE_JPEG_CODEC_CACHE" }); }
    catch { unavailable(); }
  });
}

export function subscribeOfflinePdfStatus(listener: PdfAssetStatusListener) {
  pdfAssetStatusListeners.add(listener);
  if (currentPdfAssetStatus !== null) listener(currentPdfAssetStatus);
  return () => pdfAssetStatusListeners.delete(listener);
}

async function requestPdfCache(
  type: "CHECK_PDF_CACHE" | "PREPARE_PDF_CACHE",
) {
  if (import.meta.env.DEV) return false;
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return false;
  const registration = await navigator.serviceWorker.ready;
  const target = navigator.serviceWorker.controller ?? registration.active;
  if (!target) return false;
  pdfRequestSequence += 1;
  const sequence = pdfRequestSequence;
  const requestId = `pdf-cache-${sequence}`;
  const emitRequestStatus = (status: PdfAssetStatus) => {
    if (sequence === pdfRequestSequence) emitPdfAssetStatus(status);
  };

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("message", handleMessage);
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      resolve(ready);
    };
    const unavailable = () => {
      emitRequestStatus(type === "PREPARE_PDF_CACHE"
        ? "PDF reader preparation failed"
        : "PDF reader not available offline");
      finish(false);
    };
    const handleControllerChange = () => {
      emitRequestStatus("PDF reader not available offline");
      finish(false);
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== target || event.data?.requestId !== requestId) return;
      if (event.data?.type === "PDF_CACHE_PREPARING") {
        emitRequestStatus("Preparing PDF reader assets");
      } else if (event.data?.type === "PDF_CACHE_STATUS") {
        const ready = event.data.ready === true;
        emitRequestStatus(
          ready
            ? "PDF reader available offline"
            : "PDF reader not available offline",
        );
        finish(ready);
      } else if (event.data?.type === "PDF_CACHE_FAILED") {
        emitRequestStatus("PDF reader preparation failed");
        finish(false);
      }
    };
    const timeout = window.setTimeout(unavailable, 120_000);
    navigator.serviceWorker.addEventListener("message", handleMessage);
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    try { target.postMessage({ type, requestId }); }
    catch { unavailable(); }
  });
}

export function checkOfflinePdfAssets() {
  return requestPdfCache("CHECK_PDF_CACHE");
}

export function prepareOfflinePdfAssets() {
  return requestPdfCache("PREPARE_PDF_CACHE");
}
