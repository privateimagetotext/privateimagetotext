import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cleanups: Array<() => void> = [];

function workerHarness() {
  const events = new EventTarget();
  let current = { postMessage: vi.fn() } as unknown as ServiceWorker;
  const registration = { active: current } as ServiceWorkerRegistration;
  const container = {
    controller: current,
    ready: Promise.resolve(registration),
    register: vi.fn().mockResolvedValue(registration),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  return {
    current: () => current,
    message(data: unknown, source = current) {
      events.dispatchEvent(new MessageEvent("message", { data, source }));
    },
    changeController() {
      const previous = current;
      current = { postMessage: vi.fn() } as unknown as ServiceWorker;
      container.controller = current;
      Object.defineProperty(registration, "active", { configurable: true, value: current });
      events.dispatchEvent(new Event("controllerchange"));
      return previous;
    },
  };
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe("service worker controller replacement", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DEV", false);
    vi.useFakeTimers();
  });
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("invalidates active support readiness and checks it on the replacement controller", async () => {
    const harness = workerHarness();
    const api = await import("../../src/lib/service-worker");
    const pdf = vi.fn(), ocr = vi.fn(), jpeg = vi.fn();
    cleanups.push(await api.registerLocalServiceWorker(vi.fn()));
    cleanups.push(api.subscribeOfflinePdfStatus(pdf), api.subscribeOfflineOcrStatus(ocr), api.subscribeOfflineJpegCodecStatus(jpeg));
    harness.message({ type: "PDF_CACHE_STATUS", ready: true });
    harness.message({ type: "OCR_CACHE_STATUS", ready: true });
    harness.message({ type: "JPEG_CODEC_CACHE_STATUS", ready: true });
    harness.changeController();
    expect(pdf).toHaveBeenLastCalledWith("PDF reader not available offline");
    expect(ocr).toHaveBeenLastCalledWith("English OCR not available offline");
    expect(jpeg).toHaveBeenLastCalledWith("JPEG codec not available offline");
    await flush();
    for (const type of ["CHECK_SHELL_CACHE", "CHECK_PDF_CACHE", "CHECK_OCR_CACHE", "CHECK_JPEG_CODEC_CACHE"]) {
      expect(harness.current().postMessage).toHaveBeenCalledWith(expect.objectContaining({ type }));
    }
    expect(harness.current().postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "PREPARE_PDF_CACHE" }));
  });

  it("keeps optional support checks lazy when no support channel has been used", async () => {
    const harness = workerHarness();
    const api = await import("../../src/lib/service-worker");
    cleanups.push(await api.registerLocalServiceWorker(vi.fn()));
    harness.changeController();
    await flush();
    expect(harness.current().postMessage).toHaveBeenCalledExactlyOnceWith({ type: "CHECK_SHELL_CACHE" });
    harness.changeController();
    await flush();
    expect(harness.current().postMessage).toHaveBeenCalledExactlyOnceWith({ type: "CHECK_SHELL_CACHE" });
  });

  it("ignores readiness messages from a superseded worker", async () => {
    const harness = workerHarness();
    const api = await import("../../src/lib/service-worker");
    const pdf = vi.fn(), ocr = vi.fn(), jpeg = vi.fn();
    cleanups.push(await api.registerLocalServiceWorker(vi.fn()));
    cleanups.push(api.subscribeOfflinePdfStatus(pdf), api.subscribeOfflineOcrStatus(ocr), api.subscribeOfflineJpegCodecStatus(jpeg));
    const previous = harness.changeController();
    for (const type of ["PDF_CACHE_STATUS", "OCR_CACHE_STATUS", "JPEG_CODEC_CACHE_STATUS"]) harness.message({ type, ready: false });
    pdf.mockClear(); ocr.mockClear(); jpeg.mockClear();
    for (const type of ["PDF_CACHE_STATUS", "OCR_CACHE_STATUS", "JPEG_CODEC_CACHE_STATUS"]) harness.message({ type, ready: true }, previous);
    expect(pdf).not.toHaveBeenCalled();
    expect(ocr).not.toHaveBeenCalled();
    expect(jpeg).not.toHaveBeenCalled();
  });

  it("settles a PDF preparation promptly when its controller disappears", async () => {
    const harness = workerHarness();
    const api = await import("../../src/lib/service-worker");
    cleanups.push(await api.registerLocalServiceWorker(vi.fn()));
    const settled = vi.fn();
    void api.prepareOfflinePdfAssets().then(settled);
    await flush();
    const previous = harness.current();
    const request = vi.mocked(previous.postMessage).mock.calls.find(([message]) => message.type === "PREPARE_PDF_CACHE")![0];
    harness.message({ type: "PDF_CACHE_PREPARING", requestId: request.requestId });
    harness.changeController();
    await flush();
    expect(settled).toHaveBeenCalledExactlyOnceWith(false);
    harness.message({ type: "PDF_CACHE_STATUS", requestId: request.requestId, ready: true }, previous);
    await flush();
    expect(settled).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("turns an unanswered PDF preparation into a visible failure instead of leaving it preparing", async () => {
    const harness = workerHarness();
    const api = await import("../../src/lib/service-worker");
    const pdf = vi.fn();
    cleanups.push(await api.registerLocalServiceWorker(vi.fn()), api.subscribeOfflinePdfStatus(pdf));
    const preparing = api.prepareOfflinePdfAssets();
    await flush();
    const request = vi.mocked(harness.current().postMessage).mock.calls.find(([message]) => message.type === "PREPARE_PDF_CACHE")![0];
    harness.message({ type: "PDF_CACHE_PREPARING", requestId: request.requestId });
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(preparing).resolves.toBe(false);
    expect(pdf).toHaveBeenLastCalledWith("PDF reader preparation failed");
  });

  it("ignores late correlated PDF replies after timeout while a new request owns status", async () => {
    const harness = workerHarness();
    const api = await import("../../src/lib/service-worker");
    const pdf = vi.fn();
    cleanups.push(await api.registerLocalServiceWorker(vi.fn()), api.subscribeOfflinePdfStatus(pdf));
    const old = api.prepareOfflinePdfAssets();
    await flush();
    const oldRequest = vi.mocked(harness.current().postMessage).mock.calls.at(-1)![0];
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(old).resolves.toBe(false);
    const fresh = api.prepareOfflinePdfAssets();
    await flush();
    const freshRequest = vi.mocked(harness.current().postMessage).mock.calls.at(-1)![0];
    harness.message({ type: "PDF_CACHE_STATUS", requestId: freshRequest.requestId, ready: true });
    await expect(fresh).resolves.toBe(true);
    pdf.mockClear();
    for (const type of ["PDF_CACHE_PREPARING", "PDF_CACHE_STATUS", "PDF_CACHE_FAILED"]) harness.message({ type, requestId: oldRequest.requestId, ready: false });
    expect(pdf).not.toHaveBeenCalled();
  });

  it.each(["reply", "timeout"] as const)("an older PDF check cannot overwrite newer preparation on its late %s", async (completion) => {
    const harness = workerHarness();
    const api = await import("../../src/lib/service-worker");
    const pdf = vi.fn();
    cleanups.push(await api.registerLocalServiceWorker(vi.fn()), api.subscribeOfflinePdfStatus(pdf));
    const checking = api.checkOfflinePdfAssets();
    await flush();
    const checkRequest = vi.mocked(harness.current().postMessage).mock.calls.at(-1)![0];
    const preparing = api.prepareOfflinePdfAssets();
    await flush();
    const prepareRequest = vi.mocked(harness.current().postMessage).mock.calls.at(-1)![0];
    harness.message({ type: "PDF_CACHE_STATUS", requestId: prepareRequest.requestId, ready: true });
    await expect(preparing).resolves.toBe(true);
    pdf.mockClear();
    if (completion === "reply") harness.message({ type: "PDF_CACHE_STATUS", requestId: checkRequest.requestId, ready: false });
    else await vi.advanceTimersByTimeAsync(120_000);
    await expect(checking).resolves.toBe(false);
    expect(pdf).not.toHaveBeenCalled();
  });

  it("requires the intended worker even when a PDF reply has the right request ID", async () => {
    const harness = workerHarness();
    const api = await import("../../src/lib/service-worker");
    const settled = vi.fn();
    const preparing = api.prepareOfflinePdfAssets().then(settled);
    await flush();
    const request = vi.mocked(harness.current().postMessage).mock.calls.at(-1)![0];
    const foreign = { postMessage: vi.fn() } as unknown as ServiceWorker;
    harness.message({ type: "PDF_CACHE_STATUS", requestId: request.requestId, ready: true }, foreign);
    await flush();
    expect(settled).not.toHaveBeenCalled();
    harness.message({ type: "PDF_CACHE_STATUS", requestId: request.requestId, ready: false });
    await preparing;
    expect(settled).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("settles JPEG preparation on controller change without a global registration listener", async () => {
    const harness = workerHarness();
    const api = await import("../../src/lib/service-worker");
    const settled = vi.fn();
    void api.ensureOfflineJpegCodecAsset().then(settled);
    await flush();
    const previous = harness.changeController();
    await flush();
    expect(settled).toHaveBeenCalledExactlyOnceWith(false);
    harness.message({ type: "JPEG_CODEC_CACHE_STATUS", ready: true }, previous);
    await flush();
    expect(settled).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("settles a synchronous PDF post failure and removes its pending request", async () => {
    const harness = workerHarness();
    const api = await import("../../src/lib/service-worker");
    const pdf = vi.fn();
    cleanups.push(api.subscribeOfflinePdfStatus(pdf));
    vi.mocked(harness.current().postMessage).mockImplementation(() => { throw new Error("test worker stopped"); });
    await expect(api.prepareOfflinePdfAssets()).resolves.toBe(false);
    expect(pdf).toHaveBeenLastCalledWith("PDF reader preparation failed");
    pdf.mockClear();
    harness.changeController();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(pdf).not.toHaveBeenCalled();
  });
});
