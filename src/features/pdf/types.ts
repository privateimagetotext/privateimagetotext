import type {
  EnhancementPreset,
  OcrContentMode,
} from "../ocr/types";
import type { PdfSafeError } from "./errors";

export type PdfPasswordReason = "required" | "incorrect";

export type PdfPasswordRequest = (request: {
  readonly reason: PdfPasswordReason;
  readonly attempt: number;
  readonly signal: AbortSignal;
}) => Promise<string | null>;

export type PdfOpenOptions = {
  readonly requestPassword?: PdfPasswordRequest;
  readonly signal?: AbortSignal;
};

export type PdfSource = Blob | Uint8Array;

/** Narrow, copied text-layer data. PDF.js objects must not cross this boundary. */
export type PdfTextItem = {
  readonly str: string;
  readonly dir?: string;
  readonly transform?: readonly number[];
  readonly width?: number;
  readonly height?: number;
  readonly hasEOL?: boolean;
};

export type PdfExtractedTextLayer = {
  readonly pageNumber: number;
  readonly items: readonly PdfTextItem[];
};

export type PdfTextExtractionOptions = {
  readonly signal?: AbortSignal;
};

export type PdfRenderOptions = {
  readonly signal?: AbortSignal;
  readonly targetDpi?: number;
  /** A caller-owned reusable canvas. The caller remains responsible for release. */
  readonly canvas?: HTMLCanvasElement;
};

export type PdfRenderedPage = {
  readonly pageNumber: number;
  readonly originalWidth: number;
  readonly originalHeight: number;
  readonly rotation: number;
  readonly requestedScale: number;
  readonly scale: number;
  readonly effectiveDpi: number;
  readonly width: number;
  readonly height: number;
  readonly estimatedRgbaBytes: number;
  readonly downscaled: boolean;
  readonly renderDurationMs: number;
  readonly canvas: HTMLCanvasElement;
  release(): void;
};

export type PdfDocumentSession = {
  readonly pageCount: number;
  readonly pageLabels: readonly string[] | null;
  extractText(
    pageNumber: number,
    options?: PdfTextExtractionOptions,
  ): Promise<PdfExtractedTextLayer>;
  renderPage(
    pageNumber: number,
    options?: PdfRenderOptions,
  ): Promise<PdfRenderedPage>;
  cancelRender(): void;
  destroy(): Promise<void>;
};

export type PdfWorkflowStatus =
  | "idle"
  | "validating"
  | "loading-document"
  | "password-required"
  | "ready"
  | "preflighting"
  | "processing"
  | "cancelled"
  | "complete"
  | "error";

export type PdfExtractionMode =
  | "automatic"
  | "embedded-text-only"
  | "ocr-all";

export type PdfForcedExtractionMethod = "embedded-text" | "ocr";

export type PdfPageMethod = "embedded-text" | "ocr" | "none";

export type PdfPageStatus =
  | "pending"
  | "checking-text"
  | "rendering"
  | "preparing"
  | "loading-ocr"
  | "recognising"
  | "complete"
  | "failed"
  | "skipped"
  | "not-processed";

export type PdfDocumentOutcome =
  | "complete"
  | "partial"
  | "cancelled"
  | "error";

export type PdfTextLayerClassification =
  | "usable"
  | "uncertain"
  | "empty"
  | "invalid";

export type PdfTextLayerReasonCode =
  | "empty-text-layer"
  | "no-meaningful-text"
  | "page-number-only"
  | "sparse-header-or-footer"
  | "high-replacement-character-ratio"
  | "high-unsafe-control-ratio"
  | "suspicious-repetition"
  | "high-fragmentation"
  | "ambiguous-direction"
  | "vertical-text"
  | "malformed-text-items"
  | "low-meaningful-character-ratio"
  | "valid-short-text"
  | "normal-text"
  | "right-to-left-text"
  | "text-extraction-failed";

/** Content-free metrics retained after text-layer items have been released. */
export type PdfTextLayerMetrics = {
  readonly itemCount: number;
  readonly textItemCount: number;
  readonly malformedItemCount: number;
  readonly nonWhitespaceCharacterCount: number;
  readonly meaningfulCharacterCount: number;
  readonly reconstructedLineCount: number;
  readonly replacementCharacterCount: number;
  readonly replacementCharacterRatio: number;
  readonly unsafeControlCount: number;
  readonly unsafeControlRatio: number;
  readonly meaningfulCharacterRatio: number;
  readonly repeatedFragmentCount: number;
  readonly repeatedFragmentRatio: number;
  readonly singleGlyphItemCount: number;
  readonly singleGlyphItemRatio: number;
  readonly ambiguousDirectionItemCount: number;
  readonly rightToLeftItemCount: number;
  readonly verticalItemCount: number;
  readonly ambiguousDirection: boolean;
  readonly verticalLayout: boolean;
};

export type PdfTextLayerAssessment = {
  readonly classification: PdfTextLayerClassification;
  readonly reasonCodes: readonly PdfTextLayerReasonCode[];
  readonly metrics: PdfTextLayerMetrics;
};

export type PdfWarningCode =
  | "NO_EMBEDDED_TEXT"
  | "TEXT_LAYER_UNCERTAIN"
  | "TEXT_LAYER_INVALID"
  | "UNMAPPED_TEXT_CHARACTERS"
  | "EMPTY_PAGE_TEXT"
  | "PAGE_RENDER_REDUCED";

export type PdfExtractionSettings = {
  readonly mode: PdfExtractionMode;
  readonly preset: EnhancementPreset;
  readonly contentMode: OcrContentMode;
  readonly autoDeskew: boolean;
  /** Defaults to English for existing callers; selected models stay same-origin. */
  readonly languages?: readonly string[];
};

export type PdfPageRenderMetadata = {
  readonly requestedScale: number;
  readonly scale: number;
  readonly effectiveDpi: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly downscaled: boolean;
  readonly warnings: readonly PdfWarningCode[];
};

export type PdfPageResult = {
  readonly pageNumber: number;
  readonly pageLabel?: string;
  readonly status: PdfPageStatus;
  readonly method: PdfPageMethod;
  /** OCR model selection used for this result, independent of current controls. */
  readonly languages?: readonly string[];
  readonly raw: string;
  readonly cleaned: string;
  readonly edited: string;
  readonly confidence: number | null;
  readonly elapsedMs: number;
  readonly textLayerAssessment: PdfTextLayerAssessment | null;
  readonly warnings: readonly PdfWarningCode[];
  readonly error: PdfSafeError | null;
  readonly render: PdfPageRenderMetadata | null;
};

export type PdfDocumentResult = {
  readonly documentId: string;
  readonly operationId: string;
  readonly outcome: PdfDocumentOutcome;
  readonly selectedPages: readonly number[];
  readonly pages: readonly PdfPageResult[];
  readonly embeddedTextPageCount: number;
  readonly ocrPageCount: number;
  readonly emptyPageCount: number;
  readonly failedPageCount: number;
  readonly skippedOrUnprocessedPageCount: number;
  readonly elapsedMs: number;
  readonly totalOutputCharacters: number;
  readonly error: PdfSafeError | null;
};

export type PdfProgressPhase =
  | "preflight"
  | "embedded-text"
  | "rendering"
  | "preparing"
  | "loading-ocr"
  | "recognising"
  | "combining";

/** Safe structured progress. It intentionally has no filename or document text. */
export type PdfProgress = {
  readonly stage: string;
  readonly phase: PdfProgressPhase;
  readonly overall: number | null;
  readonly currentSelectedPageIndex: number | null;
  readonly totalSelectedPages: number;
  readonly pageNumber: number | null;
  readonly pageValue: number | null;
  readonly isPreflighting: boolean;
  readonly isProducingResults: boolean;
};

export type PdfDocumentSummary = {
  readonly documentId: string;
  readonly pageCount: number;
  readonly pageLabels: readonly string[] | null;
};

export type PdfState = {
  readonly status: PdfWorkflowStatus;
  readonly document: PdfDocumentSummary | null;
  readonly currentOperationId: string | null;
  readonly singlePageOperationPage: number | null;
  readonly selectedPages: readonly number[];
  readonly settings: PdfExtractionSettings;
  readonly pages: Readonly<Record<number, PdfPageResult>>;
  readonly activeResultPage: number | null;
  readonly progress: PdfProgress | null;
  readonly result: PdfDocumentResult | null;
  readonly error: PdfSafeError | null;
};
