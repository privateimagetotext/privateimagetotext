import type {
  CleanCopyErrorCode,
  SerializedCleanCopyError,
} from "./types";

export class CleanCopyError extends Error {
  readonly code: CleanCopyErrorCode;

  constructor(code: CleanCopyErrorCode, message: string) {
    super(message);
    this.name = "CleanCopyError";
    this.code = code;
  }
}

export function cleanCopyCancelledError() {
  return new CleanCopyError(
    "cancelled",
    "Creating the metadata-removed copy was cancelled.",
  );
}

export function throwIfCleanCopyAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw cleanCopyCancelledError();
}

export function normaliseCleanCopyError(
  error: unknown,
): SerializedCleanCopyError {
  if (error instanceof CleanCopyError) {
    return { code: error.code, message: error.message };
  }
  if (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "AbortError"
  ) {
    return {
      code: "cancelled",
      message: "Creating the metadata-removed copy was cancelled.",
    };
  }
  return {
    code: "read-failed",
    message: "The browser could not safely create a metadata-removed copy.",
  };
}

export function positiveBoundedOption(
  value: number | undefined,
  hardLimit: number,
  label: string,
) {
  if (value === undefined) return hardLimit;
  if (!Number.isSafeInteger(value) || value <= 0 || value > hardLimit) {
    throw new CleanCopyError(
      "invalid-options",
      `${label} must be a positive integer no greater than ${hardLimit}.`,
    );
  }
  return value;
}
