import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ServiceWorkerHarness = {
  readonly dispatchMessage: (data: unknown) => void;
  readonly postMessage: ReturnType<typeof vi.fn>;
  readonly register: ReturnType<typeof vi.fn>;
};

function installServiceWorkerHarness(): ServiceWorkerHarness {
  const events = new EventTarget();
  const postMessage = vi.fn();
  const active = { postMessage } as unknown as ServiceWorker;
  const registration = { active } as ServiceWorkerRegistration;
  const register = vi.fn().mockResolvedValue(registration);
  const container = {
    controller: null,
    ready: Promise.resolve(registration),
    register,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  } as unknown as ServiceWorkerContainer;

  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: container,
  });
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });

  return {
    dispatchMessage: (data) =>
      events.dispatchEvent(new MessageEvent("message", { data, source: active })),
    postMessage,
    register,
  };
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: online,
  });
}

describe("service worker client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DEV", false);
    setOnline(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prepares exactly selected languages and does not treat legacy English readiness as verified new models", async () => {
    const harness = installServiceWorkerHarness();
    const api = await import("../../src/lib/service-worker");
    const status = vi.fn();
    const dispose = await api.registerLocalServiceWorker(vi.fn());
    const unsubscribe = api.subscribeOfflineLanguageStatus(status);
    api.prepareOfflineOcrAssets(["spa", "hin"]);
    await Promise.resolve();
    expect(harness.postMessage).toHaveBeenLastCalledWith({ type: "PREPARE_OCR_CACHE", languages: ["spa", "hin"] });
    harness.dispatchMessage({ type: "OCR_CACHE_STATUS", ready: true });
    expect(status).toHaveBeenLastCalledWith({ ready: [], preparing: [], failed: false });
    harness.dispatchMessage({ type: "OCR_CACHE_STATUS", ready: false, readyLanguages: ["spa", "hin"] });
    expect(status).toHaveBeenLastCalledWith({ ready: ["spa", "hin"], preparing: [], failed: false });
    unsubscribe(); dispose();
  });

  it("checks the active tool and ignores preparation replies for a departed route", async () => {
    const harness = installServiceWorkerHarness();
    const api = await import("../../src/lib/service-worker");
    const status = vi.fn();
    const dispose = await api.registerLocalServiceWorker(status, undefined, "/hide-message");
    expect(harness.postMessage).toHaveBeenCalledWith({ type: "CHECK_SHELL_CACHE", path: "/hide-message" });
    harness.dispatchMessage({ type: "SHELL_CACHE_STATUS", path: "/", ready: true });
    expect(status).not.toHaveBeenLastCalledWith("Offline app ready");
    harness.dispatchMessage({ type: "SHELL_CACHE_STATUS", path: "/hide-message", ready: false });
    expect(harness.postMessage).toHaveBeenLastCalledWith({ type: "PREPARE_SHELL_CACHE", path: "/hide-message" });
    harness.dispatchMessage({ type: "SHELL_CACHE_STATUS", path: "/hide-message", ready: true });
    expect(status).toHaveBeenLastCalledWith("Offline app ready");
    dispose();
  });

  it("prepares only the visited guide and reports its scope honestly", async () => {
    const harness = installServiceWorkerHarness();
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);
    const api = await import("../../src/lib/service-worker");
    const shell = vi.fn();
    const unsubscribe = api.subscribeOfflineShellStatus(shell);
    const dispose = await api.registerLocalServiceWorker(vi.fn(), "/guides/screenshot-to-text");
    expect(harness.postMessage).toHaveBeenCalledWith({ type: "CHECK_SHELL_CACHE", path: "/guides/screenshot-to-text" });
    harness.dispatchMessage({ type: "SHELL_CACHE_STATUS", ready: false });
    await vi.waitFor(() => expect(harness.postMessage).toHaveBeenCalledWith({ type: "PREPARE_GUIDE_CACHE", path: "/guides/screenshot-to-text", fontPaths: [] }));
    expect(harness.postMessage).not.toHaveBeenCalledWith({ type: "PREPARE_SHELL_CACHE" });
    harness.dispatchMessage({ type: "GUIDE_CACHE_READY", path: "/guides/other" });
    expect(shell).not.toHaveBeenLastCalledWith("guide-ready");
    harness.dispatchMessage({ type: "GUIDE_CACHE_READY", path: "/guides/screenshot-to-text" });
    expect(shell).toHaveBeenLastCalledWith("guide-ready");
    dispose(); unsubscribe(); vi.restoreAllMocks();
  });

  it("keeps cache readiness independent of connectivity and deduplicates repeated statuses", async () => {
    const harness = installServiceWorkerHarness();
    const api = await import("../../src/lib/service-worker");
    const shell = vi.fn(), model = vi.fn();
    const unsubscribeShell = api.subscribeOfflineShellStatus(shell);
    const unsubscribeModel = api.subscribeOfflineOcrStatus(model);
    const dispose = await api.registerLocalServiceWorker(vi.fn());
    harness.dispatchMessage({ type: "SHELL_CACHE_STATUS", ready: true });
    harness.dispatchMessage({ type: "OCR_CACHE_STATUS", ready: true });
    const shellCount = shell.mock.calls.length;
    setOnline(false);
    window.dispatchEvent(new Event("offline"));
    harness.dispatchMessage({ type: "SHELL_CACHE_STATUS", ready: true });
    harness.dispatchMessage({ type: "OCR_CACHE_STATUS", ready: true });
    expect(shell).toHaveBeenLastCalledWith("ready");
    expect(shell).toHaveBeenCalledTimes(shellCount);
    expect(model).toHaveBeenCalledTimes(1);
    harness.dispatchMessage({ type: "SHELL_CACHE_FAILED" });
    expect(shell).toHaveBeenLastCalledWith("failed");
    harness.dispatchMessage({ type: "SHELL_CACHE_STATUS", ready: false });
    expect(shell).toHaveBeenLastCalledWith("missing");
    dispose(); unsubscribeShell(); unsubscribeModel();
  });

  it("prepares the application shell independently and reports truthful global status", async () => {
    const harness = installServiceWorkerHarness();
    const listener = vi.fn();
    const { registerLocalServiceWorker } = await import(
      "../../src/lib/service-worker"
    );

    const dispose = await registerLocalServiceWorker(listener);

    expect(harness.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(harness.postMessage).toHaveBeenCalledWith({
      type: "CHECK_SHELL_CACHE",
    });
    expect(harness.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.stringContaining("PDF") }),
    );

    harness.dispatchMessage({ type: "SHELL_CACHE_STATUS", ready: false });
    expect(listener).toHaveBeenLastCalledWith("Preparing offline app");
    expect(harness.postMessage).toHaveBeenLastCalledWith({
      type: "PREPARE_SHELL_CACHE",
    });

    harness.dispatchMessage({ type: "SHELL_CACHE_STATUS", ready: true });
    expect(listener).toHaveBeenLastCalledWith("Offline app ready");

    setOnline(false);
    window.dispatchEvent(new Event("offline"));
    expect(listener).toHaveBeenLastCalledWith("Offline");

    setOnline(true);
    window.dispatchEvent(new Event("online"));
    expect(listener).toHaveBeenLastCalledWith("Offline app ready");
    expect(harness.postMessage).toHaveBeenLastCalledWith({
      type: "CHECK_SHELL_CACHE",
    });

    dispose();
    const callCount = listener.mock.calls.length;
    setOnline(false);
    window.dispatchEvent(new Event("offline"));
    expect(listener).toHaveBeenCalledTimes(callCount);
  });

  it("keeps OCR model preparation on a separate status channel", async () => {
    const harness = installServiceWorkerHarness();
    const globalListener = vi.fn();
    const ocrListener = vi.fn();
    const {
      checkOfflineOcrAssets,
      prepareOfflineOcrAssets,
      registerLocalServiceWorker,
      subscribeOfflineOcrStatus,
    } = await import("../../src/lib/service-worker");

    const disposeRegistration = await registerLocalServiceWorker(
      globalListener,
    );
    const disposeOcr = subscribeOfflineOcrStatus(ocrListener);

    checkOfflineOcrAssets();
    await Promise.resolve();
    expect(harness.postMessage).toHaveBeenCalledWith({
      type: "CHECK_OCR_CACHE",
    });

    prepareOfflineOcrAssets();
    await Promise.resolve();
    expect(harness.postMessage).toHaveBeenCalledWith({
      type: "PREPARE_OCR_CACHE",
    });

    harness.dispatchMessage({ type: "OCR_CACHE_PREPARING" });
    expect(ocrListener).toHaveBeenLastCalledWith(
      "Preparing English OCR model",
    );
    expect(globalListener).not.toHaveBeenCalledWith(
      "Preparing English OCR model",
    );

    harness.dispatchMessage({ type: "OCR_CACHE_STATUS", ready: true });
    expect(ocrListener).toHaveBeenLastCalledWith(
      "English OCR available offline",
    );
    expect(globalListener).not.toHaveBeenCalledWith(
      "English OCR available offline",
    );

    harness.dispatchMessage({ type: "OCR_CACHE_FAILED" });
    expect(ocrListener).toHaveBeenLastCalledWith("OCR preparation failed");

    disposeOcr();
    disposeRegistration();
  });

  it("prepares the optional JPEG codec on its own status channel", async () => {
    const harness = installServiceWorkerHarness();
    const globalListener = vi.fn();
    const jpegListener = vi.fn();
    const {
      checkOfflineJpegCodecAsset,
      ensureOfflineJpegCodecAsset,
      registerLocalServiceWorker,
      subscribeOfflineJpegCodecStatus,
    } = await import("../../src/lib/service-worker");

    const disposeRegistration = await registerLocalServiceWorker(globalListener);
    const disposeJpeg = subscribeOfflineJpegCodecStatus(jpegListener);

    checkOfflineJpegCodecAsset();
    await Promise.resolve();
    expect(harness.postMessage).toHaveBeenCalledWith({
      type: "CHECK_JPEG_CODEC_CACHE",
    });

    const preparing = ensureOfflineJpegCodecAsset();
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.postMessage).toHaveBeenLastCalledWith({
      type: "PREPARE_JPEG_CODEC_CACHE",
    });
    harness.dispatchMessage({ type: "JPEG_CODEC_CACHE_PREPARING" });
    expect(jpegListener).toHaveBeenLastCalledWith("Preparing JPEG codec");
    harness.dispatchMessage({ type: "JPEG_CODEC_CACHE_STATUS", ready: true });
    await expect(preparing).resolves.toBe(true);
    expect(jpegListener).toHaveBeenLastCalledWith("JPEG codec available offline");
    expect(globalListener).not.toHaveBeenCalledWith("JPEG codec available offline");

    disposeJpeg();
    disposeRegistration();
  });

  it("reports an unavailable codec without affecting PNG or global readiness", async () => {
    const harness = installServiceWorkerHarness();
    const globalListener = vi.fn();
    const { ensureOfflineJpegCodecAsset, registerLocalServiceWorker } = await import(
      "../../src/lib/service-worker"
    );
    const dispose = await registerLocalServiceWorker(globalListener);

    const preparing = ensureOfflineJpegCodecAsset();
    await Promise.resolve();
    await Promise.resolve();
    harness.dispatchMessage({ type: "JPEG_CODEC_CACHE_FAILED" });
    await expect(preparing).resolves.toBe(false);
    expect(globalListener).not.toHaveBeenCalledWith("JPEG codec not available offline");

    dispose();
  });

  it("checks and prepares PDF assets only through explicit PDF requests", async () => {
    const harness = installServiceWorkerHarness();
    const pdfListener = vi.fn();
    const {
      checkOfflinePdfAssets,
      prepareOfflinePdfAssets,
      registerLocalServiceWorker,
      subscribeOfflinePdfStatus,
    } = await import("../../src/lib/service-worker");
    const disposeRegistration = await registerLocalServiceWorker(vi.fn());
    const disposePdf = subscribeOfflinePdfStatus(pdfListener);

    const checking = checkOfflinePdfAssets();
    await Promise.resolve();
    await Promise.resolve();
    const checkMessage = harness.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message.type === "CHECK_PDF_CACHE");
    expect(checkMessage.requestId).toMatch(/^pdf-cache-/);
    harness.dispatchMessage({
      type: "PDF_CACHE_STATUS",
      ready: false,
      requestId: checkMessage.requestId,
    });
    await expect(checking).resolves.toBe(false);
    expect(pdfListener).toHaveBeenLastCalledWith(
      "PDF reader not available offline",
    );

    const preparing = prepareOfflinePdfAssets();
    await Promise.resolve();
    await Promise.resolve();
    const prepareMessage = harness.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message.type === "PREPARE_PDF_CACHE");
    harness.dispatchMessage({
      type: "PDF_CACHE_PREPARING",
      requestId: prepareMessage.requestId,
    });
    expect(pdfListener).toHaveBeenLastCalledWith("Preparing PDF reader assets");
    harness.dispatchMessage({
      type: "PDF_CACHE_STATUS",
      ready: true,
      requestId: prepareMessage.requestId,
    });
    await expect(preparing).resolves.toBe(true);
    expect(pdfListener).toHaveBeenLastCalledWith(
      "PDF reader available offline",
    );

    harness.dispatchMessage({ type: "PDF_CACHE_FAILED" });
    expect(pdfListener).toHaveBeenLastCalledWith(
      "PDF reader preparation failed",
    );

    disposePdf();
    disposeRegistration();
  });
});
