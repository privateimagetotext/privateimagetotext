import { PdfError } from "./errors";

export const PDF_LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  maxDocumentPages: 100,
  maxSelectedPages: 50,
  maxOcrPagesPerRun: 25,
  targetDpi: 300,
  maxRenderedSide: 4_096,
  maxRenderedPixels: 4_096 ** 2,
  maxPageTextCharacters: 250_000,
  maxPageTextItems: 100_000,
  maxTotalTextCharacters: 2_000_000,
  activePageConcurrency: 1,
  activeOcrConcurrency: 1,
  maxPageRangeInputCharacters: 2_048,
  signatureScanBytes: 1_024,
} as const;

const PDF_SIGNATURE = /%PDF-(?:1\.[0-9]|2\.[0-9])/;

export type PdfSignatureEvidence = {
  readonly offset: number;
  readonly version: string;
};

export type PdfRenderPlan = {
  readonly requestedScale: number;
  readonly scale: number;
  readonly effectiveDpi: number;
  readonly width: number;
  readonly height: number;
  readonly downscaled: boolean;
};

export function inspectPdfSignature(prefix: Uint8Array): PdfSignatureEvidence {
  const bounded = prefix.subarray(0, PDF_LIMITS.signatureScanBytes);
  const text = new TextDecoder("latin1").decode(bounded);
  const match = PDF_SIGNATURE.exec(text);
  if (!match || match.index < 0) throw new PdfError("PDF_SIGNATURE_INVALID");
  return {
    offset: match.index,
    version: match[0].slice("%PDF-".length),
  };
}

export async function validatePdfSource(
  source: Blob | Uint8Array,
): Promise<PdfSignatureEvidence> {
  const size = source instanceof Uint8Array ? source.byteLength : source.size;
  if (size === 0) throw new PdfError("PDF_FILE_EMPTY");
  if (size > PDF_LIMITS.maxFileBytes) {
    throw new PdfError("PDF_FILE_TOO_LARGE");
  }
  const prefix =
    source instanceof Uint8Array
      ? source.subarray(0, PDF_LIMITS.signatureScanBytes)
      : new Uint8Array(
          await source.slice(0, PDF_LIMITS.signatureScanBytes).arrayBuffer(),
        );
  return inspectPdfSignature(prefix);
}

export function planPdfRender(
  originalWidth: number,
  originalHeight: number,
  targetDpi: number = PDF_LIMITS.targetDpi,
): PdfRenderPlan {
  if (
    !Number.isFinite(originalWidth) ||
    !Number.isFinite(originalHeight) ||
    !Number.isFinite(targetDpi) ||
    originalWidth <= 0 ||
    originalHeight <= 0 ||
    targetDpi <= 0
  ) {
    throw new PdfError("PDF_LIMIT_EXCEEDED");
  }

  const requestedScale = targetDpi / 72;
  const requestedWidth = originalWidth * requestedScale;
  const requestedHeight = originalHeight * requestedScale;
  if (
    !Number.isFinite(requestedScale) ||
    !Number.isFinite(requestedWidth) ||
    !Number.isFinite(requestedHeight) ||
    !Number.isFinite(requestedWidth * requestedHeight)
  ) {
    throw new PdfError("PDF_LIMIT_EXCEEDED");
  }
  const scaleBound = Math.min(
    1,
    PDF_LIMITS.maxRenderedSide / requestedWidth,
    PDF_LIMITS.maxRenderedSide / requestedHeight,
    Math.sqrt(
      PDF_LIMITS.maxRenderedPixels / (requestedWidth * requestedHeight),
    ),
  );
  const scale = requestedScale * scaleBound;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new PdfError("PDF_LIMIT_EXCEEDED");
  }
  const width = Math.max(1, Math.floor(originalWidth * scale));
  const height = Math.max(1, Math.floor(originalHeight * scale));

  if (
    width > PDF_LIMITS.maxRenderedSide ||
    height > PDF_LIMITS.maxRenderedSide ||
    width * height > PDF_LIMITS.maxRenderedPixels
  ) {
    throw new PdfError("PDF_LIMIT_EXCEEDED");
  }

  return {
    requestedScale,
    scale,
    effectiveDpi: scale * 72,
    width,
    height,
    downscaled: scale < requestedScale,
  };
}
