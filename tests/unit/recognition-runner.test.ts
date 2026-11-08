import { beforeEach, describe, expect, it, vi } from "vitest";

import { runRecognition } from "../../src/features/ocr/recognition-runner";
import type {
  EngineSectionWord,
  OcrLine,
  PreparationMetadata,
  RecognitionResponse,
} from "../../src/features/ocr/types";

const imageMocks = vi.hoisted(() => ({
  decodeImage: vi.fn(),
  renderRecognitionTile: vi.fn(),
  clearCanvas: vi.fn((canvas: HTMLCanvasElement | null) => {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }),
}));

vi.mock("../../src/features/image-editor/image", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/features/image-editor/image")
  >();
  return { ...actual, ...imageMocks };
});

const adaptivePreparation: PreparationMetadata = {
  scale: 0.512,
  scaleX: 0.512,
  scaleY: 0.512,
  scaleAction: "reduced",
  profile: "adaptive-document",
  thresholdingMethod: 2,
  polarityInverted: false,
  sourceWidth: 900,
  sourceHeight: 8_000,
  preparedWidth: 461,
  preparedHeight: 4_096,
  adaptivePlan: {
    low: 20,
    high: 240,
    stretchApplied: true,
    polarityInverted: false,
  },
};

const adaptiveTransform = {
  crop: { x: 0, y: 0, width: 1, height: 1 },
  rotation: 0 as const,
  preset: "adaptive-document" as const,
};

function ocrLine(text: string, y: number): OcrLine {
  return {
    text,
    confidence: 90,
    bbox: { x0: 20, y0: y - 10, x1: 400, y1: y + 10 },
    blockIndex: 0,
    paragraphIndex: 0,
    lineIndex: 0,
  };
}

function ocrWord(
  text: string,
  y: number,
  lineIndex: number,
  wordIndex = 0,
): EngineSectionWord {
  return {
    text,
    confidence: 91,
    bbox: { x0: 20, y0: y - 10, x1: 180, y1: y + 10 },
    blockIndex: 0,
    paragraphIndex: 0,
    lineIndex,
    wordIndex,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("recognition runner", () => {
  beforeEach(() => {
    imageMocks.decodeImage.mockReset();
    imageMocks.renderRecognitionTile.mockReset();
    imageMocks.clearCanvas.mockClear();
  });

  it.each(["document", "columns", "screenshot", "code", "sparse", "single-line"] as const)(
    "uses one bounded preview for noneligible %s mode",
    async (contentMode) => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 600;
      const recognise = vi.fn().mockResolvedValue({
        text: "legacy result",
        confidence: 93,
        rotateRadians: 0,
        lines: [ocrLine("legacy result", 30)],
      });
      const preparation: PreparationMetadata = {
        ...adaptivePreparation,
        scale: 1,
        scaleX: 1,
        scaleY: 1,
        scaleAction: "original",
        profile: "original",
        thresholdingMethod: 0,
        sourceWidth: 800,
        sourceHeight: 600,
        preparedWidth: 800,
        preparedHeight: 600,
        adaptivePlan: undefined,
      };

      const result = await runRecognition({
        adapter: { recognise },
        file: new File(["image"], "page.png", { type: "image/png" }),
        sourceWidth: 800,
        sourceHeight: 600,
        sourceFileBytes: 5,
        transform: { ...adaptiveTransform, preset: "original" },
        contentMode,
        previewCanvas: canvas,
        previewPreparation: preparation,
        signal: new AbortController().signal,
        onProgress: vi.fn(),
      });

      expect(result.raw).toBe("legacy result");
      expect(result.lines).toEqual([ocrLine("legacy result", 30)]);
      expect(recognise).toHaveBeenCalledTimes(1);
      expect(result).not.toHaveProperty("words");
      expect(result.recognition).toMatchObject({
        strategy: "single-canvas",
        sectionCount: 1,
        sourceDetail: "original",
        peakPreparedSize: { width: 800, height: 600 },
      });
      expect(recognise).toHaveBeenCalledWith(
        canvas,
        expect.objectContaining({
          contentMode,
          autoDeskew: false,
          thresholdingMethod: 0,
          includeWords: false,
          includeLines: true,
        }),
        expect.any(Function),
      );
      expect(imageMocks.decodeImage).not.toHaveBeenCalled();
    },
  );

  it("optionally maps a single-canvas word through crop, quarter-turn, and unequal scales", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 61;
    canvas.height = 79;
    const recognise = vi.fn().mockResolvedValue({
      text: "ANCHOR",
      confidence: 93,
      rotateRadians: 0,
      words: [ocrWord("ANCHOR", 30, 0)],
    });
    const preparation: PreparationMetadata = {
      scale: 1.975,
      scaleX: 61 / 30,
      scaleY: 79 / 40,
      scaleAction: "original",
      profile: "document",
      thresholdingMethod: 0,
      polarityInverted: false,
      sourceWidth: 40,
      sourceHeight: 30,
      preparedWidth: 61,
      preparedHeight: 79,
    };

    const result = await runRecognition({
      adapter: { recognise },
      file: new File(["image"], "cropped.png", { type: "image/png" }),
      sourceWidth: 101,
      sourceHeight: 81,
      sourceFileBytes: 5,
      transform: {
        crop: { x: 10 / 101, y: 20 / 81, width: 40 / 101, height: 30 / 81 },
        rotation: 90,
        preset: "document",
      },
      contentMode: "document",
      previewCanvas: canvas,
      previewPreparation: preparation,
      signal: new AbortController().signal,
      onProgress: vi.fn(),
      includeWordGeometry: true,
    });

    expect(recognise).toHaveBeenCalledWith(
      canvas,
      expect.objectContaining({ includeWords: true, includeLines: true }),
      expect.any(Function),
    );
    expect(result.recognition.coordinates).toMatchObject({
      sourceCrop: { x: 10, y: 20, width: 40, height: 30 },
      orientedPageSize: { width: 30, height: 40 },
    });
    const word = result.words?.[0];
    expect(word).toMatchObject({
      text: "ANCHOR",
      sectionId: "section-1",
      engineSection: { space: "engine-section" },
      preparedSection: { space: "prepared-section" },
      orientedPage: { space: "oriented-page" },
      sourceImage: { space: "source-image" },
    });
    expect(word?.sourceImage.polygon[0].x).toBeCloseTo(10 + (20 * 40) / 79, 10);
    expect(word?.sourceImage.polygon[0].y).toBeCloseTo(50 - (20 * 30) / 61, 10);
  });

  it("decodes once, recognises native tiles sequentially, and owns seam lines geometrically", async () => {
    const close = vi.fn();
    imageMocks.decodeImage.mockResolvedValue({
      source: {} as CanvasImageSource,
      width: 900,
      height: 8_000,
      close,
    });
    imageMocks.renderRecognitionTile.mockImplementation(
      (
        _decoded: unknown,
        _transform: unknown,
        _crop: unknown,
        inputRect: { y: number; width: number; height: number },
        canvas: HTMLCanvasElement,
      ) => {
        canvas.width = inputRect.width;
        canvas.height = inputRect.height;
        canvas.dataset.inputY = String(inputRect.y);
      },
    );
    const responses: RecognitionResponse[] = [
      {
        text: "REPEAT\nSEAMWORD",
        confidence: 90,
        rotateRadians: 0,
        lines: [
          ocrLine("REPEAT", 100),
          { ...ocrLine("SEAMWORD", 2_677), lineIndex: 1 },
        ],
        words: [ocrWord("REPEAT", 100, 0), ocrWord("SEAMWORD", 2_677, 1)],
      },
      {
        text: "SEAMWORD\nREPEAT",
        confidence: 90,
        rotateRadians: 0,
        // Tile 2 begins at y=2539, so local y=138 is the same seam line.
        lines: [
          ocrLine("SEAMWORD", 138),
          { ...ocrLine("REPEAT", 1_400), lineIndex: 1 },
        ],
        words: [ocrWord("SEAMWORD", 138, 0), ocrWord("REPEAT", 1_400, 1)],
      },
      {
        text: "BOTTOM",
        confidence: 90,
        rotateRadians: 0,
        lines: [ocrLine("BOTTOM-9009", 2_600)],
        words: [ocrWord("BOTTOM-9009", 2_600, 0)],
      },
    ];
    const recognise = vi.fn().mockImplementation(async () => responses.shift());
    const progress = vi.fn();

    const result = await runRecognition({
      adapter: { recognise },
      file: new File(["image"], "long.png", { type: "image/png" }),
      sourceWidth: 900,
      sourceHeight: 8_000,
      sourceFileBytes: 5,
      transform: adaptiveTransform,
      contentMode: "document",
      previewCanvas: document.createElement("canvas"),
      previewPreparation: adaptivePreparation,
      signal: new AbortController().signal,
      onProgress: progress,
      includeWordGeometry: true,
    });

    expect(result.raw.match(/REPEAT/g)).toHaveLength(2);
    expect(result.raw).toContain("BOTTOM-9009");
    expect(result.raw.match(/SEAMWORD/g)).toHaveLength(1);
    expect(result.words?.map((word) => word.text)).toEqual([
      "REPEAT",
      "SEAMWORD",
      "REPEAT",
      "BOTTOM-9009",
    ]);
    expect(result.words?.filter((word) => word.text === "SEAMWORD")).toHaveLength(1);
    expect(result.words?.filter((word) => word.text === "REPEAT")).toHaveLength(2);
    expect(result.words?.map((word) => word.sectionIndex)).toEqual([0, 1, 1, 2]);
    expect(result.words?.every((word) => word.sourceImage.space === "source-image")).toBe(true);
    expect(result.recognition).toMatchObject({
      strategy: "vertical-tiles",
      sourceDetail: "original",
      sectionCount: 3,
      peakPreparedSize: { width: 900 },
    });
    expect(result.recognition.sections).toHaveLength(3);
    expect(recognise).toHaveBeenCalledTimes(3);
    expect(recognise).toHaveBeenNthCalledWith(
      1,
      expect.any(HTMLCanvasElement),
      expect.objectContaining({
        pageSegmentation: "single-block",
        includeWords: true,
        includeLines: true,
      }),
      expect.any(Function),
    );
    expect(imageMocks.decodeImage).toHaveBeenCalledTimes(1);
    expect(imageMocks.renderRecognitionTile).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledTimes(1);
    expect(imageMocks.clearCanvas).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "combining", value: 1 }),
    );
  });

  it("stops before a later tile and closes resources after cancellation", async () => {
    const close = vi.fn();
    imageMocks.decodeImage.mockResolvedValue({
      source: {} as CanvasImageSource,
      width: 900,
      height: 8_000,
      close,
    });
    imageMocks.renderRecognitionTile.mockImplementation(
      (
        _decoded: unknown,
        _transform: unknown,
        _crop: unknown,
        inputRect: { width: number; height: number },
        canvas: HTMLCanvasElement,
      ) => {
        canvas.width = inputRect.width;
        canvas.height = inputRect.height;
      },
    );
    const first = deferred<RecognitionResponse>();
    const recognise = vi.fn().mockReturnValue(first.promise);
    const controller = new AbortController();
    const promise = runRecognition({
      adapter: { recognise },
      file: new File(["image"], "long.png", { type: "image/png" }),
      sourceWidth: 900,
      sourceHeight: 8_000,
      sourceFileBytes: 5,
      transform: adaptiveTransform,
      contentMode: "document",
      previewCanvas: document.createElement("canvas"),
      previewPreparation: adaptivePreparation,
      signal: controller.signal,
      onProgress: vi.fn(),
      includeWordGeometry: true,
    });

    await vi.waitFor(() => expect(recognise).toHaveBeenCalledTimes(1));
    controller.abort();
    first.resolve({
      text: "late",
      confidence: 90,
      rotateRadians: 0,
      lines: [ocrLine("late", 100)],
    });

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(recognise).toHaveBeenCalledTimes(1);
    expect(imageMocks.renderRecognitionTile).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(imageMocks.clearCanvas).toHaveBeenCalledTimes(1);
  });

  it("plans tiles in the oriented-page space after a manual quarter turn", async () => {
    const close = vi.fn();
    imageMocks.decodeImage.mockResolvedValue({
      source: {} as CanvasImageSource,
      width: 8_000,
      height: 900,
      close,
    });
    imageMocks.renderRecognitionTile.mockImplementation(
      (
        _decoded: unknown,
        _transform: unknown,
        _crop: unknown,
        inputRect: { width: number; height: number },
        canvas: HTMLCanvasElement,
      ) => {
        canvas.width = inputRect.width;
        canvas.height = inputRect.height;
      },
    );
    const recognise = vi.fn().mockResolvedValue({
      text: "",
      confidence: 90,
      rotateRadians: 0,
      lines: [],
    });
    const preview = document.createElement("canvas");
    preview.width = 461;
    preview.height = 4_096;

    const result = await runRecognition({
      adapter: { recognise },
      file: new File(["image"], "landscape.png", { type: "image/png" }),
      sourceWidth: 8_000,
      sourceHeight: 900,
      sourceFileBytes: 5,
      transform: { ...adaptiveTransform, rotation: 90 },
      contentMode: "document",
      previewCanvas: preview,
      previewPreparation: {
        ...adaptivePreparation,
        sourceWidth: 8_000,
        sourceHeight: 900,
        preparedWidth: 461,
        preparedHeight: 4_096,
        scaleX: 461 / 900,
        scaleY: 4_096 / 8_000,
      },
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });

    expect(result.recognition).toMatchObject({
      strategy: "vertical-tiles",
      sectionCount: 3,
      coordinates: {
        sourceCrop: { x: 0, y: 0, width: 8_000, height: 900 },
        orientedPageSize: { width: 900, height: 8_000 },
        sourceToOriented: [0, 1, -1, 0, 900, 0],
      },
    });
    expect(imageMocks.renderRecognitionTile).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      expect.objectContaining({ rotation: 90 }),
      { x: 0, y: 0, width: 8_000, height: 900 },
      expect.objectContaining({ x: 0, y: 0, width: 900 }),
      expect.any(HTMLCanvasElement),
      adaptivePreparation.adaptivePlan,
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("fails closed instead of text-matching overlapping sections when line geometry is absent", async () => {
    const close = vi.fn();
    imageMocks.decodeImage.mockResolvedValue({
      source: {} as CanvasImageSource,
      width: 900,
      height: 8_000,
      close,
    });
    imageMocks.renderRecognitionTile.mockImplementation(
      (
        _decoded: unknown,
        _transform: unknown,
        _crop: unknown,
        inputRect: { width: number; height: number },
        canvas: HTMLCanvasElement,
      ) => {
        canvas.width = inputRect.width;
        canvas.height = inputRect.height;
      },
    );
    const recognise = vi.fn().mockResolvedValue({
      text: "non-empty text without geometry",
      confidence: 90,
      rotateRadians: 0,
      lines: [],
    });

    await expect(
      runRecognition({
        adapter: { recognise },
        file: new File(["image"], "long.png", { type: "image/png" }),
        sourceWidth: 900,
        sourceHeight: 8_000,
        sourceFileBytes: 5,
        transform: adaptiveTransform,
        contentMode: "document",
        previewCanvas: document.createElement("canvas"),
        previewPreparation: adaptivePreparation,
        signal: new AbortController().signal,
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow(/line positions needed to combine/i);
    expect(recognise).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(imageMocks.clearCanvas).toHaveBeenCalledTimes(1);
  });
});
