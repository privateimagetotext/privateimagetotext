import { describe, expect, it, vi } from "vitest";

import {
  recognisePreparedCanvas,
  type CanvasRecognitionAdapter,
} from "../../src/features/ocr/canvas-recognition";

function canvas() {
  return document.createElement("canvas");
}

function adapter(
  implementation: CanvasRecognitionAdapter["recognise"] = vi.fn(async () => ({
    text: "recognised",
    confidence: 91,
    rotateRadians: 0,
  })),
): CanvasRecognitionAdapter {
  return { recognise: implementation };
}

function options(
  recognitionAdapter: CanvasRecognitionAdapter,
  signal: AbortSignal,
) {
  return {
    adapter: recognitionAdapter,
    canvas: canvas(),
    contentMode: "document" as const,
    thresholdingMethod: 2 as const,
    autoDeskew: true,
    includeLines: true,
    includeWords: false,
    signal,
    onProgress: vi.fn(),
  };
}

describe("recognisePreparedCanvas", () => {
  it("passes the existing recognition settings through unchanged", async () => {
    const recognise = vi.fn(async () => ({
      text: "recognised",
      confidence: 91,
      rotateRadians: 0,
      lines: [],
    }));
    const controller = new AbortController();
    const selected = options(adapter(recognise), controller.signal);

    await expect(recognisePreparedCanvas(selected)).resolves.toMatchObject({
      text: "recognised",
      confidence: 91,
    });
    expect(recognise).toHaveBeenCalledWith(
      selected.canvas,
      {
        contentMode: "document",
        autoDeskew: true,
        thresholdingMethod: 2,
        includeLines: true,
        includeWords: false,
      },
      expect.any(Function),
    );
  });

  it("rejects before recognition when already cancelled", async () => {
    const recognise = vi.fn();
    const controller = new AbortController();
    controller.abort();

    await expect(
      recognisePreparedCanvas(options(adapter(recognise), controller.signal)),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(recognise).not.toHaveBeenCalled();
  });

  it("rejects a result and suppresses progress after mid-run cancellation", async () => {
    const controller = new AbortController();
    let publishProgress: ((progress: { stage: string; value: number }) => void) | null = null;
    const recognise = vi.fn(async (_canvas, _request, onProgress) => {
      publishProgress = onProgress;
      controller.abort();
      onProgress({ stage: "Recognising text", value: 0.75 });
      return { text: "late", confidence: 80, rotateRadians: 0 };
    });
    const selected = options(adapter(recognise), controller.signal);

    await expect(recognisePreparedCanvas(selected)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(publishProgress).not.toBeNull();
    expect(selected.onProgress).not.toHaveBeenCalled();
  });
});
