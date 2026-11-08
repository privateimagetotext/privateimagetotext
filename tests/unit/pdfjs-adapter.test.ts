import { describe, expect, it, vi } from "vitest";

import { PDF_ERROR_MESSAGES, PdfError } from "../../src/features/pdf/errors";
import { PDF_LIMITS } from "../../src/features/pdf/validation";
import {
  PDF_RUNTIME_ROOT,
  PDF_WORKER_PATH,
  PdfJsAdapter,
  type PdfJsAdapterDependencies,
} from "../../src/features/pdf/pdfjs-adapter";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeWorker extends EventTarget {
  terminate = vi.fn();
}

function pdfBlob() {
  return new Blob([new TextEncoder().encode("%PDF-1.7\nsynthetic")], {
    type: "application/pdf",
  });
}

function createCanvas() {
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: "",
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement;
  return { canvas, context };
}

type FakeTextContent = {
  readonly items: readonly unknown[];
  readonly styles: Record<string, never>;
  readonly lang: string | null;
};

function createRuntime(options: {
  pageCount?: number;
  pageLabels?: readonly string[] | null;
  renderDeferred?: ReturnType<typeof deferred<void>>;
  textDeferred?: ReturnType<typeof deferred<FakeTextContent>>;
  textItems?: readonly unknown[];
  textChunks?: readonly FakeTextContent[];
} = {}) {
  const nativeWorker = new FakeWorker();
  const wrapper = {
    promise: Promise.resolve(),
    port: nativeWorker,
    destroy: vi.fn(),
  };
  const renderDeferred = options.renderDeferred;
  const renderTask = {
    promise: renderDeferred?.promise ?? Promise.resolve(),
    cancel: vi.fn(() => renderDeferred?.reject(new Error("RenderingCancelledException"))),
  };
  const textContent: FakeTextContent = {
    items: options.textItems ?? [],
    styles: {},
    lang: null,
  };
  const cancelText = vi.fn();
  const page = {
    rotate: 90,
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: 792 * scale,
      height: 612 * scale,
    })),
    getTextContent: vi.fn(
      () => options.textDeferred?.promise ?? Promise.resolve(textContent),
    ),
    streamTextContent: vi.fn(() => {
      let index = 0;
      return new ReadableStream({
        async pull(controller) {
          const chunks = options.textChunks ?? [textContent];
          if (index >= chunks.length) {
            controller.close();
            return;
          }
          const value = options.textDeferred
            ? await options.textDeferred.promise
            : chunks[index];
          index += 1;
          controller.enqueue(value);
        },
        cancel: cancelText,
      }, { highWaterMark: 0 });
    }),
    render: vi.fn(() => renderTask),
    cleanup: vi.fn(),
  };
  const documentProxy = {
    numPages: options.pageCount ?? 1,
    getPageLabels: vi.fn(async () => options.pageLabels ?? null),
    getPage: vi.fn(async () => page),
    cleanup: vi.fn(async () => undefined),
  };
  const loading = deferred<typeof documentProxy>();
  const loadingTask = {
    promise: loading.promise,
    destroy: vi.fn(async () => undefined),
    onPassword: null as null | ((update: (value: string | Error) => void, reason: number) => void),
  };
  const getDocument = vi.fn((_configuration: Record<string, unknown>) => loadingTask);
  const pdfWorkerCreate = vi.fn(() => wrapper);
  const pdfjs = {
    getDocument,
    PDFWorker: { create: pdfWorkerCreate },
    PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
    AnnotationMode: { DISABLE: 0 },
  };
  const canvas = createCanvas();
  const createWorker = vi.fn(() => nativeWorker as unknown as Worker);
  const dependencies: Partial<PdfJsAdapterDependencies> = {
    loadPdfJs: vi.fn(async () => pdfjs as never),
    createWorker,
    createCanvas: vi.fn(() => canvas.canvas),
    now: vi.fn().mockReturnValueOnce(10).mockReturnValue(25),
    openTimeoutMs: 5_000,
    cleanupTimeoutMs: 20,
  };
  return {
    nativeWorker,
    wrapper,
    page,
    documentProxy,
    loading,
    loadingTask,
    getDocument,
    pdfWorkerCreate,
    renderTask,
    canvas,
    createWorker,
    dependencies,
    pdfjs,
    cancelText,
  };
}

async function openRuntime(runtime: ReturnType<typeof createRuntime>) {
  const adapter = new PdfJsAdapter(runtime.dependencies);
  const opening = adapter.open(pdfBlob());
  await vi.waitFor(() => expect(runtime.getDocument).toHaveBeenCalledOnce());
  runtime.loading.resolve(runtime.documentProxy);
  return { adapter, session: await opening };
}

describe("PdfJsAdapter", () => {
  it("loads PDF.js lazily and passes the reviewed local-only options", async () => {
    const runtime = createRuntime();
    expect(runtime.dependencies.loadPdfJs).not.toHaveBeenCalled();
    const { adapter, session } = await openRuntime(runtime);
    expect(runtime.createWorker).toHaveBeenCalledWith(
      new URL(PDF_WORKER_PATH, window.location.origin),
      { type: "module", name: "localtext-pdfjs" },
    );
    expect(runtime.pdfWorkerCreate).toHaveBeenCalledWith({
      port: runtime.nativeWorker,
    });
    const configuration = runtime.getDocument.mock.calls[0][0];
    expect(configuration).toMatchObject({
      enableXfa: false,
      cMapUrl: new URL(`${PDF_RUNTIME_ROOT}cmaps/`, window.location.origin).href,
      cMapPacked: true,
      standardFontDataUrl: new URL(
        `${PDF_RUNTIME_ROOT}standard_fonts/`,
        window.location.origin,
      ).href,
      iccUrl: new URL(`${PDF_RUNTIME_ROOT}iccs/`, window.location.origin).href,
      wasmUrl: new URL(`${PDF_RUNTIME_ROOT}wasm/`, window.location.origin).href,
      useWorkerFetch: true,
      useWasm: true,
      stopAtErrors: true,
      maxImageSize: 4_096 ** 2,
      canvasMaxAreaInBytes: 4_096 ** 2 * 4,
      disableFontFace: false,
      useSystemFonts: true,
      worker: runtime.wrapper,
    });
    expect(configuration.data).toBeInstanceOf(Uint8Array);
    expect(configuration).not.toHaveProperty("url");
    expect(configuration).not.toHaveProperty("password");
    expect(configuration).not.toHaveProperty("isEvalSupported");
    await session.destroy();
    await adapter.destroy();
  });

  it("sanitises page labels and rejects page-count overflow", async () => {
    const runtime = createRuntime({ pageLabels: ["\u202e  Chapter   A  "] });
    const { adapter, session } = await openRuntime(runtime);
    expect(session.pageLabels).toEqual(["Chapter A"]);
    await session.destroy();
    await adapter.destroy();

    const overflow = createRuntime({ pageCount: 101 });
    const overflowAdapter = new PdfJsAdapter(overflow.dependencies);
    const opening = overflowAdapter.open(pdfBlob());
    await vi.waitFor(() => expect(overflow.getDocument).toHaveBeenCalledOnce());
    overflow.loading.resolve(overflow.documentProxy);
    await expect(opening).rejects.toMatchObject({ code: "PDF_LIMIT_EXCEEDED" });
    expect(overflow.nativeWorker.terminate).toHaveBeenCalledOnce();
  });

  it("owns password required, incorrect, and correct callbacks without retention", async () => {
    const runtime = createRuntime();
    const requests: string[] = [];
    const adapter = new PdfJsAdapter(runtime.dependencies);
    const opening = adapter.open(pdfBlob(), {
      requestPassword: async ({ reason }) => {
        requests.push(reason);
        return reason === "required" ? "wrong-test-secret" : "right-test-secret";
      },
    });
    await vi.waitFor(() => expect(runtime.loadingTask.onPassword).toBeTypeOf("function"));
    const updates: Array<string | Error> = [];
    runtime.loadingTask.onPassword!((value) => updates.push(value), 1);
    await vi.waitFor(() => expect(updates).toHaveLength(1));
    runtime.loadingTask.onPassword!((value) => updates.push(value), 2);
    await vi.waitFor(() => expect(updates).toHaveLength(2));
    runtime.loading.resolve(runtime.documentProxy);
    const session = await opening;
    expect(requests).toEqual(["required", "incorrect"]);
    expect(updates).toEqual(["wrong-test-secret", "right-test-secret"]);
    await session.destroy();
    await adapter.destroy();
  });

  it("cancels password entry and ignores a stale callback after destruction", async () => {
    const runtime = createRuntime();
    const challenge = deferred<string | null>();
    const adapter = new PdfJsAdapter(runtime.dependencies);
    const opening = adapter.open(pdfBlob(), {
      requestPassword: () => challenge.promise,
    });
    await vi.waitFor(() => expect(runtime.loadingTask.onPassword).toBeTypeOf("function"));
    const update = vi.fn((value: string | Error) => {
      if (value instanceof Error) runtime.loading.reject(value);
    });
    runtime.loadingTask.onPassword!(update, 1);
    await adapter.destroy();
    challenge.resolve("late-secret");
    await expect(opening).rejects.toMatchObject({ code: "PDF_DESTROYED" });
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(JSON.stringify(update.mock.calls)).not.toContain("late-secret");
  });

  it("replaces a password-pending document and ignores its late result", async () => {
    const first = createRuntime();
    const second = createRuntime();
    const challenge = deferred<string | null>();
    const loadPdfJs = vi
      .fn()
      .mockResolvedValueOnce(first.pdfjs as never)
      .mockResolvedValueOnce(second.pdfjs as never);
    const createWorker = vi
      .fn()
      .mockReturnValueOnce(first.nativeWorker as unknown as Worker)
      .mockReturnValueOnce(second.nativeWorker as unknown as Worker);
    const adapter = new PdfJsAdapter({
      loadPdfJs,
      createWorker,
      createCanvas: first.dependencies.createCanvas,
      now: first.dependencies.now,
      openTimeoutMs: 5_000,
    });
    const firstOpen = adapter.open(pdfBlob(), {
      requestPassword: () => challenge.promise,
    });
    const firstOutcome = firstOpen.catch((error: unknown) => error);
    await vi.waitFor(() => expect(first.loadingTask.onPassword).toBeTypeOf("function"));
    const firstUpdate = vi.fn((value: string | Error) => {
      if (value instanceof Error) first.loading.reject(value);
    });
    first.loadingTask.onPassword!(firstUpdate, 1);

    const secondOpen = adapter.open(pdfBlob());
    await vi.waitFor(() => expect(second.getDocument).toHaveBeenCalledOnce());
    second.loading.resolve(second.documentProxy);
    const secondSession = await secondOpen;
    await expect(firstOutcome).resolves.toMatchObject({
      code: "PDF_OPERATION_REPLACED",
    });
    challenge.resolve("late-replaced-secret");
    await Promise.resolve();
    expect(firstUpdate).toHaveBeenCalledOnce();
    expect(JSON.stringify(firstUpdate.mock.calls)).not.toContain(
      "late-replaced-secret",
    );
    expect(first.nativeWorker.terminate).toHaveBeenCalledOnce();
    await secondSession.destroy();
    await adapter.destroy();
    expect(second.nativeWorker.terminate).toHaveBeenCalledOnce();
  });

  it("renders with inherent rotation, bounded allocation, disabled annotations, and release", async () => {
    const runtime = createRuntime();
    const { adapter, session } = await openRuntime(runtime);
    const rendered = await session.renderPage(1);
    expect(rendered.rotation).toBe(90);
    expect(rendered.width).toBe(3_300);
    expect(rendered.height).toBe(2_550);
    expect(rendered.estimatedRgbaBytes).toBe(3_300 * 2_550 * 4);
    expect(runtime.page.render).toHaveBeenCalledWith(
      expect.objectContaining({
        canvas: runtime.canvas.canvas,
        background: "rgb(255, 255, 255)",
        annotationMode: 0,
      }),
    );
    expect(runtime.canvas.context.fillRect).toHaveBeenCalledWith(0, 0, 3_300, 2_550);
    rendered.release();
    rendered.release();
    expect(runtime.canvas.canvas.width).toBe(0);
    expect(runtime.canvas.canvas.height).toBe(0);
    await session.destroy();
    await adapter.destroy();
  });

  it("copies only narrow text items and ignores marked or malformed content", async () => {
    const runtime = createRuntime({
      textItems: [
        {
          str: "Unicode \u05e9\u05dc\u05d5\u05dd",
          dir: "rtl",
          transform: [1, 0, 0, 1, 12, 24],
          width: 72,
          height: 12,
          hasEOL: true,
          fontName: "must-not-cross-the-adapter",
        },
        { type: "beginMarkedContent", id: "artifact" },
        { str: 42, width: 10 },
        {
          str: "safe",
          transform: [1, Number.NaN],
          width: Number.POSITIVE_INFINITY,
          height: 9,
        },
      ],
    });
    const { adapter, session } = await openRuntime(runtime);
    const extracted = await session.extractText(1);
    expect(runtime.page.streamTextContent).toHaveBeenCalledWith({
      includeMarkedContent: true,
      disableNormalization: false,
    });
    expect(runtime.page.getTextContent).not.toHaveBeenCalled();
    expect(extracted).toEqual({
      pageNumber: 1,
      items: [
        {
          str: "Unicode \u05e9\u05dc\u05d5\u05dd",
          dir: "rtl",
          transform: [1, 0, 0, 1, 12, 24],
          width: 72,
          height: 12,
          hasEOL: true,
        },
        { str: "safe", height: 9 },
      ],
    });
    expect(JSON.stringify(extracted)).not.toContain("fontName");
    expect(runtime.page.cleanup).toHaveBeenCalledOnce();
    await expect(session.extractText(2)).rejects.toMatchObject({
      code: "PDF_PAGE_OUT_OF_RANGE",
    });
    await session.destroy();
    await adapter.destroy();
  });

  it("cancels a never-settling text stream without waiting for worker text or cancellation acknowledgement", async () => {
    const textDeferred = deferred<FakeTextContent>();
    const runtime = createRuntime({ textDeferred });
    runtime.cancelText.mockImplementation(() => new Promise(() => undefined));
    const { adapter, session } = await openRuntime(runtime);
    const abortController = new AbortController();
    const extracting = session.extractText(1, { signal: abortController.signal });
    await vi.waitFor(() => expect(runtime.page.streamTextContent).toHaveBeenCalledOnce());
    abortController.abort();
    await expect(extracting).rejects.toMatchObject({
      code: "PDF_OPERATION_CANCELLED",
    });
    expect(runtime.page.cleanup).toHaveBeenCalledOnce();
    expect(runtime.cancelText).toHaveBeenCalledOnce();
    expect(runtime.nativeWorker.terminate).not.toHaveBeenCalled();
    await session.destroy();
    await adapter.destroy();
  });

  it("guards every active page operation and maps extraction failures to fixed errors", async () => {
    const textDeferred = deferred<FakeTextContent>();
    const runtime = createRuntime({ textDeferred });
    const { adapter, session } = await openRuntime(runtime);
    const extracting = session.extractText(1);
    await vi.waitFor(() => expect(runtime.page.streamTextContent).toHaveBeenCalledOnce());
    await expect(session.extractText(1)).rejects.toMatchObject({
      code: "PDF_RENDER_IN_PROGRESS",
    });
    await expect(session.renderPage(1)).rejects.toMatchObject({
      code: "PDF_RENDER_IN_PROGRESS",
    });
    textDeferred.reject(new Error("secret filename and extracted page text"));
    let error: PdfError;
    try {
      await extracting;
      throw new Error("Expected text extraction failure");
    } catch (caught) {
      error = caught as PdfError;
    }
    expect(error.code).toBe("PDF_PAGE_TEXT_EXTRACTION_FAILED");
    expect(error.message).toBe(
      PDF_ERROR_MESSAGES.PDF_PAGE_TEXT_EXTRACTION_FAILED,
    );
    expect(JSON.stringify(error)).not.toContain("extracted page text");
    expect(runtime.page.cleanup).toHaveBeenCalledOnce();
    await session.destroy();
    await adapter.destroy();
  });

  it("replaces a document even when its text stream never settles", async () => {
    const textDeferred = deferred<FakeTextContent>();
    const first = createRuntime({ textDeferred });
    const second = createRuntime();
    const adapter = new PdfJsAdapter({
      loadPdfJs: vi
        .fn()
        .mockResolvedValueOnce(first.pdfjs as never)
        .mockResolvedValueOnce(second.pdfjs as never),
      createWorker: vi
        .fn()
        .mockReturnValueOnce(first.nativeWorker as unknown as Worker)
        .mockReturnValueOnce(second.nativeWorker as unknown as Worker),
      createCanvas: first.dependencies.createCanvas,
      now: first.dependencies.now,
      openTimeoutMs: 5_000,
    });
    const firstOpening = adapter.open(pdfBlob());
    await vi.waitFor(() => expect(first.getDocument).toHaveBeenCalledOnce());
    first.loading.resolve(first.documentProxy);
    const firstSession = await firstOpening;
    const extracting = firstSession.extractText(1);
    await vi.waitFor(() => expect(first.page.streamTextContent).toHaveBeenCalledOnce());

    const secondOpening = adapter.open(pdfBlob());
    await expect(extracting).rejects.toMatchObject({
      code: "PDF_OPERATION_REPLACED",
    });
    await vi.waitFor(() => expect(second.getDocument).toHaveBeenCalledOnce());
    second.loading.resolve(second.documentProxy);
    const secondSession = await secondOpening;
    expect(first.page.cleanup).toHaveBeenCalledOnce();
    expect(first.nativeWorker.terminate).toHaveBeenCalledOnce();
    await secondSession.destroy();
    await adapter.destroy();
  });

  it("enforces cumulative character limits while consuming streamed chunks without returning partial text", async () => {
    const runtime = createRuntime({ textChunks: [
      { items: [{ str: "a".repeat(PDF_LIMITS.maxPageTextCharacters) }], styles: {}, lang: null },
      { items: [{ str: "b" }], styles: {}, lang: null },
      { items: [{ str: "unread" }], styles: {}, lang: null },
    ] });
    const { adapter, session } = await openRuntime(runtime);
    await expect(session.extractText(1)).rejects.toMatchObject({ code: "PDF_PAGE_TEXT_LIMIT_EXCEEDED" });
    expect(runtime.cancelText).toHaveBeenCalledOnce();
    expect(runtime.page.getTextContent).not.toHaveBeenCalled();
    expect(runtime.page.cleanup).toHaveBeenCalledOnce();
    await adapter.destroy();
  });

  it("bounds marker and empty-item floods independently of the character limit", async () => {
    const runtime = createRuntime({
      textItems: Array.from({ length: PDF_LIMITS.maxPageTextItems + 1 }, () => ({ str: "" })),
    });
    const { adapter, session } = await openRuntime(runtime);
    await expect(session.extractText(1)).rejects.toMatchObject({ code: "PDF_PAGE_TEXT_LIMIT_EXCEEDED" });
    expect(runtime.cancelText).toHaveBeenCalledOnce();
    await adapter.destroy();
  });

  it("accepts exactly the raw-character limit through multiple chunks", async () => {
    const half = "a".repeat(PDF_LIMITS.maxPageTextCharacters / 2);
    const runtime = createRuntime({ textChunks: [
      { items: [{ str: half }], styles: {}, lang: null },
      { items: [{ str: half }], styles: {}, lang: null },
    ] });
    const { adapter, session } = await openRuntime(runtime);
    const result = await session.extractText(1);
    expect(result.items.map((item) => item.str).join("")).toHaveLength(PDF_LIMITS.maxPageTextCharacters);
    expect(runtime.cancelText).not.toHaveBeenCalled();
    await adapter.destroy();
  });

  it("bounds teardown even when PDF.js destruction never acknowledges", async () => {
    const runtime = createRuntime();
    const { adapter } = await openRuntime(runtime);
    runtime.loadingTask.destroy.mockImplementation(() => new Promise(() => undefined));
    await adapter.destroy();
    expect(runtime.wrapper.destroy).toHaveBeenCalledOnce();
    expect(runtime.nativeWorker.terminate).toHaveBeenCalledOnce();
    await adapter.destroy();
    expect(runtime.nativeWorker.terminate).toHaveBeenCalledOnce();
  });

  it("interrupts a never-settling page lookup on cancellation and disposal", async () => {
    const runtime = createRuntime();
    const { adapter, session } = await openRuntime(runtime);
    runtime.documentProxy.getPage.mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const extracting = session.extractText(1, { signal: controller.signal });
    await vi.waitFor(() => expect(runtime.documentProxy.getPage).toHaveBeenCalledOnce());
    controller.abort();
    await expect(extracting).rejects.toMatchObject({ code: "PDF_OPERATION_CANCELLED" });
    await adapter.destroy();
    expect(runtime.nativeWorker.terminate).toHaveBeenCalledOnce();
  });

  it("times out a stalled text stream with a safe error and destroys the unusable worker", async () => {
    const runtime = createRuntime({ textDeferred: deferred<FakeTextContent>() });
    const adapter = new PdfJsAdapter({ ...runtime.dependencies, pageTaskTimeoutMs: 20 });
    const opening = adapter.open(pdfBlob());
    await vi.waitFor(() => expect(runtime.getDocument).toHaveBeenCalledOnce());
    runtime.loading.resolve(runtime.documentProxy);
    const session = await opening;
    await expect(session.extractText(1)).rejects.toMatchObject({ code: "PDF_PAGE_TEXT_EXTRACTION_FAILED" });
    await adapter.destroy();
    expect(runtime.nativeWorker.terminate).toHaveBeenCalledOnce();
  });

  it("fails safely and releases the worker when it crashes during text extraction", async () => {
    const runtime = createRuntime({ textDeferred: deferred<FakeTextContent>() });
    const { adapter, session } = await openRuntime(runtime);
    const extracting = session.extractText(1);
    await vi.waitFor(() => expect(runtime.page.streamTextContent).toHaveBeenCalledOnce());
    runtime.nativeWorker.dispatchEvent(new Event("error"));
    await expect(extracting).rejects.toMatchObject({ code: "PDF_PAGE_TEXT_EXTRACTION_FAILED" });
    await adapter.destroy();
    expect(runtime.nativeWorker.terminate).toHaveBeenCalledOnce();
  });

  it("can destroy a document while its page-label lookup never settles", async () => {
    const runtime = createRuntime();
    runtime.documentProxy.getPageLabels.mockImplementation(() => new Promise(() => undefined));
    const adapter = new PdfJsAdapter(runtime.dependencies);
    const opening = adapter.open(pdfBlob());
    const outcome = opening.catch((error: unknown) => error);
    await vi.waitFor(() => expect(runtime.getDocument).toHaveBeenCalledOnce());
    runtime.loading.resolve(runtime.documentProxy);
    await vi.waitFor(() => expect(runtime.documentProxy.getPageLabels).toHaveBeenCalledOnce());
    await adapter.destroy();
    await expect(outcome).resolves.toMatchObject({ code: "PDF_DESTROYED" });
    expect(runtime.nativeWorker.terminate).toHaveBeenCalledOnce();
  });

  it("owns and destroys a worker while its startup and document load never settle", async () => {
    const runtime = createRuntime();
    runtime.wrapper.promise = new Promise(() => undefined);
    runtime.loadingTask.destroy.mockImplementation(() => new Promise(() => undefined));
    const adapter = new PdfJsAdapter(runtime.dependencies);
    const opening = adapter.open(pdfBlob());
    const outcome = opening.catch((error: unknown) => error);
    await vi.waitFor(() => expect(runtime.getDocument).toHaveBeenCalledOnce());
    await adapter.destroy();
    await expect(outcome).resolves.toMatchObject({ code: "PDF_DESTROYED" });
    expect(runtime.nativeWorker.terminate).toHaveBeenCalledOnce();
  });

  it("reuses and zeroes a caller-owned canvas without allocating another", async () => {
    const runtime = createRuntime();
    const reusable = createCanvas();
    const { adapter, session } = await openRuntime(runtime);
    const first = await session.renderPage(1, { canvas: reusable.canvas });
    expect(runtime.dependencies.createCanvas).not.toHaveBeenCalled();
    expect(first.canvas).toBe(reusable.canvas);
    first.release();
    expect(reusable.canvas.width).toBe(0);
    expect(reusable.canvas.height).toBe(0);

    const second = await session.renderPage(1, { canvas: reusable.canvas });
    expect(second.canvas).toBe(reusable.canvas);
    expect(runtime.page.render).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ canvas: reusable.canvas }),
    );
    second.release();
    expect(reusable.canvas.width).toBe(0);
    expect(reusable.canvas.height).toBe(0);
    expect(runtime.page.cleanup).toHaveBeenCalledTimes(2);
    await session.destroy();
    await adapter.destroy();
  });

  it("rejects page range and cancels an active render", async () => {
    const renderDeferred = deferred<void>();
    const runtime = createRuntime({ renderDeferred });
    const { adapter, session } = await openRuntime(runtime);
    await expect(session.renderPage(0)).rejects.toMatchObject({
      code: "PDF_PAGE_OUT_OF_RANGE",
    });
    const abortController = new AbortController();
    const rendering = session.renderPage(1, { signal: abortController.signal });
    await vi.waitFor(() => expect(runtime.page.render).toHaveBeenCalledOnce());
    abortController.abort();
    await expect(rendering).rejects.toMatchObject({ code: "PDF_RENDER_CANCELLED" });
    expect(runtime.renderTask.cancel).toHaveBeenCalledOnce();
    expect(runtime.canvas.canvas.width).toBe(0);
    await session.destroy();
    await adapter.destroy();
  });

  it("destroys supplied worker ownership exactly once and exposes only fixed errors", async () => {
    const runtime = createRuntime();
    const { adapter, session } = await openRuntime(runtime);
    await session.destroy();
    await session.destroy();
    await adapter.destroy();
    await adapter.destroy();
    expect(runtime.loadingTask.destroy).toHaveBeenCalledOnce();
    expect(runtime.wrapper.destroy).toHaveBeenCalledOnce();
    expect(runtime.nativeWorker.terminate).toHaveBeenCalledOnce();

    const failed = createRuntime();
    const failedAdapter = new PdfJsAdapter(failed.dependencies);
    const opening = failedAdapter.open(pdfBlob());
    await vi.waitFor(() => expect(failed.getDocument).toHaveBeenCalledOnce());
    failed.loading.reject(new Error("filename secret-password extracted-text"));
    let error: PdfError;
    try {
      await opening;
      throw new Error("Expected PDF open failure");
    } catch (caught) {
      error = caught as PdfError;
    }
    expect(error.code).toBe("PDF_OPEN_FAILED");
    expect(error.message).toBe(PDF_ERROR_MESSAGES.PDF_OPEN_FAILED);
    expect(error).not.toHaveProperty("cause");
    expect(JSON.stringify(error)).not.toContain("secret-password");
  });
});
