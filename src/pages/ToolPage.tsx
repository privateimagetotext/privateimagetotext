import { OcrLanguagePicker } from "../components/OcrLanguagePicker";
import { DEFAULT_OCR_LANGUAGES, usesNonLatinScript } from "../config/ocr-languages";
import { useOfflineLanguageStatus } from "../hooks/useOfflineReadiness";
import { HomepageFaq } from "../components/HomepageFaq";
import { useOfflineShellStatus } from "../hooks/useOfflineReadiness";
import { offlineReadiness } from "../lib/offline-readiness";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { Link } from "react-router";
import { HelpfulGuides } from "../components/HelpfulGuides";
import { ToolDirectory, ToolStrip } from "../components/ToolDirectory";
import { ocrToolFacts } from "../config/ocr-tool-facts";
import { OcrSourceReview } from "../components/OcrSourceReview";
import { useOcrBatchQueue } from "../hooks/useOcrBatchQueue";
import { batchAdmissionError, combinedBatchText, separateBatchTextZip, type OcrBatchItem } from "../features/ocr/batch";
import "../styles/ocr-workspace.css";
import {
  ENHANCEMENT_PRESETS,
  FILE_LIMITS,
  OCR_CONTENT_MODES,
  OCR_IMAGE_ACCEPT,
  OCR_IMAGE_FORMAT_LABEL,
  OCR_TEXT_OUTPUT,
  OCR_MARKDOWN_OUTPUT,
  productConfig,
  routes,
} from "../config/product";
import CropEditor from "../components/CropEditor";
import {
  clearCanvas,
  cropToSourcePixels,
  readImageDimensions,
  renderWorkingImage,
} from "../features/image-editor/image";
import { orientedSize } from "../features/image-editor/coordinates";
import {
  isRecognitionAbort,
  runRecognition,
} from "../features/ocr/recognition-runner";
import { ocrReducer } from "../features/ocr/state";
import { ocrSessionOverrides, resolveContentDefaults } from "../features/ocr/content-session";
import { LocalTesseractAdapter } from "../features/ocr/tesseract-adapter";
import { scheduleOcrWorkerPrefetch } from "../features/ocr/prefetch-worker";
import { cleanOcrTextWithLayout, resultCounts } from "../features/ocr/text";
import { markdownFromOcr } from "../features/ocr/markdown";
import {
  nativeTilingEligibility,
  planNativeVerticalTiles,
} from "../features/ocr/tiling";
import {
  initialOcrState,
  type ImageSource,
  type OcrError,
  type PreparationMetadata,
  type ResultView,
  type OcrState,
  type RecognitionWordGeometry,
} from "../features/ocr/types";
import {
  formatFileSize,
  safeTextFilename,
  validateDecodedDimensions,
  validateImageFile,
} from "../features/ocr/validation";
import {
  checkOfflineOcrAssets,
  prepareOfflineOcrAssets,
  subscribeOfflineOcrStatus,
  type OcrModelStatus,
} from "../lib/service-worker";

type PendingLargeImage = {
  intakeSource: NonNullable<ImageSource["intakeSource"]>;
  file: File;
  width: number;
  height: number;
  operationId: number;
};


const dialogFocusableSelector = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const useCases: readonly {
  readonly title: string;
  readonly copy: string;
  readonly guide?: { readonly label: string; readonly to: string };
}[] = [
  {
    title: "Screenshot text",
    copy: "Best with sharp interface text at its original resolution.",
  },
  {
    title: "Error messages",
    copy: "Copy a message from a screenshot before searching or sharing it.",
  },
  {
    title: "Printed documents",
    copy: "High-contrast, evenly lit pages produce the most useful draft.",
    guide: {
      label: "Improve OCR accuracy",
      to: routes.guide.improveOcrAccuracy,
    },
  },
  {
    title: "Receipts and labels",
    copy: "Short printed blocks work well; always check names and numbers.",
    guide: {
      label: "Extract text from a receipt",
      to: routes.guide.receiptToText,
    },
  },
  {
    title: "Code and terminal output",
    copy: "Code / terminal preserves line breaks and spacing instead of joining prose.",
  },
  {
    title: "Scanned pages",
    copy: "Crop margins and try the Document preset for a clearer rerun.",
    guide: {
      label: "Convert a photo or scan to text",
      to: routes.guide.photoScanToText,
    },
  },
];

const limitations = [
  "Blurry, curved, skewed or low-resolution text may be inaccurate.",
  "Handwriting is not a current strength.",
  "Complex tables and multi-column pages often need manual correction.",
  "Image batches run sequentially. Complex layouts still need review.",
  "Check names, numbers, punctuation and codes before relying on the result.",
];

const resultViewCopy: Record<
  ResultView,
  { readonly label: string; readonly description: string }
> = {
  raw: {
    label: "Original OCR",
    description: "Recognised lines before any tidying or edits.",
  },
  cleaned: {
    label: "Tidied",
    description:
      "Line breaks and split words have been cleaned up conservatively.",
  },
  markdown: {
    label: "Markdown",
    description: "Headings and clear columns are kept where recognised. Check the structure before downloading.",
  },
  edited: {
    label: "Your edits",
    description: "A version you can correct before copying or downloading.",
  },
};

function makeError(type: OcrError["type"], message: string): OcrError {
  return { type, message };
}

function preparationScaleLabel(metadata: PreparationMetadata) {
  if (metadata.scaleAction === "reduced") return "reduced locally";
  if (metadata.scaleAction === "enlarged") {
    return "enlarged locally for OCR";
  }
  return "original scale";
}

function copyPreparedCanvas(
  source: HTMLCanvasElement,
  target: HTMLCanvasElement,
) {
  target.width = source.width;
  target.height = source.height;
  const context = target.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas rendering is not available.");
  context.drawImage(source, 0, 0);
}

function currentResultText(
  result: NonNullable<ReturnType<typeof useToolState>["state"]["result"]>,
  view: ResultView,
) {
  if (view === "raw") return result.raw;
  if (view === "cleaned") return result.cleaned;
  if (view === "markdown") return result.markdown;
  return result.edited;
}

function useToolState() {
  const [state, dispatch] = useReducer(ocrReducer, initialOcrState);
  return { state, dispatch };
}

function OcrExplanation() {
  return (
    <>
      <p>{productConfig.supportingPromise}</p>
      <Link className="text-link" to="/how-it-works">
        See how private OCR works
      </Link>
    </>
  );
}

export default function ToolPage() {
  useEffect(scheduleOcrWorkerPrefetch, []);
  const { state, dispatch } = useToolState();
  const [languages, setLanguages] = useState<readonly string[]>(DEFAULT_OCR_LANGUAGES);
  const languageStatus = useOfflineLanguageStatus();
  const resultLanguagesChanged = Boolean(state.result &&
    (state.result.languages ?? DEFAULT_OCR_LANGUAGES).join("+") !== languages.join("+"));
  const batch = useOcrBatchQueue(state);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState("");
  const [batchError, setBatchError] = useState("");
  const [pdfRejected, setPdfRejected] = useState(false);
  const pdfRejectionRef = useRef<HTMLDivElement>(null);
  const [regionBusy, setRegionBusy] = useState(false);
  const [sampleBusy, setSampleBusy] = useState(false);
  const batchRunRef = useRef(false);
  const batchRunGenerationRef = useRef(0);
  const intakeGenerationRef = useRef(0);
  const batchFileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [pendingLarge, setPendingLarge] =
    useState<PendingLargeImage | null>(null);
  const [renderBusy, setRenderBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [ocrModelStatus, setOcrModelStatus] = useState<OcrModelStatus | null>(null);
  const shellCacheStatus = useOfflineShellStatus();
  const offlineStatus = offlineReadiness(shellCacheStatus, ocrModelStatus, languageStatus);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pasteButtonRef = useRef<HTMLButtonElement>(null);
  const extractButtonRef = useRef<HTMLButtonElement>(null);
  const cropButtonRef = useRef<HTMLButtonElement>(null);
  const largeDialogRef = useRef<HTMLDivElement>(null);
  const largeDialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const preparedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderGenerationRef = useRef(0);
  const activeObjectUrlRef = useRef<string | null>(null);
  const adapterRef = useRef(new LocalTesseractAdapter());
  const activeRecognitionRef = useRef<{
    operationId: number;
    controller: AbortController;
    adapter: LocalTesseractAdapter;
  } | null>(null);
  const operationCounterRef = useRef(0);
  // Admission owns this one-shot token, not render/settings changes. Consume
  // it before starting OCR so rerenders and StrictMode cannot start it twice.
  const pendingAutoRunRef = useRef<number | null>(null);
  const initialResultOperationRef = useRef<number | null>(null);
  const resultPanelRef = useRef<HTMLElement>(null);

  const rejectPdfSelection = useCallback((files: readonly File[]) => {
    // This is only a handoff hint, never PDF admission. Leave the active image,
    // processing session and edits untouched when a PDF needs another tool.
    if (__PDF_OCR_PUBLIC__ && routes.pdfToText
      && files.some((file) => file.type === "application/pdf" || /\.pdf$/iu.test(file.name))) {
      setPdfRejected(true);
      return true;
    }
    setPdfRejected(false);
    return false;
  }, []);

  useEffect(() => {
    if (!pdfRejected) return;
    const frame = window.requestAnimationFrame(() => pdfRejectionRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [pdfRejected]);

  useEffect(() => {
    const unsubscribe = subscribeOfflineOcrStatus(setOcrModelStatus);
    checkOfflineOcrAssets();
    return () => { unsubscribe(); };
  }, []);

  const nextOperation = useCallback(() => {
    operationCounterRef.current += 1;
    return operationCounterRef.current;
  }, []);

  const abortRecognitionAndRenewAdapter = useCallback(() => {
    const active = activeRecognitionRef.current;
    activeRecognitionRef.current = null;
    active?.controller.abort();

    const currentAdapter = adapterRef.current;
    adapterRef.current = new LocalTesseractAdapter();
    const adapters = new Set<LocalTesseractAdapter>([currentAdapter]);
    if (active) adapters.add(active.adapter);
    for (const adapter of adapters) {
      void adapter.dispose().catch(() => undefined);
    }
  }, []);

  const releaseObjectUrl = useCallback(() => {
    if (activeObjectUrlRef.current) {
      URL.revokeObjectURL(activeObjectUrlRef.current);
      activeObjectUrlRef.current = null;
    }
  }, []);

  const commitImage = useCallback(
    (
      file: File,
      width: number,
      height: number,
      operationId: number,
      intakeSource: NonNullable<ImageSource["intakeSource"]>,
    ) => {
      if (operationCounterRef.current !== operationId) return;
      releaseObjectUrl();
      const objectUrl = URL.createObjectURL(file);
      activeObjectUrlRef.current = objectUrl;
      const image: ImageSource = {
        intakeSource,
        file,
        objectUrl,
        name: file.name || "pasted-image",
        mime: file.type,
        size: file.size,
        width,
        height,
        willDownscale:
          width > FILE_LIMITS.maxWorkingSide ||
          height > FILE_LIMITS.maxWorkingSide,
      };
      pendingAutoRunRef.current = operationId;
      dispatch({ type: "imageReady", operationId, image });
      setPendingLarge(null);
      setAnnouncement("Image ready. Extracting text locally.");
    },
    [releaseObjectUrl],
  );

  const handleFile = useCallback(
    async (file: File, intakeSource: NonNullable<ImageSource["intakeSource"]> = "file") => {
      if (rejectPdfSelection([file])) return;
      if (batch.activeIdRef.current !== null) {
        const admissionError = batchAdmissionError(
          batch.itemsRef.current.filter((item) => item.id !== batch.activeIdRef.current), [file],
        );
        if (admissionError) { setBatchError(admissionError); return; }
      }
      const operationId = nextOperation();
      pendingAutoRunRef.current = null;
      initialResultOperationRef.current = null;
      setPendingLarge(null);
      setCropOpen(false);
      abortRecognitionAndRenewAdapter();
      dispatch({ type: "decodeStart", operationId });
      setAnnouncement("Checking the image locally.");

      try {
        const validation = await validateImageFile(file);
        if (operationCounterRef.current !== operationId) return;
        if (!validation.ok) {
          dispatch({
            type: "decodeError",
            operationId,
            error: makeError("image-decode", validation.message),
          });
          pasteButtonRef.current?.focus();
          return;
        }

        const dimensions = await readImageDimensions(file);
        if (operationCounterRef.current !== operationId) return;
        const dimensionError = validateDecodedDimensions(
          dimensions.width,
          dimensions.height,
        );
        if (dimensionError) {
          dispatch({
            type: "decodeError",
            operationId,
            error: makeError("image-decode", dimensionError),
          });
          pasteButtonRef.current?.focus();
          return;
        }

        if (
          dimensions.width > FILE_LIMITS.maxWorkingSide ||
          dimensions.height > FILE_LIMITS.maxWorkingSide
        ) {
          largeDialogReturnFocusRef.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : pasteButtonRef.current;
          setPendingLarge({ file, ...dimensions, operationId, intakeSource });
          return;
        }

        commitImage(file, dimensions.width, dimensions.height, operationId, intakeSource);
      } catch {
        if (operationCounterRef.current !== operationId) return;
        dispatch({
          type: "decodeError",
          operationId,
          error: makeError(
            "image-decode",
            "This image could not be decoded safely by the browser.",
          ),
        });
        pasteButtonRef.current?.focus();
      }
    },
    [abortRecognitionAndRenewAdapter, commitImage, nextOperation, rejectPdfSelection],
  );

  const cancelPendingLarge = useCallback(() => {
    if (!pendingLarge) return;

    dispatch({
      type: "decodeError",
      operationId: pendingLarge.operationId,
      error: makeError("image-decode", "The large image was not added."),
    });
    setPendingLarge(null);
    setAnnouncement("The large image was not added.");
  }, [pendingLarge]);

  useEffect(() => {
    if (!pendingLarge || !largeDialogRef.current) return;

    const dialog = largeDialogRef.current;
    const returnFocus = largeDialogReturnFocusRef.current;
    const previousOverflow = document.body.style.overflow;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(dialogFocusableSelector),
    );
    const focusFrame = window.requestAnimationFrame(() =>
      focusable[0]?.focus({ preventScroll: true }),
    );

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelPendingLarge();
        return;
      }
      if (event.key !== "Tab" || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() =>
        returnFocus?.focus({ preventScroll: true }),
      );
    };
  }, [cancelPendingLarge, pendingLarge]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (batchBusy || batchRunning || regionBusy || sampleBusy) return;
      const target = event.target;
      if (
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      const imageItem = Array.from(event.clipboardData?.items ?? []).find(
        (item) => item.kind === "file" && item.type.startsWith("image/"),
      );
      const blob = imageItem?.getAsFile();
      if (blob) {
        event.preventDefault();
        void handleFile(
          new File([blob], "pasted-image", {
            type: blob.type,
            lastModified: Date.now(),
          }),
          "clipboard",
        );
      } else if (event.clipboardData?.getData("text")) {
        setAnnouncement("The clipboard contains text, but no image.");
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handleFile, batchBusy, batchRunning, regionBusy, sampleBusy]);

  useEffect(() => {
    const generation = ++renderGenerationRef.current;
    const previousPreparedCanvas = preparedCanvasRef.current;
    preparedCanvasRef.current = null;
    clearCanvas(previousPreparedCanvas);
    if (!state.image || !canvasRef.current) {
      setRenderBusy(false);
      return;
    }
    let cancelled = false;
    setRenderBusy(true);
    renderWorkingImage(state.image.file, state.transform)
      .then((prepared) => {
        if (cancelled || renderGenerationRef.current !== generation) {
          clearCanvas(prepared.canvas);
          return;
        }
        const defaults = resolveContentDefaults(state, prepared.canvas);
        if (defaults !== state) {
          dispatch({ type: "applyContentDefaults", state: defaults });
          if (defaults.transform.preset !== state.transform.preset) {
            // Reprepare with the selected enhancement before the one-shot OCR run.
            clearCanvas(prepared.canvas);
            return;
          }
        }
        const previewCanvas = canvasRef.current;
        if (!previewCanvas) {
          clearCanvas(prepared.canvas);
          return;
        }
        try {
          copyPreparedCanvas(prepared.canvas, previewCanvas);
        } catch (error) {
          clearCanvas(prepared.canvas);
          throw error;
        }
        preparedCanvasRef.current = prepared.canvas;
        dispatch({ type: "preparationReady", metadata: prepared.metadata });
      })
      .catch(() => {
        if (!cancelled && renderGenerationRef.current === generation) {
          const pendingOperationId = pendingAutoRunRef.current;
          if (pendingOperationId !== null && pendingOperationId === operationCounterRef.current) {
            pendingAutoRunRef.current = null;
            dispatch({ type: "ocrError", operationId: pendingOperationId,
              error: makeError("image-decode", "The local preview could not be rendered. Adjust the image or choose another file.") });
          }
          setAnnouncement("The local preview could not be rendered.");
        }
      })
      .finally(() => {
        if (!cancelled && renderGenerationRef.current === generation) {
          setRenderBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [state.image, state.transform]);

  useEffect(() => {
    const processing =
      state.status === "loadingOcr" || state.status === "recognising";
    if (!processing) {
      setElapsedSeconds(0);
      return;
    }
    const started = performance.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((performance.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state.status]);

  useEffect(() => {
    const releasePageResources = () => {
      intakeGenerationRef.current += 1;
      batchRunRef.current = false;
      batchRunGenerationRef.current += 1;
      pendingAutoRunRef.current = null;
      initialResultOperationRef.current = null;
      renderGenerationRef.current += 1;
      abortRecognitionAndRenewAdapter();
      releaseObjectUrl();
      clearCanvas(canvasRef.current);
      clearCanvas(preparedCanvasRef.current);
      preparedCanvasRef.current = null;
    };
    const handlePageHide = () => {
      const operationId = nextOperation();
      releasePageResources();
      setPendingLarge(null);
      setCropOpen(false);
      batch.clear();
      setBatchBusy(false);
      setBatchRunning(false);
      setRegionBusy(false);
      setSampleBusy(false);
      dispatch({ type: "clear", operationId });
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      operationCounterRef.current += 1;
      releasePageResources();
    };
  }, [abortRecognitionAndRenewAdapter, batch.clear, nextOperation, releaseObjectUrl]);

  const readClipboard = async () => {
    const generation = intakeGenerationRef.current;
    const operationIdAtRequest = operationCounterRef.current;
    const isCurrentRequest = () => generation === intakeGenerationRef.current
      && operationIdAtRequest === operationCounterRef.current;
    try {
      if (!navigator.clipboard?.read) {
        throw new Error("Clipboard image access is unavailable.");
      }
      const items = await navigator.clipboard.read();
      if (!isCurrentRequest()) return;
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          if (!isCurrentRequest()) return;
          await handleFile(
            new File([blob], "pasted-image", {
              type: blob.type,
              lastModified: Date.now(),
            }),
            "clipboard",
          );
          return;
        }
      }
      setAnnouncement("The clipboard does not contain an image.");
    } catch {
      if (!isCurrentRequest()) return;
      const operationId = nextOperation();
      dispatch({
        type: "decodeStart",
        operationId,
      });
      dispatch({
        type: "decodeError",
        operationId,
        error: makeError(
          "clipboard",
          "The browser could not read an image from the clipboard. Use normal paste or choose a file instead.",
        ),
      });
    }
  };

  const clearWorkspace = useCallback(() => {
    intakeGenerationRef.current += 1;
    batchRunRef.current = false;
    batchRunGenerationRef.current += 1;
    batch.clear();
    setBatchRunning(false);
    setBatchBusy(false);
    setSampleBusy(false);
    setRegionBusy(false);
    setBatchProgress("");
    setBatchError("");
    setPdfRejected(false);
    pendingAutoRunRef.current = null;
    initialResultOperationRef.current = null;
    const operationId = nextOperation();
    renderGenerationRef.current += 1;
    abortRecognitionAndRenewAdapter();
    releaseObjectUrl();
    clearCanvas(canvasRef.current);
    clearCanvas(preparedCanvasRef.current);
    preparedCanvasRef.current = null;
    setPendingLarge(null);
    setCropOpen(false);
    dispatch({ type: "clear", operationId });
    setAnnouncement("Current work cleared.");
    window.requestAnimationFrame(() => pasteButtonRef.current?.focus());
  }, [abortRecognitionAndRenewAdapter, batch.clear, nextOperation, releaseObjectUrl]);

  const cancelProcessing = () => {
    const preserveResult = batchRunning || regionBusy;
    intakeGenerationRef.current += 1;
    pendingAutoRunRef.current = null;
    initialResultOperationRef.current = null;
    batchRunRef.current = false;
    batchRunGenerationRef.current += 1;
    if (batchRunning) setBatchProgress("Batch stopped. Completed results and edits are retained. Pending images can be retried.");
    setBatchRunning(false);
    setRegionBusy(false);
    const operationId = state.currentOperationId;
    const nextOperationId = nextOperation();
    abortRecognitionAndRenewAdapter();
    if (preserveResult) dispatch({ type: "restoreWorkspace", operationId: nextOperationId,
      state: { ...state, status: state.result ? "complete" : state.image ? "imageReady" : "idle", progress: null } });
    else dispatch({ type: "ocrCancelled", operationId, nextOperationId });
    setAnnouncement("Text extraction cancelled. The selected image is still ready.");
    window.requestAnimationFrame(() => extractButtonRef.current?.focus());
  };

  const runOcr = async (initialRun = false) => {
    const canvas = preparedCanvasRef.current;
    const preparation = state.preparation;
    if (
      !canvas ||
      !preparation ||
      !state.image ||
      activeRecognitionRef.current ||
      pendingLarge ||
      state.status === "decoding" ||
      renderBusy ||
      canvas.width === 0
    ) {
      return;
    }
    const operationId = nextOperation();
    pendingAutoRunRef.current = null;
    initialResultOperationRef.current = initialRun ? operationId : null;
    const controller = new AbortController();
    const adapter = adapterRef.current;
    activeRecognitionRef.current = { operationId, controller, adapter };
    dispatch({ type: "ocrStart", operationId });
    const started = performance.now();

    try {
      const recognised = await runRecognition({ languages,
        adapter,
        file: state.image.file,
        sourceWidth: state.image.width,
        sourceHeight: state.image.height,
        sourceFileBytes: state.image.size,
        transform: state.transform,
        contentMode: state.contentMode,
        previewCanvas: canvas,
        previewPreparation: preparation,
        signal: controller.signal,
        includeWordGeometry: true,
        onProgress: (progress) => {
          if (
            operationCounterRef.current !== operationId ||
            controller.signal.aborted
          ) {
            return;
          }
          dispatch({ type: "ocrProgress", operationId, progress });
        },
      });
      if (operationCounterRef.current !== operationId) return;
      const raw = recognised.raw;
      const cleaned = cleanOcrTextWithLayout(
        raw,
        state.contentMode,
        state.transform.preset === "adaptive-document"
          ? recognised.lines
          : undefined,
        languages,
      );
      dispatch({
        type: "ocrSuccess",
        operationId,
        result: {
          languages: [...languages],
          raw,
          cleaned,
          markdown: markdownFromOcr(raw, state.contentMode, recognised.lines, languages),
          edited: cleaned,
          confidence: recognised.confidence,
          elapsedMs: performance.now() - started,
          rotateRadians: recognised.rotateRadians,
          preparation,
          recognition: recognised.recognition,
          words: recognised.words,
        },
      });
      setAnnouncement(
        raw.trim()
          ? "Text extraction complete."
          : "Text extraction complete, but no text was detected.",
      );
      prepareOfflineOcrAssets(languages);
    } catch (error) {
      if (operationCounterRef.current !== operationId) return;
      if (isRecognitionAbort(error)) return;
      if (adapterRef.current === adapter) {
        abortRecognitionAndRenewAdapter();
      } else {
        void adapter.dispose().catch(() => undefined);
      }
      dispatch({
        type: "ocrError",
        operationId,
        error: makeError(
          "recognition",
          "Text extraction stopped before it could finish. The image remains available so you can try again.",
        ),
      });
    } finally {
      if (activeRecognitionRef.current?.operationId === operationId) {
        activeRecognitionRef.current = null;
      }
    }
  };

  const resultText = useMemo(() => {
    if (!state.result) return "";
    return currentResultText(state.result, state.resultView);
  }, [state.result, state.resultView]);
  const counts = useMemo(() => resultCounts(resultText), [resultText]);
  const plannedRecognition = useMemo(() => {
    if (!state.image || !state.preparation) return null;
    const sourceCrop = cropToSourcePixels(
      state.transform.crop,
      state.image.width,
      state.image.height,
    );
    const pageSize = orientedSize(sourceCrop, state.transform.rotation);
    const eligibility = nativeTilingEligibility({
      contentMode: state.contentMode,
      preset: state.transform.preset,
      orientedWidth: pageSize.width,
      orientedHeight: pageSize.height,
      wholePreparationAction: state.preparation.scaleAction,
      sourceWidth: state.image.width,
      sourceHeight: state.image.height,
      sourceFileBytes: state.image.size,
    });
    if (!eligibility.eligible) {
      return { strategy: "single-canvas" as const, sectionCount: 1 };
    }
    return {
      strategy: "vertical-tiles" as const,
      sectionCount: planNativeVerticalTiles(pageSize.width, pageSize.height).tiles
        .length,
    };
  }, [state.contentMode, state.image, state.preparation, state.transform]);

  const copyText = async () => {
    if (!resultText) {
      setAnnouncement("There is no text to copy.");
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(resultText);
      } else {
        const fallback = document.createElement("textarea");
        fallback.className = "clipboard-fallback";
        fallback.value = resultText;
        fallback.spellcheck = false;
        fallback.autocomplete = "off";
        fallback.setAttribute("autocorrect", "off");
        fallback.setAttribute("autocapitalize", "off");
        document.body.append(fallback);
        try {
          fallback.select();
          if (!document.execCommand("copy")) throw new Error("Copy failed");
        } finally {
          fallback.value = "";
          fallback.remove();
        }
      }
      setAnnouncement("Text copied.");
    } catch {
      setAnnouncement(
        "The browser could not copy the text. Select it in the editor and copy it manually.",
      );
    }
  };

  const downloadText = (format: "txt" | "md" = "txt") => {
    // The Markdown export is the generated view unless Your edits is selected;
    // this also lets a user correct Markdown using Edit this version.
    const text = format === "md" && state.resultView !== "edited" ? state.result?.markdown : resultText;
    if (!text || !state.image) {
      setAnnouncement("There is no text to download.");
      return;
    }
    try {
      const blob = new Blob([text], {
        type: format === "md" ? OCR_MARKDOWN_OUTPUT.mimeType : OCR_TEXT_OUTPUT.mimeType,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = safeTextFilename(state.image.name).replace(/\.txt$/, `.${format}`);
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setAnnouncement(format === "md" ? "Markdown file download started." : "Text file download started.");
    } catch {
      setAnnouncement("The browser could not prepare the text download.");
    }
  };

  const activateBatchItem = (requestedItem: OcrBatchItem) => {
    const item = batch.capture().find((entry) => entry.id === requestedItem.id);
    if (!item || batch.activeIdRef.current === item.id) return;
    pendingAutoRunRef.current = null;
    initialResultOperationRef.current = null;
    abortRecognitionAndRenewAdapter();
    releaseObjectUrl();
    const operationId = nextOperation();
    const image = item.state.image;
    const objectUrl = image ? URL.createObjectURL(image.file) : "";
    activeObjectUrlRef.current = objectUrl || null;
    batch.activeIdRef.current = item.id;
    dispatch({ type: "restoreWorkspace", operationId, state: {
      ...item.state,
      image: image ? { ...image, objectUrl } : null,
    } });
    setCropOpen(false);
    setPendingLarge(null);
    setAnnouncement(`Opened ${item.name}. Its image settings and text edits are retained.`);
  };

  const addBatchFiles = async (files: File[]) => {
    if (!files.length || batchBusy || batchRunning || regionBusy || state.status === "decoding" || pendingLarge) return;
    if (rejectPdfSelection(files)) return;
    const existing = batch.capture();
    const admissionItems = existing.length ? existing : state.image ? [{ size: state.image.size }] : [];
    const admissionError = batchAdmissionError(admissionItems, files);
    if (admissionError) { setBatchError(admissionError); return; }
    const generation = ++intakeGenerationRef.current;
    setBatchBusy(true);
    setBatchError("");
    const added: OcrBatchItem[] = [];
    try {
      for (const file of files) {
        setBatchProgress(`Checking ${file.name} locally…`);
        let snapshot: OcrState;
        try {
          const validation = await validateImageFile(file);
          if (!validation.ok) throw new Error(validation.message);
          const dimensions = await readImageDimensions(file);
          const dimensionError = validateDecodedDimensions(dimensions.width, dimensions.height);
          if (dimensionError) throw new Error(dimensionError);
          snapshot = {
            ...initialOcrState, status: "imageReady",
            image: { file, objectUrl: "", name: file.name || "pasted-image", mime: file.type,
              size: file.size, ...dimensions,
              willDownscale: dimensions.width > FILE_LIMITS.maxWorkingSide || dimensions.height > FILE_LIMITS.maxWorkingSide },
          };
        } catch (error) {
          snapshot = { ...initialOcrState, status: "error", error: makeError("image-decode",
            error instanceof Error ? error.message : "The image could not be read safely.") };
        }
        if (generation !== intakeGenerationRef.current) return;
        added.push(batch.makeItem(file.name || "pasted-image", snapshot.image ? file.size : 0, snapshot));
      }
      if (generation !== intakeGenerationRef.current) return;
      // Validation can take time while the text editor stays available. Merge
      // against the latest snapshots, including a fresh seed for a single image.
      let latestExisting = batch.capture();
      const latestCurrent = batch.getCurrentState();
      if (!latestExisting.length && latestCurrent.image) {
        latestExisting = [batch.makeItem(latestCurrent.image.name, latestCurrent.image.size, latestCurrent)];
      }
      const finalAdmissionError = batchAdmissionError(latestExisting, added);
      if (finalAdmissionError) {
        setBatchError(finalAdmissionError);
        setBatchProgress("No images were added. The current workspace is unchanged.");
        return;
      }
      if (batch.activeIdRef.current === null && latestExisting.length) batch.activeIdRef.current = latestExisting[0].id;
      const next = [...latestExisting, ...added];
      batch.write(next);
      if (batch.activeIdRef.current === null && next.length) activateBatchItem(next.find((item) => item.state.image) ?? next[0]);
      setBatchProgress(`${added.filter((item) => item.state.image).length} images added. Large previews are reduced locally; originals are unchanged.`);
    } finally {
      if (generation === intakeGenerationRef.current) setBatchBusy(false);
    }
  };

  const updateBatchItem = (id: number, snapshot: OcrState) => {
    batch.write(batch.itemsRef.current.map((item) => item.id === id ? { ...item, state: snapshot } : item));
    if (batch.activeIdRef.current === id) {
      dispatch({ type: "restoreWorkspace", operationId: operationCounterRef.current, state: {
        ...snapshot, image: snapshot.image ? { ...snapshot.image, objectUrl: activeObjectUrlRef.current ?? "" } : null,
      } });
    }
  };

  const runBatch = async () => {
    if (state.status === "decoding" || batchBusy || pendingLarge) return;
    const pending = batch.capture().filter((item) => item.state.image && !item.state.result);
    if (!pending.length || batchRunRef.current || regionBusy) return;
    batchRunRef.current = true;
    const generation = ++batchRunGenerationRef.current;
    setBatchRunning(true);
    setBatchError("");
    let completed = 0;
    let failed = 0;
    for (const [index, item] of pending.entries()) {
      if (!batchRunRef.current || generation !== batchRunGenerationRef.current) break;
      const image = item.state.image!;
      const operationId = nextOperation();
      const controller = new AbortController();
      const adapter = adapterRef.current;
      activeRecognitionRef.current = { operationId, controller, adapter };
      let prepared: Awaited<ReturnType<typeof renderWorkingImage>> | null = null;
      let imageState = item.state;
      const started = performance.now();
      setBatchProgress(`Image ${index + 1} of ${pending.length}: ${item.name} · preparing`);
      try {
        prepared = await renderWorkingImage(image.file, item.state.transform);
        if (!batchRunRef.current || generation !== batchRunGenerationRef.current || controller.signal.aborted) break;
        imageState = resolveContentDefaults(item.state, prepared.canvas);
        if (imageState.transform.preset !== item.state.transform.preset) {
          clearCanvas(prepared.canvas);
          prepared = await renderWorkingImage(image.file, imageState.transform);
          if (!batchRunRef.current || generation !== batchRunGenerationRef.current || controller.signal.aborted) break;
        }
        updateBatchItem(item.id, imageState);
        const recognised = await runRecognition({ languages,
          adapter, file: image.file, sourceWidth: image.width, sourceHeight: image.height,
          sourceFileBytes: image.size, transform: imageState.transform, contentMode: imageState.contentMode,
          previewCanvas: prepared.canvas, previewPreparation: prepared.metadata, signal: controller.signal,
          includeWordGeometry: true,
          onProgress: (progress) => {
            if (batchRunRef.current && generation === batchRunGenerationRef.current && !controller.signal.aborted) setBatchProgress(`Image ${index + 1} of ${pending.length}: ${item.name} · ${progress.stage}`);
          },
        });
        if (!batchRunRef.current || generation !== batchRunGenerationRef.current || controller.signal.aborted) break;
        const cleaned = cleanOcrTextWithLayout(recognised.raw, imageState.contentMode,
          imageState.transform.preset === "adaptive-document" ? recognised.lines : undefined, languages);
        updateBatchItem(item.id, { ...imageState, status: "complete", error: null, progress: null,
          preparation: prepared.metadata, resultView: "cleaned", result: {
            languages: [...languages],
            raw: recognised.raw, cleaned, edited: cleaned, confidence: recognised.confidence,
            markdown: markdownFromOcr(recognised.raw, imageState.contentMode, recognised.lines, languages),
            elapsedMs: performance.now() - started, rotateRadians: recognised.rotateRadians,
            preparation: prepared.metadata, recognition: recognised.recognition, words: recognised.words,
          } });
        completed += 1;
      } catch {
        if (!batchRunRef.current || generation !== batchRunGenerationRef.current || controller.signal.aborted) break;
        failed += 1;
        updateBatchItem(item.id, { ...imageState, error: makeError("recognition", "Recognition failed for this image. Review its settings and retry."), status: "imageReady" });
        abortRecognitionAndRenewAdapter();
      } finally {
        if (prepared) clearCanvas(prepared.canvas);
        if (activeRecognitionRef.current?.operationId === operationId) activeRecognitionRef.current = null;
      }
    }
    if (generation !== batchRunGenerationRef.current) return;
    const wasCancelled = !batchRunRef.current;
    batchRunRef.current = false;
    setBatchRunning(false);
    setBatchProgress(`${wasCancelled ? "Batch stopped" : "Batch finished"}. ${completed} completed, ${failed} failed. Completed results and edits are retained.`);
    if (completed) prepareOfflineOcrAssets(languages);
  };

  const downloadBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    // Delay revocation through the next task so the browser can consume the click.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const rerunRegion = async (word: RecognitionWordGeometry): Promise<string | null> => {
    if (!state.image || regionBusy || batchRunning) return null;
    const image = state.image;
    const rect = word.sourceImage.envelope;
    const padding = Math.max(4, rect.height * 0.25);
    const x = Math.max(0, rect.x - padding);
    const y = Math.max(0, rect.y - padding);
    const transform = { ...state.transform, crop: {
      x: x / image.width, y: y / image.height,
      width: (Math.min(image.width, rect.x + rect.width + padding) - x) / image.width,
      height: (Math.min(image.height, rect.y + rect.height + padding) - y) / image.height,
    } };
    const operationId = nextOperation();
    const controller = new AbortController();
    const adapter = adapterRef.current;
    activeRecognitionRef.current = { operationId, controller, adapter };
    let prepared: Awaited<ReturnType<typeof renderWorkingImage>> | null = null;
    setRegionBusy(true);
    try {
      prepared = await renderWorkingImage(image.file, transform);
      if (controller.signal.aborted) return null;
      const recognised = await runRecognition({ languages, adapter, file: image.file, sourceWidth: image.width,
        sourceHeight: image.height, sourceFileBytes: image.size, transform, contentMode: "single-line",
        previewCanvas: prepared.canvas, previewPreparation: prepared.metadata, signal: controller.signal,
        onProgress: () => undefined });
      return controller.signal.aborted ? null : recognised.raw;
    } catch { return null; }
    finally {
      if (prepared) clearCanvas(prepared.canvas);
      if (activeRecognitionRef.current?.operationId === operationId) {
        activeRecognitionRef.current = null;
        setRegionBusy(false);
      }
    }
  };

  const loadSample = async (kind: "mixed" | "screenshot" | "receipt" | "terminal") => {
    const files = { mixed: "sample.png", screenshot: "clean-screenshot.png", receipt: "receipt.png", terminal: "code-terminal.png" };
    const generation = ++intakeGenerationRef.current;
    setSampleBusy(true);
    setBatchError("");
    try {
      const response = await fetch(`/samples/${files[kind]}`);
      if (!response.ok) throw new Error("Sample unavailable");
      const blob = await response.blob();
      if (generation !== intakeGenerationRef.current) return;
      await handleFile(new File([blob], files[kind], { type: "image/png" }), "sample");
      if (generation !== intakeGenerationRef.current) return;
    } catch {
      if (generation === intakeGenerationRef.current) setBatchError("This sample is not available. Reconnect once to save the sample, or choose your own image.");
    } finally {
      if (generation === intakeGenerationRef.current) setSampleBusy(false);
    }
  };

  useEffect(() => {
    if (pendingAutoRunRef.current === state.currentOperationId
      && state.status === "imageReady" && !pendingLarge && !sampleBusy
      && !renderBusy && !batchBusy && !batchRunning && state.image && state.preparation) {
      pendingAutoRunRef.current = null;
      void runOcr(true);
    }
  });

  useEffect(() => {
    if (state.status !== "complete" || !state.result
      || initialResultOperationRef.current !== state.currentOperationId) return;
    initialResultOperationRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      const panel = resultPanelRef.current;
      const editor = panel?.querySelector("textarea");
      if (!panel || !editor) return;
      const bounds = editor.getBoundingClientRect();
      const bottomInset = window.innerHeight < 900 ? 96 : 16;
      if (bounds.top < 80 || bounds.top + Math.min(bounds.height, 160) > window.innerHeight - bottomInset) {
        // Do not steal focus or animate motion. This only happens on an initial
        // result; explicit reruns and edits leave the user's scroll position alone.
        panel.scrollIntoView({ block: "start", behavior: "instant" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [state.currentOperationId, state.result, state.status]);

  const processing = state.status === "loadingOcr" || state.status === "recognising" || batchRunning || regionBusy;
  const preparingInitial = pendingAutoRunRef.current !== null;
  const controlsBusy = processing || preparingInitial || sampleBusy || state.status === "decoding"
    || Boolean(renderBusy && state.image && !state.defaultsApplied);
  const materialDeskewSections =
    state.result?.recognition.sections.filter(
      (section) => Math.abs((section.rotateRadians * 180) / Math.PI) >= 0.5,
    ) ?? [];
  const deskewDegrees = materialDeskewSections[0]
    ? Math.abs((materialDeskewSections[0].rotateRadians * 180) / Math.PI)
    : 0;

  return (
    <main id="main-content" className={`ocr-workspace-page${state.image ? " has-image" : ""}`}>
      <section className="product-intro" aria-labelledby="product-title">
        <div>
          <p className="eyebrow">{productConfig.homepageEyebrow}</p>
          <h1 id="product-title">{productConfig.tagline}</h1>
        </div>
        <p className="ocr-mobile-lead">Free multilingual image OCR in your browser.</p>
        <div className="product-intro__copy">
          <OcrExplanation />
        </div>
        <ul className="trust-markers" aria-label="Product facts">
          {productConfig.trustMarkers.map((marker) => (
            <li key={marker}>{marker}</li>
          ))}
          <li className="offline-readiness" aria-live="polite" aria-atomic="true" title={offlineStatus.description}>{offlineStatus.label}</li>
        </ul>
        <ToolStrip currentPath={routes.tool} />
      </section>

      <section className="workspace-section" aria-labelledby="workspace-title">
        <div className="section-heading section-heading--compact">
          <p className="eyebrow">Image to text tool</p>
          <h2 id="workspace-title">Extract and edit text from an image</h2>
        </div>

        <OcrLanguagePicker value={languages} onChange={setLanguages}
          disabled={processing || batchBusy || sampleBusy || renderBusy || regionBusy || state.status === "decoding"}
          cacheStatus={languageStatus} shellStatus={shellCacheStatus}
          onPrepare={() => prepareOfflineOcrAssets(languages)} />
        {usesNonLatinScript(languages) && <p className="caveat">Text cleanup is disabled for Hindi and Thai selections, including Code / terminal cleanup. Tidied keeps the original OCR text; content modes and image enhancements still apply.</p>}

        {__PDF_OCR_PUBLIC__ && routes.pdfToText && pdfRejected ? (
          <div ref={pdfRejectionRef} className="error-message pdf-rejection" role="alert" tabIndex={-1}>
            <p>This image workspace does not accept PDFs. No files from this selection were added.</p>
            <Link to={routes.pdfToText} target="_blank" rel="noopener noreferrer">Open PDF to text (opens in a new tab)</Link>
            <span> and select the document there.</span>
            <button className="text-button" type="button" onClick={() => setPdfRejected(false)}>Dismiss PDF notice</button>
          </div>
        ) : null}

        {batch.items.length > 0 && <section className="ocr-batch" aria-label="Image batch">
          <div className="ocr-batch-heading"><h3>Your image batch</h3><span>{batch.items.length}/10 images · {(batch.items.reduce((sum, item) => sum + item.size, 0) / 1024 / 1024).toFixed(1)}/100 MiB</span></div>
          <p>One image is recognised at a time. Select an image to keep editing its own result. Large previews are reduced locally. Everything is discarded on Clear or leaving this page.</p>
          <ol className="ocr-batch-list">
            {batch.items.map((item, index) => <li key={item.id}>
              <button type="button" className="ocr-batch-select" aria-pressed={batch.activeIdRef.current === item.id}
                aria-label={`${index + 1}. ${item.name} ${item.state.result ? "Complete" : item.state.error ? "Needs attention" : "Ready"}`}
                disabled={processing || batchBusy} onClick={() => activateBatchItem(item)}>
                <span>{index + 1}. {item.name}</span><small>{item.state.result ? "Complete" : item.state.error ? "Needs attention" : "Ready"}</small>
              </button>
              <div className="ocr-batch-item-actions">
                <button type="button" aria-label={`Move ${item.name} up`} disabled={index === 0 || processing || batchBusy} onClick={() => {
                  const items = [...batch.capture()]; [items[index - 1], items[index]] = [items[index], items[index - 1]]; batch.write(items);
                }}>↑</button>
                <button type="button" aria-label={`Move ${item.name} down`} disabled={index === batch.items.length - 1 || processing || batchBusy} onClick={() => {
                  const items = [...batch.capture()]; [items[index + 1], items[index]] = [items[index], items[index + 1]]; batch.write(items);
                }}>↓</button>
                <button type="button" aria-label={`Remove ${item.name}`} disabled={processing || batchBusy} onClick={() => {
                  const remaining = batch.capture().filter((entry) => entry.id !== item.id);
                  const removingActive = batch.activeIdRef.current === item.id;
                  if (!remaining.length) { clearWorkspace(); return; }
                  if (removingActive) batch.activeIdRef.current = null;
                  batch.write(remaining);
                  if (removingActive) activateBatchItem(remaining[Math.min(index, remaining.length - 1)]);
                }}>Remove</button>
                {item.state.result && <button type="button" onClick={() => {
                  const latest = batch.capture().find((entry) => entry.id === item.id);
                  if (latest?.state.result) downloadBlob(new Blob([latest.state.result.edited], { type: OCR_TEXT_OUTPUT.mimeType }), safeTextFilename(latest.name));
                }} aria-label={`Download text for ${item.name}`}>.txt</button>}
              </div>
              {item.state.error && <p className="ocr-batch-item-error">{item.state.error.message}</p>}
            </li>)}
          </ol>
          <div className="ocr-batch-actions">
            <button className="button button--primary" type="button" disabled={processing || batchBusy || state.status === "decoding" || !batch.items.some((item) => item.state.image && !item.state.result)} onClick={() => void runBatch()}>Process pending images</button>
            <button className="button button--quiet" type="button" disabled={processing || batchBusy || state.status === "decoding"} onClick={() => batchFileInputRef.current?.click()}>Add more images</button>
            <button className="button button--quiet" type="button" disabled={!batch.items.some((item) => item.state.result)} onClick={() => downloadBlob(new Blob([combinedBatchText(batch.capture())], { type: OCR_TEXT_OUTPUT.mimeType }), "image-batch.txt")}>Combined text .txt</button>
            <button className="button button--quiet" type="button" disabled={!batch.items.some((item) => item.state.result)} onClick={() => downloadBlob(separateBatchTextZip(batch.capture()), "image-text-files.zip")}>Separate text files .zip</button>
          </div>
        </section>}
        {batchProgress && <p className="ocr-batch-status" role="status">{batchProgress}</p>}
        {batchBusy && <button className="button button--quiet" type="button" onClick={() => { intakeGenerationRef.current += 1; setBatchBusy(false); setBatchProgress("Adding images cancelled."); }}>Cancel adding images</button>}
        {batchError && <p className="error-message" role="alert">{batchError}</p>}

        <div className="workspace">
          <section className="work-panel image-panel" aria-labelledby="image-title"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event: DragEvent<HTMLElement>) => {
              event.preventDefault();
              setIsDragging(false);
              if (batchRunning || regionBusy || batchBusy || sampleBusy) return;
              const files = Array.from(event.dataTransfer.files);
              if (files.length > 1) {
                if (processing) { setBatchError("Cancel the current run before adding a batch."); return; }
                void addBatchFiles(files);
              } else if (files[0]) void handleFile(files[0]);
            }}>
            <div className="panel-heading">
              <div>
                <span className="step-number">01</span>
                <h3 id="image-title">Image</h3>
              </div>
              {state.image && (
                <div className="panel-heading__actions">
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={batchRunning || regionBusy || batchBusy || sampleBusy}
                  >
                    Replace
                  </button>
                  <button className="text-button" type="button" disabled={processing || batchBusy || state.status === "decoding"} onClick={() => batchFileInputRef.current?.click()}>Add to batch</button>
                  <button
                    className="text-button text-button--danger"
                    type="button"
                    onClick={() => void clearWorkspace()}
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              className="visually-hidden-input"
              type="file"
              multiple
              disabled={batchRunning || regionBusy || batchBusy || sampleBusy}
              aria-label="Choose image file"
              accept={OCR_IMAGE_ACCEPT}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                if (files.length > 1) void addBatchFiles(files);
                else if (files[0]) void handleFile(files[0]);
                event.currentTarget.value = "";
              }}
            />

            {!state.image ? (
              <div
                className={`dropzone${isDragging ? " is-dragging" : ""}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                    setIsDragging(false);
                  }
                }}
              >
                <svg
                  className="dropzone-illustration"
                  viewBox="0 0 240 118"
                  role="img"
                  aria-label="An image page becoming editable lines of text"
                >
                  <rect x="18" y="14" width="82" height="90" rx="8" />
                  <circle cx="40" cy="38" r="8" />
                  <path d="m29 86 20-21 14 13 12-12 14 20" />
                  <path className="illustration-arrow" d="M112 59h29m-9-9 10 9-10 9" />
                  <path className="illustration-line" d="M158 31h63M158 50h49M158 69h63M158 88h42" />
                </svg>
                <h4 className="dropzone__title">Add an image</h4>
                <p>Paste, drop or choose an image: {OCR_IMAGE_FORMAT_LABEL}.</p>
                <div className="dropzone__actions">
                  <button
                    ref={pasteButtonRef}
                    className="button button--primary"
                    type="button"
                    onClick={() => void readClipboard()}
                    disabled={batchBusy || sampleBusy}
                  >
                    Paste image
                  </button>
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={batchBusy || sampleBusy}
                  >
                    Choose image
                  </button>
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={() => void loadSample("mixed")}
                    disabled={batchBusy || controlsBusy}
                  >
                    Try a sample
                  </button>
                </div>
                <div className="ocr-samples" aria-label="Try a sample image">
                  <span role="status">{sampleBusy ? "Loading sample…" : "More samples:"}</span>
                  {(["screenshot", "receipt", "terminal"] as const).map((sample) => <button type="button" className="text-button" key={sample}
                    disabled={controlsBusy || batchBusy} onClick={() => void loadSample(sample)}>{sample[0].toUpperCase() + sample.slice(1)}</button>)}
                </div>
                <p className="dropzone__hint">
                  Up to {productConfig.fileLimits.maximumFileSizeLabel} and{" "}
                  {productConfig.fileLimits.maximumDecodedPixelsLabel}. If an image is very
                  large, its preview is reduced locally. Select multiple images
                  for a batch of up to 10 images and 100 MiB total.
                </p>
              </div>
            ) : (
              <>
                <div className="image-stage" aria-busy={renderBusy}>
                  <canvas
                    ref={canvasRef}
                    aria-label="Locally prepared image preview"
                  />
                  {renderBusy && <p className="canvas-status">Rendering locally…</p>}
                </div>
                <dl className="file-details">
                  <div>
                    <dt>File</dt>
                    <dd>{state.image.name}{state.image.intakeSource === "sample" ? " (bundled with this site)" : ""}</dd>
                  </div>
                  <div>
                    <dt>Original</dt>
                    <dd>
                      {state.image.width} × {state.image.height}px
                    </dd>
                  </div>
                  <div>
                    <dt>Size</dt>
                    <dd>{formatFileSize(state.image.size)}</dd>
                  </div>
                  <div>
                    <dt>Preview</dt>
                    <dd
                      data-preparation-profile={state.preparation?.profile}
                      data-preparation-scale={state.preparation?.scale}
                      data-scale-action={state.preparation?.scaleAction}
                      data-thresholding-method={
                        state.preparation?.thresholdingMethod
                      }
                      data-polarity-inverted={
                        state.preparation
                          ? String(state.preparation.polarityInverted)
                          : undefined
                      }
                    >
                      {state.preparation
                        ? `${state.preparation.preparedWidth} × ${state.preparation.preparedHeight}px · ${preparationScaleLabel(state.preparation)}`
                        : "Preparing"}
                    </dd>
                  </div>
                  <div className="file-details__wide">
                    <dt>Recognition</dt>
                    <dd
                      data-recognition-strategy={plannedRecognition?.strategy}
                      data-recognition-sections={
                        plannedRecognition?.sectionCount
                      }
                    >
                      {plannedRecognition?.strategy === "vertical-tiles"
                        ? `${plannedRecognition.sectionCount} local sections at source detail`
                        : plannedRecognition
                          ? "One bounded local image"
                          : "Preparing"}
                    </dd>
                  </div>
                </dl>

                <div className="image-toolbar" aria-label="Image edits">
                  <button
                    ref={cropButtonRef}
                    className="tool-button"
                    type="button"
                    onClick={() => {
                      dispatch({ type: "editStart" });
                      setCropOpen(true);
                    }}
                    disabled={controlsBusy}
                  >
                    <span aria-hidden="true">⌗</span> Crop
                  </button>
                  <button
                    className="tool-button"
                    type="button"
                    onClick={() => dispatch({ type: "rotate", direction: "left" })}
                    disabled={controlsBusy}
                  >
                    <span aria-hidden="true">↶</span> Rotate left
                  </button>
                  <button
                    className="tool-button"
                    type="button"
                    onClick={() =>
                      dispatch({ type: "rotate", direction: "right" })
                    }
                    disabled={controlsBusy}
                  >
                    <span aria-hidden="true">↷</span> Rotate right
                  </button>
                  <button
                    className="tool-button"
                    type="button"
                    onClick={() => {
                      ocrSessionOverrides.preset = "original";
                      dispatch({ type: "resetImageEdits" });
                    }}
                    disabled={controlsBusy}
                  >
                    Reset changes
                  </button>
                </div>

                <div className="control-grid">
                  <label>
                    <span>Enhancement</span>
                    <select
                      value={state.transform.preset}
                      onChange={(event) => {
                        ocrSessionOverrides.preset = event.currentTarget.value as typeof state.transform.preset;
                        dispatch({
                          type: "setPreset",
                          preset: event.currentTarget.value as typeof state.transform.preset,
                        });
                      }}
                      disabled={controlsBusy}
                    >
                      {ENHANCEMENT_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                    <small>
                      {
                        ENHANCEMENT_PRESETS.find(
                          (preset) => preset.id === state.transform.preset,
                        )?.description
                      }
                    </small>
                  </label>
                  <label>
                    <span>Content type</span>
                    <select
                      value={state.contentMode}
                      onChange={(event) => {
                        ocrSessionOverrides.contentMode = event.currentTarget.value as typeof state.contentMode;
                        dispatch({
                          type: "setContentMode",
                          mode: event.currentTarget.value as typeof state.contentMode,
                        });
                      }}
                      disabled={controlsBusy}
                    >
                      {OCR_CONTENT_MODES.map((mode) => (
                        <option key={mode.id} value={mode.id}>
                          {mode.label}{state.suggestedContentMode === mode.id ? " (suggested)" : ""}
                        </option>
                      ))}
                    </select>
                    <small>
                      {
                        OCR_CONTENT_MODES.find(
                          (mode) => mode.id === state.contentMode,
                        )?.description
                      }
                    </small>
                  </label>

                </div>

                {!processing && !preparingInitial && (!state.result || resultLanguagesChanged) && (
                  <div className="ocr-primary-action">
                    <button
                      ref={extractButtonRef}
                      className="button button--primary extract-button"
                      type="button"
                      disabled={renderBusy || batchBusy || sampleBusy || state.status === "decoding" || !state.preparation}
                      onClick={() => void runOcr()}
                    >
                      Re-run OCR
                      <span aria-hidden="true">→</span>
                    </button>
                  </div>
                )}
              </>
            )}

            {state.error && (
              <div className="error-message" role="alert">
                <p>{state.error.message}</p>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => dispatch({ type: "dismissError" })}
                >
                  Dismiss
                </button>
              </div>
            )}
          </section>

          <section ref={resultPanelRef} className="work-panel result-panel" aria-labelledby="result-title">
            <div className="panel-heading">
              <div>
                <span className="step-number">02</span>
                <h3 id="result-title">Recognised text</h3>
              </div>
              {state.result && (
                <span className="confidence-label">
                  Engine confidence{" "}
                  {state.result.confidence === null
                    ? "unavailable"
                    : `${Math.round(state.result.confidence)}%`}
                  {" · "}Estimate only, not a guarantee
                </span>
              )}
            </div>

            <p className="caveat">This site does not upload your image or recognised text.</p>
            {(processing || preparingInitial) && (
              <div className="ocr-progress">
                <div>
                  <p aria-live="polite" aria-atomic="true">
                    {batchRunning ? batchProgress : regionBusy ? "Recognising the selected region locally" : state.progress?.stage ?? "Preparing local OCR"}
                  </p>
                  <span>{elapsedSeconds}s elapsed</span>
                </div>
                {state.progress?.value === null || state.progress?.value === undefined ? (
                  <div className="indeterminate-progress" aria-hidden="true" />
                ) : (
                  <progress max="1" value={state.progress.value}
                    aria-label={state.progress.stage} aria-valuetext={state.progress.stage} />
                )}
                <p className="ocr-progress__note">
                  The first run may take longer while the selected local models is prepared and cached.
                  {plannedRecognition?.strategy === "vertical-tiles" &&
                    " Long pages are processed section by section in this browser."}
                </p>
                <div className="ocr-primary-action">
                  <button className="button button--quiet" type="button" onClick={cancelProcessing}>Cancel</button>
                </div>
              </div>
            )}
            {!state.result && !processing && !preparingInitial && (
              <div className="result-empty">
                <div className="result-empty__paper" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <h4>Your editable result will appear here</h4>
                <p>
                  Add an image to extract text automatically. After adjustments, choose Re-run OCR.
                </p>
              </div>
            )}
            {state.result && (
              <>
                <div className="result-stats" aria-label="Result statistics">
                  <span>{counts.characters} characters</span>
                  <span>{counts.words} words</span>
                  <span>
                    {(state.result.elapsedMs / 1000).toFixed(1)}s processing
                  </span>
                  <span
                    data-result-recognition-strategy={
                      state.result.recognition.strategy
                    }
                    data-result-recognition-sections={
                      state.result.recognition.sectionCount
                    }
                    data-result-total-prepared-pixels={
                      state.result.recognition.totalPreparedPixels
                    }
                    data-result-peak-prepared-width={
                      state.result.recognition.peakPreparedSize.width
                    }
                    data-result-peak-prepared-height={
                      state.result.recognition.peakPreparedSize.height
                    }
                    data-result-section-deskew-radians={JSON.stringify(
                      state.result.recognition.sections.map(
                        (section) => section.rotateRadians,
                      ),
                    )}
                    data-result-section-input-rects={JSON.stringify(
                      state.result.recognition.sections.map(
                        (section) => section.inputRect,
                      ),
                    )}
                    data-result-section-core-rects={JSON.stringify(
                      state.result.recognition.sections.map(
                        (section) => section.coreRect,
                      ),
                    )}
                  >
                    {state.result.recognition.strategy === "vertical-tiles"
                      ? `${state.result.recognition.sectionCount} sections combined locally`
                      : "One local recognition image"}
                  </span>
                  {state.result.recognition.strategy === "single-canvas" &&
                    deskewDegrees >= 0.5 && (
                    <span>
                      Fine deskew about {deskewDegrees.toFixed(1)}° · engine estimate
                    </span>
                  )}
                  {state.result.recognition.strategy === "vertical-tiles" &&
                    materialDeskewSections.length > 0 && (
                      <span>
                        Fine deskew applied in {materialDeskewSections.length}{" "}
                        {materialDeskewSections.length === 1
                          ? "section"
                          : "sections"}
                        {" · "}engine estimates
                      </span>
                    )}
                </div>
                <div className="result-tabs" aria-label="Result version">
                  {(["raw", "cleaned", "markdown", "edited"] as ResultView[]).map((view) => (
                    <button
                      key={view}
                      type="button"
                      aria-pressed={state.resultView === view}
                      onClick={() => dispatch({ type: "setResultView", view })}
                    >
                      {resultViewCopy[view].label}
                    </button>
                  ))}
                </div>
                <label className="result-editor">
                  <span id="ocr-result-label">{resultViewCopy[state.resultView].label}</span>
                  <small id="ocr-result-help">{resultViewCopy[state.resultView].description}</small>
                  <textarea
                    aria-labelledby="ocr-result-label"
                    aria-describedby="ocr-result-help"
                    value={resultText}
                    readOnly={state.resultView !== "edited"}
                    onChange={(event) =>
                      dispatch({
                        type: "editResult",
                        value: event.currentTarget.value,
                      })
                    }
                    spellCheck={false}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                  />
                </label>

                {state.resultView !== "edited" && (
                  <button
                    className="text-button edit-version"
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "replaceEdited",
                        value: resultText,
                        view: "edited",
                      })
                    }
                  >
                    Edit this version
                  </button>
                )}

                <div className="result-actions">
                  {!processing && (
                    <div className={resultLanguagesChanged ? undefined : "ocr-primary-action"}>
                      <button
                        className="button button--primary"
                        type="button"
                        onClick={() => void copyText()}
                      >
                        Copy text
                      </button>
                    </div>
                  )}
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={() => downloadText()}
                  >
                    Download .txt
                  </button>
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={() => downloadText("md")}
                    title={state.resultView === "edited" ? "Download Your edits as Markdown" : "Download the Markdown version"}
                  >
                    Download .md
                  </button>
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "replaceEdited",
                        value: state.result?.cleaned ?? "",
                        view: "cleaned",
                      })
                    }
                  >
                    Reset result edits
                  </button>
                  <button
                    className="text-button text-button--danger"
                    type="button"
                    onClick={() => void clearWorkspace()}
                  >
                    Clear
                  </button>
                </div>
                {state.image && <OcrSourceReview key={`${batch.activeIdRef.current}:${state.image.name}:${state.result.elapsedMs}`} image={state.image} result={state.result}
                  disabled={processing || batchBusy} onRerun={rerunRegion} onCorrect={(start, end, replacement) => {
                    if (!state.result) return;
                    dispatch({ type: "editResult", value: state.result.edited.slice(0, start) + replacement + state.result.edited.slice(end) });
                  }} />}
              </>
            )}
          </section>
        </div>
        {/* CSS exposes one explanation/status placement per viewport, keeping
            mobile reading and focus order aligned without moving any headings. */}
        <div className="ocr-mobile-details">
          <OcrExplanation />
          <p className="ocr-mobile-readiness" aria-live="polite" aria-atomic="true" title={offlineStatus.description}>
            {offlineStatus.label}
          </p>
        </div>
      </section>

      <section className="privacy-proof ocr-tool-facts" aria-labelledby="ocr-tool-facts-title">
        <div className="section-heading">
          <h2 id="ocr-tool-facts-title">What this tool does</h2>
        </div>
        <dl className="ocr-tool-facts__list">
          {ocrToolFacts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>
                <span className={"mobileValue" in fact ? "ocr-desktop-fact" : undefined}>{fact.value}</span>
                {"mobileValue" in fact ? <span className="ocr-mobile-fact">{fact.mobileValue}</span> : null}
                {"verificationLink" in fact ? <> <Link to={routes.verify}>Verify browser-only processing</Link></> : null}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {__PDF_OCR_PUBLIC__ && routes.pdfToText ? (
        <section className="pdf-handoff-card" aria-labelledby="pdf-handoff-title">
          <div>
            <h3 id="pdf-handoff-title">PDF to text</h3>
            <p>Preview PDF pages and extract text with 12 OCR languages.</p>
          </div>
          <Link className="text-link" to={routes.pdfToText} target="_blank" rel="noopener noreferrer">Open PDF to text (opens in a new tab)</Link>
        </section>
      ) : null}

      <input ref={batchFileInputRef} className="visually-hidden-input" type="file" multiple
        disabled={processing || batchBusy || sampleBusy || state.status === "decoding"}
        accept={OCR_IMAGE_ACCEPT} aria-label="Add images to batch"
        onChange={(event) => { void addBatchFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }} />

      <section className="privacy-proof" aria-labelledby="privacy-proof-title">
        <div className="section-heading">
          <p className="eyebrow">How your image is processed</p>
          <h2 id="privacy-proof-title">
            OCR without uploading: how processing works
          </h2>
          <p>
            Follow the image from selection to editable text, then{" "}
            <Link to={routes.verify}>check the processing steps in your browser</Link>.
          </p>
        </div>
        <div className="privacy-proof__details">
          <ol
            className="privacy-flow"
            aria-label="Processing steps that stay in your browser"
          >
            {["Your image", "Your browser", "Text recognition", "Editable text"].map(
              (item, index) => (
                <li key={item}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {item}
                </li>
              ),
            )}
          </ol>
          <ul className="proof-facts">
            <li>No account or cloud history</li>
            <li>No user content in browser storage</li>
            <li>Clear removes your current work from the page</li>
          </ul>
          <p className="caveat">
            The selected OCR models are site files that may be downloaded and saved
            for offline use. They do not contain your image or recognised text.{" "}
            Copied text may be synchronised by your operating system if clipboard
            sync is enabled. Downloaded text is controlled by your browser and
            operating system. Clear cannot remove clipboard history or downloaded
            files. Browser extensions and device software are outside this site’s
            control.
          </p>
          <nav className="result-actions" aria-label="Privacy information">
            <button className="button button--quiet" type="button"
              disabled={shellCacheStatus !== "ready" || languageStatus.preparing.length > 0 || languages.every(id => languageStatus.ready.includes(id))}
              onClick={() => prepareOfflineOcrAssets(languages)}>
              Prepare offline OCR
            </button>
            <Link className="button button--quiet" to="/privacy">
              Read the privacy explanation
            </Link>
            <Link className="button button--quiet" to="/verify">
              Verify the privacy boundary
            </Link>
          </nav>
        </div>
      </section>

      <section className="use-cases" aria-labelledby="uses-title">
        <div className="section-heading">
          <p className="eyebrow">Useful with clear printed text</p>
          <h2 id="uses-title">Extract text from screenshots, scans and receipts</h2>
        </div>
        <div className="use-case-grid">
          {useCases.map((useCase, index) => (
            <article key={useCase.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{useCase.title}</h3>
              <p>{useCase.copy}</p>
              {useCase.guide ? (
                <Link className="text-link" to={useCase.guide.to}>
                  {useCase.guide.label} <span aria-hidden="true">→</span>
                </Link>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="limitations" aria-labelledby="limitations-title">
        <div>
          <p className="eyebrow">Worth knowing</p>
          <h2 id="limitations-title">What can OCR get wrong?</h2>
          <p>
            OCR can mistake characters and reading order. Compare important
            details with the original image before using the text.
          </p>
        </div>
        <ul>
          {limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </section>

      <HomepageFaq />

      <HelpfulGuides
        id="guides-title"
        guideSlugs={[
          "improve-ocr-accuracy",
          "photo-scan-to-text",
          "receipt-to-text",
          "offline-ocr-without-internet",
          "ocr-in-other-languages",
          "batch-ocr-multiple-images",
        ]}
        eyebrow="Helpful OCR guides"
        title="Get accurate, private OCR results"
      />

      <ToolDirectory id="other-tools-title" currentPath={routes.tool} newTab />

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {cropOpen && state.image && (
        <CropEditor
          imageUrl={state.image.objectUrl}
          initialCrop={state.transform.crop}
          returnFocus={cropButtonRef.current}
          onApply={(crop) => {
            dispatch({ type: "setCrop", crop });
            setCropOpen(false);
            setAnnouncement("Crop applied. OCR will use the selected area.");
          }}
          onCancel={() => {
            dispatch({ type: "editCancel" });
            setCropOpen(false);
          }}
        />
      )}

      {pendingLarge && (
        <div className="dialog-backdrop">
          <div
            ref={largeDialogRef}
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="large-image-title"
            aria-describedby="large-image-description"
          >
            <p className="eyebrow">Large image safeguard</p>
            <h2 id="large-image-title">Prepare a reduced preview?</h2>
            <p id="large-image-description">
              This {pendingLarge.width} × {pendingLarge.height}px image is within
              the image-size limit, but a full preview could use too much memory.
              Private Image to Text can reduce its preview to at most{" "}
              {FILE_LIMITS.maxWorkingSide}px in this tab. Eligible long documents
              can still be recognised in bounded local sections at source detail.
              The original file is not changed.
            </p>
            <div className="dialog-actions">
              <button
                className="button button--quiet"
                type="button"
                onClick={cancelPendingLarge}
              >
                Cancel
              </button>
              <button
                className="button button--primary"
                type="button"
                onClick={() =>
                  commitImage(
                    pendingLarge.file,
                    pendingLarge.width,
                    pendingLarge.height,
                    pendingLarge.operationId,
                    pendingLarge.intakeSource,
                  )
                }
              >
                Use reduced preview
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
