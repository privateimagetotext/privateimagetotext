import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleOcrWorkerPrefetch } from "../../src/features/ocr/prefetch-worker";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe("idle OCR bootstrap prefetch", () => {
  it("waits for idle and fetches only the local worker, without starting OCR", () => {
    let idle: (() => void) | undefined;
    vi.stubGlobal("requestIdleCallback", vi.fn(callback => { idle = callback; return 1; }));
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    const fetch = vi.fn().mockResolvedValue({});
    vi.stubGlobal("fetch", fetch);
    const cancel = scheduleOcrWorkerPrefetch();
    expect(fetch).not.toHaveBeenCalled();
    idle!();
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/ocr/worker.min.js", { cache: "force-cache" });
    cancel();
  });
  it("cancels fallback work on route exit and tolerates unavailable network", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    const cancel = scheduleOcrWorkerPrefetch();
    cancel();
    await vi.runAllTimersAsync();
    expect(fetch).not.toHaveBeenCalled();
    scheduleOcrWorkerPrefetch();
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
