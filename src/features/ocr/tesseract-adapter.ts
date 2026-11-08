import { createWorker, OEM, PSM } from "tesseract.js";
import { DEFAULT_OCR_LANGUAGES, selectedOcrLanguages } from "../../config/ocr-languages";
import { loadLanguageModels } from "./language-models";

import type {
  EngineSectionWord,
  OcrContentMode,
  OcrLine,
  OcrProgress,
  RecognitionRequest,
  RecognitionResponse,
} from "./types";

type ProgressCallback = (progress: OcrProgress) => void;

const INITIALISATION_TIMEOUT_MS = 60_000;

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;
type BaseRecognizeOptions = NonNullable<
  Parameters<TesseractWorker["recognize"]>[1]
>;
type RecognizeOutput = NonNullable<
  Parameters<TesseractWorker["recognize"]>[2]
>;
const psmByMode: Record<OcrContentMode, PSM> = {
  document: PSM.AUTO,
  columns: PSM.AUTO,
  screenshot: PSM.SPARSE_TEXT,
  code: PSM.SINGLE_BLOCK,
  sparse: PSM.SPARSE_TEXT,
  "single-line": PSM.SINGLE_LINE,
};

function pageSegmentationForRequest(request: RecognitionRequest) {
  return request.pageSegmentation === "single-block"
    ? PSM.SINGLE_BLOCK
    : psmByMode[request.contentMode];
}

/** Exact per-run variables passed to the production Tesseract worker. */
export function tesseractParametersForRequest(request: RecognitionRequest) {
  const pageSegmentation = pageSegmentationForRequest(request);
  return {
    // Columns deliberately uses Tesseract.js's typed automatic-layout value:
    // the synthetic layout corpus proves that it preserves column-major
    // reading order. Every existing threshold-0 mode retains the established
    // numeric bridge because changing it regresses other corpus categories.
    tessedit_pageseg_mode:
      request.thresholdingMethod === 0 && request.contentMode !== "columns"
        ? (Number(pageSegmentation) as unknown as PSM)
        : pageSegmentation,
    preserve_interword_spaces:
      request.contentMode === "code" || request.contentMode === "screenshot"
        ? "1"
        : "0",
    user_defined_dpi: "300",
    thresholding_method: String(request.thresholdingMethod),
  };
}

/** Exact per-run recognition options passed to the production worker. */
export function tesseractOptionsForRequest(
  request: RecognitionRequest,
): BaseRecognizeOptions {
  return request.autoDeskew ? { rotateAuto: true } : {};
}

function finiteConfidence(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function minimalWords(
  blocks: Awaited<ReturnType<TesseractWorker["recognize"]>>["data"]["blocks"],
): readonly EngineSectionWord[] {
  if (!blocks) return [];
  return blocks.flatMap((block, blockIndex) =>
    block.paragraphs.flatMap((paragraph, paragraphIndex) =>
      paragraph.lines.flatMap((line, lineIndex) =>
        line.words.map((word, wordIndex) => ({
          text: word.text,
          confidence: finiteConfidence(word.confidence),
          bbox: {
            x0: word.bbox.x0,
            y0: word.bbox.y0,
            x1: word.bbox.x1,
            y1: word.bbox.y1,
          },
          blockIndex,
          paragraphIndex,
          lineIndex,
          wordIndex,
        })),
      ),
    ),
  );
}

function minimalLines(
  blocks: Awaited<ReturnType<TesseractWorker["recognize"]>>["data"]["blocks"],
): readonly OcrLine[] {
  if (!blocks) return [];
  return blocks.flatMap((block, blockIndex) =>
    block.paragraphs.flatMap((paragraph, paragraphIndex) =>
      paragraph.lines.map((line, lineIndex) => ({
        text: line.text,
        confidence: finiteConfidence(line.confidence),
        bbox: {
          x0: line.bbox.x0,
          y0: line.bbox.y0,
          x1: line.bbox.x1,
          y1: line.bbox.y1,
        },
        blockIndex,
        paragraphIndex,
        lineIndex,
      })),
    ),
  );
}

function sameOriginAsset(pathname: string) {
  return new URL(pathname, window.location.origin).toString();
}

export class LocalTesseractAdapter {
  private worker: TesseractWorker | null = null;
  private progressCallback: ProgressCallback | null = null;
  private initialising: Promise<void> | null = null;
  private rejectInitialisation: ((reason: unknown) => void) | null = null;
  private initialisationAttempt = 0;
  private disposed = false;
  private workerHasTypedPageSegmentation = false;
  private lifecycleGeneration = 0;
  private rejectRecognition: ((reason: Error) => void) | null = null;

  private languageKey = "";
  private modelLoadController: AbortController | null = null;

  async initialise(onProgress: ProgressCallback, languages: readonly string[] = DEFAULT_OCR_LANGUAGES) {
    const key = selectedOcrLanguages(languages).map(model => model.id).join("+");
    if (key !== this.languageKey && (this.worker || this.initialising)) await this.dispose();
    this.languageKey = key;
    this.progressCallback = onProgress;
    this.disposed = false;
    if (this.worker) return;
    if (this.initialising) return this.initialising;

    const attempt = ++this.initialisationAttempt;
    this.initialising = (async () => {
      let timeoutId: number | null = null;
      let workerPromise: Promise<TesseractWorker> | null = null;
      const failed = new Promise<never>((_, reject) => {
        this.rejectInitialisation = reject;
        timeoutId = window.setTimeout(
          () =>
            reject(
              new Error(
                "The local OCR engine did not finish loading within one minute.",
              ),
            ),
          INITIALISATION_TIMEOUT_MS,
        );
      });

      try {
        if (this.disposed || attempt !== this.initialisationAttempt) {
          throw new Error("The local OCR worker was cancelled.");
        }
        const controller = new AbortController();
        this.modelLoadController = controller;
        onProgress({ stage: `Loading ${selectedOcrLanguages(languages).map(model => model.label).join(", ")} models`, value: null });
        const models = await Promise.race([loadLanguageModels(languages, controller.signal), failed]);
        if (this.disposed || attempt !== this.initialisationAttempt) throw new Error("The local OCR worker was cancelled.");
        workerPromise = createWorker(
          models,
          OEM.LSTM_ONLY,
          {
            workerPath: sameOriginAsset("/ocr/worker.min.js"),
            corePath: sameOriginAsset("/ocr/core"),
            langPath: sameOriginAsset("/ocr/lang"),
            gzip: true,
            cacheMethod: "none",
            workerBlobURL: false,
            logger: (message) => {
              if (
                this.disposed ||
                attempt !== this.initialisationAttempt ||
                (!this.rejectInitialisation && !this.rejectRecognition)
              ) {
                return;
              }
              const value = Number.isFinite(message.progress)
                ? Math.min(1, Math.max(0, message.progress))
                : null;
              this.progressCallback?.({
                stage: humaniseStatus(message.status),
                value,
              });
            },
            errorHandler: (reason) => {
              if (
                this.disposed ||
                attempt !== this.initialisationAttempt ||
                (!this.rejectInitialisation && !this.rejectRecognition)
              ) {
                return;
              }
              this.progressCallback?.({
                stage: "The local OCR worker stopped unexpectedly",
                value: null,
              });
              const error = reason instanceof Error
                  ? reason
                  : new Error(
                      typeof reason === "string"
                        ? reason
                        : "The local OCR worker stopped unexpectedly.",
                    );
              this.rejectInitialisation?.(error);
              this.rejectRecognition?.(error);
            },
          },
        );

        const worker = await Promise.race([workerPromise, failed]);
        if (this.disposed || attempt !== this.initialisationAttempt) {
          await worker.terminate();
          throw new Error("The local OCR worker was cancelled.");
        }
        this.worker = worker;
        this.workerHasTypedPageSegmentation = false;
      } catch (error) {
        if (workerPromise) {
          void workerPromise
            .then((lateWorker) => lateWorker.terminate())
            .catch(() => undefined);
        }
        throw error;
      } finally {
        if (attempt === this.initialisationAttempt) {
          this.modelLoadController?.abort();
          this.modelLoadController = null;
        }
        if (timeoutId !== null) window.clearTimeout(timeoutId);
      }
    })().finally(() => {
      if (attempt !== this.initialisationAttempt) return;
      this.rejectInitialisation = null;
      this.initialising = null;
    });

    return this.initialising;
  }

  private async stopInitialisation(reason: Error) {
    if (!this.initialising) return;
    const initialising = this.initialising;
    this.initialisationAttempt += 1;
    this.rejectInitialisation?.(reason);
    this.rejectInitialisation = null;
    this.initialising = null;
    await initialising.catch(() => undefined);
  }

  private async resetTypedPageSegmentationForLegacyMode() {
    if (!this.workerHasTypedPageSegmentation) return;
    const worker = this.worker;
    this.worker = null;
    this.workerHasTypedPageSegmentation = false;
    if (worker) await worker.terminate();
  }

  async recognise(
    canvas: HTMLCanvasElement,
    request: RecognitionRequest,
    onProgress: ProgressCallback,
  ): Promise<RecognitionResponse> {
    const languageKey = selectedOcrLanguages(request.languages).map(model => model.id).join("+");
    if (this.languageKey && languageKey !== this.languageKey) await this.dispose();
    const lifecycleGeneration = this.lifecycleGeneration;
    const parameters = tesseractParametersForRequest(request);
    // Tesseract.js accepts the historic numeric bridge on a fresh worker but
    // cannot restore it after a typed PSM value has been set. Recycle only on
    // that transition so Columns and Adaptive runs cannot leak layout state
    // into an existing Original-mode workflow.
    if (typeof parameters.tessedit_pageseg_mode === "number") {
      await this.resetTypedPageSegmentationForLegacyMode();
    }
    if (lifecycleGeneration !== this.lifecycleGeneration) {
      throw new Error("The local OCR worker was cancelled.");
    }
    await this.initialise(onProgress, request.languages);
    if (lifecycleGeneration !== this.lifecycleGeneration) {
      throw new Error("The local OCR worker was cancelled.");
    }
    if (!this.worker || this.disposed) {
      throw new Error("The local OCR worker could not be initialised.");
    }

    const worker = this.worker;
    const options = tesseractOptionsForRequest(request);
    const output: RecognizeOutput = request.includeWords || request.includeLines
      ? { text: true, blocks: true }
      : { text: true };
    let rejectRecognition!: (reason: Error) => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectRecognition = reject;
      this.rejectRecognition = reject;
    });
    const ensureCurrent = () => {
      if (lifecycleGeneration !== this.lifecycleGeneration || this.worker !== worker ||
          this.disposed || this.rejectRecognition !== rejectRecognition) {
        throw new Error("The local OCR worker was cancelled.");
      }
    };
    const recognition = (async () => {
      await worker.setParameters(parameters);
      ensureCurrent();
      this.workerHasTypedPageSegmentation =
        typeof parameters.tessedit_pageseg_mode === "string";
      // Tesseract encodes canvas input asynchronously, then posts to its worker
      // even if terminate() ran meanwhile. Own that asynchronous boundary so
      // cancellation can reject late encoding before it enters the library.
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((encoded) => {
          if (encoded) resolve(encoded);
          else reject(new Error("The local OCR image could not be prepared."));
        }, "image/png");
      });
      ensureCurrent();
      const imageBytes = await blob.arrayBuffer();
      ensureCurrent();
      // Its browser loader accepts ArrayBuffer without another async file read;
      // Tesseract's ImageLike declaration omits that supported binary input.
      return worker.recognize(
        imageBytes as unknown as Parameters<TesseractWorker["recognize"]>[0],
        options,
        output,
      );
    })();
    let result: Awaited<ReturnType<TesseractWorker["recognize"]>>;
    try {
      result = await Promise.race([recognition, cancelled]);
    } finally {
      if (this.rejectRecognition === rejectRecognition) {
        this.rejectRecognition = null;
      }
    }
    const rotateRadians =
      typeof result.data.rotateRadians === "number" &&
      Number.isFinite(result.data.rotateRadians)
        ? result.data.rotateRadians
        : 0;
    const response: RecognitionResponse = {
      text: result.data.text,
      confidence: finiteConfidence(result.data.confidence),
      rotateRadians,
    };
    if (request.includeWords) response.words = minimalWords(result.data.blocks);
    if (request.includeLines) response.lines = minimalLines(result.data.blocks);
    return response;
  }

  async cancel() {
    await this.dispose();
  }

  async dispose() {
    this.lifecycleGeneration += 1;
    this.disposed = true;
    this.modelLoadController?.abort();
    this.modelLoadController = null;
    this.rejectRecognition?.(
      new Error("The local OCR worker was cancelled."),
    );
    this.rejectRecognition = null;
    await this.stopInitialisation(
      new Error("The local OCR worker was cancelled."),
    );
    const worker = this.worker;
    this.worker = null;
    this.workerHasTypedPageSegmentation = false;
    this.progressCallback = null;
    if (worker) {
      await worker.terminate();
    }
  }
}

function humaniseStatus(status: string) {
  const labels: Record<string, string> = {
    "loading tesseract core": "Loading local OCR engine",
    "initializing tesseract": "Initialising OCR engine",
    "loading language traineddata": "Loading selected offline models",
    "initializing api": "Preparing recognition",
    "recognizing text": "Recognising text",
  };
  return labels[status] ?? "Preparing local OCR";
}
