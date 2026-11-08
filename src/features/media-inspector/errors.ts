import type {
  MediaInspectionErrorCode,
  SerializedMediaInspectionError,
} from "./types";

export class MediaInspectionError extends Error {
  readonly code: MediaInspectionErrorCode;

  constructor(code: MediaInspectionErrorCode, message: string) {
    super(message);
    this.name = "MediaInspectionError";
    this.code = code;
  }
}

export function cancelledError() {
  return new MediaInspectionError("cancelled", "Media inspection was cancelled.");
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw cancelledError();
}

export function normaliseInspectionError(
  error: unknown,
): SerializedMediaInspectionError {
  if (error instanceof MediaInspectionError) {
    return { code: error.code, message: error.message };
  }
  if (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "AbortError"
  ) {
    return { code: "cancelled", message: "Media inspection was cancelled." };
  }
  return {
    code: "read-failed",
    message: "The browser could not safely inspect this file.",
  };
}
