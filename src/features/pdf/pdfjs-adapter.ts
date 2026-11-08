import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  PDFWorker,
  RenderTask,
} from "pdfjs-dist";

import { PdfError, isPdfError, type PdfErrorCode } from "./errors";
import type {
  PdfDocumentSession,
  PdfExtractedTextLayer,
  PdfOpenOptions,
  PdfPasswordReason,
  PdfRenderedPage,
  PdfRenderOptions,
  PdfSource,
  PdfTextExtractionOptions,
  PdfTextItem,
} from "./types";
import { PDF_LIMITS, planPdfRender, validatePdfSource } from "./validation";

export const PDFJS_VERSION = "6.2.108" as const;
export const PDF_RUNTIME_ROOT = `/pdf/${PDFJS_VERSION}/` as const;
export const PDF_API_MODULE_PATH = `${PDF_RUNTIME_ROOT}api/pdf.mjs` as const;
export const PDF_WORKER_PATH =
  `${PDF_RUNTIME_ROOT}worker/pdf.worker.min.mjs` as const;

const OPEN_TIMEOUT_MS = 60_000;
const PAGE_TASK_TIMEOUT_MS = 60_000;
const CLEANUP_TIMEOUT_MS = 1_000;
const MAX_IMAGE_PIXELS = 4_096 ** 2;
const MAX_CANVAS_BYTES = PDF_LIMITS.maxRenderedPixels * 4;

type PdfJsModule = typeof import("pdfjs-dist");
type PasswordUpdate = (password: string | Error) => void;

export type PdfJsAdapterDependencies = {
  readonly loadPdfJs: () => Promise<PdfJsModule>;
  readonly createWorker: (url: URL, options: WorkerOptions) => Worker;
  readonly createCanvas: () => HTMLCanvasElement;
  readonly now: () => number;
  readonly openTimeoutMs: number;
  readonly pageTaskTimeoutMs: number;
  readonly cleanupTimeoutMs: number;
};

type PendingPassword = {
  readonly abortController: AbortController;
  reject(): void;
};

type Owner = {
  readonly generation: number;
  readonly pdfjs: PdfJsModule;
  readonly nativeWorker: Worker;
  readonly pdfWorker: PDFWorker;
  loadingTask: PDFDocumentLoadingTask | null;
  document: PDFDocumentProxy | null;
  pageOperationActive: boolean;
  activePageRequest: Promise<PDFPageProxy> | null;
  activePage: PDFPageProxy | null;
  activePageRelease: (() => void) | null;
  activeTextTask: Promise<unknown> | null;
  activeTextReader: ReadableStreamDefaultReader<unknown> | null;
  activeRenderTask: RenderTask | null;
  pendingPassword: PendingPassword | null;
  terminalCode: PdfErrorCode | null;
  sourceBytes: Uint8Array | null;
  readonly canvases: Set<HTMLCanvasElement>;
  cleanupPromise: Promise<void> | null;
  readonly shutdown: AbortController;
};

async function loadSameOriginPdfJs(): Promise<PdfJsModule> {
  return import(/* @vite-ignore */ PDF_API_MODULE_PATH) as Promise<PdfJsModule>;
}

const defaultDependencies: PdfJsAdapterDependencies = {
  loadPdfJs: loadSameOriginPdfJs,
  createWorker: (url, options) => new Worker(url, options),
  createCanvas: () => document.createElement("canvas"),
  now: () => performance.now(),
  openTimeoutMs: OPEN_TIMEOUT_MS,
  pageTaskTimeoutMs: PAGE_TASK_TIMEOUT_MS,
  cleanupTimeoutMs: CLEANUP_TIMEOUT_MS,
};

function normalisePageLabels(
  labels: readonly string[] | null,
  pageCount: number,
): readonly string[] | null {
  if (!labels || labels.length !== pageCount) return null;
  return labels.map((label, index) => {
    const safe = [...label.normalize("NFC")]
      .filter((character) => {
        const code = character.codePointAt(0) ?? 0;
        return !(
          code <= 0x1f ||
          (code >= 0x7f && code <= 0x9f) ||
          code === 0x061c ||
          code === 0x200e ||
          code === 0x200f ||
          (code >= 0x202a && code <= 0x202e) ||
          (code >= 0x2066 && code <= 0x2069)
        );
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    return [...safe].slice(0, 64).join("") || String(index + 1);
  });
}

function zeroCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

function abortError() {
  return new Error("Local PDF operation stopped.");
}

function ensurePageNumber(pageNumber: number, pageCount: number) {
  if (
    !Number.isInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > pageCount
  ) {
    throw new PdfError("PDF_PAGE_OUT_OF_RANGE");
  }
}

function copyTextItem(item: unknown): PdfTextItem | null {
  if (!item || typeof item !== "object" || !("str" in item)) return null;
  const source = item as Record<string, unknown>;
  if (typeof source.str !== "string") return null;

  const copied: {
    str: string;
    dir?: string;
    transform?: readonly number[];
    width?: number;
    height?: number;
    hasEOL?: boolean;
  } = { str: source.str };
  if (typeof source.dir === "string") copied.dir = source.dir;
  if (
    Array.isArray(source.transform) &&
    source.transform.every(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    )
  ) {
    copied.transform = [...source.transform];
  }
  if (typeof source.width === "number" && Number.isFinite(source.width)) {
    copied.width = source.width;
  }
  if (typeof source.height === "number" && Number.isFinite(source.height)) {
    copied.height = source.height;
  }
  if (typeof source.hasEOL === "boolean") copied.hasEOL = source.hasEOL;
  return copied;
}

export class PdfJsAdapter {
  private readonly dependencies: PdfJsAdapterDependencies;
  private generation = 0;
  private destroyed = false;
  private owner: Owner | null = null;
  private session: PdfJsDocumentSession | null = null;
  private destroyPromise: Promise<void> | null = null;

  constructor(dependencies: Partial<PdfJsAdapterDependencies> = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async open(source: PdfSource, options: PdfOpenOptions = {}) {
    if (this.destroyed) throw new PdfError("PDF_DESTROYED");
    const generation = ++this.generation;
    await this.replaceCurrent("PDF_OPERATION_REPLACED");
    this.throwIfStale(generation);

    await validatePdfSource(source);
    if (options.signal?.aborted) throw new PdfError("PDF_RENDER_CANCELLED");
    const sourceBytes =
      source instanceof Uint8Array
        ? source.slice()
        : new Uint8Array(await source.arrayBuffer());
    this.throwIfStale(generation);

    let pdfjs: PdfJsModule;
    try {
      pdfjs = await this.dependencies.loadPdfJs();
    } catch {
      throw new PdfError("PDF_WORKER_FAILED");
    }
    this.throwIfStale(generation);

    const workerUrl = new URL(PDF_WORKER_PATH, window.location.origin);
    if (workerUrl.origin !== window.location.origin) {
      throw new PdfError("PDF_WORKER_FAILED");
    }

    let nativeWorker: Worker | undefined;
    let pdfWorker: PDFWorker | undefined;
    try {
      nativeWorker = this.dependencies.createWorker(workerUrl, {
        type: "module",
        name: "localtext-pdfjs",
      });
      pdfWorker = pdfjs.PDFWorker.create({ port: nativeWorker });
      // getDocument already waits for PDFWorker readiness. Establish ownership
      // first so its open timeout/replacement can also stop a stalled startup.
      if (pdfWorker.port !== nativeWorker) {
        throw new PdfError("PDF_WORKER_FAILED");
      }
    } catch (error) {
      try {
        pdfWorker?.destroy();
      } finally {
        nativeWorker?.terminate();
      }
      if (isPdfError(error)) throw error;
      throw new PdfError("PDF_WORKER_FAILED");
    }

    const owner: Owner = {
      generation,
      pdfjs,
      nativeWorker,
      pdfWorker,
      loadingTask: null,
      document: null,
      pageOperationActive: false,
      activePageRequest: null,
      activePage: null,
      activePageRelease: null,
      activeTextTask: null,
      activeTextReader: null,
      activeRenderTask: null,
      pendingPassword: null,
      terminalCode: null,
      sourceBytes,
      canvases: new Set(),
      cleanupPromise: null,
      shutdown: new AbortController(),
    };
    this.owner = owner;

    try {
      const loadingTask = pdfjs.getDocument({
        data: sourceBytes,
        worker: pdfWorker,
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
        maxImageSize: MAX_IMAGE_PIXELS,
        canvasMaxAreaInBytes: MAX_CANVAS_BYTES,
        disableFontFace: false,
        useSystemFonts: true,
      });
      owner.loadingTask = loadingTask;
      owner.sourceBytes = null;
      this.bindPassword(owner, options);
      const document = await this.awaitDocument(owner, options.signal);
      this.throwIfStale(generation);
      owner.document = document;
      if (
        document.numPages < 1 ||
        document.numPages > PDF_LIMITS.maxDocumentPages
      ) {
        owner.terminalCode = "PDF_LIMIT_EXCEEDED";
        throw new PdfError("PDF_LIMIT_EXCEEDED");
      }
      const labels = normalisePageLabels(
        await this.awaitPageTask(
          owner, document.getPageLabels(), options.signal, "PDF_OPEN_FAILED", "PDF_RENDER_CANCELLED",
        ),
        document.numPages,
      );
      this.throwIfStale(generation);
      const session = new PdfJsDocumentSession(
        this,
        owner,
        document.numPages,
        labels,
      );
      this.session = session;
      return session as PdfDocumentSession;
    } catch (error) {
      const mapped = this.mapOpenError(owner, error);
      await this.cleanupOwner(owner);
      if (this.owner === owner) this.owner = null;
      throw mapped;
    }
  }

  async destroy() {
    if (this.destroyPromise) return this.destroyPromise;
    this.destroyed = true;
    this.generation += 1;
    this.destroyPromise = this.replaceCurrent("PDF_DESTROYED");
    return this.destroyPromise;
  }

  isCurrent(owner: Owner) {
    return (
      !this.destroyed &&
      this.owner === owner &&
      owner.generation === this.generation &&
      owner.cleanupPromise === null
    );
  }

  inactiveError(owner: Owner) {
    return new PdfError(
      this.destroyed || owner.terminalCode === "PDF_DESTROYED"
        ? "PDF_DESTROYED"
        : "PDF_OPERATION_REPLACED",
    );
  }

  createCanvas() {
    return this.dependencies.createCanvas();
  }

  now() {
    return this.dependencies.now();
  }

  /** Do not let a stalled worker keep cancellation or document replacement waiting. */
  async awaitPageTask<T>(
    owner: Owner,
    task: Promise<T>,
    signal: AbortSignal | undefined,
    failureCode: PdfErrorCode,
    cancellationCode: PdfErrorCode = "PDF_OPERATION_CANCELLED",
  ): Promise<T> {
    let timeout = 0;
    let abort: (() => void) | undefined;
    let shutdown: (() => void) | undefined;
    let workerFailed: (() => void) | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(new PdfError(cancellationCode));
      shutdown = () => reject(this.inactiveError(owner));
      workerFailed = () => {
        reject(new PdfError(failureCode));
        void this.releaseSession(owner);
      };
      signal?.addEventListener("abort", abort, { once: true });
      owner.shutdown.signal.addEventListener("abort", shutdown, { once: true });
      owner.nativeWorker.addEventListener("error", workerFailed, { once: true });
      owner.nativeWorker.addEventListener("messageerror", workerFailed, { once: true });
      timeout = window.setTimeout(() => {
        reject(new PdfError(failureCode));
        // A non-responsive worker cannot safely be reused for subsequent pages.
        void this.releaseSession(owner);
      }, this.dependencies.pageTaskTimeoutMs);
      if (signal?.aborted) abort();
      if (owner.shutdown.signal.aborted) shutdown();
    });
    try {
      return await Promise.race([task, interrupted]);
    } finally {
      window.clearTimeout(timeout);
      if (abort) signal?.removeEventListener("abort", abort);
      if (shutdown) owner.shutdown.signal.removeEventListener("abort", shutdown);
      if (workerFailed) {
        owner.nativeWorker.removeEventListener("error", workerFailed);
        owner.nativeWorker.removeEventListener("messageerror", workerFailed);
      }
    }
  }

  async releaseSession(owner: Owner) {
    owner.terminalCode = "PDF_DESTROYED";
    await this.cleanupOwner(owner);
    if (this.owner === owner) this.owner = null;
    if (this.session?.owns(owner)) this.session = null;
  }

  private throwIfStale(generation: number) {
    if (this.destroyed) throw new PdfError("PDF_DESTROYED");
    if (generation !== this.generation) {
      throw new PdfError("PDF_OPERATION_REPLACED");
    }
  }

  private async replaceCurrent(code: PdfErrorCode) {
    const current = this.owner;
    this.session = null;
    if (!current) return;
    current.terminalCode = code;
    await this.cleanupOwner(current);
    if (this.owner === current) this.owner = null;
  }

  private bindPassword(owner: Owner, options: PdfOpenOptions) {
    const task = owner.loadingTask!;
    let attempt = 0;
    task.onPassword = (updatePassword: PasswordUpdate, response: number) => {
      owner.pendingPassword?.reject();
      const reason: PdfPasswordReason | null =
        response === owner.pdfjs.PasswordResponses.NEED_PASSWORD
          ? "required"
          : response === owner.pdfjs.PasswordResponses.INCORRECT_PASSWORD
            ? "incorrect"
            : null;
      if (!reason || !this.isCurrent(owner)) {
        updatePassword(abortError());
        return;
      }
      if (!options.requestPassword) {
        owner.terminalCode =
          reason === "required" ? "PDF_PASSWORD_REQUIRED" : "PDF_PASSWORD_REJECTED";
        updatePassword(abortError());
        return;
      }

      attempt += 1;
      const abortController = new AbortController();
      let settled = false;
      const reject = () => {
        if (settled) return;
        settled = true;
        abortController.abort();
        updatePassword(abortError());
      };
      const pending: PendingPassword = { abortController, reject };
      owner.pendingPassword = pending;

      void options
        .requestPassword({ reason, attempt, signal: abortController.signal })
        .then((candidate) => {
          if (settled || owner.pendingPassword !== pending) return;
          settled = true;
          owner.pendingPassword = null;
          if (!this.isCurrent(owner)) {
            updatePassword(abortError());
            return;
          }
          if (candidate === null || candidate.length === 0) {
            owner.terminalCode = "PDF_PASSWORD_CANCELLED";
            updatePassword(abortError());
            return;
          }
          let password = candidate;
          updatePassword(password);
          password = "";
        })
        .catch(() => {
          if (settled || owner.pendingPassword !== pending) return;
          settled = true;
          owner.pendingPassword = null;
          owner.terminalCode = "PDF_PASSWORD_CANCELLED";
          updatePassword(abortError());
        });
    };
  }

  private async awaitDocument(owner: Owner, signal?: AbortSignal) {
    const task = owner.loadingTask!;
    if (signal?.aborted) {
      owner.terminalCode = "PDF_RENDER_CANCELLED";
      throw new PdfError("PDF_RENDER_CANCELLED");
    }
    let timeout = 0;
    let abortListener: (() => void) | null = null;
    let workerFailureListener: (() => void) | null = null;
    let shutdownListener: (() => void) | null = null;
    const interruption = new Promise<never>((_, reject) => {
      timeout = window.setTimeout(() => {
        owner.terminalCode = "PDF_OPEN_FAILED";
        reject(new PdfError("PDF_OPEN_FAILED"));
      }, this.dependencies.openTimeoutMs);
      shutdownListener = () => reject(this.inactiveError(owner));
      owner.shutdown.signal.addEventListener("abort", shutdownListener, { once: true });
      if (signal) {
        abortListener = () => {
          owner.terminalCode = "PDF_RENDER_CANCELLED";
          reject(new PdfError("PDF_RENDER_CANCELLED"));
        };
        signal.addEventListener("abort", abortListener, { once: true });
      }
      workerFailureListener = () => {
        owner.terminalCode = "PDF_WORKER_FAILED";
        reject(new PdfError("PDF_WORKER_FAILED"));
      };
      owner.nativeWorker.addEventListener("error", workerFailureListener, {
        once: true,
      });
      owner.nativeWorker.addEventListener("messageerror", workerFailureListener, {
        once: true,
      });
    });
    try {
      return await Promise.race([task.promise, interruption]);
    } finally {
      window.clearTimeout(timeout);
      if (signal && abortListener) signal.removeEventListener("abort", abortListener);
      if (shutdownListener) owner.shutdown.signal.removeEventListener("abort", shutdownListener);
      if (workerFailureListener) {
        owner.nativeWorker.removeEventListener("error", workerFailureListener);
        owner.nativeWorker.removeEventListener("messageerror", workerFailureListener);
      }
    }
  }

  private mapOpenError(owner: Owner, error: unknown) {
    if (isPdfError(error)) return error;
    if (owner.terminalCode) return new PdfError(owner.terminalCode);
    if (this.destroyed) return new PdfError("PDF_DESTROYED");
    if (owner.generation !== this.generation) {
      return new PdfError("PDF_OPERATION_REPLACED");
    }
    return new PdfError("PDF_OPEN_FAILED");
  }

  private cleanupOwner(owner: Owner) {
    if (owner.cleanupPromise) return owner.cleanupPromise;
    owner.cleanupPromise = (async () => {
      owner.shutdown.abort();
      owner.pendingPassword?.reject();
      owner.pendingPassword = null;
      owner.activePageRequest = null;
      const renderTask = owner.activeRenderTask;
      owner.activeRenderTask = null;
      renderTask?.cancel();
      void owner.activeTextReader?.cancel(abortError()).catch(() => undefined);
      owner.activeTextReader = null;
      owner.activeTextTask = null;
      owner.activePageRelease?.();
      owner.activePageRelease = null;
      owner.activePage = null;
      owner.pageOperationActive = false;
      let timeout = 0;
      try {
        // PDF.js destruction cancels its page resources. It normally completes
        // promptly, but its worker handshake must never prevent native teardown.
        await Promise.race([
          Promise.resolve().then(() => owner.loadingTask?.destroy()).catch(() => undefined),
          new Promise<void>((resolve) => {
            timeout = window.setTimeout(resolve, this.dependencies.cleanupTimeoutMs);
          }),
        ]);
      } finally {
        window.clearTimeout(timeout);
        owner.loadingTask = null;
        owner.document = null;
        try {
          owner.pdfWorker.destroy();
        } finally {
          owner.nativeWorker.terminate();
        }
        for (const canvas of owner.canvases) zeroCanvas(canvas);
        owner.canvases.clear();
        owner.sourceBytes = null;
      }
    })();
    return owner.cleanupPromise;
  }
}

class PdfJsDocumentSession implements PdfDocumentSession {
  private destroyPromise: Promise<void> | null = null;

  constructor(
    private readonly adapter: PdfJsAdapter,
    private readonly owner: Owner,
    readonly pageCount: number,
    readonly pageLabels: readonly string[] | null,
  ) {}

  owns(owner: Owner) {
    return this.owner === owner;
  }

  async extractText(
    pageNumber: number,
    options: PdfTextExtractionOptions = {},
  ): Promise<PdfExtractedTextLayer> {
    if (!this.adapter.isCurrent(this.owner)) {
      throw this.adapter.inactiveError(this.owner);
    }
    if (this.owner.pageOperationActive) {
      throw new PdfError("PDF_RENDER_IN_PROGRESS");
    }
    ensurePageNumber(pageNumber, this.pageCount);
    if (options.signal?.aborted) throw new PdfError("PDF_OPERATION_CANCELLED");

    this.owner.pageOperationActive = true;
    let page: PDFPageProxy | null = null;
    let pageRequest: Promise<PDFPageProxy> | null = null;
    let textTask: Promise<ReadableStreamReadResult<unknown>> | null = null;
    let reader: ReadableStreamDefaultReader<unknown> | null = null;
    let textFinished = false;
    let releasePage: (() => void) | null = null;
    try {
      pageRequest = this.owner.document!.getPage(pageNumber);
      this.owner.activePageRequest = pageRequest;
      page = await this.adapter.awaitPageTask(
        this.owner, pageRequest, options.signal, "PDF_PAGE_TEXT_EXTRACTION_FAILED",
      );
      if (this.owner.activePageRequest === pageRequest) {
        this.owner.activePageRequest = null;
      }

      const currentPage = page;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        if (this.owner.activePage === currentPage) {
          this.owner.activePage = null;
        }
        if (this.owner.activePageRelease === release) {
          this.owner.activePageRelease = null;
        }
        currentPage.cleanup();
      };
      releasePage = release;
      this.owner.activePage = currentPage;
      this.owner.activePageRelease = release;

      if (!this.adapter.isCurrent(this.owner)) {
        throw this.adapter.inactiveError(this.owner);
      }
      if (options.signal?.aborted) throw new PdfError("PDF_OPERATION_CANCELLED");

      reader = (currentPage.streamTextContent({
        includeMarkedContent: true,
        disableNormalization: false,
      }) as ReadableStream<unknown>).getReader();
      this.owner.activeTextReader = reader;
      const items: PdfTextItem[] = [];
      let itemCount = 0;
      let characterCount = 0;
      while (true) {
        textTask = reader.read();
        this.owner.activeTextTask = textTask;
        const chunk = await this.adapter.awaitPageTask(
          this.owner, textTask, options.signal, "PDF_PAGE_TEXT_EXTRACTION_FAILED",
        );
        if (options.signal?.aborted) throw new PdfError("PDF_OPERATION_CANCELLED");
        if (!this.adapter.isCurrent(this.owner)) throw this.adapter.inactiveError(this.owner);
        if (chunk.done) {
          textFinished = true;
          break;
        }
        const value = chunk.value;
        if (!value || typeof value !== "object" || !("items" in value) || !Array.isArray(value.items)) {
          throw new PdfError("PDF_PAGE_TEXT_EXTRACTION_FAILED");
        }
        itemCount += value.items.length;
        if (itemCount > PDF_LIMITS.maxPageTextItems) {
          throw new PdfError("PDF_PAGE_TEXT_LIMIT_EXCEEDED");
        }
        for (const item of value.items) {
          if (item && typeof item === "object" && "str" in item && typeof item.str === "string") {
            characterCount += item.str.length;
            if (characterCount > PDF_LIMITS.maxPageTextCharacters) {
              throw new PdfError("PDF_PAGE_TEXT_LIMIT_EXCEEDED");
            }
          }
          const copied = copyTextItem(item);
          if (copied) items.push(copied);
        }
      }
      return { pageNumber, items };
    } catch (error) {
      if (isPdfError(error)) throw error;
      if (options.signal?.aborted) throw new PdfError("PDF_OPERATION_CANCELLED");
      if (!this.adapter.isCurrent(this.owner)) {
        throw this.adapter.inactiveError(this.owner);
      }
      throw new PdfError("PDF_PAGE_TEXT_EXTRACTION_FAILED");
    } finally {
      if (this.owner.activePageRequest === pageRequest) {
        this.owner.activePageRequest = null;
      }
      if (this.owner.activeTextTask === textTask) {
        this.owner.activeTextTask = null;
      }
      if (reader) {
        if (!textFinished) void reader.cancel(abortError()).catch(() => undefined);
        reader.releaseLock();
      }
      if (this.owner.activeTextReader === reader) this.owner.activeTextReader = null;
      releasePage?.();
      this.owner.pageOperationActive = false;
    }
  }

  async renderPage(
    pageNumber: number,
    options: PdfRenderOptions = {},
  ): Promise<PdfRenderedPage> {
    if (!this.adapter.isCurrent(this.owner)) {
      throw this.adapter.inactiveError(this.owner);
    }
    if (this.owner.pageOperationActive) {
      throw new PdfError("PDF_RENDER_IN_PROGRESS");
    }
    ensurePageNumber(pageNumber, this.pageCount);
    if (options.signal?.aborted) throw new PdfError("PDF_RENDER_CANCELLED");
    if (options.canvas && this.owner.canvases.has(options.canvas)) {
      throw new PdfError("PDF_RENDER_IN_PROGRESS");
    }

    this.owner.pageOperationActive = true;
    let page: PDFPageProxy | null = null;
    let pageRequest: Promise<PDFPageProxy> | null = null;
    let releasePage: (() => void) | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let abortListener: (() => void) | null = null;
    try {
      pageRequest = this.owner.document!.getPage(pageNumber);
      this.owner.activePageRequest = pageRequest;
      page = await this.adapter.awaitPageTask(
        this.owner, pageRequest, options.signal, "PDF_PAGE_RENDER_FAILED", "PDF_RENDER_CANCELLED",
      );
      if (this.owner.activePageRequest === pageRequest) {
        this.owner.activePageRequest = null;
      }
      const currentPage = page;
      let pageReleased = false;
      const release = () => {
        if (pageReleased) return;
        pageReleased = true;
        if (this.owner.activePage === currentPage) {
          this.owner.activePage = null;
        }
        if (this.owner.activePageRelease === release) {
          this.owner.activePageRelease = null;
        }
        currentPage.cleanup();
      };
      releasePage = release;
      this.owner.activePage = currentPage;
      this.owner.activePageRelease = release;
      if (options.signal?.aborted) {
        throw new PdfError("PDF_RENDER_CANCELLED");
      }
      if (!this.adapter.isCurrent(this.owner)) {
        throw this.adapter.inactiveError(this.owner);
      }
      const unscaled = page.getViewport({ scale: 1 });
      const rotation = page.rotate;
      const plan = planPdfRender(
        unscaled.width,
        unscaled.height,
        options.targetDpi,
      );
      if (options.signal?.aborted) {
        throw new PdfError("PDF_RENDER_CANCELLED");
      }
      const viewport = page.getViewport({ scale: plan.scale });
      canvas = options.canvas ?? this.adapter.createCanvas();
      canvas.width = plan.width;
      canvas.height = plan.height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new PdfError("PDF_PAGE_RENDER_FAILED");
      context.save();
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.restore();
      this.owner.canvases.add(canvas);

      const started = this.adapter.now();
      const task = page.render({
        canvas,
        viewport,
        background: "rgb(255, 255, 255)",
        annotationMode: this.owner.pdfjs.AnnotationMode.DISABLE,
      });
      this.owner.activeRenderTask = task;
      if (options.signal) {
        abortListener = () => task.cancel();
        options.signal.addEventListener("abort", abortListener, { once: true });
      }
      await this.adapter.awaitPageTask(
        this.owner, task.promise, options.signal, "PDF_PAGE_RENDER_FAILED", "PDF_RENDER_CANCELLED",
      );
      if (!this.adapter.isCurrent(this.owner)) {
        throw this.adapter.inactiveError(this.owner);
      }
      const renderDurationMs = this.adapter.now() - started;
      this.owner.activeRenderTask = null;
      releasePage();
      releasePage = null;
      page = null;
      const releasedCanvas = canvas;
      let released = false;
      return {
        pageNumber,
        originalWidth: unscaled.width,
        originalHeight: unscaled.height,
        rotation,
        requestedScale: plan.requestedScale,
        scale: plan.scale,
        effectiveDpi: plan.effectiveDpi,
        width: plan.width,
        height: plan.height,
        estimatedRgbaBytes: plan.width * plan.height * 4,
        downscaled: plan.downscaled,
        renderDurationMs,
        canvas: releasedCanvas,
        release: () => {
          if (released) return;
          released = true;
          this.owner.canvases.delete(releasedCanvas);
          zeroCanvas(releasedCanvas);
        },
      };
    } catch (error) {
      if (canvas) {
        this.owner.canvases.delete(canvas);
        zeroCanvas(canvas);
      }
      if (isPdfError(error)) throw error;
      if (options.signal?.aborted) throw new PdfError("PDF_RENDER_CANCELLED");
      if (!this.adapter.isCurrent(this.owner)) {
        throw this.adapter.inactiveError(this.owner);
      }
      throw new PdfError("PDF_PAGE_RENDER_FAILED");
    } finally {
      if (options.signal && abortListener) {
        options.signal.removeEventListener("abort", abortListener);
      }
      this.owner.activeRenderTask = null;
      if (this.owner.activePageRequest === pageRequest) {
        this.owner.activePageRequest = null;
      }
      releasePage?.();
      this.owner.pageOperationActive = false;
    }
  }

  cancelRender() {
    this.owner.activeRenderTask?.cancel();
  }

  destroy() {
    if (this.destroyPromise) return this.destroyPromise;
    this.destroyPromise = this.adapter.releaseSession(this.owner);
    return this.destroyPromise;
  }
}
