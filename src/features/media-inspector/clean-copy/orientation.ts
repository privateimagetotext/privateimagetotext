import { CleanCopyError, throwIfCleanCopyAborted } from "./errors";
import { yieldToBrowser } from "./common";

export interface StrictOrientationState {
  count: number;
  value?: number;
}

function readU16(
  bytes: Uint8Array,
  offset: number,
  littleEndian: boolean,
) {
  if (offset < 0 || offset + 2 > bytes.byteLength) {
    throw new CleanCopyError(
      "malformed-source",
      "An Exif orientation field is truncated.",
    );
  }
  return littleEndian
    ? bytes[offset] + bytes[offset + 1] * 0x100
    : bytes[offset] * 0x100 + bytes[offset + 1];
}

function readU32(
  bytes: Uint8Array,
  offset: number,
  littleEndian: boolean,
) {
  if (offset < 0 || offset + 4 > bytes.byteLength) {
    throw new CleanCopyError(
      "malformed-source",
      "An Exif orientation directory is truncated.",
    );
  }
  return littleEndian
    ? bytes[offset] +
        bytes[offset + 1] * 0x100 +
        bytes[offset + 2] * 0x1_0000 +
        bytes[offset + 3] * 0x1_000000
    : bytes[offset] * 0x1_000000 +
        bytes[offset + 1] * 0x1_0000 +
        bytes[offset + 2] * 0x100 +
        bytes[offset + 3];
}

/**
 * Strictly reads the main-image TIFF Orientation tag. The broad metadata
 * inspector remains responsible for validating the rest of the Exif graph;
 * this independent pass prevents malformed or ambiguous orientation from
 * being silently treated as unrotated before Exif is removed.
 */
export function recordStrictExifOrientation(
  tiff: Uint8Array,
  state: StrictOrientationState,
) {
  if (tiff.byteLength < 8) {
    throw new CleanCopyError(
      "malformed-source",
      "The Exif/TIFF header is truncated.",
    );
  }
  const littleEndian = tiff[0] === 0x49 && tiff[1] === 0x49;
  const bigEndian = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if ((!littleEndian && !bigEndian) || readU16(tiff, 2, littleEndian) !== 42) {
    throw new CleanCopyError(
      "malformed-source",
      "The Exif/TIFF header is invalid.",
    );
  }
  const directoryOffset = readU32(tiff, 4, littleEndian);
  if (directoryOffset < 8 || directoryOffset > tiff.byteLength - 2) {
    throw new CleanCopyError(
      "malformed-source",
      "The Exif main-image directory is invalid.",
    );
  }
  const entryCount = readU16(tiff, directoryOffset, littleEndian);
  if (entryCount > 512) {
    throw new CleanCopyError(
      "malformed-source",
      "The Exif main-image directory is unreasonably complex.",
    );
  }
  const entriesStart = directoryOffset + 2;
  const entriesBytes = entryCount * 12;
  if (
    !Number.isSafeInteger(entriesBytes) ||
    entriesStart > tiff.byteLength - 4 ||
    entriesBytes > tiff.byteLength - entriesStart - 4
  ) {
    throw new CleanCopyError(
      "malformed-source",
      "The Exif main-image directory is truncated.",
    );
  }

  for (let index = 0; index < entryCount; index += 1) {
    const entry = entriesStart + index * 12;
    if (readU16(tiff, entry, littleEndian) !== 0x0112) continue;
    const type = readU16(tiff, entry + 2, littleEndian);
    const count = readU32(tiff, entry + 4, littleEndian);
    if (type !== 3 || count !== 1) {
      throw new CleanCopyError(
        "orientation-unsupported",
        "The Exif Orientation tag has an invalid type or count.",
      );
    }
    const value = readU16(tiff, entry + 8, littleEndian);
    if (value < 1 || value > 8) {
      throw new CleanCopyError(
        "orientation-unsupported",
        "The Exif Orientation tag has an invalid value.",
      );
    }
    if (state.count > 0) {
      throw new CleanCopyError(
        "orientation-unsupported",
        "The image contains duplicate or conflicting Orientation tags.",
      );
    }
    state.count += 1;
    state.value = value;
  }
}

export function assertStrictOrientationIsSafe(
  state: StrictOrientationState,
) {
  if (state.value !== undefined && state.value !== 1) {
    throw new CleanCopyError(
      "orientation-unsupported",
      "Images whose visible orientation depends on metadata are not eligible for a lossless metadata-removed copy.",
    );
  }
}

export async function containsAsciiCaseInsensitive(
  bytes: Uint8Array,
  value: string,
  signal?: AbortSignal,
) {
  const expected = value.toLowerCase();
  if (expected.length === 0 || expected.length > bytes.byteLength) return false;
  for (let offset = 0; offset <= bytes.byteLength - expected.length; offset += 1) {
    if (offset % (64 * 1024) === 0) throwIfCleanCopyAborted(signal);
    if (offset > 0 && offset % (1024 * 1024) === 0) {
      await yieldToBrowser(signal);
    }
    let matches = true;
    for (let index = 0; index < expected.length; index += 1) {
      const byte = bytes[offset + index];
      const lower = byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
      if (lower !== expected.charCodeAt(index)) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}
