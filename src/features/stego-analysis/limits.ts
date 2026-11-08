/** Size, pixel and output bounds for the steganography analysis toolkit. */
export const STEGO_ANALYSIS_LIMITS = {
  maxFileBytes: 50 * 1024 * 1024,
  maxFileLabel: "50 MiB",
  maxWidth: 4_096,
  maxHeight: 4_096,
  maxListedStructures: 512,
  maxListedStrings: 5_000,
  maxSignatureMatches: 200,
  maxExtractBytes: 16 * 1024 * 1024,
  maxExtractLabel: "16 MiB",
  hexPreviewBytes: 4_096,
  extractedStringsListed: 500,
} as const;

export class StegoAnalysisError extends Error {
  readonly code: StegoAnalysisErrorCode;

  constructor(code: StegoAnalysisErrorCode, message: string) {
    super(message);
    this.name = "StegoAnalysisError";
    this.code = code;
  }
}

export type StegoAnalysisErrorCode =
  | "file-too-large"
  | "empty-file"
  | "malformed-png"
  | "unsupported-png"
  | "dimensions-too-large"
  | "decode-failed"
  | "invalid-options"
  | "no-image"
  | "worker-failed";
