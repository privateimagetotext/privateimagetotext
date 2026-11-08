import { describe, expect, it } from "vitest";

import { ocrReducer, type OcrAction } from "../../src/features/ocr/state";
import {
  initialOcrState,
  type ImageSource,
  type OcrError,
  type OcrResult,
  type OcrState,
  type PreparationMetadata,
} from "../../src/features/ocr/types";

const image: ImageSource = {
  file: new File(["image"], "source.png", { type: "image/png" }),
  objectUrl: "blob:localtext-source",
  name: "source.png",
  mime: "image/png",
  size: 5,
  width: 640,
  height: 480,
  willDownscale: false,
};

const preparation: PreparationMetadata = {
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  scaleAction: "original",
  profile: "original",
  thresholdingMethod: 0,
  polarityInverted: false,
  sourceWidth: 640,
  sourceHeight: 480,
  preparedWidth: 640,
  preparedHeight: 480,
};

const result: OcrResult = {
  raw: "Raw result",
  cleaned: "Clean result",
  markdown: "Markdown result",
  edited: "Clean result",
  confidence: 92,
  elapsedMs: 125,
  rotateRadians: 0,
  preparation,
  recognition: {
    strategy: "single-canvas",
    sourceDetail: "original",
    sectionCount: 1,
    totalPreparedPixels: 640 * 480,
    peakPreparedSize: { width: 640, height: 480 },
    coordinates: {
      version: 1,
      sourceSize: { width: 640, height: 480 },
      sourceCrop: { x: 0, y: 0, width: 640, height: 480 },
      orientedPageSize: { width: 640, height: 480 },
      sourceToOriented: [1, 0, 0, 1, 0, 0],
      orientedToSource: [1, 0, 0, 1, 0, 0],
    },
    sections: [
      {
        id: "section-1",
        index: 0,
        inputRect: { x: 0, y: 0, width: 640, height: 480 },
        coreRect: { x: 0, y: 0, width: 640, height: 480 },
        preparedSize: { width: 640, height: 480 },
        orientedToPrepared: [1, 0, 0, 1, 0, 0],
        preparedToOriented: [1, 0, 0, 1, 0, 0],
        preparedToEngine: [1, 0, 0, 1, 0, 0],
        engineToPrepared: [1, 0, 0, 1, 0, 0],
        rotateRadians: 0,
        thresholdingMethod: 0,
        polarityInverted: false,
      },
    ],
  },
};

const recognitionError: OcrError = {
  type: "recognition",
  message: "Recognition could not be completed.",
};

function readyState(operationId = 1): OcrState {
  return {
    ...initialOcrState,
    status: "imageReady",
    currentOperationId: operationId,
    image,
  };
}

describe("OCR reducer operation lifecycle", () => {
  it("reports local-asset loading and recognition progress", () => {
    const started = ocrReducer(readyState(), {
      type: "ocrStart",
      operationId: 7,
    });
    const loading = ocrReducer(started, {
      type: "ocrProgress",
      operationId: 7,
      progress: { stage: "Loading English model", value: 0.25 },
    });
    const recognising = ocrReducer(loading, {
      type: "ocrProgress",
      operationId: 7,
      progress: { stage: "Recognising text", value: 0.6 },
    });

    expect(started).toMatchObject({
      status: "loadingOcr",
      currentOperationId: 7,
      result: null,
      error: null,
    });
    expect(loading).toMatchObject({
      status: "loadingOcr",
      progress: { stage: "Loading English model", value: 0.25 },
    });
    expect(recognising).toMatchObject({
      status: "recognising",
      progress: { stage: "Recognising text", value: 0.6 },
    });
  });

  it("completes the current operation and clears progress", () => {
    const running = {
      ...readyState(12),
      status: "recognising" as const,
      progress: { stage: "Recognising text", value: 0.9 },
    };

    const completed = ocrReducer(running, {
      type: "ocrSuccess",
      operationId: 12,
      result,
    });

    expect(completed).toMatchObject({
      status: "complete",
      progress: null,
      result,
      resultView: "cleaned",
    });
  });

  it("keeps preparation metadata until an image transform invalidates it", () => {
    const prepared = ocrReducer(readyState(), {
      type: "preparationReady",
      metadata: preparation,
    });
    const contentModeChanged = ocrReducer(prepared, {
      type: "setContentMode",
      mode: "code",
    });
    const presetChanged = ocrReducer(contentModeChanged, {
      type: "setPreset",
      preset: "adaptive-document",
    });

    expect(prepared.preparation).toEqual(preparation);
    expect(contentModeChanged.preparation).toEqual(preparation);
    expect(presetChanged.preparation).toBeNull();
  });

  it("invalidates an existing result when Columns is selected without rerendering", () => {
    const completed: OcrState = {
      ...readyState(),
      status: "complete",
      preparation,
      result,
    };

    const changed = ocrReducer(completed, {
      type: "setContentMode",
      mode: "columns",
    });

    expect(changed).toMatchObject({
      status: "imageReady",
      contentMode: "columns",
      preparation,
      result: null,
    });
  });

  it("cancels the current operation, invalidates its id, and returns to the image", () => {
    const running: OcrState = {
      ...readyState(4),
      status: "recognising",
      progress: { stage: "Recognising text", value: 0.5 },
      error: recognitionError,
    };

    const cancelled = ocrReducer(running, {
      type: "ocrCancelled",
      operationId: 4,
      nextOperationId: 5,
    });

    expect(cancelled).toMatchObject({
      status: "imageReady",
      currentOperationId: 5,
      image,
      progress: null,
      result: null,
      error: null,
    });
  });

  it("records an OCR error and supports recovery by dismissing it", () => {
    const running: OcrState = {
      ...readyState(8),
      status: "recognising",
      progress: { stage: "Recognising text", value: 0.4 },
    };

    const failed = ocrReducer(running, {
      type: "ocrError",
      operationId: 8,
      error: recognitionError,
    });
    const recovered = ocrReducer(failed, { type: "dismissError" });

    expect(failed).toMatchObject({
      status: "error",
      progress: null,
      error: recognitionError,
    });
    expect(recovered).toMatchObject({
      status: "imageReady",
      image,
      error: null,
    });
  });

  it("clears the entire workspace while retaining the supplied invalidation id", () => {
    const completed: OcrState = {
      ...readyState(15),
      status: "complete",
      result,
      resultView: "edited",
      error: recognitionError,
    };

    expect(
      ocrReducer(completed, { type: "clear", operationId: 16 }),
    ).toEqual({
      ...initialOcrState,
      currentOperationId: 16,
    });
  });
});

describe("stale operation rejection", () => {
  const activeState: OcrState = {
    ...readyState(42),
    status: "recognising",
    progress: { stage: "Recognising text", value: 0.5 },
  };

  const staleActions: OcrAction[] = [
    {
      type: "imageReady",
      operationId: 41,
      image: { ...image, name: "stale.png" },
    },
    {
      type: "decodeError",
      operationId: 41,
      error: { type: "image-decode", message: "Stale decode failure" },
    },
    {
      type: "ocrProgress",
      operationId: 41,
      progress: { stage: "Recognising text", value: 1 },
    },
    {
      type: "ocrSuccess",
      operationId: 41,
      result,
    },
    {
      type: "ocrCancelled",
      operationId: 41,
      nextOperationId: 43,
    },
    {
      type: "ocrError",
      operationId: 41,
      error: recognitionError,
    },
    {
      type: "clear",
      operationId: 41,
    },
  ];

  it.each(staleActions)(
    "ignores a stale $type event",
    (action) => {
      expect(ocrReducer(activeState, action)).toBe(activeState);
    },
  );
});
