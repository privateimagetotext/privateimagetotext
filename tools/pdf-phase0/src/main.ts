import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  PDFWorker,
  RenderTask,
} from "pdfjs-dist";

import { LocalTesseractAdapter } from "../../../src/features/ocr/tesseract-adapter";
import { PdfError } from "../../../src/features/pdf/errors";
import {
  PdfExtractionSession,
} from "../../../src/features/pdf/extraction-session";
import type { PdfOcrAdapter } from "../../../src/features/pdf/extraction-runner";
import type {
  PdfDocumentSession,
  PdfPageResult,
} from "../../../src/features/pdf/types";
import {
  PDF_RUNTIME_ROOT,
  PDF_WORKER_PATH,
  PdfJsAdapter,
} from "../../../src/features/pdf/pdfjs-adapter";
import { clearCanvas } from "../../../src/features/image-editor/image";
import {
  applyPreparationToCanvas,
  thresholdingMethodForPreset,
} from "../../../src/features/image-editor/preparation";
import "./style.css";

const MAX_CANVAS_SIDE = 4_096;
const MAX_CANVAS_PIXELS = MAX_CANVAS_SIDE * MAX_CANVAS_SIDE;
const MAX_CANVAS_BYTES = MAX_CANVAS_PIXELS * 4;
const TARGET_DPI = 300;

type PdfJsModule = typeof import("pdfjs-dist");
type Scenario =
  | "selectable"
  | "scanned"
  | "mixed"
  | "font"
  | "rotated"
  | "render-cancel"
  | "cleanup"
  | "benchmark"
  | "password"
  | "adapter-password"
  | "adapter-render-cancel"
  | "decoder"
  | "phase1b-automatic"
  | "phase1b-embedded-only"
  | "phase1b-ocr-all"
  | "phase1b-page-range"
  | "phase1b-ocr-limit"
  | "phase1b-force-ocr"
  | "phase1b-cancel-after-one"
  | "phase1b-benchmark";

type JsonRecord = Record<string, unknown>;

type WorkerEvidence = {
  constructed: number;
  terminated: number;
  active: number;
  urls: string[];
  moduleWorkers: number;
};

declare global {
  interface Window {
    __PDF_PHASE0__: {
      lastResult: JsonRecord | null;
      lastError: string | null;
      workerEvidence: WorkerEvidence;
      pdfCacheFailure: JsonRecord | null;
      checkPdfCache(): Promise<boolean>;
      preparePdfCache(): Promise<boolean>;
      runDecoderBytes(bytes: readonly number[]): Promise<JsonRecord>;
      stageDecoderBytes(files: readonly (readonly number[])[]): void;
      runStagedDecoder(index: number): Promise<JsonRecord>;
      clearStagedDecoderBytes(): void;
    };
  }
}

const fileInput = requiredElement<HTMLInputElement>("pdf-file");
const scenarioInput = requiredElement<HTMLSelectElement>("scenario");
const cancelAfterOneInput = requiredElement<HTMLInputElement>("cancel-after-one");
const runButton = requiredElement<HTMLButtonElement>("run");
const passwordPanel = requiredElement<HTMLElement>("password-panel");
const passwordInput = requiredElement<HTMLInputElement>("password");
const passwordReason = requiredElement<HTMLOutputElement>("password-reason");
const submitPasswordButton = requiredElement<HTMLButtonElement>("submit-password");
const cancelPasswordButton = requiredElement<HTMLButtonElement>("cancel-password");
const statusOutput = requiredElement<HTMLOutputElement>("status");
const resultOutput = requiredElement<HTMLPreElement>("result");
const canvas = requiredElement<HTMLCanvasElement>("page-canvas");

const workerEvidence: WorkerEvidence = {
  constructed: 0,
  terminated: 0,
  active: 0,
  urls: [],
  moduleWorkers: 0,
};
let stagedDecoderBytes: Uint8Array[] = [];

window.__PDF_PHASE0__ = {
  lastResult: null,
  lastError: null,
  workerEvidence,
  pdfCacheFailure: null,
  checkPdfCache: () => checkPdfCache(),
  preparePdfCache: () => preparePdfCache(),
  runDecoderBytes: (bytes) =>
    runDecoder(new Uint8Array(bytes)),
  stageDecoderBytes: (files) => {
    stagedDecoderBytes = files.map((bytes) => new Uint8Array(bytes));
  },
  runStagedDecoder: (index) => {
    const bytes = stagedDecoderBytes[index];
    if (!bytes) return Promise.reject(new Error("Staged decoder fixture unavailable."));
    return runDecoder(bytes);
  },
  clearStagedDecoderBytes: () => {
    stagedDecoderBytes = [];
  },
};

async function requestPdfCache(type: "CHECK_PDF_CACHE" | "PREPARE_PDF_CACHE") {
  const registration = await navigator.serviceWorker.ready;
  const target = navigator.serviceWorker.controller ?? registration.active;
  if (!target) return false;
  const requestId = `phase1a-${crypto.randomUUID()}`;
  return new Promise<boolean>((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.data?.requestId !== requestId) return;
      if (event.data?.type === "PDF_CACHE_STATUS") {
        navigator.serviceWorker.removeEventListener("message", listener);
        resolve(event.data.ready === true);
      } else if (event.data?.type === "PDF_CACHE_FAILED") {
        navigator.serviceWorker.removeEventListener("message", listener);
        window.__PDF_PHASE0__.pdfCacheFailure = {
          failureCode: event.data.failureCode,
          assetPath: event.data.assetPath,
          details: event.data.details,
        };
        resolve(false);
      }
    };
    navigator.serviceWorker.addEventListener("message", listener);
    target.postMessage({ type, requestId });
  });
}

function checkPdfCache() {
  return requestPdfCache("CHECK_PDF_CACHE");
}

function preparePdfCache() {
  return requestPdfCache("PREPARE_PDF_CACHE");
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing harness element: ${id}`);
  return element as T;
}

function setStatus(message: string) {
  statusOutput.value = message;
}

function publishResult(result: JsonRecord) {
  window.__PDF_PHASE0__.lastResult = result;
  window.__PDF_PHASE0__.lastError = null;
  resultOutput.textContent = JSON.stringify(result, null, 2);
  setStatus("Complete");
}

function publishError(error: unknown) {
  const message = error instanceof Error ? error.message : "Experiment failed";
  window.__PDF_PHASE0__.lastError = message;
  window.__PDF_PHASE0__.lastResult = null;
  resultOutput.textContent = JSON.stringify({ error: message }, null, 2);
  setStatus("Failed");
}

function normaliseText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function median(values: readonly number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

async function loadPdfJs() {
  return import("pdfjs-dist");
}

class PdfSession {
  readonly loadingTask: PDFDocumentLoadingTask;
  readonly pdfWorker: PDFWorker;
  readonly nativeWorker: Worker;
  readonly pdfjs: PdfJsModule;
  document: PDFDocumentProxy | null = null;
  page: PDFPageProxy | null = null;
  renderTask: RenderTask | null = null;
  private destroyed = false;

  private constructor(
    pdfjs: PdfJsModule,
    loadingTask: PDFDocumentLoadingTask,
    pdfWorker: PDFWorker,
    nativeWorker: Worker,
  ) {
    this.pdfjs = pdfjs;
    this.loadingTask = loadingTask;
    this.pdfWorker = pdfWorker;
    this.nativeWorker = nativeWorker;
  }

  static async start(bytes: Uint8Array, disableFontFace = false) {
    const pdfjs = await loadPdfJs();
    const workerUrl = new URL(PDF_WORKER_PATH, window.location.origin);
    if (workerUrl.origin !== window.location.origin) {
      throw new Error("PDF worker URL was not same-origin.");
    }
    const nativeWorker = new Worker(workerUrl, {
      type: "module",
      name: "pdfjs-phase0",
    });
    workerEvidence.constructed += 1;
    workerEvidence.active += 1;
    workerEvidence.moduleWorkers += 1;
    workerEvidence.urls.push(workerUrl.href);

    let pdfWorker: PDFWorker | null = null;
    try {
      pdfWorker = pdfjs.PDFWorker.create({ port: nativeWorker });
      await pdfWorker.promise;
      if (pdfWorker.port !== nativeWorker) {
        throw new Error("PDF.js did not retain the supplied dedicated worker.");
      }
      const loadingTask = pdfjs.getDocument({
        data: bytes,
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
        maxImageSize: MAX_CANVAS_PIXELS,
        canvasMaxAreaInBytes: MAX_CANVAS_BYTES,
        disableFontFace,
        useSystemFonts: !disableFontFace,
      });
      return new PdfSession(pdfjs, loadingTask, pdfWorker, nativeWorker);
    } catch (error) {
      pdfWorker?.destroy();
      nativeWorker.terminate();
      workerEvidence.terminated += 1;
      workerEvidence.active -= 1;
      throw error;
    }
  }

  async open() {
    this.document = await this.loadingTask.promise;
    return this.document;
  }

  async getPage(pageNumber: number) {
    this.page?.cleanup();
    this.page = await this.documentOrThrow().getPage(pageNumber);
    return this.page;
  }

  documentOrThrow() {
    if (!this.document) throw new Error("PDF document is not open.");
    return this.document;
  }

  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderTask?.cancel();
    if (this.renderTask) await this.renderTask.promise.catch(() => undefined);
    this.renderTask = null;
    this.page?.cleanup();
    this.page = null;
    if (this.document) {
      await this.document.cleanup().catch(() => undefined);
      await this.loadingTask.destroy().catch(() => undefined);
      this.document = null;
    } else {
      await this.loadingTask.destroy().catch(() => undefined);
    }
    this.pdfWorker.destroy();
    this.nativeWorker.terminate();
    workerEvidence.terminated += 1;
    workerEvidence.active -= 1;
  }
}

function selectedFile() {
  const file = fileInput.files?.[0];
  if (!file) throw new Error("Select a synthetic PDF fixture first.");
  return file;
}

async function selectedBytes() {
  return new Uint8Array(await selectedFile().arrayBuffer());
}

function createProductionAdapter() {
  return new PdfJsAdapter({
    createWorker: (url, options) => {
      const worker = new Worker(url, options);
      workerEvidence.constructed += 1;
      workerEvidence.active += 1;
      workerEvidence.moduleWorkers += options.type === "module" ? 1 : 0;
      workerEvidence.urls.push(url.href);
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        workerEvidence.terminated += 1;
        workerEvidence.active -= 1;
        terminate();
      };
      return worker;
    },
  });
}

type Phase1bInstrumentation = {
  textExtractions: number;
  renders: number;
  ocrAdapters: number;
  ocrRecognitions: number;
  ocrCancellations: number;
  ocrDisposals: number;
};

function instrumentDocumentSession(
  session: PdfDocumentSession,
  evidence: Phase1bInstrumentation,
): PdfDocumentSession {
  return {
    pageCount: session.pageCount,
    pageLabels: session.pageLabels,
    extractText: (pageNumber, options) => {
      evidence.textExtractions += 1;
      return session.extractText(pageNumber, options);
    },
    renderPage: (pageNumber, options) => {
      evidence.renders += 1;
      return session.renderPage(pageNumber, options);
    },
    cancelRender: () => session.cancelRender(),
    destroy: () => session.destroy(),
  };
}

function createInstrumentedOcrAdapter(
  evidence: Phase1bInstrumentation,
): PdfOcrAdapter {
  evidence.ocrAdapters += 1;
  const adapter = new LocalTesseractAdapter();
  return {
    recognise: (recognitionCanvas, request, onProgress) => {
      evidence.ocrRecognitions += 1;
      return adapter.recognise(recognitionCanvas, request, onProgress);
    },
    cancel: async () => {
      evidence.ocrCancellations += 1;
      await adapter.cancel();
    },
    dispose: async () => {
      evidence.ocrDisposals += 1;
      await adapter.dispose();
    },
  };
}

function phase1bErrorCode(error: unknown) {
  return error instanceof PdfError ? error.code : "unknown";
}

function allDocumentPages(document: PdfDocumentSession) {
  return Array.from({ length: document.pageCount }, (_, index) => index + 1);
}

function canvasIsZeroed(canvas: HTMLCanvasElement | null) {
  return canvas === null || (canvas.width === 0 && canvas.height === 0);
}

async function runPhase1b(
  file: File,
  scenario: Scenario,
  cancelAfterOne = false,
): Promise<JsonRecord> {
  const workerBaseline = workerEvidence.active;
  const evidence: Phase1bInstrumentation = {
    textExtractions: 0,
    renders: 0,
    ocrAdapters: 0,
    ocrRecognitions: 0,
    ocrCancellations: 0,
    ocrDisposals: 0,
  };
  const adapter = createProductionAdapter();
  let extraction: PdfExtractionSession | null = null;
  let ownedCanvas: HTMLCanvasElement | null = null;
  let scenarioResult: unknown = null;
  try {
    const openedDocument = await adapter.open(file);
    const document = instrumentDocumentSession(openedDocument, evidence);
    extraction = new PdfExtractionSession(document, {
      createCanvas: () => {
        ownedCanvas = window.document.createElement("canvas");
        return ownedCanvas;
      },
      createOcrAdapter: () => createInstrumentedOcrAdapter(evidence),
    });
    const selectedPages = allDocumentPages(document);

    if (scenario === "phase1b-automatic") {
      scenarioResult = await extraction.run({
        documentId: "phase1b-document",
        operationId: "phase1b-automatic",
        selectedPages,
      });
    } else if (scenario === "phase1b-embedded-only") {
      scenarioResult = await extraction.run({
        documentId: "phase1b-document",
        operationId: "phase1b-embedded-only",
        selectedPages,
        settings: { mode: "embedded-text-only" },
      });
    } else if (scenario === "phase1b-ocr-all") {
      scenarioResult = await extraction.run({
        documentId: "phase1b-document",
        operationId: "phase1b-ocr-all",
        selectedPages,
        settings: { mode: "ocr-all" },
      });
    } else if (scenario === "phase1b-page-range") {
      scenarioResult = await extraction.run({
        documentId: "phase1b-document",
        operationId: "phase1b-page-range",
        selectedPages: [2],
      });
    } else if (scenario === "phase1b-ocr-limit") {
      let automaticCode = "none";
      try {
        await extraction.run({
          documentId: "phase1b-document",
          operationId: "phase1b-automatic-limit",
          selectedPages,
        });
      } catch (error) {
        automaticCode = phase1bErrorCode(error);
      }
      const afterAutomatic = { ...evidence };
      let ocrAllCode = "none";
      try {
        await extraction.run({
          documentId: "phase1b-document",
          operationId: "phase1b-ocr-all-limit",
          selectedPages,
          settings: { mode: "ocr-all" },
        });
      } catch (error) {
        ocrAllCode = phase1bErrorCode(error);
      }
      scenarioResult = {
        automaticCode,
        ocrAllCode,
        afterAutomatic,
      };
    } else if (scenario === "phase1b-force-ocr") {
      const initial = await extraction.run({
        documentId: "phase1b-document",
        operationId: "phase1b-force-initial",
        selectedPages,
      });
      const unaffectedBefore = initial.pages.find((page) => page.pageNumber === 2) ?? null;
      const forced = await extraction.processPage({
        documentId: "phase1b-document",
        operationId: "phase1b-force-page",
        pageNumber: 1,
        method: "ocr",
      });
      const unaffectedAfter = initial.pages.find((page) => page.pageNumber === 2) ?? null;
      scenarioResult = {
        initial,
        forced,
        unrelatedPageUnchanged:
          JSON.stringify(unaffectedBefore) === JSON.stringify(unaffectedAfter),
      };
    } else if (scenario === "phase1b-cancel-after-one") {
      const completedBeforeCancellation: PdfPageResult[] = [];
      scenarioResult = await extraction.run({
        documentId: "phase1b-document",
        operationId: "phase1b-cancel-after-one",
        selectedPages,
        settings: { mode: "embedded-text-only" },
        onPageResult: (result) => {
          completedBeforeCancellation.push(result);
          if (completedBeforeCancellation.length === 1) void extraction?.cancel();
        },
      });
    } else if (scenario === "phase1b-benchmark") {
      const started = performance.now();
      let preflightStarted: number | null = null;
      let preflightFinished: number | null = null;
      let ocrLoadingStarted: number | null = null;
      let firstRecognitionStarted: number | null = null;
      let completedPages = 0;
      const result = await extraction.run({
        documentId: "phase1b-benchmark-document",
        operationId: "phase1b-benchmark-operation",
        selectedPages,
        onProgress: (progress) => {
          const now = performance.now();
          if (progress.phase === "preflight") {
            preflightStarted ??= now;
          } else if (preflightStarted !== null) {
            preflightFinished ??= now;
          }
          if (progress.phase === "loading-ocr") ocrLoadingStarted ??= now;
          if (progress.phase === "recognising") firstRecognitionStarted ??= now;
        },
        onPageResult: () => {
          completedPages += 1;
          if (cancelAfterOne && completedPages === 1) void extraction?.cancel();
        },
      });
      const finished = performance.now();
      const completed = result.pages.filter((page) => page.status === "complete");
      const durations = completed.map((page) => page.elapsedMs);
      const sentinelCount = completed.filter((page) =>
        page.edited.includes("SENTINEL"),
      ).length;
      scenarioResult = {
        result,
        benchmark: {
          requestedPages: selectedPages.length,
          processedPages: completed.length,
          cancelled: result.outcome === "cancelled",
          preflightMs:
            (preflightFinished ?? finished) - (preflightStarted ?? started),
          ocrWorkerColdLoadMs:
            ocrLoadingStarted !== null && firstRecognitionStarted !== null
              ? firstRecognitionStarted - ocrLoadingStarted
              : null,
          totalMs: finished - started,
          perPageMedianMs: median(durations),
          warmPageMedianMs: median(durations.slice(1)),
          embeddedTextPageCount: result.embeddedTextPageCount,
          ocrPageCount: result.ocrPageCount,
          sentinelRate:
            completed.length === 0 ? 0 : sentinelCount / completed.length,
          peakCanvasBytes: completed.reduce(
            (peak, page) =>
              Math.max(
                peak,
                page.render ? page.render.width * page.render.height * 4 : 0,
              ),
            0,
          ),
          pageElapsedMs: durations,
        },
      };
    } else {
      throw new Error(`Unsupported Phase 1B scenario: ${scenario}`);
    }
  } finally {
    await extraction?.dispose();
    await adapter.destroy();
  }

  return {
    scenario,
    result: scenarioResult,
    instrumentation: evidence,
    workerBaseline,
    workerActiveAfter: workerEvidence.active,
    workerReleased: workerEvidence.active === workerBaseline,
    canvasZeroed: canvasIsZeroed(ownedCanvas),
  };
}

async function textEvidence(page: PDFPageProxy) {
  const content = await page.getTextContent();
  const items = content.items.filter(
    (item): item is Extract<(typeof content.items)[number], { str: string }> =>
      "str" in item,
  );
  let plainText = "";
  for (const item of items) {
    plainText += item.str;
    plainText += item.hasEOL ? "\n" : " ";
  }
  return {
    plainText: normaliseText(plainText),
    itemCount: items.length,
    hasLineEnding: items.some((item) => item.hasEOL),
    firstTransform: items[0]?.transform ?? null,
  };
}

function boundedViewport(page: PDFPageProxy, targetDpi = TARGET_DPI) {
  const unscaled = page.getViewport({ scale: 1 });
  const requestedScale = targetDpi / 72;
  const requestedWidth = unscaled.width * requestedScale;
  const requestedHeight = unscaled.height * requestedScale;
  const bound = Math.min(
    1,
    MAX_CANVAS_SIDE / requestedWidth,
    MAX_CANVAS_SIDE / requestedHeight,
    Math.sqrt(MAX_CANVAS_PIXELS / (requestedWidth * requestedHeight)),
  );
  const scale = requestedScale * bound;
  return { viewport: page.getViewport({ scale }), scale, requestedScale };
}

async function renderPage(
  session: PdfSession,
  page: PDFPageProxy,
  targetDpi = TARGET_DPI,
) {
  const { viewport, scale, requestedScale } = boundedViewport(page, targetDpi);
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas 2D context is unavailable.");
  context.save();
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
  session.renderTask = page.render({
    canvas,
    viewport,
    background: "rgb(255, 255, 255)",
    annotationMode: session.pdfjs.AnnotationMode.DISABLE,
  });
  await session.renderTask.promise;
  session.renderTask = null;
  return {
    context,
    width: canvas.width,
    height: canvas.height,
    scale,
    requestedScale,
    estimatedRgbaBytes: canvas.width * canvas.height * 4,
    rotation: page.rotate,
  };
}

async function recogniseRenderedCanvas(adapter: LocalTesseractAdapter, scale: number) {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas 2D context is unavailable.");
  applyPreparationToCanvas(
    context,
    canvas.width,
    canvas.height,
    "adaptive-document",
    scale,
  );
  const started = performance.now();
  const response = await adapter.recognise(
    canvas,
    {
      contentMode: "document",
      autoDeskew: false,
      thresholdingMethod: thresholdingMethodForPreset("adaptive-document"),
      includeLines: true,
    },
    (progress) => setStatus(progress.stage),
  );
  return {
    text: normaliseText(response.text),
    confidence: response.confidence,
    elapsedMs: rounded(performance.now() - started),
  };
}

async function runSelectable(bytes: Uint8Array) {
  const baselineWorkers = workerEvidence.active;
  const session = await PdfSession.start(bytes);
  try {
    const document = await session.open();
    const page = await session.getPage(1);
    const text = await textEvidence(page);
    return {
      scenario: "selectable",
      pageCount: document.numPages,
      ...text,
      sentinelFound: text.plainText.includes("PDF PHASE ZERO SELECTABLE 271828"),
      unicodePreserved:
        text.plainText.includes("café") && text.plainText.includes("résumé"),
      realWorker: session.pdfWorker.port === session.nativeWorker,
      workerBaseline: baselineWorkers,
    };
  } finally {
    await session.destroy();
  }
}

async function runScanned(bytes: Uint8Array, scenario: "scanned" | "rotated") {
  const baselineWorkers = workerEvidence.active;
  const session = await PdfSession.start(bytes);
  const adapter = new LocalTesseractAdapter();
  try {
    const document = await session.open();
    const page = await session.getPage(1);
    const textLayer = await textEvidence(page);
    const rendered = await renderPage(session, page);
    const recognised = await recogniseRenderedCanvas(adapter, rendered.scale);
    return {
      scenario,
      pageCount: document.numPages,
      textLayerItems: textLayer.itemCount,
      ...rendered,
      ...recognised,
      sentinelFound: recognised.text.includes("SENTINEL"),
      realWorker: session.pdfWorker.port === session.nativeWorker,
      workerBaseline: baselineWorkers,
    };
  } finally {
    await adapter.dispose();
    clearCanvas(canvas);
    await session.destroy();
  }
}

async function runMixed(bytes: Uint8Array) {
  const session = await PdfSession.start(bytes);
  const adapter = new LocalTesseractAdapter();
  try {
    const document = await session.open();
    const first = await session.getPage(1);
    const selectable = await textEvidence(first);
    const second = await session.getPage(2);
    const scannedText = await textEvidence(second);
    const rendered = await renderPage(session, second);
    const recognised = await recogniseRenderedCanvas(adapter, rendered.scale);
    return {
      scenario: "mixed",
      pageCount: document.numPages,
      selectableSentinel: selectable.plainText.includes("MIXED SELECTABLE PAGE 112358"),
      scannedTextLayerItems: scannedText.itemCount,
      scannedSentinel: recognised.text.includes("SENTINEL"),
      recognisedText: recognised.text,
      confidence: recognised.confidence,
      elapsedMs: recognised.elapsedMs,
      width: rendered.width,
      height: rendered.height,
      realWorker: session.pdfWorker.port === session.nativeWorker,
    };
  } finally {
    await adapter.dispose();
    clearCanvas(canvas);
    await session.destroy();
  }
}

function pixelDifference(left: Uint8ClampedArray, right: Uint8ClampedArray) {
  if (left.length !== right.length) return 1;
  let changed = 0;
  for (let index = 0; index < left.length; index += 4) {
    if (
      left[index] !== right[index] ||
      left[index + 1] !== right[index + 1] ||
      left[index + 2] !== right[index + 2]
    ) {
      changed += 1;
    }
  }
  return changed / (left.length / 4);
}

async function fontVariant(bytes: Uint8Array, disableFontFace: boolean) {
  const session = await PdfSession.start(bytes, disableFontFace);
  try {
    await session.open();
    const page = await session.getPage(1);
    const text = await textEvidence(page);
    const rendered = await renderPage(session, page, 144);
    const pixels = rendered.context.getImageData(0, 0, rendered.width, rendered.height).data;
    return {
      disableFontFace,
      text,
      width: rendered.width,
      height: rendered.height,
      pixels: new Uint8ClampedArray(pixels),
      realWorker: session.pdfWorker.port === session.nativeWorker,
    };
  } finally {
    clearCanvas(canvas);
    await session.destroy();
  }
}

async function runFontComparison(bytes: Uint8Array) {
  const defaultFont = await fontVariant(bytes.slice(), false);
  const disabledFont = await fontVariant(bytes.slice(), true);
  const difference = pixelDifference(defaultFont.pixels, disabledFont.pixels);
  return {
    scenario: "font",
    defaultFont: {
      text: defaultFont.text,
      width: defaultFont.width,
      height: defaultFont.height,
      realWorker: defaultFont.realWorker,
    },
    disableFontFace: {
      text: disabledFont.text,
      width: disabledFont.width,
      height: disabledFont.height,
      realWorker: disabledFont.realWorker,
    },
    unicodePreserved:
      defaultFont.text.plainText.includes("日本") &&
      disabledFont.text.plainText.includes("日本"),
    textEqual:
      defaultFont.text.plainText === disabledFont.text.plainText,
    changedPixelRatio: difference,
  };
}

async function runRenderCancellation(bytes: Uint8Array) {
  const session = await PdfSession.start(bytes);
  try {
    await session.open();
    const page = await session.getPage(1);
    const { viewport } = boundedViewport(page);
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    session.renderTask = page.render({
      canvas,
      viewport,
      background: "rgb(255, 255, 255)",
      annotationMode: session.pdfjs.AnnotationMode.DISABLE,
    });
    session.renderTask.cancel();
    let cancellationName = "";
    try {
      await session.renderTask.promise;
    } catch (error) {
      cancellationName = error instanceof Error ? error.name : "unknown";
    }
    session.renderTask = null;
    return {
      scenario: "render-cancel",
      cancelled: cancellationName === "RenderingCancelledException",
      cancellationName,
      realWorker: session.pdfWorker.port === session.nativeWorker,
    };
  } finally {
    clearCanvas(canvas);
    await session.destroy();
  }
}

async function runCleanupCycles(bytes: Uint8Array) {
  const baseline = workerEvidence.active;
  const activeAfterCycle: number[] = [];
  for (let cycle = 0; cycle < 5; cycle += 1) {
    const session = await PdfSession.start(bytes.slice());
    try {
      await session.open();
      const page = await session.getPage(1);
      await renderPage(session, page, 72);
    } finally {
      clearCanvas(canvas);
      await session.destroy();
    }
    activeAfterCycle.push(workerEvidence.active);
  }
  return {
    scenario: "cleanup",
    cycles: activeAfterCycle.length,
    baselineWorkers: baseline,
    activeAfterCycle,
    noWorkerGrowth: activeAfterCycle.every((active) => active === baseline),
    canvasZeroed: canvas.width === 0 && canvas.height === 0,
  };
}

type ChromiumPerformance = Performance & {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
};

async function runBenchmark(bytes: Uint8Array, cancelAfterOne: boolean) {
  const baselineWorkers = workerEvidence.active;
  const totalStarted = performance.now();
  const workerStarted = performance.now();
  const session = await PdfSession.start(bytes);
  const document = await session.open();
  const pdfWorkerLoadMs = performance.now() - workerStarted;
  const adapter = new LocalTesseractAdapter();
  const modelStarted = performance.now();
  await adapter.initialise((progress) => setStatus(progress.stage));
  const ocrModelLoadMs = performance.now() - modelStarted;
  const pageResults: Array<{
    page: number;
    elapsedMs: number;
    renderMs: number;
    ocrMs: number;
    confidence: number | null;
    sentinel: boolean;
    width: number;
    height: number;
  }> = [];
  let cancelled = false;
  let peakCanvasBytes = 0;
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const pageStarted = performance.now();
      setStatus(`Processing page ${pageNumber} of ${document.numPages}`);
      const page = await session.getPage(pageNumber);
      const renderStarted = performance.now();
      const rendered = await renderPage(session, page);
      const renderMs = performance.now() - renderStarted;
      peakCanvasBytes = Math.max(peakCanvasBytes, rendered.estimatedRgbaBytes);
      const recognised = await recogniseRenderedCanvas(adapter, rendered.scale);
      pageResults.push({
        page: pageNumber,
        elapsedMs: rounded(performance.now() - pageStarted),
        renderMs: rounded(renderMs),
        ocrMs: recognised.elapsedMs,
        confidence: recognised.confidence,
        sentinel: recognised.text.includes("SENTINEL"),
        width: rendered.width,
        height: rendered.height,
      });
      clearCanvas(canvas);
      if (cancelAfterOne && pageNumber === 1) {
        cancelled = true;
        break;
      }
    }
  } finally {
    await adapter.dispose();
    clearCanvas(canvas);
    await session.destroy();
  }
  const durations = pageResults.map((page) => page.elapsedMs);
  const memory = (performance as ChromiumPerformance).memory;
  return {
    scenario: "benchmark",
    requestedPages: document.numPages,
    processedPages: pageResults.length,
    cancelled,
    pdfWorkerLoadMs: rounded(pdfWorkerLoadMs),
    ocrModelLoadMs: rounded(ocrModelLoadMs),
    coldStartupMs: rounded(pdfWorkerLoadMs + ocrModelLoadMs),
    totalRuntimeMs: rounded(performance.now() - totalStarted),
    perPageMedianMs: median(durations),
    warmPageMedianMs: median(durations.slice(1)),
    slowestPageMs: durations.length ? Math.max(...durations) : null,
    sentinelPassRate: pageResults.length
      ? pageResults.filter((page) => page.sentinel).length / pageResults.length
      : 0,
    peakCanvasBytes,
    approximateJsHeapBytes: memory?.usedJSHeapSize ?? null,
    pageResults,
    cleanup: {
      workersAtBaseline: workerEvidence.active === baselineWorkers,
      canvasZeroed: canvas.width === 0 && canvas.height === 0,
    },
  };
}

async function runDecoder(file: Blob | Uint8Array) {
  const baselineWorkers = workerEvidence.active;
  const adapter = createProductionAdapter();
  let session: PdfDocumentSession | null = null;
  try {
    session = await adapter.open(file);
    const rendered = await session.renderPage(1);
    const context = rendered.canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Decoder canvas is unavailable.");
    const pixels = context.getImageData(0, 0, rendered.width, rendered.height).data;
    let nonWhitePixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] < 250 || pixels[index + 1] < 250 || pixels[index + 2] < 250) {
        nonWhitePixels += 1;
      }
    }
    const result = {
      scenario: "decoder",
      pageCount: session.pageCount,
      width: rendered.width,
      height: rendered.height,
      rotation: rendered.rotation,
      downscaled: rendered.downscaled,
      nonWhitePixels,
      rendered: nonWhitePixels > 0,
      workerBaseline: baselineWorkers,
    };
    rendered.release();
    return result;
  } finally {
    await session?.destroy();
    await adapter.destroy();
  }
}

async function runAdapterRenderCancellation(file: File) {
  const adapter = createProductionAdapter();
  let session: PdfDocumentSession | null = null;
  try {
    session = await adapter.open(file);
    const abortController = new AbortController();
    const rendering = session.renderPage(1, { signal: abortController.signal });
    window.setTimeout(() => abortController.abort(), 0);
    let cancellationCode = "";
    try {
      const rendered = await rendering;
      rendered.release();
    } catch (error) {
      cancellationCode = error instanceof PdfError ? error.code : "unknown";
    }
    return {
      scenario: "adapter-render-cancel",
      cancelled: cancellationCode === "PDF_RENDER_CANCELLED",
      cancellationCode,
    };
  } finally {
    await session?.destroy();
    await adapter.destroy();
  }
}

let passwordUpdate: ((password: string | Error) => void) | null = null;
let passwordCancelled = false;
let adapterPasswordResolve: ((password: string | null) => void) | null = null;

async function runPassword(bytes: Uint8Array) {
  passwordCancelled = false;
  passwordPanel.hidden = false;
  passwordReason.value = "Waiting for PDF.js";
  const baselineWorkers = workerEvidence.active;
  const session = await PdfSession.start(bytes);
  let incorrectAttempts = 0;
  session.loadingTask.onPassword = (
    updatePassword: (password: string | Error) => void,
    reason: number,
  ) => {
    if (passwordCancelled) {
      updatePassword(new Error("PDF password entry cancelled."));
      return;
    }
    if (reason === session.pdfjs.PasswordResponses.INCORRECT_PASSWORD) {
      incorrectAttempts += 1;
      passwordReason.value = "Incorrect test password";
    } else {
      passwordReason.value = "Password required";
    }
    passwordUpdate = updatePassword;
    passwordInput.value = "";
    passwordInput.focus();
  };
  try {
    await session.open();
    const page = await session.getPage(1);
    const text = await textEvidence(page);
    return {
      scenario: "password",
      opened: true,
      cancelled: false,
      incorrectAttempts,
      sentinelFound: text.plainText.includes("PASSWORD FIXTURE OPEN 424242"),
      passwordFieldCleared: passwordInput.value === "",
      realWorker: session.pdfWorker.port === session.nativeWorker,
      workerBaseline: baselineWorkers,
    };
  } catch (error) {
    if (!passwordCancelled) throw error;
    return {
      scenario: "password",
      opened: false,
      cancelled: true,
      incorrectAttempts,
      passwordFieldCleared: passwordInput.value === "",
      workerBaseline: baselineWorkers,
    };
  } finally {
    passwordUpdate = null;
    passwordInput.value = "";
    passwordPanel.hidden = true;
    await session.destroy();
  }
}

async function runAdapterPassword(file: File) {
  passwordCancelled = false;
  passwordPanel.hidden = false;
  passwordReason.value = "Waiting for PDF.js";
  const baselineWorkers = workerEvidence.active;
  const adapter = createProductionAdapter();
  let session: PdfDocumentSession | null = null;
  let incorrectAttempts = 0;
  try {
    session = await adapter.open(file, {
      requestPassword: ({ reason }) => {
        if (reason === "incorrect") {
          incorrectAttempts += 1;
          passwordReason.value = "Incorrect test password";
        } else {
          passwordReason.value = "Password required";
        }
        passwordInput.value = "";
        passwordInput.focus();
        return new Promise<string | null>((resolve) => {
          adapterPasswordResolve = resolve;
        });
      },
    });
    const rendered = await session.renderPage(1, { targetDpi: 72 });
    const result = {
      scenario: "adapter-password",
      opened: true,
      cancelled: false,
      pageCount: session.pageCount,
      incorrectAttempts,
      width: rendered.width,
      height: rendered.height,
      passwordFieldCleared: passwordInput.value === "",
      workerBaseline: baselineWorkers,
    };
    rendered.release();
    return result;
  } catch (error) {
    if (!(error instanceof PdfError) || error.code !== "PDF_PASSWORD_CANCELLED") {
      throw error;
    }
    return {
      scenario: "adapter-password",
      opened: false,
      cancelled: true,
      incorrectAttempts,
      passwordFieldCleared: passwordInput.value === "",
      workerBaseline: baselineWorkers,
    };
  } finally {
    adapterPasswordResolve = null;
    passwordInput.value = "";
    passwordPanel.hidden = true;
    await session?.destroy();
    await adapter.destroy();
  }
}

submitPasswordButton.addEventListener("click", () => {
  if (adapterPasswordResolve) {
    const resolve = adapterPasswordResolve;
    adapterPasswordResolve = null;
    const value = passwordInput.value;
    passwordInput.value = "";
    resolve(value);
    return;
  }
  const update = passwordUpdate;
  if (!update) return;
  const value = passwordInput.value;
  passwordInput.value = "";
  passwordUpdate = null;
  update(value);
});

cancelPasswordButton.addEventListener("click", () => {
  passwordCancelled = true;
  passwordInput.value = "";
  if (adapterPasswordResolve) {
    const resolve = adapterPasswordResolve;
    adapterPasswordResolve = null;
    resolve(null);
    return;
  }
  const update = passwordUpdate;
  passwordUpdate = null;
  update?.(new Error("PDF password entry cancelled."));
});

async function runSelectedScenario() {
  window.__PDF_PHASE0__.lastResult = null;
  window.__PDF_PHASE0__.lastError = null;
  resultOutput.textContent = "";
  passwordInput.value = "";
  passwordPanel.hidden = true;
  setStatus("Starting");
  const file = selectedFile();
  const scenario = scenarioInput.value as Scenario;
  if (scenario.startsWith("phase1b-")) {
    return runPhase1b(file, scenario, cancelAfterOneInput.checked);
  }
  if (scenario === "decoder") return runDecoder(file);
  if (scenario === "adapter-password") return runAdapterPassword(file);
  if (scenario === "adapter-render-cancel") {
    return runAdapterRenderCancellation(file);
  }
  const bytes = await selectedBytes();
  switch (scenario) {
    case "selectable":
      return runSelectable(bytes);
    case "scanned":
      return runScanned(bytes, "scanned");
    case "mixed":
      return runMixed(bytes);
    case "font":
      return runFontComparison(bytes);
    case "rotated":
      return runScanned(bytes, "rotated");
    case "render-cancel":
      return runRenderCancellation(bytes);
    case "cleanup":
      return runCleanupCycles(bytes);
    case "benchmark":
      return runBenchmark(bytes, cancelAfterOneInput.checked);
    case "password":
      return runPassword(bytes);
    default:
      throw new Error(`Unsupported harness scenario: ${scenario}`);
  }
}

runButton.addEventListener("click", () => {
  runButton.disabled = true;
  void runSelectedScenario()
    .then(publishResult)
    .catch(publishError)
    .finally(() => {
      runButton.disabled = false;
    });
});
