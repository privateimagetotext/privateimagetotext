import {
  concatenateParts,
  tailContainsRasterSignature,
  yieldToBrowser,
  type StructuralCleanCopy,
} from "./common";
import { CleanCopyError, throwIfCleanCopyAborted } from "./errors";
import {
  assertStrictOrientationIsSafe,
  containsAsciiCaseInsensitive,
  recordStrictExifOrientation,
  type StrictOrientationState,
} from "./orientation";
import { CLEAN_COPY_LIMITS } from "./types";

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const SAFE_ANCILLARY = new Set([
  "tRNS",
  "cHRM",
  "gAMA",
  "sRGB",
  "sBIT",
  "cICP",
  "mDCV",
  "cLLI",
  "bKGD",
  "sTER",
]);

const REMOVED_ANCILLARY = new Set([
  "tEXt",
  "zTXt",
  "iTXt",
  "eXIf",
  "tIME",
  "pHYs",
  "caBX",
  "hIST",
  "sPLT",
  "oFFs",
  "pCAL",
  "sCAL",
  "dSIG",
  "gIFg",
  "gIFt",
  "gIFx",
]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb8_8320 : 0);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

interface PngWalkResult {
  readonly width: number;
  readonly height: number;
  readonly outputParts: readonly Uint8Array[];
  readonly preservedParts: readonly Uint8Array[];
  readonly removedCarriers: readonly string[];
  readonly preservedCarriers: readonly string[];
}

function malformed(message: string): never {
  throw new CleanCopyError("malformed-source", message);
}

function matchesSignature(bytes: Uint8Array) {
  if (bytes.byteLength < PNG_SIGNATURE.byteLength) return false;
  for (let index = 0; index < PNG_SIGNATURE.byteLength; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) return false;
  }
  return true;
}

function readU32(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 4 > bytes.byteLength) {
    malformed("A PNG 32-bit field is truncated.");
  }
  return (
    bytes[offset] * 0x1_000000 +
    bytes[offset + 1] * 0x1_0000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function chunkType(bytes: Uint8Array, offset: number) {
  let value = "";
  for (let index = 0; index < 4; index += 1) {
    const byte = bytes[offset + index];
    if (!((byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a))) {
      malformed("A PNG chunk type contains a non-letter byte.");
    }
    value += String.fromCharCode(byte);
  }
  if ((bytes[offset + 2] & 0x20) !== 0) {
    malformed("A PNG chunk uses the reserved lowercase type bit.");
  }
  return value;
}

function metadataKeyword(data: Uint8Array) {
  let value = "";
  for (let index = 0; index < Math.min(data.byteLength, 80); index += 1) {
    if (data[index] === 0) return value.toLowerCase();
    value += String.fromCharCode(data[index]);
  }
  return "";
}

async function crc32(
  bytes: Uint8Array,
  start: number,
  end: number,
  signal?: AbortSignal,
) {
  let crc = 0xffff_ffff;
  for (let index = start; index < end; index += 1) {
    if ((index - start) % (64 * 1024) === 0) {
      throwIfCleanCopyAborted(signal);
    }
    if (index > start && (index - start) % (1024 * 1024) === 0) {
      await yieldToBrowser(signal);
    }
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function validateIhdr(data: Uint8Array) {
  if (data.byteLength !== 13) malformed("The PNG IHDR chunk is invalid.");
  const width = readU32(data, 0);
  const height = readU32(data, 4);
  const bitDepth = data[8];
  const colourType = data[9];
  const validDepths: Readonly<Record<number, readonly number[]>> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (
    width <= 0 ||
    height <= 0 ||
    !validDepths[colourType]?.includes(bitDepth) ||
    data[10] !== 0 ||
    data[11] !== 0 ||
    ![0, 1].includes(data[12])
  ) {
    malformed("The PNG image header contains unsupported or invalid fields.");
  }
  return { width, height, bitDepth, colourType };
}

function validateSafeAncillary(
  type: string,
  data: Uint8Array,
  colourType: number,
  bitDepth: number,
  paletteEntries: number,
) {
  if (type === "cHRM" && data.byteLength !== 32) malformed("The PNG cHRM chunk is invalid.");
  if (type === "gAMA" && (data.byteLength !== 4 || readU32(data, 0) === 0)) {
    malformed("The PNG gAMA chunk is invalid.");
  }
  if (type === "sRGB" && (data.byteLength !== 1 || data[0] > 3)) {
    malformed("The PNG sRGB chunk is invalid.");
  }
  if (
    type === "cICP" &&
    (data.byteLength !== 4 || data[2] !== 0 || data[3] > 1)
  ) {
    malformed("The PNG cICP chunk is invalid.");
  }
  if (type === "mDCV" && data.byteLength !== 24) {
    malformed(`The PNG ${type} HDR mastering chunk is invalid.`);
  }
  if (type === "cLLI" && data.byteLength !== 8) {
    malformed(`The PNG ${type} HDR light-level chunk is invalid.`);
  }
  if (type === "sTER" && (data.byteLength !== 1 || data[0] > 1)) {
    malformed("The PNG sTER chunk is invalid.");
  }
  if (type === "sBIT") {
    const expected = colourType === 0 ? 1 : colourType === 2 || colourType === 3 ? 3 : colourType === 4 ? 2 : 4;
    if (data.byteLength !== expected) malformed("The PNG sBIT chunk is invalid.");
    for (const depth of data) {
      const maximum = colourType === 3 ? 8 : bitDepth;
      if (depth === 0 || depth > maximum) malformed("The PNG sBIT precision is invalid.");
    }
  }
  if (type === "tRNS") {
    if (
      (colourType === 0 && data.byteLength !== 2) ||
      (colourType === 2 && data.byteLength !== 6) ||
      (colourType === 3 &&
        (data.byteLength === 0 || data.byteLength > paletteEntries)) ||
      colourType === 4 ||
      colourType === 6
    ) {
      malformed("The PNG tRNS chunk is invalid for its colour type.");
    }
  }
  if (type === "bKGD") {
    const expected = colourType === 3 ? 1 : colourType === 0 || colourType === 4 ? 2 : 6;
    if (data.byteLength !== expected) malformed("The PNG bKGD chunk is invalid.");
    if (colourType === 3 && data[0] >= paletteEntries) {
      malformed("The PNG bKGD palette index is invalid.");
    }
  }
}

async function walkPng(
  bytes: Uint8Array,
  mode: "source" | "output",
  signal?: AbortSignal,
): Promise<PngWalkResult> {
  if (!matchesSignature(bytes)) malformed("The PNG signature is invalid.");
  const outputParts: Uint8Array[] = [PNG_SIGNATURE];
  const preservedParts: Uint8Array[] = [];
  const removed = new Set<string>();
  const preserved = new Set<string>();
  const seen = new Set<string>();
  const orientation: StrictOrientationState = { count: 0 };
  let offset = PNG_SIGNATURE.byteLength;
  let chunks = 0;
  let width: number | undefined;
  let height: number | undefined;
  let bitDepth: number | undefined;
  let colourType: number | undefined;
  let paletteEntries = 0;
  let sawPlte = false;
  let sawIdat = false;
  let endedIdat = false;
  let sawIend = false;
  let sawMasteringDisplay = false;

  while (offset < bytes.byteLength) {
    throwIfCleanCopyAborted(signal);
    if (chunks >= CLEAN_COPY_LIMITS.maxPngChunks) {
      throw new CleanCopyError(
        "unsupported-structure",
        "The PNG chunk graph is unreasonably complex.",
      );
    }
    if (chunks > 0 && chunks % 128 === 0) await yieldToBrowser(signal);
    if (offset > bytes.byteLength - 12) malformed("A PNG chunk header is truncated.");
    const length = readU32(bytes, offset);
    const typeOffset = offset + 4;
    const type = chunkType(bytes, typeOffset);
    if (length > 0x7fff_ffff || length > bytes.byteLength - offset - 12) {
      malformed("A PNG chunk has an invalid length.");
    }
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    const expectedCrc = readU32(bytes, dataEnd);
    if ((await crc32(bytes, typeOffset, dataEnd, signal)) !== expectedCrc) {
      malformed(`The PNG ${type} chunk has an invalid CRC.`);
    }
    const data = bytes.subarray(dataStart, dataEnd);
    const fullChunk = bytes.subarray(offset, chunkEnd);
    chunks += 1;

    if (!width && type !== "IHDR") malformed("The PNG IHDR chunk must be first.");
    if (sawIend) malformed("The PNG contains a chunk after IEND.");
    if (sawIdat && type !== "IDAT") endedIdat = true;

    if (type === "IHDR") {
      if (width || chunks !== 1) malformed("The PNG contains an invalid or duplicate IHDR chunk.");
      ({ width, height, bitDepth, colourType } = validateIhdr(data));
    } else if (type === "PLTE") {
      if (
        sawPlte ||
        sawIdat ||
        seen.has("tRNS") ||
        seen.has("bKGD") ||
        data.byteLength < 3 ||
        data.byteLength > 768 ||
        data.byteLength % 3 !== 0
      ) {
        malformed("The PNG PLTE chunk is invalid or misplaced.");
      }
      if (colourType === 0 || colourType === 4) malformed("The PNG colour type cannot contain a palette.");
      paletteEntries = data.byteLength / 3;
      if (colourType === 3 && paletteEntries > 2 ** (bitDepth ?? 0)) {
        malformed("The PNG palette exceeds the indexed bit depth.");
      }
      sawPlte = true;
    } else if (type === "IDAT") {
      if (endedIdat) malformed("The PNG IDAT chunks are not consecutive.");
      if (colourType === 3 && !sawPlte) malformed("The indexed PNG is missing its palette.");
      sawIdat = true;
    } else if (type === "IEND") {
      if (length !== 0 || !sawIdat) malformed("The PNG IEND chunk is invalid or appears before image data.");
      sawIend = true;
    } else if (["acTL", "fcTL", "fdAT"].includes(type)) {
      throw new CleanCopyError(
        "animated-media",
        "Animated or multi-frame PNG files are not eligible for a metadata-removed copy.",
      );
    } else if (type === "iCCP") {
      throw new CleanCopyError(
        "colour-profile-unsupported",
        "PNGs with embedded ICC profiles are not eligible for the lossless metadata-removal profile.",
      );
    } else if (["mDCv", "cLLi"].includes(type)) {
      throw new CleanCopyError(
        "colour-profile-unsupported",
        `The legacy PNG ${type} HDR chunk is not supported by the metadata-removal profile.`,
      );
    } else if (SAFE_ANCILLARY.has(type)) {
      if (seen.has(type)) malformed(`The PNG contains a duplicate ${type} chunk.`);
      if (
        [
          "cHRM",
          "gAMA",
          "sRGB",
          "sBIT",
          "cICP",
          "mDCV",
          "cLLI",
        ].includes(type) &&
        (sawPlte || sawIdat)
      ) {
        malformed(`The PNG ${type} colour chunk is misplaced.`);
      }
      if (["tRNS", "bKGD", "sTER"].includes(type) && sawIdat) {
        malformed(`The PNG ${type} chunk appears after image data.`);
      }
      if (type === "mDCV") sawMasteringDisplay = true;
      if (colourType === undefined || bitDepth === undefined) malformed("The PNG header state is incomplete.");
      validateSafeAncillary(type, data, colourType, bitDepth, paletteEntries);
      seen.add(type);
    } else if (REMOVED_ANCILLARY.has(type)) {
      if (type === "eXIf") recordStrictExifOrientation(data, orientation);
      if (type === "pHYs") {
        if (data.byteLength !== 9) malformed("The PNG pHYs chunk is invalid.");
        const xDensity = readU32(data, 0);
        const yDensity = readU32(data, 4);
        if (
          xDensity === 0 ||
          yDensity === 0 ||
          xDensity !== yDensity ||
          data[8] > 1
        ) {
          throw new CleanCopyError(
            "unsupported-structure",
            "PNGs with ambiguous or non-square pixel density are not eligible for a metadata-removed copy.",
          );
        }
      }
      const keyword = ["tEXt", "zTXt", "iTXt"].includes(type)
        ? metadataKeyword(data)
        : "";
      if (
        (type === "zTXt" && keyword.includes("xmp")) ||
        (type === "iTXt" &&
          keyword.includes("xmp") &&
          data[keyword.length + 1] === 1)
      ) {
        throw new CleanCopyError(
          "orientation-unsupported",
          "This file stores rotation information in compressed XMP in a form the tool cannot remove safely, so a metadata-removed copy is unavailable.",
        );
      }
      if (
        ["tEXt", "iTXt"].includes(type) &&
        await containsAsciiCaseInsensitive(data, "orientation", signal)
      ) {
        throw new CleanCopyError(
          "orientation-unsupported",
          "This file stores rotation information in XMP or PNG text in a form the tool cannot remove safely, so a metadata-removed copy is unavailable.",
        );
      }
      if (mode === "output") {
        throw new CleanCopyError(
          "verification-failed",
          `The generated PNG still contains ${type} metadata.`,
        );
      }
      removed.add(`PNG ${type} metadata chunk`);
      offset = chunkEnd;
      if (type === "IEND") break;
      continue;
    } else if ((type.charCodeAt(0) & 0x20) === 0) {
      throw new CleanCopyError(
        "unsupported-structure",
        `The PNG contains unknown critical chunk ${type}.`,
      );
    } else {
      if (mode === "output") {
        throw new CleanCopyError(
          "verification-failed",
          `The generated PNG contains unknown ancillary chunk ${type}.`,
        );
      }
      removed.add(`PNG private or unknown ancillary chunk ${type}`);
      offset = chunkEnd;
      continue;
    }

    outputParts.push(fullChunk);
    preservedParts.push(fullChunk);
    if (type === "IHDR") preserved.add("PNG IHDR image header");
    else if (type === "PLTE") preserved.add("PNG PLTE palette");
    else if (type === "IDAT") preserved.add("PNG IDAT image data");
    else if (SAFE_ANCILLARY.has(type)) {
      preserved.add(`PNG ${type} rendering chunk`);
    }
    offset = chunkEnd;
    if (type === "IEND") break;
  }

  if (!width || !height || !sawIdat || !sawIend) {
    malformed("The PNG is missing a complete header, image data, or end marker.");
  }
  if (sawMasteringDisplay && !seen.has("cICP")) {
    malformed("The PNG mDCV HDR mastering chunk requires a cICP chunk.");
  }
  if (offset < bytes.byteLength) {
    if (mode === "output") {
      throw new CleanCopyError(
        "verification-failed",
        "The generated PNG contains data after IEND.",
      );
    }
    if (await tailContainsRasterSignature(bytes, offset, signal)) {
      throw new CleanCopyError(
        "animated-media",
        "Concatenated or multi-image raster files are not eligible for a metadata-removed copy.",
      );
    }
    removed.add("Data after the PNG end marker");
  }
  assertStrictOrientationIsSafe(orientation);
  return {
    width,
    height,
    outputParts,
    preservedParts,
    removedCarriers: [...removed],
    preservedCarriers: [...preserved],
  };
}

export async function rewritePngCleanCopy(
  source: Uint8Array,
  maximumOutputBytes: number,
  signal?: AbortSignal,
): Promise<StructuralCleanCopy> {
  const parsed = await walkPng(source, "source", signal);
  return {
    bytes: await concatenateParts(parsed.outputParts, maximumOutputBytes, signal),
    width: parsed.width,
    height: parsed.height,
    preservedParts: parsed.preservedParts,
    removedCarriers: parsed.removedCarriers,
    preservedCarriers: parsed.preservedCarriers,
  };
}

export async function verifyPngCleanCopy(
  output: Uint8Array,
  signal?: AbortSignal,
): Promise<StructuralCleanCopy> {
  const parsed = await walkPng(output, "output", signal);
  return {
    bytes: output,
    width: parsed.width,
    height: parsed.height,
    preservedParts: parsed.preservedParts,
    removedCarriers: [],
    preservedCarriers: parsed.preservedCarriers,
  };
}
