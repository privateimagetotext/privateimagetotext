import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { DEFAULT_OCR_LANGUAGES } from "../config/ocr-languages";
import { useOfflineShellStatus } from "./useOfflineReadiness";
import { PdfExtractionSession } from "../features/pdf/extraction-session";
import {
  PdfError,
  createPdfSafeError,
  isPdfError,
  toPdfSafeError,
  type PdfSafeError,
} from "../features/pdf/errors";
import { PdfJsAdapter } from "../features/pdf/pdfjs-adapter";
import { PdfPreviewRenderer } from "../features/pdf/preview-renderer";
import {
  parsePdfPageRange,
  selectAllPdfPages,
} from "../features/pdf/page-range";
import { buildPdfTextOutput } from "../features/pdf/output";
import {
  initialPdfState,
  pdfReducer,
} from "../features/pdf/state";
import type {
  PdfDocumentSession,
  PdfExtractionSettings,
  PdfForcedExtractionMethod,
} from "../features/pdf/types";
import { PDF_LIMITS } from "../features/pdf/validation";
import {
  checkOfflineOcrAssets,
  checkOfflinePdfAssets,
  prepareOfflineOcrAssets,
  prepareOfflinePdfAssets,
  subscribeOfflineLanguageStatus,
  subscribeOfflinePdfStatus,
  type OcrLanguageStatus,
  type PdfAssetStatus,
} from "../lib/service-worker";
import type { PdfConfirmation } from "../components/pdf/PdfConfirmDialog";

type PdfAdapterResource = Pick<PdfJsAdapter, "open" | "destroy">;
type PdfExtractionResource = Pick<
  PdfExtractionSession,
  "run" | "processPage" | "cancel" | "dispose"
>;

export type PdfWorkspaceDependencies = {
  readonly createPdfAdapter: () => PdfAdapterResource;
  readonly createExtractionSession: (
    document: PdfDocumentSession,
    isOcrSupportReady: (signal: AbortSignal, languages: readonly string[]) => boolean | Promise<boolean>,
  ) => PdfExtractionResource;
  readonly subscribePdfStatus: typeof subscribeOfflinePdfStatus;
  readonly subscribeLanguageStatus: typeof subscribeOfflineLanguageStatus;
  readonly checkPdfAssets: typeof checkOfflinePdfAssets;
  readonly checkOcrAssets: typeof checkOfflineOcrAssets;
  readonly preparePdfAssets: typeof prepareOfflinePdfAssets;
  readonly prepareOcrAssets: typeof prepareOfflineOcrAssets;
  readonly isOnline: () => boolean;
};

const defaultDependencies: PdfWorkspaceDependencies = {
  createPdfAdapter: () => new PdfJsAdapter(),
  createExtractionSession: (document, isOcrSupportReady) =>
    new PdfExtractionSession(document, { isOcrSupportReady }),
  subscribePdfStatus: subscribeOfflinePdfStatus,
  subscribeLanguageStatus: subscribeOfflineLanguageStatus,
  checkPdfAssets: checkOfflinePdfAssets,
  checkOcrAssets: checkOfflineOcrAssets,
  preparePdfAssets: prepareOfflinePdfAssets,
  prepareOcrAssets: prepareOfflineOcrAssets,
  isOnline: () => navigator.onLine,
};

type FileSummary = {
  readonly name: string;
  readonly size: number;
  readonly passwordProtected: boolean;
};

type PasswordPrompt = {
  readonly incorrect: boolean;
};

type PendingPassword = {
  readonly resolve: (password: string | null) => void;
  readonly removeAbortListener: () => void;
};

type PendingReprocess = {
  readonly pageNumber: number;
  readonly method: PdfForcedExtractionMethod;
};

function nextId(prefix: "document" | "operation", value: number) {
  return `pdf-${prefix}-${value}`;
}

function isOperationStatus(status: typeof initialPdfState.status) {
  return status === "preflighting" || status === "processing";
}

function formatSupportBytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function usePdfOcrWorkspace(
  suppliedDependencies: Partial<PdfWorkspaceDependencies> = {},
) {
  const dependenciesRef = useRef<PdfWorkspaceDependencies | null>(null);
  dependenciesRef.current ??= {
    ...defaultDependencies,
    ...suppliedDependencies,
  };
  const dependencies = dependenciesRef.current;
  const [state, dispatch] = useReducer(pdfReducer, initialPdfState);
  const [fileSummary, setFileSummary] = useState<FileSummary | null>(null);
  const [selectionKind, setSelectionKindState] = useState<"all" | "range">("all");
  const [rangeValue, setRangeValue] = useState("");
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<PdfSafeError | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordPrompt | null>(null);
  const [confirmation, setConfirmation] = useState<PdfConfirmation | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [pdfAssetStatus, setPdfAssetStatus] = useState<PdfAssetStatus | null>(null);
  const [languageStatus, setLanguageStatus] = useState<OcrLanguageStatus>({ ready: [], preparing: [], failed: false });
  const shellStatus = useOfflineShellStatus();
  const [preparingOffline, setPreparingOffline] = useState(false);
  const [inputVersion, setInputVersion] = useState(0);
  const [pickerRequestVersion, setPickerRequestVersion] = useState(0);
  const [selectionFocusVersion, setSelectionFocusVersion] = useState(0);
  const [resultFocusVersion, setResultFocusVersion] = useState(0);
  const [attemptPageNumber, setAttemptPageNumber] = useState<number | null>(null);

  const adapterRef = useRef<PdfAdapterResource | null>(null);
  const extractionRef = useRef<PdfExtractionResource | null>(null);
  const previewRef = useRef<PdfPreviewRenderer | null>(null);
  const pendingStartRef = useRef<{ operationId: string; cancelled: boolean } | null>(null);
  const pendingPasswordRef = useRef<PendingPassword | null>(null);
  const pendingReplacementRef = useRef<File | null>(null);
  const pendingReprocessRef = useRef<PendingReprocess | null>(null);
  const downloadUrlRef = useRef<string | null>(null);
  const documentSequenceRef = useRef(0);
  const operationSequenceRef = useRef(0);
  const lifecycleGenerationRef = useRef(0);
  const currentDocumentIdRef = useRef<string | null>(null);
  const currentOperationIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const pdfStatusRef = useRef<PdfAssetStatus | null>(null);
  const languageStatusRef = useRef<OcrLanguageStatus>(languageStatus);

  const activeError = actionError ?? state.error;
  const operationActive = isOperationStatus(state.status);
  const busy =
    operationActive ||
    state.status === "validating" ||
    state.status === "loading-document" ||
    state.status === "password-required";

  useEffect(() => {
    const unsubscribePdf = dependencies.subscribePdfStatus((status) => {
      pdfStatusRef.current = status;
      setPdfAssetStatus(status);
    });
    const unsubscribeLanguages = dependencies.subscribeLanguageStatus((status) => {
      languageStatusRef.current = status;
      setLanguageStatus(status);
    });
    void dependencies.checkPdfAssets();
    dependencies.checkOcrAssets();
    return () => {
      unsubscribePdf();
      unsubscribeLanguages();
    };
  }, [dependencies]);

  const releaseDownloadUrl = useCallback(() => {
    if (!downloadUrlRef.current) return;
    URL.revokeObjectURL(downloadUrlRef.current);
    downloadUrlRef.current = null;
  }, []);

  const settlePassword = useCallback((candidate: string | null) => {
    const pending = pendingPasswordRef.current;
    pendingPasswordRef.current = null;
    if (!pending) return;
    pending.removeAbortListener();
    pending.resolve(candidate);
  }, []);

  const disposeResources = useCallback(async () => {
    lifecycleGenerationRef.current += 1;
    const generation = lifecycleGenerationRef.current;
    currentDocumentIdRef.current = null;
    currentOperationIdRef.current = null;
    settlePassword(null);
    setPasswordPrompt(null);
    const extraction = extractionRef.current;
    const adapter = adapterRef.current;
    const preview = previewRef.current;
    previewRef.current = null;
    if (pendingStartRef.current) pendingStartRef.current.cancelled = true;
    extractionRef.current = null;
    adapterRef.current = null;
    releaseDownloadUrl();
    await preview?.dispose();
    if (extraction) {
      await extraction.cancel().catch(() => undefined);
      await extraction.dispose().catch(() => undefined);
    }
    await adapter?.destroy().catch(() => undefined);
    if (generation === lifecycleGenerationRef.current) busyRef.current = false;
    return generation;
  }, [releaseDownloadUrl, settlePassword]);

  const resetWorkspaceView = useCallback(() => {
    dispatch({ type: "clear" });
    setFileSummary(null);
    setActionError(null);
    setSelectionError(null);
    setSelectionKindState("all");
    setRangeValue("");
    setAttemptPageNumber(null);
    setConfirmation(null);
    pendingReplacementRef.current = null;
    pendingReprocessRef.current = null;
    setInputVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    const handlePageHide = () => {
      // BFCache can preserve React state after the worker resources are gone.
      // Reset both sides of the workspace; returning requires a fresh selection.
      resetWorkspaceView();
      void disposeResources();
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      resetWorkspaceView();
      setAnnouncement("The previous PDF workspace was cleared when you left this page. Choose the PDF again to continue.");
      setSelectionFocusVersion((value) => value + 1);
    };
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      void disposeResources();
    };
  }, [disposeResources, resetWorkspaceView]);

  const applySelection = useCallback(
    (kind: "all" | "range", value: string, pageCount = state.document?.pageCount) => {
      const documentId = currentDocumentIdRef.current;
      if (!documentId || !pageCount) return false;
      try {
        const pages =
          kind === "all"
            ? selectAllPdfPages(pageCount)
            : parsePdfPageRange(value, pageCount);
        setSelectionError(null);
        dispatch({ type: "selectionChanged", documentId, selectedPages: pages });
        return true;
      } catch (error) {
        const safe = toPdfSafeError(error, "PDF_PAGE_RANGE_INVALID");
        const message =
          safe.code === "PDF_SELECTED_PAGE_LIMIT_EXCEEDED" && kind === "all"
            ? `This document has more than ${PDF_LIMITS.maxSelectedPages} pages. Choose a page range instead.`
            : safe.message;
        setSelectionError(message);
        dispatch({ type: "selectionChanged", documentId, selectedPages: [] });
        return false;
      }
    },
    [state.document?.pageCount],
  );

  const setSelectionKind = useCallback(
    (kind: "all" | "range") => {
      setSelectionKindState(kind);
      applySelection(kind, rangeValue);
    },
    [applySelection, rangeValue],
  );

  const changeRange = useCallback(
    (value: string) => {
      setRangeValue(value);
      if (selectionKind === "range") applySelection("range", value);
    },
    [applySelection, selectionKind],
  );

  const openFile = useCallback(
    async (file: File) => {
      const generation = await disposeResources();
      // Teardown may finish after Clear, another selection, or route departure.
      if (generation !== lifecycleGenerationRef.current) return;
      dispatch({ type: "clear" });
      setFileSummary(null);
      setActionError(null);
      setSelectionError(null);
      setRangeValue("");
      setInputVersion((value) => value + 1);

      documentSequenceRef.current += 1;
      const documentId = nextId("document", documentSequenceRef.current);
      busyRef.current = true;
      currentDocumentIdRef.current = documentId;
      dispatch({ type: "documentValidationStarted", documentId });

      const offlinePdfReady = dependencies.isOnline()
        ? true
        : pdfStatusRef.current === "PDF reader available offline" ||
          (await dependencies.checkPdfAssets().catch(() => false));
      if (currentDocumentIdRef.current !== documentId || generation !== lifecycleGenerationRef.current) return;
      if (!offlinePdfReady) {
        const error = createPdfSafeError("PDF_READER_SUPPORT_UNAVAILABLE_OFFLINE");
        dispatch({ type: "documentFailed", documentId, error });
        setActionError(error);
        setSelectionFocusVersion((value) => value + 1);
        currentDocumentIdRef.current = null;
        busyRef.current = false;
        return;
      }

      const adapter = dependencies.createPdfAdapter();
      adapterRef.current = adapter;
      let passwordProtected = false;
      try {
        dispatch({ type: "documentLoadingStarted", documentId });
        const documentSession = await adapter.open(file, {
          requestPassword: ({ reason, signal }) => {
            if (
              currentDocumentIdRef.current !== documentId ||
              generation !== lifecycleGenerationRef.current
            ) {
              return Promise.resolve(null);
            }
            passwordProtected = true;
            dispatch({ type: "passwordRequired", documentId });
            setPasswordPrompt({ incorrect: reason === "incorrect" });
            return new Promise<string | null>((resolve) => {
              settlePassword(null);
              const abort = () => {
                if (pendingPasswordRef.current?.resolve === resolve) {
                  pendingPasswordRef.current = null;
                  setPasswordPrompt(null);
                  resolve(null);
                }
              };
              signal.addEventListener("abort", abort, { once: true });
              pendingPasswordRef.current = {
                resolve,
                removeAbortListener: () => signal.removeEventListener("abort", abort),
              };
            });
          },
        });
        if (
          currentDocumentIdRef.current !== documentId ||
          generation !== lifecycleGenerationRef.current
        ) {
          await documentSession.destroy();
          return;
        }
        setPasswordPrompt(null);
        previewRef.current = new PdfPreviewRenderer(documentSession);
        extractionRef.current = dependencies.createExtractionSession(
          documentSession,
          (_signal, languages) =>
            dependencies.isOnline() ||
            languages.every((id) => languageStatusRef.current.ready.includes(id)),
        );
        setFileSummary({
          name: file.name || "Selected PDF",
          size: file.size,
          passwordProtected,
        });
        dispatch({
          type: "documentReady",
          document: {
            documentId,
            pageCount: documentSession.pageCount,
            pageLabels: documentSession.pageLabels,
          },
        });
        const initialKind =
          documentSession.pageCount <= PDF_LIMITS.maxSelectedPages ? "all" : "range";
        setSelectionKindState(initialKind);
        applySelection(initialKind, "", documentSession.pageCount);
        setAnnouncement("PDF ready. Choose pages and a processing method.");
      } catch (error) {
        await adapter.destroy().catch(() => undefined);
        if (adapterRef.current === adapter) adapterRef.current = null;
        if (
          currentDocumentIdRef.current !== documentId ||
          generation !== lifecycleGenerationRef.current
        ) return;
        if (isPdfError(error) && error.code === "PDF_PASSWORD_CANCELLED") {
          currentDocumentIdRef.current = null;
          busyRef.current = false;
          dispatch({ type: "clear" });
          setPasswordPrompt(null);
          setAnnouncement("PDF selection cancelled.");
          setSelectionFocusVersion((value) => value + 1);
          return;
        }
        const safe = toPdfSafeError(error, "PDF_OPEN_FAILED");
        dispatch({ type: "documentFailed", documentId, error: safe });
        setActionError(safe);
        setPasswordPrompt(null);
        setSelectionFocusVersion((value) => value + 1);
        currentDocumentIdRef.current = null;
        busyRef.current = false;
      } finally {
        if (currentDocumentIdRef.current === documentId) busyRef.current = false;
      }
    },
    [applySelection, dependencies, disposeResources, settlePassword],
  );

  const receiveFiles = useCallback(
    (files: FileList | readonly File[]) => {
      if (files.length !== 1) {
        setActionError({
          ...createPdfSafeError("PDF_SIGNATURE_INVALID"),
          message: "Choose one PDF at a time.",
        });
        setAnnouncement("Choose one PDF at a time.");
        setSelectionFocusVersion((value) => value + 1);
        return;
      }
      const file = files[0];
      if (currentDocumentIdRef.current || fileSummary || busyRef.current) {
        pendingReplacementRef.current = file;
        setConfirmation({ kind: "replace" });
      } else {
        void openFile(file);
      }
    },
    [fileSummary, openFile],
  );

  const updateSettings = useCallback((settings: PdfExtractionSettings) => {
    const documentId = currentDocumentIdRef.current;
    if (!documentId || busyRef.current) return;
    dispatch({ type: "settingsChanged", documentId, settings });
  }, []);

  const startOperation = useCallback(async () => {
    const documentId = currentDocumentIdRef.current;
    const session = extractionRef.current;
    if (!documentId || !session || !state.document) return;
    if (busyRef.current) {
      setActionError(createPdfSafeError("PDF_OPERATION_IN_PROGRESS"));
      return;
    }
    if (!applySelection(selectionKind, rangeValue) || state.selectedPages.length === 0) {
      setSelectionFocusVersion((value) => value + 1);
      return;
    }
    busyRef.current = true;
    setActionError(null);
    setAttemptPageNumber(null);
    operationSequenceRef.current += 1;
    const operationId = nextId("operation", operationSequenceRef.current);
    currentOperationIdRef.current = operationId;
    dispatch({
      type: "operationStarted",
      documentId,
      operationId,
      selectedPages: state.selectedPages,
      settings: state.settings,
      preflighting: state.settings.mode === "automatic",
    });
    setAnnouncement("Local PDF processing started.");
    const pendingStart = { operationId, cancelled: false };
    pendingStartRef.current = pendingStart;
    try {
      await previewRef.current?.stop();
      if (currentDocumentIdRef.current !== documentId || currentOperationIdRef.current !== operationId) return;
      if (pendingStart.cancelled) {
        dispatch({ type: "operationCancelled", documentId, operationId });
        setAnnouncement("PDF processing cancelled.");
        return;
      }
      pendingStartRef.current = null;
      const result = await session.run({
        documentId,
        operationId,
        selectedPages: state.selectedPages,
        settings: state.settings,
        onProgress: (progress) =>
          dispatch({ type: "progressChanged", documentId, operationId, progress }),
        onPageStatus: (pageNumber, status) =>
          dispatch({ type: "pageStatusChanged", documentId, operationId, pageNumber, status }),
        onPageResult: (result) =>
          dispatch({ type: "pageResult", documentId, operationId, result }),
      });
      if (currentDocumentIdRef.current !== documentId || currentOperationIdRef.current !== operationId) return;
      dispatch({ type: "operationCompleted", documentId, operationId, result });
      setAnnouncement(
        result.outcome === "cancelled"
          ? "Processing cancelled. Completed pages were retained."
          : result.outcome === "complete"
            ? "PDF processing complete."
            : "PDF processing finished with pages to review.",
      );
      setResultFocusVersion((value) => value + 1);
    } catch (error) {
      if (currentDocumentIdRef.current !== documentId || currentOperationIdRef.current !== operationId) return;
      const safe = toPdfSafeError(error);
      dispatch({ type: "operationFailed", documentId, operationId, error: safe });
      setActionError(safe);
      setAnnouncement(safe.message);
      if (safe.code === "PDF_OCR_PAGE_LIMIT_EXCEEDED") {
        setSelectionFocusVersion((value) => value + 1);
      }
    } finally {
      if (pendingStartRef.current === pendingStart) pendingStartRef.current = null;
      if (currentOperationIdRef.current === operationId) busyRef.current = false;
    }
  }, [applySelection, rangeValue, selectionKind, state.document, state.selectedPages, state.settings]);

  const requestStart = useCallback(() => {
    if (state.result?.pages.some((page) => page.status === "complete" && page.edited !== page.cleaned)) {
      setConfirmation({ kind: "restart" });
      return;
    }
    void startOperation();
  }, [startOperation, state.result?.pages]);

  const cancelOperation = useCallback(async () => {
    const session = extractionRef.current;
    if (!session || !busyRef.current) return;
    setAnnouncement("Cancelling local PDF processing.");
    if (pendingStartRef.current) pendingStartRef.current.cancelled = true;
    await session.cancel();
  }, []);

  const runPage = useCallback(
    async (pageNumber: number, method: PdfForcedExtractionMethod) => {
      const documentId = currentDocumentIdRef.current;
      const session = extractionRef.current;
      if (!documentId || !session || !state.result || busyRef.current) return;
      busyRef.current = true;
      setActionError(null);
      setAttemptPageNumber(pageNumber);
      operationSequenceRef.current += 1;
      const operationId = nextId("operation", operationSequenceRef.current);
      currentOperationIdRef.current = operationId;
      dispatch({ type: "singlePageOperationStarted", documentId, operationId, pageNumber });
      setAnnouncement(`Reprocessing page ${pageNumber}.`);
      const pendingStart = { operationId, cancelled: false };
      pendingStartRef.current = pendingStart;
      try {
        await previewRef.current?.stop();
        if (currentDocumentIdRef.current !== documentId || currentOperationIdRef.current !== operationId) return;
        if (pendingStart.cancelled) throw new PdfError("PDF_OPERATION_CANCELLED");
        pendingStartRef.current = null;
        const result = await session.processPage({
          documentId,
          operationId,
          pageNumber,
          method,
          settings: state.settings,
          onProgress: (progress) =>
            dispatch({ type: "progressChanged", documentId, operationId, progress }),
          onPageStatus: (changedPage, status) =>
            dispatch({ type: "pageStatusChanged", documentId, operationId, pageNumber: changedPage, status }),
        });
        if (currentDocumentIdRef.current !== documentId || currentOperationIdRef.current !== operationId) return;
        dispatch({
          type: result.status === "complete" ? "singlePageOperationCompleted" : "singlePageOperationFailed",
          documentId,
          operationId,
          pageNumber,
          result,
        });
        setAnnouncement(
          result.status === "complete"
            ? `Page ${pageNumber} was replaced with the new local result.`
            : `Page ${pageNumber} could not be reprocessed. Previous useful text was retained where available.`,
        );
        if (result.status === "complete") setAttemptPageNumber(null);
      } catch (error) {
        if (currentDocumentIdRef.current !== documentId || currentOperationIdRef.current !== operationId) return;
        const safe = toPdfSafeError(error);
        if (safe.code === "PDF_OPERATION_CANCELLED" || safe.code === "PDF_RENDER_CANCELLED") {
          dispatch({ type: "singlePageOperationCancelled", documentId, operationId, pageNumber });
          setAnnouncement(`Page ${pageNumber} reprocessing was cancelled. Previous text was retained.`);
        } else {
          const previous = state.result.pages.find((page) => page.pageNumber === pageNumber);
          const failed = {
            ...(previous ?? {
              pageNumber,
              status: "failed" as const,
              method: method === "ocr" ? ("ocr" as const) : ("embedded-text" as const),
              raw: "",
              cleaned: "",
              edited: "",
              confidence: null,
              elapsedMs: 0,
              textLayerAssessment: null,
              warnings: [],
              render: null,
            }),
            status: "failed" as const,
            error: safe,
          };
          dispatch({ type: "singlePageOperationFailed", documentId, operationId, pageNumber, result: failed });
          setAnnouncement(safe.message);
        }
      } finally {
        if (pendingStartRef.current === pendingStart) pendingStartRef.current = null;
        if (currentOperationIdRef.current === operationId) busyRef.current = false;
      }
    },
    [state.result, state.settings],
  );

  const requestReprocess = useCallback(
    (pageNumber: number, method: PdfForcedExtractionMethod) => {
      const page = state.result?.pages.find((item) => item.pageNumber === pageNumber);
      if (page?.status === "complete" && page.edited !== page.cleaned) {
        pendingReprocessRef.current = { pageNumber, method };
        setConfirmation({ kind: "reprocess", pageNumber });
        return;
      }
      void runPage(pageNumber, method);
    },
    [runPage, state.result?.pages],
  );

  const requestClear = useCallback(() => {
    if (currentDocumentIdRef.current || fileSummary || busyRef.current) {
      setConfirmation({ kind: "clear" });
    }
  }, [fileSummary]);

  const requestReplace = useCallback(() => {
    setAnnouncement("Choose a replacement PDF.");
    setPickerRequestVersion((value) => value + 1);
  }, []);

  const clearWorkspace = useCallback(async () => {
    const generation = await disposeResources();
    if (generation !== lifecycleGenerationRef.current) return;
    resetWorkspaceView();
    setAnnouncement("PDF and results cleared from the workspace.");
    setSelectionFocusVersion((value) => value + 1);
  }, [disposeResources, resetWorkspaceView]);

  const confirmPending = useCallback(() => {
    const pending = confirmation;
    setConfirmation(null);
    if (pending?.kind === "clear") {
      void clearWorkspace();
    } else if (pending?.kind === "replace") {
      const file = pendingReplacementRef.current;
      pendingReplacementRef.current = null;
      if (file) void openFile(file);
    } else if (pending?.kind === "reprocess") {
      const request = pendingReprocessRef.current;
      pendingReprocessRef.current = null;
      if (request) void runPage(request.pageNumber, request.method);
    } else if (pending?.kind === "restart") {
      void startOperation();
    }
  }, [clearWorkspace, confirmation, openFile, runPage, startOperation]);

  const cancelPending = useCallback(() => {
    pendingReplacementRef.current = null;
    pendingReprocessRef.current = null;
    setConfirmation(null);
    setAnnouncement("Current PDF and results retained.");
  }, []);

  const submitPassword = useCallback(
    (password: string) => {
      settlePassword(password);
    },
    [settlePassword],
  );

  const cancelPassword = useCallback(() => {
    settlePassword(null);
    setPasswordPrompt(null);
  }, [settlePassword]);

  const selectResultPage = useCallback((pageNumber: number) => {
    const documentId = currentDocumentIdRef.current;
    if (documentId) dispatch({ type: "activeResultPageChanged", documentId, pageNumber });
  }, []);

  const renderPreview = useCallback((pageNumber: number, signal: AbortSignal) => {
    if (busyRef.current || !previewRef.current) {
      return Promise.reject(new PdfError("PDF_RENDER_CANCELLED"));
    }
    return previewRef.current.render(pageNumber, signal);
  }, []);

  const editPage = useCallback((pageNumber: number, value: string) => {
    const documentId = currentDocumentIdRef.current;
    const operationId = currentOperationIdRef.current;
    if (!documentId || !operationId) return;
    setActionError(null);
    dispatch({ type: "editPageText", documentId, operationId, pageNumber, value });
  }, []);

  const buildOutput = useCallback(() => {
    if (!state.result || !fileSummary) throw new PdfError("PDF_INTERNAL_PROCESSING_ERROR");
    return buildPdfTextOutput(state.result, fileSummary.name);
  }, [fileSummary, state.result]);

  const copyAll = useCallback(async () => {
    try {
      const output = buildOutput();
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(output.combinedText);
      } else {
        const fallback = document.createElement("textarea");
        fallback.className = "clipboard-fallback";
        fallback.setAttribute("spellcheck", "false");
        fallback.autocomplete = "off";
        fallback.setAttribute("autocorrect", "off");
        fallback.setAttribute("autocapitalize", "off");
        fallback.value = output.combinedText;
        try {
          document.body.append(fallback);
          fallback.select();
          if (!document.execCommand("copy")) throw new Error("copy failed");
        } finally {
          fallback.value = "";
          fallback.remove();
        }
      }
      setAnnouncement("All page-marked text copied to the system clipboard.");
    } catch {
      setAnnouncement("The browser could not copy the page-marked text.");
    }
  }, [buildOutput]);

  const downloadAll = useCallback(() => {
    try {
      const output = buildOutput();
      releaseDownloadUrl();
      const blob = new Blob([output.combinedText], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      downloadUrlRef.current = url;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = output.filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => {
        if (downloadUrlRef.current === url) {
          URL.revokeObjectURL(url);
          downloadUrlRef.current = null;
        }
      }, 0);
      setAnnouncement("Text file download started.");
    } catch {
      setAnnouncement("The browser could not prepare the text download.");
    }
  }, [buildOutput, releaseDownloadUrl]);

  const prepareOffline = useCallback(async () => {
    if (!dependencies.isOnline()) {
      setAnnouncement("Connect to the internet before preparing offline support.");
      return;
    }
    setPreparingOffline(true);
    setAnnouncement("Preparing verified PDF reader and selected OCR language support files.");
    dependencies.prepareOcrAssets(state.settings.languages ?? DEFAULT_OCR_LANGUAGES);
    const pdfReady = await dependencies.preparePdfAssets().catch(() => false);
    setPreparingOffline(false);
    setAnnouncement(
      pdfReady
        ? "PDF reader preparation finished. Selected OCR language preparation status is shown separately."
        : "PDF reader preparation failed. You can try again while online.",
    );
  }, [dependencies, state.settings.languages]);

  const prepareLanguages = useCallback(() => {
    dependencies.prepareOcrAssets(state.settings.languages ?? DEFAULT_OCR_LANGUAGES);
  }, [dependencies, state.settings.languages]);

  const selectedLanguageKey = (state.settings.languages ?? DEFAULT_OCR_LANGUAGES).join("+");
  const staleLanguagePages = (state.result?.pages ?? [])
    .filter((page) => page.status === "complete" && page.method === "ocr"
      && (page.languages ?? DEFAULT_OCR_LANGUAGES).join("+") !== selectedLanguageKey)
    .map((page) => page.pageNumber);

  return {
    state,
    fileSummary,
    selectionKind,
    rangeValue,
    selectionError,
    activeError,
    passwordPrompt,
    confirmation,
    announcement,
    pdfAssetStatus,
    languageStatus,
    shellStatus,
    staleLanguagePages,
    preparingOffline:
      preparingOffline ||
      pdfAssetStatus === "Preparing PDF reader assets" ||
      languageStatus.preparing.length > 0,
    inputVersion,
    pickerRequestVersion,
    selectionFocusVersion,
    resultFocusVersion,
    attemptPageNumber,
    busy,
    operationActive,
    pdfSupportSize: formatSupportBytes(__PDF_RUNTIME_ASSET_BYTES__),
    receiveFiles,
    setSelectionKind,
    changeRange,
    updateSettings,
    requestStart,
    cancelOperation,
    requestReprocess,
    requestClear,
    requestReplace,
    confirmPending,
    cancelPending,
    submitPassword,
    cancelPassword,
    selectResultPage,
    renderPreview,
    editPage,
    copyAll,
    downloadAll,
    prepareOffline,
    prepareLanguages,
  };
}
