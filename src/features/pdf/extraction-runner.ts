import {
  applyPreparationToCanvas,
  thresholdingMethodForPreset,
} from "../image-editor/preparation";
import { DEFAULT_OCR_LANGUAGES, selectedOcrLanguages } from "../../config/ocr-languages";
import {
  recognisePreparedCanvas,
  type CanvasRecognitionAdapter,
} from "../ocr/canvas-recognition";
import { cleanOcrTextWithLayout } from "../ocr/text";
import type {
  EnhancementPreset,
  OcrContentMode,
  OcrProgress,
} from "../ocr/types";
import {
  PdfError,
  createPdfSafeError,
  isPdfError,
  toPdfSafeError,
  type PdfSafeError,
} from "./errors";
import {
  assessPdfTextLayer,
  cleanEmbeddedPdfText,
  reconstructPdfText,
  type PdfTextReconstruction,
} from "./text-layer";
import type {
  PdfDocumentResult,
  PdfDocumentSession,
  PdfExtractionSettings,
  PdfForcedExtractionMethod,
  PdfPageMethod,
  PdfPageRenderMetadata,
  PdfPageResult,
  PdfPageStatus,
  PdfProgress,
  PdfProgressPhase,
  PdfTextLayerAssessment,
  PdfWarningCode,
} from "./types";
import { PDF_LIMITS } from "./validation";

export const DEFAULT_PDF_EXTRACTION_SETTINGS: PdfExtractionSettings = {
  mode: "automatic",
  preset: "adaptive-document",
  contentMode: "document",
  autoDeskew: true,
  languages: DEFAULT_OCR_LANGUAGES,
};

export type PdfOcrAdapter = CanvasRecognitionAdapter & {
  cancel(): Promise<void>;
  dispose(): Promise<void>;
};

export type PdfExtractionRequest = {
  readonly documentId: string;
  readonly operationId: string;
  readonly selectedPages: readonly number[];
  readonly settings?: Partial<PdfExtractionSettings>;
  readonly onProgress?: (progress: PdfProgress) => void;
  readonly onPageStatus?: (pageNumber: number, status: PdfPageStatus) => void;
  readonly onPageResult?: (result: PdfPageResult) => void;
};

export type PdfSinglePageRequest = {
  readonly documentId: string;
  readonly operationId: string;
  readonly pageNumber: number;
  readonly method: PdfForcedExtractionMethod;
  readonly settings?: Partial<PdfExtractionSettings>;
  readonly onProgress?: (progress: PdfProgress) => void;
  readonly onPageStatus?: (pageNumber: number, status: PdfPageStatus) => void;
};

export type PdfExtractionRunnerContext = {
  readonly document: PdfDocumentSession;
  readonly canvas: HTMLCanvasElement;
  readonly signal: AbortSignal;
  readonly isOcrSupportReady?: (languages: readonly string[]) => boolean | Promise<boolean>;
  readonly getOcrAdapter: () => PdfOcrAdapter;
  readonly now: () => number;
};

type ProgressEmitter = (
  phase: PdfProgressPhase,
  stage: string,
  overall: number,
  pageNumber: number | null,
  selectedIndex: number | null,
  pageValue: number | null,
  preflighting: boolean,
  producing: boolean,
) => void;

type PreflightPage = {
  readonly pageNumber: number;
  readonly pageLabel?: string;
  readonly assessment: PdfTextLayerAssessment;
  readonly reconstruction: PdfTextReconstruction | null;
  readonly cleaned: string;
  readonly elapsedMs: number;
  readonly useOcr: boolean;
  readonly failure: PdfSafeError | null;
};

const EMPTY_RECONSTRUCTION: PdfTextReconstruction = {
  text: "",
  unsafeControlCount: 0,
  replacementCharacterCount: 0,
  lineCount: 0,
  malformedItemCount: 0,
  explicitLineBreakCount: 0,
  geometryLineBreakCount: 0,
  insertedSpaceCount: 0,
};

function settingsWithDefaults(
  settings: Partial<PdfExtractionSettings> | undefined,
): PdfExtractionSettings {
  let languages: readonly string[];
  try {
    languages = selectedOcrLanguages(settings?.languages).map((model) => model.id);
  } catch {
    throw new PdfError("PDF_OCR_LANGUAGE_INVALID");
  }
  const mode =
    settings?.mode === "automatic" ||
    settings?.mode === "embedded-text-only" ||
    settings?.mode === "ocr-all"
      ? settings.mode
      : DEFAULT_PDF_EXTRACTION_SETTINGS.mode;
  const preset =
    settings?.preset === "original" ||
    settings?.preset === "document" ||
    settings?.preset === "adaptive-document" ||
    settings?.preset === "high-contrast" ||
    settings?.preset === "inverted"
      ? settings.preset
      : DEFAULT_PDF_EXTRACTION_SETTINGS.preset;
  const contentMode =
    settings?.contentMode === "document" ||
    settings?.contentMode === "columns" ||
    settings?.contentMode === "screenshot" ||
    settings?.contentMode === "code" ||
    settings?.contentMode === "sparse" ||
    settings?.contentMode === "single-line"
      ? settings.contentMode
      : DEFAULT_PDF_EXTRACTION_SETTINGS.contentMode;
  return {
    mode,
    preset,
    contentMode,
    languages,
    autoDeskew:
      typeof settings?.autoDeskew === "boolean"
        ? settings.autoDeskew
        : DEFAULT_PDF_EXTRACTION_SETTINGS.autoDeskew,
  };
}

function throwIfCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new PdfError("PDF_OPERATION_CANCELLED");
}

async function ensureOcrSupportReady(context: PdfExtractionRunnerContext, settings: PdfExtractionSettings) {
  throwIfCancelled(context.signal);
  const ready = (await context.isOcrSupportReady?.(settings.languages ?? DEFAULT_OCR_LANGUAGES)) ?? true;
  throwIfCancelled(context.signal);
  if (!ready) throw new PdfError("PDF_OCR_SUPPORT_UNAVAILABLE_OFFLINE");
}

function isCancellation(error: unknown, signal: AbortSignal) {
  return (
    signal.aborted ||
    (error instanceof Error && error.name === "AbortError") ||
    (isPdfError(error) &&
      (error.code === "PDF_OPERATION_CANCELLED" ||
        error.code === "PDF_RENDER_CANCELLED"))
  );
}

function validateSelectedPages(
  pages: readonly number[],
  document: PdfDocumentSession,
) {
  if (pages.length === 0) throw new PdfError("PDF_PAGE_RANGE_INVALID");
  if (pages.length > PDF_LIMITS.maxSelectedPages) {
    throw new PdfError("PDF_SELECTED_PAGE_LIMIT_EXCEEDED");
  }
  let previous = 0;
  for (const page of pages) {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > document.pageCount ||
      page <= previous
    ) {
      throw new PdfError("PDF_PAGE_RANGE_INVALID");
    }
    previous = page;
  }
}

function pageLabel(document: PdfDocumentSession, pageNumber: number) {
  const label = document.pageLabels?.[pageNumber - 1];
  return label && label !== String(pageNumber) ? label : undefined;
}

function warningCodes(
  assessment: PdfTextLayerAssessment | null,
  text: string,
): PdfWarningCode[] {
  const warnings: PdfWarningCode[] = [];
  if (assessment?.classification === "empty") warnings.push("NO_EMBEDDED_TEXT");
  if (assessment?.classification === "uncertain") {
    warnings.push("TEXT_LAYER_UNCERTAIN");
  }
  if (assessment?.classification === "invalid") {
    warnings.push("TEXT_LAYER_INVALID");
  }
  // Inspect the selected output, so a successful OCR repair does not inherit
  // the old embedded layer's font-specific or replacement-character warning.
  if (/[\p{Co}\uFFFD]/u.test(text)) warnings.push("UNMAPPED_TEXT_CHARACTERS");
  if (text.length === 0) warnings.push("EMPTY_PAGE_TEXT");
  return [...new Set(warnings)];
}

function ensurePageTextLimit(...values: readonly string[]) {
  if (values.some((value) => value.length > PDF_LIMITS.maxPageTextCharacters)) {
    throw new PdfError("PDF_PAGE_TEXT_LIMIT_EXCEEDED");
  }
}

function failedPage(
  pageNumber: number,
  label: string | undefined,
  method: PdfPageMethod,
  error: PdfSafeError,
  elapsedMs: number,
  assessment: PdfTextLayerAssessment | null = null,
  render: PdfPageRenderMetadata | null = null,
): PdfPageResult {
  return {
    pageNumber,
    ...(label ? { pageLabel: label } : {}),
    status: "failed",
    method,
    raw: "",
    cleaned: "",
    edited: "",
    confidence: null,
    elapsedMs,
    textLayerAssessment: assessment,
    warnings: render?.warnings ?? [],
    error,
    render,
  };
}

function notProcessedPage(
  document: PdfDocumentSession,
  pageNumber: number,
): PdfPageResult {
  const label = pageLabel(document, pageNumber);
  return {
    pageNumber,
    ...(label ? { pageLabel: label } : {}),
    status: "not-processed",
    method: "none",
    raw: "",
    cleaned: "",
    edited: "",
    confidence: null,
    elapsedMs: 0,
    textLayerAssessment: null,
    warnings: [],
    error: null,
    render: null,
  };
}

function embeddedResult(entry: PreflightPage): PdfPageResult {
  const raw = entry.reconstruction?.text ?? "";
  ensurePageTextLimit(raw, entry.cleaned);
  return {
    pageNumber: entry.pageNumber,
    ...(entry.pageLabel ? { pageLabel: entry.pageLabel } : {}),
    status: "complete",
    method: "embedded-text",
    raw,
    cleaned: entry.cleaned,
    edited: entry.cleaned,
    confidence: null,
    elapsedMs: entry.elapsedMs,
    textLayerAssessment: entry.assessment,
    warnings: warningCodes(entry.assessment, entry.cleaned),
    error: null,
    render: null,
  };
}

function renderMetadata(
  rendered: Awaited<ReturnType<PdfDocumentSession["renderPage"]>>,
): PdfPageRenderMetadata {
  return {
    requestedScale: rendered.requestedScale,
    scale: rendered.scale,
    effectiveDpi: rendered.effectiveDpi,
    width: rendered.width,
    height: rendered.height,
    rotation: rendered.rotation,
    downscaled: rendered.downscaled,
    warnings: rendered.downscaled ? ["PAGE_RENDER_REDUCED"] : [],
  };
}

function createProgressEmitter(
  totalPages: number,
  callback?: (progress: PdfProgress) => void,
): ProgressEmitter {
  let lastOverall = 0;
  return (
    phase,
    stage,
    overall,
    pageNumber,
    selectedIndex,
    pageValue,
    isPreflighting,
    isProducingResults,
  ) => {
    if (!callback) return;
    const bounded = Math.min(1, Math.max(lastOverall, overall));
    lastOverall = bounded;
    callback({
      stage,
      phase,
      overall: bounded,
      currentSelectedPageIndex: selectedIndex,
      totalSelectedPages: totalPages,
      pageNumber,
      pageValue:
        pageValue === null ? null : Math.min(1, Math.max(0, pageValue)),
      isPreflighting,
      isProducingResults,
    });
  };
}

async function inspectTextPage(
  context: PdfExtractionRunnerContext,
  pageNumber: number,
  label: string | undefined,
): Promise<PreflightPage> {
  const started = context.now();
  try {
    const layer = await context.document.extractText(pageNumber, {
      signal: context.signal,
    });
    throwIfCancelled(context.signal);
    const reconstruction = reconstructPdfText(
      layer.items,
      PDF_LIMITS.maxPageTextCharacters,
    );
    const assessment = assessPdfTextLayer(layer.items, reconstruction);
    const cleaned = cleanEmbeddedPdfText(reconstruction.text);
    ensurePageTextLimit(reconstruction.text, cleaned);
    return {
      pageNumber,
      ...(label ? { pageLabel: label } : {}),
      assessment,
      reconstruction,
      cleaned,
      elapsedMs: context.now() - started,
      useOcr: assessment.classification !== "usable",
      failure: null,
    };
  } catch (error) {
    if (isCancellation(error, context.signal)) throw error;
    const assessment = assessPdfTextLayer([], EMPTY_RECONSTRUCTION, true);
    const safetyFailure =
      isPdfError(error) && error.code === "PDF_PAGE_TEXT_LIMIT_EXCEEDED";
    return {
      pageNumber,
      ...(label ? { pageLabel: label } : {}),
      assessment,
      reconstruction: null,
      cleaned: "",
      elapsedMs: context.now() - started,
      useOcr: !safetyFailure,
      failure: safetyFailure
        ? createPdfSafeError(error.code, { pageNumber })
        : createPdfSafeError("PDF_PAGE_TEXT_EXTRACTION_FAILED", {
            pageNumber,
          }),
    };
  }
}

async function extractEmbeddedOnly(
  context: PdfExtractionRunnerContext,
  pageNumber: number,
): Promise<PdfPageResult> {
  const label = pageLabel(context.document, pageNumber);
  const entry = await inspectTextPage(context, pageNumber, label);
  if (entry.failure) {
    return failedPage(
      pageNumber,
      label,
      "embedded-text",
      entry.failure,
      entry.elapsedMs,
      entry.assessment,
    );
  }
  return embeddedResult(entry);
}

async function recognisePage(
  context: PdfExtractionRunnerContext,
  pageNumber: number,
  settings: PdfExtractionSettings,
  selectedIndex: number,
  totalPages: number,
  progress: ProgressEmitter,
  onStatus?: (pageNumber: number, status: PdfPageStatus) => void,
  assessment: PdfTextLayerAssessment | null = null,
): Promise<PdfPageResult> {
  const started = context.now();
  const label = pageLabel(context.document, pageNumber);
  let rendered: Awaited<ReturnType<PdfDocumentSession["renderPage"]>> | null = null;
  try {
    onStatus?.(pageNumber, "rendering");
    progress(
      "rendering",
      "Preparing this PDF page",
      0,
      pageNumber,
      selectedIndex,
      0,
      false,
      true,
    );
    rendered = await context.document.renderPage(pageNumber, {
      signal: context.signal,
      targetDpi: PDF_LIMITS.targetDpi,
      canvas: context.canvas,
    });
    throwIfCancelled(context.signal);

    onStatus?.(pageNumber, "preparing");
    const pageShareStart = 0.2 + (selectedIndex / totalPages) * 0.75;
    const pageShare = 0.75 / totalPages;
    progress(
      "preparing",
      "Improving this PDF page locally",
      pageShareStart + pageShare * 0.15,
      pageNumber,
      selectedIndex,
      0.15,
      false,
      true,
    );
    const context2d = rendered.canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: settings.preset !== "original",
    });
    if (!context2d) {
      throw new PdfError("PDF_CANVAS_UNAVAILABLE", { pageNumber });
    }
    applyPreparationToCanvas(
      context2d,
      rendered.width,
      rendered.height,
      settings.preset,
      rendered.scale,
    );
    throwIfCancelled(context.signal);

    onStatus?.(pageNumber, "loading-ocr");
    const response = await recognisePreparedCanvas({
      adapter: context.getOcrAdapter(),
      canvas: rendered.canvas,
      contentMode: settings.contentMode,
      thresholdingMethod: thresholdingMethodForPreset(settings.preset),
      autoDeskew:
        settings.autoDeskew &&
        settings.preset === "adaptive-document" &&
        settings.contentMode !== "single-line",
      includeLines: settings.preset === "adaptive-document",
      includeWords: false,
      languages: settings.languages,
      signal: context.signal,
      onProgress: (ocrProgress: OcrProgress) => {
        const recognising = ocrProgress.stage.toLowerCase().includes("recogn");
        onStatus?.(pageNumber, recognising ? "recognising" : "loading-ocr");
        const local = ocrProgress.value ?? (recognising ? 0.5 : 0.25);
        const pageValue = 0.2 + Math.min(1, Math.max(0, local)) * 0.75;
        progress(
          recognising ? "recognising" : "loading-ocr",
          ocrProgress.stage,
          pageShareStart + pageShare * pageValue,
          pageNumber,
          selectedIndex,
          pageValue,
          false,
          true,
        );
      },
    });
    throwIfCancelled(context.signal);
    const cleaned = cleanOcrTextWithLayout(
      response.text,
      settings.contentMode,
      response.lines,
      settings.languages,
    );
    ensurePageTextLimit(response.text, cleaned);
    const render = renderMetadata(rendered);
    return {
      pageNumber,
      ...(label ? { pageLabel: label } : {}),
      status: "complete",
      method: "ocr",
      languages: [...(settings.languages ?? DEFAULT_OCR_LANGUAGES)],
      raw: response.text,
      cleaned,
      edited: cleaned,
      confidence: response.confidence,
      elapsedMs: context.now() - started,
      textLayerAssessment: assessment,
      warnings: [
        ...warningCodes(assessment, cleaned),
        ...render.warnings,
      ],
      error: null,
      render,
    };
  } catch (error) {
    if (isCancellation(error, context.signal)) throw error;
    if (
      isPdfError(error) &&
      (error.code === "PDF_CANVAS_UNAVAILABLE" ||
        error.code === "PDF_DESTROYED" ||
        error.code === "PDF_OPERATION_REPLACED")
    ) {
      throw error;
    }
    return failedPage(
      pageNumber,
      label,
      "ocr",
      toPdfSafeError(error, "PDF_PAGE_OCR_FAILED", { pageNumber }),
      context.now() - started,
      assessment,
      rendered ? renderMetadata(rendered) : null,
    );
  } finally {
    rendered?.release();
  }
}

function documentResult(
  request: Pick<PdfExtractionRequest, "documentId" | "operationId" | "selectedPages">,
  pages: readonly PdfPageResult[],
  elapsedMs: number,
  outcomeOverride?: "cancelled" | "error",
  error: PdfSafeError | null = null,
): PdfDocumentResult {
  const embeddedTextPageCount = pages.filter(
    (page) => page.status === "complete" && page.method === "embedded-text",
  ).length;
  const ocrPageCount = pages.filter(
    (page) => page.status === "complete" && page.method === "ocr",
  ).length;
  const emptyPageCount = pages.filter(
    (page) => page.status === "complete" && page.edited.length === 0,
  ).length;
  const failedPageCount = pages.filter((page) => page.status === "failed").length;
  const skippedOrUnprocessedPageCount = pages.filter(
    (page) => page.status === "skipped" || page.status === "not-processed",
  ).length;
  const outcome =
    outcomeOverride ??
    (failedPageCount > 0 || skippedOrUnprocessedPageCount > 0
      ? "partial"
      : "complete");
  return {
    documentId: request.documentId,
    operationId: request.operationId,
    outcome,
    selectedPages: [...request.selectedPages],
    pages,
    embeddedTextPageCount,
    ocrPageCount,
    emptyPageCount,
    failedPageCount,
    skippedOrUnprocessedPageCount,
    elapsedMs,
    totalOutputCharacters: pages.reduce(
      (total, page) =>
        total + (page.status === "complete" ? page.edited.length : 0),
      0,
    ),
    error,
  };
}

export async function runPdfExtraction(
  context: PdfExtractionRunnerContext,
  request: PdfExtractionRequest,
): Promise<PdfDocumentResult> {
  validateSelectedPages(request.selectedPages, context.document);
  const settings = settingsWithDefaults(request.settings);
  const started = context.now();
  const progress = createProgressEmitter(
    request.selectedPages.length,
    request.onProgress,
  );
  const results = new Map<number, PdfPageResult>();
  let documentError: PdfSafeError | null = null;

  const publish = (result: PdfPageResult) => {
    results.set(result.pageNumber, result);
    request.onPageResult?.(result);
  };

  try {
    const preflight = new Map<number, PreflightPage>();
    let requiresOcrSupport = settings.mode === "ocr-all";
    if (settings.mode === "automatic") {
      for (let index = 0; index < request.selectedPages.length; index += 1) {
        throwIfCancelled(context.signal);
        const pageNumber = request.selectedPages[index];
        request.onPageStatus?.(pageNumber, "checking-text");
        progress(
          "preflight",
          "Checking existing PDF text",
          (index / request.selectedPages.length) * 0.2,
          pageNumber,
          index,
          0,
          true,
          false,
        );
        const entry = await inspectTextPage(
          context,
          pageNumber,
          pageLabel(context.document, pageNumber),
        );
        preflight.set(pageNumber, entry);
        progress(
          "preflight",
          "Checking existing PDF text",
          ((index + 1) / request.selectedPages.length) * 0.2,
          pageNumber,
          index,
          1,
          true,
          false,
        );
      }
      const ocrPages = [...preflight.values()].filter(
        (entry) => entry.useOcr,
      ).length;
      if (ocrPages > PDF_LIMITS.maxOcrPagesPerRun) {
        throw new PdfError("PDF_OCR_PAGE_LIMIT_EXCEEDED", {
          details: {
            selectedPageCount: request.selectedPages.length,
            requiredOcrPageCount: ocrPages,
            permittedOcrPageCount: PDF_LIMITS.maxOcrPagesPerRun,
          },
        });
      }
      requiresOcrSupport = ocrPages > 0;
    } else if (
      settings.mode === "ocr-all" &&
      request.selectedPages.length > PDF_LIMITS.maxOcrPagesPerRun
    ) {
      throw new PdfError("PDF_OCR_PAGE_LIMIT_EXCEEDED", {
        details: {
          selectedPageCount: request.selectedPages.length,
          requiredOcrPageCount: request.selectedPages.length,
          permittedOcrPageCount: PDF_LIMITS.maxOcrPagesPerRun,
        },
      });
    }
    if (requiresOcrSupport) await ensureOcrSupportReady(context, settings);

    let totalCharacters = 0;
    for (let index = 0; index < request.selectedPages.length; index += 1) {
      throwIfCancelled(context.signal);
      const pageNumber = request.selectedPages[index];
      let result: PdfPageResult;
      try {
        if (settings.mode === "embedded-text-only") {
          request.onPageStatus?.(pageNumber, "checking-text");
          result = await extractEmbeddedOnly(context, pageNumber);
        } else if (settings.mode === "automatic") {
          const entry = preflight.get(pageNumber)!;
          if (entry.failure && !entry.useOcr) {
            result = failedPage(
              pageNumber,
              entry.pageLabel,
              "embedded-text",
              entry.failure,
              entry.elapsedMs,
              entry.assessment,
            );
          } else if (!entry.useOcr) {
            result = embeddedResult(entry);
          } else {
            result = await recognisePage(
              context,
              pageNumber,
              settings,
              index,
              request.selectedPages.length,
              progress,
              request.onPageStatus,
              entry.assessment,
            );
          }
        } else {
          result = await recognisePage(
            context,
            pageNumber,
            settings,
            index,
            request.selectedPages.length,
            progress,
            request.onPageStatus,
          );
        }
      } catch (error) {
        if (isCancellation(error, context.signal)) throw error;
        if (
          isPdfError(error) &&
          (error.code === "PDF_CANVAS_UNAVAILABLE" ||
            error.code === "PDF_DESTROYED" ||
            error.code === "PDF_OPERATION_REPLACED")
        ) {
          throw error;
        }
        const fallback =
          settings.mode === "embedded-text-only"
            ? "PDF_PAGE_TEXT_EXTRACTION_FAILED"
            : "PDF_PAGE_OCR_FAILED";
        result = failedPage(
          pageNumber,
          pageLabel(context.document, pageNumber),
          settings.mode === "embedded-text-only" ? "embedded-text" : "ocr",
          toPdfSafeError(error, fallback, { pageNumber }),
          0,
        );
      }

      if (
        result.status === "complete" &&
        totalCharacters + result.edited.length > PDF_LIMITS.maxTotalTextCharacters
      ) {
        documentError = createPdfSafeError("PDF_TOTAL_TEXT_LIMIT_EXCEEDED");
        publish(
          failedPage(
            pageNumber,
            result.pageLabel,
            result.method,
            documentError,
            result.elapsedMs,
            result.textLayerAssessment,
          ),
        );
        break;
      }
      if (result.status === "complete") totalCharacters += result.edited.length;
      publish(result);
      throwIfCancelled(context.signal);
      request.onPageStatus?.(pageNumber, result.status);
      const base = settings.mode === "automatic" ? 0.2 : 0;
      const fraction = base + ((index + 1) / request.selectedPages.length) * (0.95 - base);
      progress(
        result.method === "embedded-text" ? "embedded-text" : "recognising",
        "Finished this PDF page",
        fraction,
        pageNumber,
        index,
        1,
        false,
        true,
      );
      if (documentError) break;
    }

    const pages = request.selectedPages.map(
      (pageNumber) => results.get(pageNumber) ?? notProcessedPage(context.document, pageNumber),
    );
    if (documentError) {
      return documentResult(
        request,
        pages,
        context.now() - started,
        "error",
        documentError,
      );
    }
    progress(
      "combining",
      "Finishing local PDF text",
      1,
      null,
      null,
      1,
      false,
      true,
    );
    return documentResult(request, pages, context.now() - started);
  } catch (error) {
    if (!isCancellation(error, context.signal)) throw error;
    const pages = request.selectedPages.map(
      (pageNumber) => results.get(pageNumber) ?? notProcessedPage(context.document, pageNumber),
    );
    return documentResult(
      request,
      pages,
      context.now() - started,
      "cancelled",
      createPdfSafeError("PDF_OPERATION_CANCELLED"),
    );
  }
}

export async function runSinglePdfPage(
  context: PdfExtractionRunnerContext,
  request: PdfSinglePageRequest,
): Promise<PdfPageResult> {
  validateSelectedPages([request.pageNumber], context.document);
  const settings = settingsWithDefaults(request.settings);
  const progress = createProgressEmitter(1, request.onProgress);
  const started = context.now();
  try {
    let result: PdfPageResult;
    if (request.method === "embedded-text") {
      request.onPageStatus?.(request.pageNumber, "checking-text");
      result = await extractEmbeddedOnly(context, request.pageNumber);
    } else {
      await ensureOcrSupportReady(context, settings);
      result = await recognisePage(
        context,
        request.pageNumber,
        settings,
        0,
        1,
        progress,
        request.onPageStatus,
      );
    }
    request.onPageStatus?.(request.pageNumber, result.status);
    progress(
      "combining",
      "Finished this PDF page",
      1,
      request.pageNumber,
      0,
      1,
      false,
      true,
    );
    return result;
  } catch (error) {
    if (isCancellation(error, context.signal)) throw new PdfError("PDF_OPERATION_CANCELLED");
    const result = failedPage(
      request.pageNumber,
      pageLabel(context.document, request.pageNumber),
      request.method,
      toPdfSafeError(
        error,
        request.method === "ocr"
          ? "PDF_PAGE_OCR_FAILED"
          : "PDF_PAGE_TEXT_EXTRACTION_FAILED",
        { pageNumber: request.pageNumber },
      ),
      context.now() - started,
    );
    request.onPageStatus?.(request.pageNumber, "failed");
    return result;
  }
}

export type PdfOcrSettings = {
  readonly preset: EnhancementPreset;
  readonly contentMode: OcrContentMode;
};
