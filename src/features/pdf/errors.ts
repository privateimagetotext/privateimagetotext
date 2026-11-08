export type PdfErrorCode =
  | "PDF_FILE_EMPTY"
  | "PDF_FILE_TOO_LARGE"
  | "PDF_SIGNATURE_INVALID"
  | "PDF_OPEN_FAILED"
  | "PDF_PASSWORD_REQUIRED"
  | "PDF_PASSWORD_REJECTED"
  | "PDF_PASSWORD_CANCELLED"
  | "PDF_PAGE_OUT_OF_RANGE"
  | "PDF_PAGE_RANGE_INVALID"
  | "PDF_SELECTED_PAGE_LIMIT_EXCEEDED"
  | "PDF_OCR_PAGE_LIMIT_EXCEEDED"
  | "PDF_OCR_LANGUAGE_INVALID"
  | "PDF_READER_SUPPORT_UNAVAILABLE_OFFLINE"
  | "PDF_OCR_SUPPORT_UNAVAILABLE_OFFLINE"
  | "PDF_PAGE_TEXT_EXTRACTION_FAILED"
  | "PDF_PAGE_TEXT_LIMIT_EXCEEDED"
  | "PDF_TOTAL_TEXT_LIMIT_EXCEEDED"
  | "PDF_PAGE_RENDER_FAILED"
  | "PDF_PAGE_OCR_FAILED"
  | "PDF_CANVAS_UNAVAILABLE"
  | "PDF_OPERATION_IN_PROGRESS"
  | "PDF_OPERATION_CANCELLED"
  | "PDF_UNSUPPORTED_PAGE"
  | "PDF_INTERNAL_PROCESSING_ERROR"
  | "PDF_RENDER_CANCELLED"
  | "PDF_LIMIT_EXCEEDED"
  | "PDF_WORKER_FAILED"
  | "PDF_UNSUPPORTED_FEATURE"
  | "PDF_OPERATION_REPLACED"
  | "PDF_RENDER_IN_PROGRESS"
  | "PDF_DESTROYED";

export type PdfErrorScope = "page" | "document";

export type PdfSafeError = {
  readonly code: PdfErrorCode;
  readonly message: string;
  readonly pageNumber?: number;
  readonly details?: {
    readonly selectedPageCount?: number;
    readonly requiredOcrPageCount?: number;
    readonly permittedOcrPageCount?: number;
  };
  readonly retryable: boolean;
  readonly scope: PdfErrorScope;
};

export const PDF_ERROR_MESSAGES: Readonly<Record<PdfErrorCode, string>> = {
  PDF_FILE_EMPTY: "Select a PDF that is not empty.",
  PDF_FILE_TOO_LARGE: "This PDF is larger than the current local limit.",
  PDF_SIGNATURE_INVALID: "This file does not have a valid PDF signature.",
  PDF_OPEN_FAILED: "This PDF could not be opened safely in this browser.",
  PDF_PASSWORD_REQUIRED: "This PDF requires a password.",
  PDF_PASSWORD_REJECTED: "That PDF password was not accepted.",
  PDF_PASSWORD_CANCELLED: "PDF password entry was cancelled.",
  PDF_PAGE_OUT_OF_RANGE: "That PDF page is not available.",
  PDF_PAGE_RANGE_INVALID: "Enter a valid PDF page or page range.",
  PDF_SELECTED_PAGE_LIMIT_EXCEEDED:
    "That selection contains too many PDF pages for one operation.",
  PDF_OCR_PAGE_LIMIT_EXCEEDED:
    "Too many selected pages require OCR for one operation.",
  PDF_OCR_LANGUAGE_INVALID:
    "Choose between one and three supported OCR languages.",
  PDF_READER_SUPPORT_UNAVAILABLE_OFFLINE:
    "The PDF reader is not available offline. Connect to the internet and prepare it first.",
  PDF_OCR_SUPPORT_UNAVAILABLE_OFFLINE:
    "The selected OCR languages are not available offline. Connect to the internet and prepare them first.",
  PDF_PAGE_TEXT_EXTRACTION_FAILED:
    "Existing text could not be read from this PDF page.",
  PDF_PAGE_TEXT_LIMIT_EXCEEDED:
    "This PDF page contains more text than the current local limit.",
  PDF_TOTAL_TEXT_LIMIT_EXCEEDED:
    "The selected PDF pages contain more text than the current local limit.",
  PDF_PAGE_RENDER_FAILED: "This PDF page could not be prepared.",
  PDF_PAGE_OCR_FAILED: "Text could not be recognised on this PDF page.",
  PDF_CANVAS_UNAVAILABLE:
    "This browser could not create the local page-processing surface.",
  PDF_OPERATION_IN_PROGRESS: "Another PDF operation is already in progress.",
  PDF_OPERATION_CANCELLED: "PDF processing was cancelled.",
  PDF_UNSUPPORTED_PAGE: "This PDF page cannot be processed safely.",
  PDF_INTERNAL_PROCESSING_ERROR:
    "Local PDF processing stopped because of an internal error.",
  PDF_RENDER_CANCELLED: "PDF page preparation was cancelled.",
  PDF_LIMIT_EXCEEDED: "This PDF exceeds a current local processing limit.",
  PDF_WORKER_FAILED:
    "Local PDF processing could not start. Reconnect and reload this page, or try another browser.",
  PDF_UNSUPPORTED_FEATURE: "This PDF uses a feature that is not supported safely.",
  PDF_OPERATION_REPLACED: "This PDF operation was replaced by a newer one.",
  PDF_RENDER_IN_PROGRESS: "Another PDF page is already being prepared.",
  PDF_DESTROYED: "PDF processing is no longer available.",
};

const PAGE_ERROR_CODES = new Set<PdfErrorCode>([
  "PDF_PAGE_OUT_OF_RANGE",
  "PDF_PAGE_TEXT_EXTRACTION_FAILED",
  "PDF_PAGE_TEXT_LIMIT_EXCEEDED",
  "PDF_PAGE_RENDER_FAILED",
  "PDF_PAGE_OCR_FAILED",
  "PDF_UNSUPPORTED_PAGE",
]);

const RETRYABLE_ERROR_CODES = new Set<PdfErrorCode>([
  "PDF_PASSWORD_REJECTED",
  "PDF_READER_SUPPORT_UNAVAILABLE_OFFLINE",
  "PDF_OCR_SUPPORT_UNAVAILABLE_OFFLINE",
  "PDF_PAGE_TEXT_EXTRACTION_FAILED",
  "PDF_PAGE_RENDER_FAILED",
  "PDF_PAGE_OCR_FAILED",
  "PDF_CANVAS_UNAVAILABLE",
  "PDF_OPERATION_IN_PROGRESS",
  "PDF_OPERATION_CANCELLED",
  "PDF_RENDER_CANCELLED",
  "PDF_WORKER_FAILED",
  "PDF_OPERATION_REPLACED",
  "PDF_RENDER_IN_PROGRESS",
]);

export type PdfErrorOptions = {
  readonly pageNumber?: number;
  readonly details?: PdfSafeError["details"];
  readonly retryable?: boolean;
  readonly scope?: PdfErrorScope;
};

function normalisePageNumber(pageNumber: number | undefined) {
  return pageNumber !== undefined &&
    Number.isSafeInteger(pageNumber) &&
    pageNumber > 0
    ? pageNumber
    : undefined;
}

export function createPdfSafeError(
  code: PdfErrorCode,
  options: PdfErrorOptions = {},
): PdfSafeError {
  const pageNumber = normalisePageNumber(options.pageNumber);
  const scope =
    options.scope ??
    (pageNumber !== undefined || PAGE_ERROR_CODES.has(code)
      ? "page"
      : "document");
  return {
    code,
    message: PDF_ERROR_MESSAGES[code],
    ...(pageNumber === undefined ? {} : { pageNumber }),
    ...(options.details === undefined ? {} : { details: options.details }),
    retryable: options.retryable ?? RETRYABLE_ERROR_CODES.has(code),
    scope,
  };
}

export class PdfError extends Error {
  readonly code: PdfErrorCode;
  readonly pageNumber?: number;
  readonly details?: PdfSafeError["details"];
  readonly retryable: boolean;
  readonly scope: PdfErrorScope;

  constructor(code: PdfErrorCode, options: PdfErrorOptions = {}) {
    super(PDF_ERROR_MESSAGES[code]);
    this.name = "PdfError";
    this.code = code;
    const safe = createPdfSafeError(code, options);
    this.pageNumber = safe.pageNumber;
    this.details = safe.details;
    this.retryable = safe.retryable;
    this.scope = safe.scope;
  }

  toSafeError(): PdfSafeError {
    return createPdfSafeError(this.code, {
      pageNumber: this.pageNumber,
      details: this.details,
      retryable: this.retryable,
      scope: this.scope,
    });
  }
}

export function isPdfError(error: unknown): error is PdfError {
  return error instanceof PdfError;
}

export function toPdfSafeError(
  error: unknown,
  fallbackCode: PdfErrorCode = "PDF_INTERNAL_PROCESSING_ERROR",
  options: PdfErrorOptions = {},
): PdfSafeError {
  if (!(error instanceof PdfError)) {
    return createPdfSafeError(fallbackCode, options);
  }
  return createPdfSafeError(error.code, {
    pageNumber: error.pageNumber ?? options.pageNumber,
    details: error.details ?? options.details,
    retryable: options.retryable ?? error.retryable,
    scope: options.scope ?? error.scope,
  });
}
