import { MediaInspectionError, throwIfAborted } from "./errors";
import { MEDIA_INSPECTION_LIMITS, type ReaderOptions } from "./types";

function positiveSafeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new MediaInspectionError(
      "invalid-range",
      `${label} must be a positive safe integer.`,
    );
  }
  return value;
}

export class BoundedBlobReader {
  readonly blob: Blob;
  readonly signal?: AbortSignal;
  readonly maxReadBytes: number;
  readonly maxReadOperations: number;
  readonly maxSliceBytes: number;

  #bytesRead = 0;
  #readOperations = 0;

  constructor(blob: Blob, options: ReaderOptions = {}) {
    if (!Number.isSafeInteger(blob.size) || blob.size < 0) {
      throw new MediaInspectionError(
        "file-too-large",
        "The browser reported an invalid file size.",
      );
    }
    this.blob = blob;
    this.signal = options.signal;
    this.maxReadBytes = positiveSafeInteger(
      options.maxReadBytes ?? MEDIA_INSPECTION_LIMITS.maxReadBytes,
      "Maximum read bytes",
    );
    this.maxReadOperations = positiveSafeInteger(
      options.maxReadOperations ?? MEDIA_INSPECTION_LIMITS.maxReadOperations,
      "Maximum read operations",
    );
    this.maxSliceBytes = positiveSafeInteger(
      options.maxSliceBytes ?? MEDIA_INSPECTION_LIMITS.maxSliceBytes,
      "Maximum slice bytes",
    );
  }

  get size() {
    return this.blob.size;
  }

  get bytesRead() {
    return this.#bytesRead;
  }

  get readOperations() {
    return this.#readOperations;
  }

  assertRange(offset: number, length: number) {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset > this.size ||
      length > this.size - offset
    ) {
      throw new MediaInspectionError(
        "invalid-range",
        "The file contains an invalid or truncated byte range.",
      );
    }
    if (length > this.maxSliceBytes) {
      throw new MediaInspectionError(
        "read-limit-exceeded",
        "A requested file section exceeds the per-read safety limit.",
      );
    }
    if (
      this.#readOperations >= this.maxReadOperations ||
      length > this.maxReadBytes - this.#bytesRead
    ) {
      throw new MediaInspectionError(
        "read-limit-exceeded",
        "The file requires more local reads than the inspection safety limit allows.",
      );
    }
  }

  async read(offset: number, length: number) {
    throwIfAborted(this.signal);
    this.assertRange(offset, length);
    this.#readOperations += 1;
    this.#bytesRead += length;
    if (length === 0) return new Uint8Array();

    let buffer: ArrayBuffer;
    try {
      buffer = await this.blob.slice(offset, offset + length).arrayBuffer();
    } catch (error) {
      throwIfAborted(this.signal);
      throw new MediaInspectionError(
        "read-failed",
        error instanceof Error && error.message
          ? `The browser could not read the selected file: ${error.message}`
          : "The browser could not read the selected file.",
      );
    }
    throwIfAborted(this.signal);
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength !== length) {
      throw new MediaInspectionError(
        "malformed-file",
        "The file changed or ended while it was being inspected.",
      );
    }
    return bytes;
  }

  readHead(length: number) {
    return this.read(0, Math.min(length, this.size));
  }
}

export function readUint16BigEndian(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 2 > bytes.byteLength) {
    throw new MediaInspectionError("malformed-file", "A 16-bit field is truncated.");
  }
  return bytes[offset] * 0x100 + bytes[offset + 1];
}

export function readUint16LittleEndian(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 2 > bytes.byteLength) {
    throw new MediaInspectionError("malformed-file", "A 16-bit field is truncated.");
  }
  return bytes[offset] + bytes[offset + 1] * 0x100;
}

export function readUint32BigEndian(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 4 > bytes.byteLength) {
    throw new MediaInspectionError("malformed-file", "A 32-bit field is truncated.");
  }
  return (
    bytes[offset] * 0x1_000_000 +
    bytes[offset + 1] * 0x1_0000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

export function readUint32LittleEndian(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 4 > bytes.byteLength) {
    throw new MediaInspectionError("malformed-file", "A 32-bit field is truncated.");
  }
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x1_0000 +
    bytes[offset + 3] * 0x1_000_000
  );
}

export function readUint64BigEndian(bytes: Uint8Array, offset: number) {
  const high = readUint32BigEndian(bytes, offset);
  const low = readUint32BigEndian(bytes, offset + 4);
  const value = high * 0x1_0000_0000 + low;
  if (!Number.isSafeInteger(value)) {
    throw new MediaInspectionError(
      "malformed-file",
      "A 64-bit file offset exceeds the browser's safe integer range.",
    );
  }
  return value;
}

export function ascii(bytes: Uint8Array, offset: number, length: number) {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new MediaInspectionError("malformed-file", "An ASCII field is truncated.");
  }
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(bytes[offset + index]);
  }
  return value;
}

export function matchesAscii(bytes: Uint8Array, offset: number, value: string) {
  if (offset < 0 || offset + value.length > bytes.byteLength) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}
