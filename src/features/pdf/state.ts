import { createPdfSafeError, type PdfSafeError } from "./errors";
import { DEFAULT_OCR_LANGUAGES } from "../../config/ocr-languages";
import type {
  PdfDocumentResult,
  PdfDocumentSummary,
  PdfExtractionSettings,
  PdfPageResult,
  PdfPageStatus,
  PdfProgress,
  PdfState as PdfStateContract,
  PdfWorkflowStatus,
} from "./types";
import { PDF_LIMITS } from "./validation";

export type PdfState = PdfStateContract;

export const defaultPdfExtractionSettings: PdfExtractionSettings = {
  mode: "automatic",
  preset: "adaptive-document",
  contentMode: "document",
  autoDeskew: true,
  languages: DEFAULT_OCR_LANGUAGES,
};

export const initialPdfState: PdfState = {
  status: "idle",
  document: null,
  currentOperationId: null,
  singlePageOperationPage: null,
  selectedPages: [],
  settings: defaultPdfExtractionSettings,
  pages: {},
  activeResultPage: null,
  progress: null,
  result: null,
  error: null,
};

export type PdfAction =
  | { type: "documentValidationStarted"; documentId: string }
  | { type: "documentLoadingStarted"; documentId: string }
  | { type: "passwordRequired"; documentId: string }
  | { type: "documentReady"; document: PdfDocumentSummary }
  | { type: "documentFailed"; documentId: string; error: PdfSafeError }
  | {
      type: "selectionChanged";
      documentId: string;
      selectedPages: readonly number[];
    }
  | {
      type: "settingsChanged";
      documentId: string;
      settings: PdfExtractionSettings;
    }
  | {
      type: "operationStarted";
      documentId: string;
      operationId: string;
      selectedPages: readonly number[];
      settings: PdfExtractionSettings;
      preflighting: boolean;
    }
  | {
      type: "singlePageOperationStarted";
      documentId: string;
      operationId: string;
      pageNumber: number;
    }
  | {
      type: "pageStatusChanged";
      documentId: string;
      operationId: string;
      pageNumber: number;
      status: PdfPageStatus;
    }
  | {
      type: "progressChanged";
      documentId: string;
      operationId: string;
      progress: PdfProgress;
    }
  | {
      type: "pageResult";
      documentId: string;
      operationId: string;
      result: PdfPageResult;
    }
  | {
      type: "operationCompleted";
      documentId: string;
      operationId: string;
      result: PdfDocumentResult;
    }
  | {
      type: "singlePageOperationCompleted";
      documentId: string;
      operationId: string;
      pageNumber: number;
      result: PdfPageResult;
    }
  | {
      type: "singlePageOperationFailed";
      documentId: string;
      operationId: string;
      pageNumber: number;
      result: PdfPageResult;
    }
  | {
      type: "singlePageOperationCancelled";
      documentId: string;
      operationId: string;
      pageNumber: number;
    }
  | {
      type: "operationCancelled";
      documentId: string;
      operationId: string;
    }
  | {
      type: "operationFailed";
      documentId: string;
      operationId: string;
      error: PdfSafeError;
    }
  | {
      type: "editPageText";
      documentId: string;
      operationId: string;
      pageNumber: number;
      value: string;
    }
  | {
      type: "activeResultPageChanged";
      documentId: string;
      pageNumber: number | null;
    }
  | { type: "clear" };

function pendingPage(pageNumber: number, pageLabel?: string): PdfPageResult {
  return {
    pageNumber,
    ...(pageLabel === undefined ? {} : { pageLabel }),
    status: "pending",
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

function pageLabel(state: PdfState, pageNumber: number) {
  return state.document?.pageLabels?.[pageNumber - 1];
}

function isCurrentDocument(state: PdfState, documentId: string) {
  return state.document?.documentId === documentId;
}

function isCurrentOperation(
  state: PdfState,
  documentId: string,
  operationId: string,
) {
  return (
    isCurrentDocument(state, documentId) &&
    state.currentOperationId === operationId
  );
}

function isActiveOperation(
  state: PdfState,
  documentId: string,
  operationId: string,
) {
  return (
    isCurrentOperation(state, documentId, operationId) &&
    (state.status === "preflighting" || state.status === "processing")
  );
}

function replaceSelectedPages(
  state: PdfState,
  selectedPages: readonly number[],
) {
  const pages = { ...state.pages };
  for (const pageNumber of selectedPages) {
    pages[pageNumber] = pendingPage(pageNumber, pageLabel(state, pageNumber));
  }
  return pages;
}

function clampProgressValue(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? null
    : Math.min(1, Math.max(0, value));
}

function monotonicProgress(previous: PdfProgress | null, next: PdfProgress) {
  const previousOverall = previous?.overall;
  const nextOverall = clampProgressValue(next.overall);
  return {
    ...next,
    overall:
      previousOverall !== null &&
      previousOverall !== undefined &&
      nextOverall !== null
        ? Math.max(previousOverall, nextOverall)
        : nextOverall,
    pageValue: clampProgressValue(next.pageValue),
  };
}

function cancelledPages(pages: Readonly<Record<number, PdfPageResult>>) {
  const next: Record<number, PdfPageResult> = {};
  for (const [key, page] of Object.entries(pages)) {
    next[Number(key)] =
      page.status === "complete" ||
      page.status === "failed" ||
      page.status === "skipped"
        ? page
        : { ...page, status: "not-processed" };
  }
  return next;
}

function resultWithEditedPage(
  result: PdfDocumentResult | null,
  pageNumber: number,
  value: string,
) {
  if (!result) return null;
  let characterDifference = 0;
  let emptyPageDifference = 0;
  let changed = false;
  const pages = result.pages.map((page) => {
    if (page.pageNumber !== pageNumber || page.status !== "complete") return page;
    changed = true;
    characterDifference = value.length - page.edited.length;
    emptyPageDifference =
      Number(value.length === 0) - Number(page.edited.length === 0);
    return { ...page, edited: value };
  });
  return changed
    ? {
        ...result,
        pages,
        emptyPageCount: result.emptyPageCount + emptyPageDifference,
        totalOutputCharacters:
          result.totalOutputCharacters + characterDifference,
      }
    : result;
}

function resultWithReprocessedPage(
  result: PdfDocumentResult,
  replacement: PdfPageResult,
  operationId: string,
) {
  let replaced = false;
  const pages = result.pages.map((page) => {
    if (page.pageNumber !== replacement.pageNumber) return page;
    replaced = true;
    return replacement;
  });
  if (!replaced) return result;
  const failedPageCount = pages.filter((page) => page.status === "failed").length;
  const skippedOrUnprocessedPageCount = pages.filter(
    (page) => page.status === "skipped" || page.status === "not-processed",
  ).length;
  return {
    ...result,
    operationId,
    outcome:
      failedPageCount > 0 || skippedOrUnprocessedPageCount > 0
        ? ("partial" as const)
        : ("complete" as const),
    pages,
    embeddedTextPageCount: pages.filter(
      (page) => page.status === "complete" && page.method === "embedded-text",
    ).length,
    ocrPageCount: pages.filter(
      (page) => page.status === "complete" && page.method === "ocr",
    ).length,
    emptyPageCount: pages.filter(
      (page) => page.status === "complete" && page.edited.length === 0,
    ).length,
    failedPageCount,
    skippedOrUnprocessedPageCount,
    elapsedMs: result.elapsedMs + replacement.elapsedMs,
    totalOutputCharacters: pages.reduce(
      (total, page) =>
        total + (page.status === "complete" ? page.edited.length : 0),
      0,
    ),
    error: null,
  };
}

function isActiveSinglePageOperation(
  state: PdfState,
  documentId: string,
  operationId: string,
  pageNumber: number,
) {
  return (
    isActiveOperation(state, documentId, operationId) &&
    state.singlePageOperationPage === pageNumber
  );
}

function withDocumentLifecycle(
  state: PdfState,
  documentId: string,
  status: PdfWorkflowStatus,
): PdfState {
  if (state.document?.documentId === documentId) {
    return { ...state, status, error: null, progress: null };
  }
  return {
    ...initialPdfState,
    status,
    document: { documentId, pageCount: 0, pageLabels: null },
  };
}

export function pdfReducer(state: PdfState, action: PdfAction): PdfState {
  switch (action.type) {
    case "documentValidationStarted":
      return withDocumentLifecycle(state, action.documentId, "validating");
    case "documentLoadingStarted":
      return isCurrentDocument(state, action.documentId)
        ? { ...state, status: "loading-document", error: null }
        : state;
    case "passwordRequired":
      return isCurrentDocument(state, action.documentId)
        ? { ...state, status: "password-required", error: null }
        : state;
    case "documentReady":
      return isCurrentDocument(state, action.document.documentId)
        ? {
            ...state,
            status: "ready",
            document: action.document,
            selectedPages: [],
            pages: {},
            activeResultPage: null,
            result: null,
            progress: null,
            error: null,
          }
        : state;
    case "documentFailed":
      return isCurrentDocument(state, action.documentId)
        ? {
            ...initialPdfState,
            status: "error",
            document: state.document,
            error: action.error,
          }
        : state;
    case "selectionChanged":
      return isCurrentDocument(state, action.documentId)
        ? { ...state, selectedPages: [...action.selectedPages] }
        : state;
    case "settingsChanged":
      return isCurrentDocument(state, action.documentId)
        ? { ...state, settings: action.settings }
        : state;
    case "operationStarted":
      if (!isCurrentDocument(state, action.documentId)) return state;
      return {
        ...state,
        status: action.preflighting ? "preflighting" : "processing",
        currentOperationId: action.operationId,
        singlePageOperationPage: null,
        selectedPages: [...action.selectedPages],
        settings: action.settings,
        pages: replaceSelectedPages(state, action.selectedPages),
        activeResultPage: null,
        progress: null,
        result: null,
        error: null,
      };
    case "singlePageOperationStarted": {
      if (
        !isCurrentDocument(state, action.documentId) ||
        !state.result ||
        !state.result.selectedPages.includes(action.pageNumber) ||
        !state.pages[action.pageNumber]
      ) {
        return state;
      }
      return {
        ...state,
        status: "processing",
        currentOperationId: action.operationId,
        singlePageOperationPage: action.pageNumber,
        pages: {
          ...state.pages,
          [action.pageNumber]: {
            ...state.pages[action.pageNumber],
            status: "pending",
          },
        },
        progress: null,
        error: null,
      };
    }
    case "pageStatusChanged": {
      if (!isActiveOperation(state, action.documentId, action.operationId)) {
        return state;
      }
      const page = state.pages[action.pageNumber];
      if (!page) return state;
      return {
        ...state,
        status:
          state.status === "preflighting" && action.status === "checking-text"
            ? "preflighting"
            : "processing",
        pages: {
          ...state.pages,
          [action.pageNumber]: { ...page, status: action.status },
        },
      };
    }
    case "progressChanged":
      if (!isActiveOperation(state, action.documentId, action.operationId)) {
        return state;
      }
      return {
        ...state,
        status: action.progress.isPreflighting ? "preflighting" : "processing",
        progress: monotonicProgress(state.progress, action.progress),
      };
    case "pageResult":
      if (!isActiveOperation(state, action.documentId, action.operationId)) {
        return state;
      }
      if (!state.pages[action.result.pageNumber]) return state;
      return {
        ...state,
        pages: { ...state.pages, [action.result.pageNumber]: action.result },
        activeResultPage:
          state.activeResultPage ??
          (action.result.status === "complete" ? action.result.pageNumber : null),
      };
    case "operationCompleted":
      if (
        !isActiveOperation(state, action.documentId, action.operationId) ||
        action.result.documentId !== action.documentId ||
        action.result.operationId !== action.operationId
      ) {
        return state;
      }
      return {
        ...state,
        status:
          action.result.outcome === "cancelled"
            ? "cancelled"
            : action.result.outcome === "error"
              ? "error"
              : "complete",
        pages: {
          ...state.pages,
          ...Object.fromEntries(
            action.result.pages.map((page) => [page.pageNumber, page]),
          ),
        },
        activeResultPage:
          state.activeResultPage ??
          action.result.pages.find((page) => page.status === "complete")
            ?.pageNumber ??
          null,
        progress: null,
        result: action.result,
        error: action.result.error,
      };
    case "singlePageOperationCompleted":
    case "singlePageOperationFailed": {
      if (
        !isActiveSinglePageOperation(
          state,
          action.documentId,
          action.operationId,
          action.pageNumber,
        ) ||
        !state.result ||
        action.result.pageNumber !== action.pageNumber ||
        (action.type === "singlePageOperationCompleted" &&
          action.result.status !== "complete") ||
        (action.type === "singlePageOperationFailed" &&
          action.result.status !== "failed")
      ) {
        return state;
      }
      const previousPage = state.result.pages.find(
        (page) => page.pageNumber === action.pageNumber,
      );
      const nextTotalCharacters =
        state.result.totalOutputCharacters -
        (previousPage?.status === "complete" ? previousPage.edited.length : 0) +
        (action.result.status === "complete" ? action.result.edited.length : 0);
      const totalLimitError =
        nextTotalCharacters > PDF_LIMITS.maxTotalTextCharacters
          ? createPdfSafeError("PDF_TOTAL_TEXT_LIMIT_EXCEEDED")
          : null;
      const replacementRejected =
        action.type === "singlePageOperationFailed" || totalLimitError !== null;
      if (previousPage?.status === "complete" && replacementRejected) {
        const attemptError =
          totalLimitError ??
          action.result.error ??
          createPdfSafeError("PDF_INTERNAL_PROCESSING_ERROR", {
            pageNumber: action.pageNumber,
          });
        return {
          ...state,
          status: "complete",
          singlePageOperationPage: null,
          pages: { ...state.pages, [action.pageNumber]: previousPage },
          progress: null,
          error: attemptError,
        };
      }
      const replacement = totalLimitError
        ? {
            ...action.result,
            status: "failed" as const,
            raw: "",
            cleaned: "",
            edited: "",
            confidence: null,
            error: totalLimitError,
          }
        : action.result;
      const updatedResult = resultWithReprocessedPage(
        state.result,
        replacement,
        action.operationId,
      );
      const result = totalLimitError
        ? {
            ...updatedResult,
            outcome: "error" as const,
            error: totalLimitError,
          }
        : updatedResult;
      return {
        ...state,
        status: totalLimitError ? "error" : "complete",
        singlePageOperationPage: null,
        pages: { ...state.pages, [action.pageNumber]: replacement },
        activeResultPage:
          replacement.status === "complete"
            ? action.pageNumber
            : (state.activeResultPage ?? action.pageNumber),
        progress: null,
        result,
        error: totalLimitError,
      };
    }
    case "singlePageOperationCancelled": {
      if (
        !isActiveSinglePageOperation(
          state,
          action.documentId,
          action.operationId,
          action.pageNumber,
        ) ||
        !state.result
      ) {
        return state;
      }
      const retained = state.result.pages.find(
        (page) => page.pageNumber === action.pageNumber,
      );
      return {
        ...state,
        status: "complete",
        singlePageOperationPage: null,
        pages: retained
          ? { ...state.pages, [action.pageNumber]: retained }
          : state.pages,
        progress: null,
        error: null,
      };
    }
    case "operationCancelled":
      if (!isActiveOperation(state, action.documentId, action.operationId)) {
        return state;
      }
      return {
        ...state,
        status: "cancelled",
        pages: cancelledPages(state.pages),
        progress: null,
        result: state.result
          ? { ...state.result, outcome: "cancelled" }
          : null,
        error: null,
      };
    case "operationFailed":
      if (!isActiveOperation(state, action.documentId, action.operationId)) {
        return state;
      }
      return {
        ...state,
        status: "error",
        pages: cancelledPages(state.pages),
        progress: null,
        error: action.error,
      };
    case "editPageText": {
      if (!isCurrentOperation(state, action.documentId, action.operationId)) {
        return state;
      }
      const page = state.pages[action.pageNumber];
      if (!page || page.status !== "complete") return state;
      if (action.value.length > PDF_LIMITS.maxPageTextCharacters) {
        return {
          ...state,
          error: createPdfSafeError("PDF_PAGE_TEXT_LIMIT_EXCEEDED", { pageNumber: action.pageNumber }),
        };
      }
      const otherCharacters = (state.result?.pages ?? Object.values(state.pages)).reduce(
        (total, item) => total + (item.pageNumber !== action.pageNumber && item.status === "complete" ? item.edited.length : 0),
        0,
      );
      if (otherCharacters > PDF_LIMITS.maxTotalTextCharacters - action.value.length) {
        return { ...state, error: createPdfSafeError("PDF_TOTAL_TEXT_LIMIT_EXCEEDED") };
      }
      return {
        ...state,
        error: state.error?.code === "PDF_PAGE_TEXT_LIMIT_EXCEEDED" || state.error?.code === "PDF_TOTAL_TEXT_LIMIT_EXCEEDED"
          ? null
          : state.error,
        pages: {
          ...state.pages,
          [action.pageNumber]: { ...page, edited: action.value },
        },
        result: resultWithEditedPage(
          state.result,
          action.pageNumber,
          action.value,
        ),
      };
    }
    case "activeResultPageChanged":
      if (!isCurrentDocument(state, action.documentId)) return state;
      if (
        action.pageNumber !== null &&
        (!(state.result?.selectedPages ?? state.selectedPages).includes(action.pageNumber) ||
          !state.pages[action.pageNumber])
      ) {
        return state;
      }
      return { ...state, activeResultPage: action.pageNumber };
    case "clear":
      return initialPdfState;
  }
}
