import { CleanCopyError, throwIfCleanCopyAborted } from "./errors";
import { CLEAN_COPY_LIMITS, type CleanCopyProgress } from "./types";

export interface StructuralCleanCopy {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly preservedParts: readonly Uint8Array[];
  readonly removedCarriers: readonly string[];
  readonly preservedCarriers: readonly string[];
}

export function reportCleanCopyProgress(
  onProgress: ((progress: CleanCopyProgress) => void) | undefined,
  signal: AbortSignal | undefined,
  progress: CleanCopyProgress,
) {
  throwIfCleanCopyAborted(signal);
  onProgress?.(progress);
  throwIfCleanCopyAborted(signal);
}

export async function readBlobBounded(
  blob: Blob,
  maximumBytes: number,
  signal: AbortSignal | undefined,
  onProgress?: (processedBytes: number) => void,
) {
  if (
    !Number.isSafeInteger(blob.size) ||
    blob.size < 0 ||
    blob.size > maximumBytes
  ) {
    throw new CleanCopyError(
      "source-too-large",
      "The selected file exceeds the metadata-removal byte limit.",
    );
  }
  const result = new Uint8Array(blob.size);
  let offset = 0;
  onProgress?.(0);
  while (offset < blob.size) {
    throwIfCleanCopyAborted(signal);
    const length = Math.min(
      CLEAN_COPY_LIMITS.readChunkBytes,
      blob.size - offset,
    );
    let buffer: ArrayBuffer;
    try {
      buffer = await blob.slice(offset, offset + length).arrayBuffer();
    } catch (error) {
      throwIfCleanCopyAborted(signal);
      throw new CleanCopyError(
        "read-failed",
        error instanceof Error && error.message
          ? `The browser could not read the selected file: ${error.message}`
          : "The browser could not read the selected file.",
      );
    }
    throwIfCleanCopyAborted(signal);
    const chunk = new Uint8Array(buffer);
    if (chunk.byteLength !== length) {
      throw new CleanCopyError(
        "malformed-source",
        "The selected file changed or ended while it was being rewritten.",
      );
    }
    result.set(chunk, offset);
    offset += length;
    onProgress?.(offset);
  }
  throwIfCleanCopyAborted(signal);
  return result;
}

export async function yieldToBrowser(signal?: AbortSignal) {
  throwIfCleanCopyAborted(signal);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  throwIfCleanCopyAborted(signal);
}

export async function concatenateParts(
  parts: readonly Uint8Array[],
  maximumBytes: number,
  signal?: AbortSignal,
) {
  let total = 0;
  for (const part of parts) {
    if (part.byteLength > maximumBytes - total) {
      throw new CleanCopyError(
        "rewrite-limit-exceeded",
        "The metadata-removed copy would exceed its bounded output size.",
      );
    }
    total += part.byteLength;
  }
  const result = new Uint8Array(total);
  let offset = 0;
  let bytesSinceYield = 0;
  for (const part of parts) {
    for (let partOffset = 0; partOffset < part.byteLength; ) {
      throwIfCleanCopyAborted(signal);
      const length = Math.min(64 * 1024, part.byteLength - partOffset);
      result.set(part.subarray(partOffset, partOffset + length), offset);
      offset += length;
      partOffset += length;
      bytesSinceYield += length;
      if (bytesSinceYield >= 1024 * 1024) {
        bytesSinceYield = 0;
        await yieldToBrowser(signal);
      }
    }
  }
  return result;
}

export async function bytePartsEqual(
  left: readonly Uint8Array[],
  right: readonly Uint8Array[],
  signal?: AbortSignal,
) {
  let leftPart = 0;
  let rightPart = 0;
  let leftOffset = 0;
  let rightOffset = 0;
  let compared = 0;
  let leftTotal = 0;
  let rightTotal = 0;
  for (const part of left) leftTotal += part.byteLength;
  for (const part of right) rightTotal += part.byteLength;
  if (leftTotal !== rightTotal) return false;
  while (compared < leftTotal) {
    while (leftPart < left.length && leftOffset === left[leftPart].byteLength) {
      leftPart += 1;
      leftOffset = 0;
    }
    while (
      rightPart < right.length &&
      rightOffset === right[rightPart].byteLength
    ) {
      rightPart += 1;
      rightOffset = 0;
    }
    const count = Math.min(
      left[leftPart].byteLength - leftOffset,
      right[rightPart].byteLength - rightOffset,
    );
    for (let index = 0; index < count; index += 1) {
      if ((compared + index) % (64 * 1024) === 0) {
        throwIfCleanCopyAborted(signal);
      }
      if (
        index > 0 &&
        (compared + index) % (1024 * 1024) === 0
      ) {
        await yieldToBrowser(signal);
      }
      if (
        left[leftPart][leftOffset + index] !==
        right[rightPart][rightOffset + index]
      ) {
        return false;
      }
    }
    leftOffset += count;
    rightOffset += count;
    compared += count;
  }
  return true;
}

function matchesAt(bytes: Uint8Array, offset: number, signature: readonly number[]) {
  if (offset < 0 || offset + signature.length > bytes.byteLength) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[offset + index] !== signature[index]) return false;
  }
  return true;
}

export async function tailContainsRasterSignature(
  bytes: Uint8Array,
  start: number,
  signal?: AbortSignal,
) {
  for (let offset = start; offset < bytes.byteLength; offset += 1) {
    if ((offset - start) % (64 * 1024) === 0) {
      throwIfCleanCopyAborted(signal);
    }
    if (offset > start && (offset - start) % (1024 * 1024) === 0) {
      await yieldToBrowser(signal);
    }
    if (
      matchesAt(bytes, offset, [0xff, 0xd8, 0xff]) ||
      matchesAt(bytes, offset, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
      matchesAt(bytes, offset, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
      matchesAt(bytes, offset, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) ||
      matchesAt(bytes, offset, [0x42, 0x4d]) ||
      matchesAt(bytes, offset, [0x49, 0x49, 0x2a, 0x00]) ||
      matchesAt(bytes, offset, [0x4d, 0x4d, 0x00, 0x2a]) ||
      (matchesAt(bytes, offset, [0x52, 0x49, 0x46, 0x46]) &&
        matchesAt(bytes, offset + 8, [0x57, 0x45, 0x42, 0x50]))
    ) {
      return true;
    }
  }
  return false;
}

export async function awaitWithAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfCleanCopyAborted(signal);
  if (!signal) return promise;

  let rejectAbort: ((error: CleanCopyError) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort?.(cleanCopyCancelledError());
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function cleanCopyCancelledError() {
  return new CleanCopyError(
    "cancelled",
    "Creating the metadata-removed copy was cancelled.",
  );
}
