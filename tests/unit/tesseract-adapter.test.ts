import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalTesseractAdapter } from "../../src/features/ocr/tesseract-adapter";
import { loadLanguageModels } from "../../src/features/ocr/language-models";

const tesseractMocks = vi.hoisted(() => ({
  createWorker: vi.fn(),
}));

vi.mock("tesseract.js", () => ({
  createWorker: tesseractMocks.createWorker,
  OEM: { LSTM_ONLY: 1 },
  PSM: {
    AUTO: "3",
    SINGLE_BLOCK: "6",
    SINGLE_LINE: "7",
    SPARSE_TEXT: "11",
  },
}));

vi.mock("../../src/features/ocr/language-models", () => ({
  loadLanguageModels: vi.fn(async (ids: string[]) => ids.map(code => ({ code, data: new Uint8Array([31, 139]) }))),
}));

type WorkerOptions = {
  cacheMethod?: string;
  errorHandler: (reason: unknown) => void;
  gzip?: boolean;
  logger: (message: { status: string; progress: number }) => void;
};

function mockWorker(text = "recognised text") {
  return {
    setParameters: vi.fn().mockResolvedValue(undefined),
    recognize: vi.fn().mockResolvedValue({
      data: { text, confidence: 96, rotateRadians: null, blocks: null },
    }),
    terminate: vi.fn().mockResolvedValue(undefined),
  };
}

const documentRequest = {
  contentMode: "document" as const,
  autoDeskew: false,
  thresholdingMethod: 0 as const,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("LocalTesseractAdapter", () => {
  beforeEach(() => {
    tesseractMocks.createWorker.mockReset();
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
    });
  });

  it("reuses identical selections and terminates the worker before switching languages", async () => {
    const first = mockWorker();
    const second = mockWorker();
    tesseractMocks.createWorker.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const adapter = new LocalTesseractAdapter();
    const canvas = document.createElement("canvas");
    await adapter.recognise(canvas, { ...documentRequest, languages: ["spa", "hin"] }, vi.fn());
    await adapter.recognise(canvas, { ...documentRequest, languages: ["spa", "hin"] }, vi.fn());
    expect(tesseractMocks.createWorker).toHaveBeenCalledTimes(1);
    await adapter.recognise(canvas, { ...documentRequest, languages: ["tha"] }, vi.fn());
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(tesseractMocks.createWorker.mock.calls[1][0]).toEqual([{ code: "tha", data: new Uint8Array([31, 139]) }]);
    await adapter.dispose();
  });

  it("aborts a model download without creating a late worker", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(loadLanguageModels).mockImplementationOnce(async (_ids, pendingSignal) => {
      signal = pendingSignal;
      return new Promise((_resolve, reject) => pendingSignal.addEventListener("abort", () => reject(new Error("cancelled"))));
    });
    const adapter = new LocalTesseractAdapter();
    const run = adapter.recognise(document.createElement("canvas"), documentRequest, vi.fn());
    const rejected = expect(run).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(signal).toBeDefined());
    await adapter.cancel();
    await rejected;
    expect(signal!.aborted).toBe(true);
    expect(tesseractMocks.createWorker).not.toHaveBeenCalled();
  });

  it("reports engine progress after loading and on repeated recognition", async () => {
    const worker = mockWorker();
    const pending = deferred<Awaited<ReturnType<typeof worker.recognize>>>();
    worker.recognize.mockReturnValueOnce(pending.promise);
    tesseractMocks.createWorker.mockResolvedValue(worker);
    const adapter = new LocalTesseractAdapter();
    const firstProgress = vi.fn();
    const first = adapter.recognise(document.createElement("canvas"), documentRequest, firstProgress);
    await vi.waitFor(() => expect(worker.recognize).toHaveBeenCalledOnce());
    const options = tesseractMocks.createWorker.mock.calls[0][2] as WorkerOptions;

    options.logger({ status: "recognizing text", progress: 0.4 });
    expect(firstProgress).toHaveBeenLastCalledWith({ stage: "Recognising text", value: 0.4 });
    pending.resolve({ data: { text: "first", confidence: 90, rotateRadians: 0, blocks: null } });
    await first;
    firstProgress.mockClear();
    options.logger({ status: "recognizing text", progress: 0.9 });
    expect(firstProgress).not.toHaveBeenCalled();

    const repeated = deferred<Awaited<ReturnType<typeof worker.recognize>>>();
    worker.recognize.mockReturnValueOnce(repeated.promise);
    const nextProgress = vi.fn();
    const next = adapter.recognise(document.createElement("canvas"), documentRequest, nextProgress);
    await vi.waitFor(() => expect(worker.recognize).toHaveBeenCalledTimes(2));
    options.logger({ status: "recognizing text", progress: 0.65 });
    expect(nextProgress).toHaveBeenLastCalledWith({ stage: "Recognising text", value: 0.65 });
    expect(firstProgress).not.toHaveBeenCalled();
    repeated.resolve({ data: { text: "second", confidence: 90, rotateRadians: 0, blocks: null } });
    await next;
    await adapter.dispose();
  });

  it("settles a worker error during recognition and ignores callbacks after cancellation", async () => {
    const worker = mockWorker();
    worker.recognize.mockReturnValue(new Promise(() => undefined));
    tesseractMocks.createWorker.mockResolvedValue(worker);
    const adapter = new LocalTesseractAdapter();
    const progress = vi.fn();
    const recognition = adapter.recognise(document.createElement("canvas"), documentRequest, progress);
    const rejected = expect(recognition).rejects.toThrow("Worker failed during recognition");
    await vi.waitFor(() => expect(worker.recognize).toHaveBeenCalledOnce());
    const options = tesseractMocks.createWorker.mock.calls[0][2] as WorkerOptions;
    options.errorHandler("Worker failed during recognition");
    await rejected;
    await adapter.cancel();
    progress.mockClear();
    options.logger({ status: "recognizing text", progress: 0.8 });
    options.errorHandler("late error");
    expect(progress).not.toHaveBeenCalled();
  });

  it("rejects a failed initialisation and creates a fresh worker on retry", async () => {
    const secondWorker = mockWorker("retry succeeded");
    tesseractMocks.createWorker
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValueOnce(secondWorker);
    const adapter = new LocalTesseractAdapter();
    const canvas = document.createElement("canvas");

    const firstRecognition = adapter.recognise(
      canvas,
      documentRequest,
      vi.fn(),
    );
    await vi.waitFor(() =>
      expect(tesseractMocks.createWorker).toHaveBeenCalledTimes(1),
    );
    const firstOptions = tesseractMocks.createWorker.mock.calls[0][2] as
      | WorkerOptions
      | undefined;
    expect(firstOptions?.cacheMethod).toBe("none");
    expect(firstOptions?.gzip).toBe(true);
    firstOptions?.errorHandler("The English model could not be loaded.");

    await expect(firstRecognition).rejects.toThrow(
      "The English model could not be loaded.",
    );
    await expect(
      adapter.recognise(canvas, documentRequest, vi.fn()),
    ).resolves.toEqual({
      text: "retry succeeded",
      confidence: 96,
      rotateRadians: 0,
    });
    expect(tesseractMocks.createWorker).toHaveBeenCalledTimes(2);
  });

  it("cancels an in-flight initialisation and terminates a late worker", async () => {
    const firstWorker = mockWorker();
    const secondWorker = mockWorker("fresh worker");
    const firstCreation = deferred<typeof firstWorker>();
    tesseractMocks.createWorker
      .mockReturnValueOnce(firstCreation.promise)
      .mockResolvedValueOnce(secondWorker);
    const adapter = new LocalTesseractAdapter();
    const canvas = document.createElement("canvas");

    const cancelledRecognition = adapter.recognise(
      canvas,
      documentRequest,
      vi.fn(),
    );
    const cancelledResult = expect(cancelledRecognition).rejects.toThrow(
      "cancelled",
    );
    await vi.waitFor(() =>
      expect(tesseractMocks.createWorker).toHaveBeenCalledTimes(1),
    );
    await adapter.cancel();
    await cancelledResult;

    await expect(
      adapter.recognise(canvas, documentRequest, vi.fn()),
    ).resolves.toEqual({
      text: "fresh worker",
      confidence: 96,
      rotateRadians: 0,
    });
    firstCreation.resolve(firstWorker);
    await vi.waitFor(() => expect(firstWorker.terminate).toHaveBeenCalled());
    expect(secondWorker.terminate).not.toHaveBeenCalled();
  });

  it.each(["cancel", "dispose"] as const)(
    "%s terminates an already-initialised worker before the adapter is reused",
    async (method) => {
      const initialWorker = mockWorker("initial worker");
      const freshWorker = mockWorker("fresh worker");
      tesseractMocks.createWorker
        .mockResolvedValueOnce(initialWorker)
        .mockResolvedValueOnce(freshWorker);
      const adapter = new LocalTesseractAdapter();
      const canvas = document.createElement("canvas");

      await adapter.recognise(canvas, documentRequest, vi.fn());
      await adapter[method]();

      expect(initialWorker.terminate).toHaveBeenCalledTimes(1);
      await expect(
        adapter.recognise(canvas, documentRequest, vi.fn()),
      ).resolves.toMatchObject({ text: "fresh worker" });
      expect(tesseractMocks.createWorker).toHaveBeenCalledTimes(2);
      expect(freshWorker.terminate).not.toHaveBeenCalled();
    },
  );

  it("settles active recognition when the Tesseract worker is terminated", async () => {
    const worker = mockWorker();
    worker.recognize.mockReturnValue(new Promise(() => undefined));
    tesseractMocks.createWorker.mockResolvedValue(worker);
    const adapter = new LocalTesseractAdapter();
    const recognition = adapter.recognise(
      document.createElement("canvas"),
      documentRequest,
      vi.fn(),
    );

    await vi.waitFor(() => expect(worker.recognize).toHaveBeenCalledOnce());
    await adapter.cancel();

    await expect(recognition).rejects.toThrow("cancelled");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("does not submit recognition after cancelled parameter setup resolves late", async () => {
    const worker = mockWorker();
    const parameters = deferred<void>();
    worker.setParameters.mockReturnValueOnce(parameters.promise);
    tesseractMocks.createWorker.mockResolvedValue(worker);
    const adapter = new LocalTesseractAdapter();
    const recognition = adapter.recognise(document.createElement("canvas"), documentRequest, vi.fn());
    const rejected = expect(recognition).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(worker.setParameters).toHaveBeenCalledOnce());
    await adapter.cancel();
    await rejected;
    parameters.resolve();
    await parameters.promise;
    await Promise.resolve();
    expect(worker.recognize).not.toHaveBeenCalled();
  });

  it.each(["canvas encoding", "encoded-byte reading"] as const)(
    "cancels during %s without submitting late work to a terminated worker",
    async (stage) => {
      const worker = mockWorker();
      const freshWorker = mockWorker("fresh recognition");
      const bytes = deferred<ArrayBuffer>();
      let finishEncoding!: BlobCallback;
      const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
      const readBytes = vi.spyOn(blob, "arrayBuffer").mockReturnValue(bytes.promise);
      vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce((callback) => {
        finishEncoding = callback;
        if (stage === "encoded-byte reading") callback(blob);
      });
      tesseractMocks.createWorker.mockResolvedValueOnce(worker).mockResolvedValueOnce(freshWorker);
      const adapter = new LocalTesseractAdapter();
      const canvas = document.createElement("canvas");
      const recognition = adapter.recognise(canvas, documentRequest, vi.fn());
      const rejected = expect(recognition).rejects.toThrow("cancelled");
      await vi.waitFor(() => expect(canvas.toBlob).toHaveBeenCalledOnce());
      if (stage === "encoded-byte reading") expect(readBytes).toHaveBeenCalledOnce();
      await adapter.cancel();
      await rejected;
      expect(worker.terminate).toHaveBeenCalledOnce();

      await expect(adapter.recognise(canvas, documentRequest, vi.fn())).resolves.toMatchObject({ text: "fresh recognition" });
      if (stage === "canvas encoding") finishEncoding(blob);
      bytes.resolve(new Uint8Array([137, 80, 78, 71]).buffer);
      await bytes.promise;
      await Promise.resolve();
      expect(worker.recognize).not.toHaveBeenCalled();
      expect(freshWorker.recognize).toHaveBeenCalledOnce();
      expect(freshWorker.recognize.mock.calls[0][0]).toBeInstanceOf(ArrayBuffer);
      expect(new Uint8Array(freshWorker.recognize.mock.calls[0][0])).toEqual(new Uint8Array([137, 80, 78, 71]));
      await adapter.dispose();
    },
  );

  it("passes typed recognition options and resets profile settings on every run", async () => {
    const typedWorker = mockWorker();
    typedWorker.recognize.mockResolvedValueOnce({
      data: {
        text: "deskewed",
        confidence: 88,
        rotateRadians: 0.052,
        blocks: null,
      },
    });
    const legacyWorker = mockWorker();
    legacyWorker.recognize.mockResolvedValueOnce({
      data: {
        text: "document",
        confidence: Number.NaN,
        rotateRadians: null,
        blocks: null,
      },
    });
    tesseractMocks.createWorker
      .mockResolvedValueOnce(typedWorker)
      .mockResolvedValueOnce(legacyWorker);
    const adapter = new LocalTesseractAdapter();
    const canvas = document.createElement("canvas");

    await expect(
      adapter.recognise(
        canvas,
        {
          contentMode: "screenshot",
          autoDeskew: true,
          thresholdingMethod: 2,
          pageSegmentation: "single-block",
        },
        vi.fn(),
      ),
    ).resolves.toMatchObject({
      text: "deskewed",
      confidence: 88,
      rotateRadians: 0.052,
    });
    await expect(
      adapter.recognise(canvas, documentRequest, vi.fn()),
    ).resolves.toEqual({
      text: "document",
      confidence: null,
      rotateRadians: 0,
    });

    expect(typedWorker.setParameters).toHaveBeenCalledWith({
      tessedit_pageseg_mode: "6",
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
      thresholding_method: "2",
    });
    expect(legacyWorker.setParameters).toHaveBeenCalledWith({
      tessedit_pageseg_mode: 3,
      preserve_interword_spaces: "0",
      user_defined_dpi: "300",
      thresholding_method: "0",
    });
    expect(typedWorker.recognize).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      { rotateAuto: true },
      { text: true },
    );
    expect(legacyWorker.recognize).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      {},
      { text: true },
    );
    expect(typedWorker.terminate).toHaveBeenCalledTimes(1);
    expect(legacyWorker.terminate).not.toHaveBeenCalled();
  });

  it("reuses typed Columns but recycles before restoring legacy Document", async () => {
    const columnsWorker = mockWorker();
    const documentWorker = mockWorker();
    tesseractMocks.createWorker
      .mockResolvedValueOnce(columnsWorker)
      .mockResolvedValueOnce(documentWorker);
    const adapter = new LocalTesseractAdapter();
    const canvas = document.createElement("canvas");
    const columnsRequest = {
      contentMode: "columns" as const,
      autoDeskew: false,
      thresholdingMethod: 0 as const,
    };

    await adapter.recognise(canvas, columnsRequest, vi.fn());
    await adapter.recognise(canvas, columnsRequest, vi.fn());
    await adapter.recognise(canvas, documentRequest, vi.fn());

    expect(columnsWorker.setParameters).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tessedit_pageseg_mode: "3" }),
    );
    expect(columnsWorker.setParameters).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tessedit_pageseg_mode: "3" }),
    );
    expect(documentWorker.setParameters).toHaveBeenCalledWith(
      expect.objectContaining({ tessedit_pageseg_mode: 3 }),
    );
    expect(columnsWorker.terminate).toHaveBeenCalledTimes(1);
    expect(documentWorker.terminate).not.toHaveBeenCalled();
    expect(tesseractMocks.createWorker).toHaveBeenCalledTimes(2);
  });

  it("does not restart after disposal interrupts a typed-to-legacy recycle", async () => {
    const columnsWorker = mockWorker();
    const unexpectedWorker = mockWorker();
    const termination = deferred<void>();
    tesseractMocks.createWorker
      .mockResolvedValueOnce(columnsWorker)
      .mockResolvedValueOnce(unexpectedWorker);
    const adapter = new LocalTesseractAdapter();
    const canvas = document.createElement("canvas");

    await adapter.recognise(
      canvas,
      {
        contentMode: "columns",
        autoDeskew: false,
        thresholdingMethod: 0,
      },
      vi.fn(),
    );
    columnsWorker.terminate.mockReturnValueOnce(termination.promise);

    const restoringDocument = adapter.recognise(
      canvas,
      documentRequest,
      vi.fn(),
    );
    await vi.waitFor(() =>
      expect(columnsWorker.terminate).toHaveBeenCalledTimes(1),
    );
    await adapter.dispose();
    termination.resolve();

    await expect(restoringDocument).rejects.toThrow("cancelled");
    expect(tesseractMocks.createWorker).toHaveBeenCalledTimes(1);
    expect(unexpectedWorker.recognize).not.toHaveBeenCalled();
  });

  it("returns engine-section words with hierarchy only when requested", async () => {
    const worker = mockWorker();
    worker.recognize.mockResolvedValue({
      data: {
        text: "hello",
        confidence: 90,
        rotateRadians: 0,
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    words: [
                      {
                        text: "hello",
                        confidence: 87,
                        bbox: { x0: 2, y0: 3, x1: 22, y1: 13 },
                      },
                    ],
                  },
                ],
              },
              {
                lines: [
                  {
                    words: [
                      {
                        text: "paragraph",
                        confidence: 86,
                        bbox: { x0: 2, y0: 20, x1: 42, y1: 30 },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            paragraphs: [
              {
                lines: [
                  {
                    words: [
                      {
                        text: "block",
                        confidence: 85,
                        bbox: { x0: 2, y0: 40, x1: 32, y1: 50 },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    tesseractMocks.createWorker.mockResolvedValue(worker);
    const adapter = new LocalTesseractAdapter();
    const canvas = document.createElement("canvas");

    const withoutWords = await adapter.recognise(
      canvas,
      documentRequest,
      vi.fn(),
    );
    expect(withoutWords).not.toHaveProperty("words");

    await expect(
      adapter.recognise(
        canvas,
        { ...documentRequest, includeWords: true },
        vi.fn(),
      ),
    ).resolves.toMatchObject({
      words: [
        {
          text: "hello",
          confidence: 87,
          bbox: { x0: 2, y0: 3, x1: 22, y1: 13 },
          blockIndex: 0,
          paragraphIndex: 0,
          lineIndex: 0,
          wordIndex: 0,
        },
        {
          text: "paragraph",
          confidence: 86,
          bbox: { x0: 2, y0: 20, x1: 42, y1: 30 },
          blockIndex: 0,
          paragraphIndex: 1,
          lineIndex: 0,
          wordIndex: 0,
        },
        {
          text: "block",
          confidence: 85,
          bbox: { x0: 2, y0: 40, x1: 32, y1: 50 },
          blockIndex: 1,
          paragraphIndex: 0,
          lineIndex: 0,
          wordIndex: 0,
        },
      ],
    });
    expect(worker.recognize).toHaveBeenNthCalledWith(
      1,
      expect.any(ArrayBuffer),
      {},
      { text: true },
    );
    expect(worker.recognize).toHaveBeenNthCalledWith(
      2,
      expect.any(ArrayBuffer),
      {},
      { text: true, blocks: true },
    );
  });

  it("returns words and lines together from one requested block payload", async () => {
    const worker = mockWorker();
    worker.recognize.mockResolvedValue({
      data: {
        text: "first second\nthird",
        confidence: 92,
        rotateRadians: 0,
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    text: "first second",
                    confidence: 91,
                    bbox: { x0: 4, y0: 5, x1: 84, y1: 15 },
                    words: [
                      {
                        text: "first",
                        confidence: 90,
                        bbox: { x0: 4, y0: 5, x1: 34, y1: 15 },
                      },
                      {
                        text: "second",
                        confidence: 89,
                        bbox: { x0: 40, y0: 5, x1: 84, y1: 15 },
                      },
                    ],
                  },
                  {
                    text: "third",
                    confidence: 88,
                    bbox: { x0: 4, y0: 20, x1: 34, y1: 30 },
                    words: [
                      {
                        text: "third",
                        confidence: 87,
                        bbox: { x0: 4, y0: 20, x1: 34, y1: 30 },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    tesseractMocks.createWorker.mockResolvedValue(worker);
    const adapter = new LocalTesseractAdapter();

    const result = await adapter.recognise(
      document.createElement("canvas"),
      { ...documentRequest, includeWords: true, includeLines: true },
      vi.fn(),
    );

    expect(result.words).toEqual([
      expect.objectContaining({ text: "first", lineIndex: 0, wordIndex: 0 }),
      expect.objectContaining({ text: "second", lineIndex: 0, wordIndex: 1 }),
      expect.objectContaining({ text: "third", lineIndex: 1, wordIndex: 0 }),
    ]);
    expect(result.lines).toEqual([
      expect.objectContaining({ text: "first second", lineIndex: 0 }),
      expect.objectContaining({ text: "third", lineIndex: 1 }),
    ]);
    expect(worker.recognize).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      {},
      { text: true, blocks: true },
    );
  });

  it("returns explicit empty word and line arrays when requested blocks are absent", async () => {
    const worker = mockWorker();
    tesseractMocks.createWorker.mockResolvedValue(worker);
    const adapter = new LocalTesseractAdapter();

    await expect(
      adapter.recognise(
        document.createElement("canvas"),
        { ...documentRequest, includeWords: true, includeLines: true },
        vi.fn(),
      ),
    ).resolves.toEqual({
      text: "recognised text",
      confidence: 96,
      rotateRadians: 0,
      words: [],
      lines: [],
    });
  });

  it("returns minimal line hierarchy when requested for layout-aware cleanup", async () => {
    const worker = mockWorker();
    worker.recognize.mockResolvedValue({
      data: {
        text: "first\nsecond",
        confidence: 91,
        rotateRadians: 0.01,
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    text: "first",
                    confidence: 89,
                    bbox: { x0: 4, y0: 5, x1: 44, y1: 15 },
                    words: [],
                  },
                  {
                    text: "second",
                    confidence: Number.NaN,
                    bbox: { x0: 4, y0: 20, x1: 54, y1: 30 },
                    words: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    tesseractMocks.createWorker.mockResolvedValue(worker);
    const adapter = new LocalTesseractAdapter();

    await expect(
      adapter.recognise(
        document.createElement("canvas"),
        { ...documentRequest, includeLines: true },
        vi.fn(),
      ),
    ).resolves.toMatchObject({
      lines: [
        {
          text: "first",
          confidence: 89,
          bbox: { x0: 4, y0: 5, x1: 44, y1: 15 },
          blockIndex: 0,
          paragraphIndex: 0,
          lineIndex: 0,
        },
        {
          text: "second",
          confidence: null,
          bbox: { x0: 4, y0: 20, x1: 54, y1: 30 },
          blockIndex: 0,
          paragraphIndex: 0,
          lineIndex: 1,
        },
      ],
    });
    expect(worker.recognize).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      {},
      { text: true, blocks: true },
    );
  });
});
