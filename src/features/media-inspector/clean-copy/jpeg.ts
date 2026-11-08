import { CleanCopyError, throwIfCleanCopyAborted } from "./errors";
import {
  concatenateParts,
  tailContainsRasterSignature,
  yieldToBrowser,
  type StructuralCleanCopy,
} from "./common";
import { CLEAN_COPY_LIMITS } from "./types";
import {
  assertStrictOrientationIsSafe,
  containsAsciiCaseInsensitive,
  recordStrictExifOrientation,
  type StrictOrientationState,
} from "./orientation";

const SOI = new Uint8Array([0xff, 0xd8]);
const EOI = new Uint8Array([0xff, 0xd9]);
const CANONICAL_JFIF = new Uint8Array([
  0xff, 0xe0, 0x00, 0x10,
  0x4a, 0x46, 0x49, 0x46, 0x00,
  0x01, 0x01, 0x00,
  0x00, 0x01, 0x00, 0x01,
  0x00, 0x00,
]);

// V1 is intentionally limited to browser-portable, 8-bit Huffman DCT JPEG.
// Lossless, arithmetic and differential modes require a separate decode gate.
const SUPPORTED_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2]);
const SUPPORTED_TABLE_MARKERS = new Set([0xc4, 0xdb, 0xdd]);

interface JpegWalkResult {
  readonly width: number;
  readonly height: number;
  readonly components: number;
  readonly outputParts: readonly Uint8Array[];
  readonly preservedParts: readonly Uint8Array[];
  readonly removedCarriers: readonly string[];
}

function matchesAscii(bytes: Uint8Array, offset: number, value: string) {
  if (offset < 0 || offset + value.length > bytes.byteLength) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function readU16(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 2 > bytes.byteLength) {
    throw new CleanCopyError(
      "malformed-source",
      "The JPEG contains a truncated 16-bit field.",
    );
  }
  return bytes[offset] * 0x100 + bytes[offset + 1];
}

function applicationCarrier(marker: number, payload: Uint8Array) {
  const number = marker - 0xe0;
  if (marker === 0xe0 && matchesAscii(payload, 0, "JFXX\0")) {
    return "JPEG JFXX preview";
  }
  if (marker === 0xe1 && matchesAscii(payload, 0, "Exif\0\0")) {
    return "JPEG Exif metadata and previews";
  }
  if (
    marker === 0xe1 &&
    (matchesAscii(payload, 0, "http://ns.adobe.com/xap/1.0/") ||
      matchesAscii(payload, 0, "http://ns.adobe.com/xmp/extension/"))
  ) {
    return "JPEG XMP metadata";
  }
  if (marker === 0xe2 && matchesAscii(payload, 0, "MPF\0")) {
    return "JPEG MPF embedded images";
  }
  if (marker === 0xeb && matchesAscii(payload, 0, "JP")) {
    return "JPEG JUMBF or Content Credentials";
  }
  if (marker === 0xed && matchesAscii(payload, 0, "Photoshop 3.0\0")) {
    return "JPEG Photoshop or IPTC metadata";
  }
  if (marker === 0xee && matchesAscii(payload, 0, "Adobe")) {
    return "JPEG Adobe colour marker";
  }
  return `JPEG application marker APP${number}`;
}

function malformed(message: string): never {
  throw new CleanCopyError("malformed-source", message);
}

function unsupported(message: string): never {
  throw new CleanCopyError("unsupported-structure", message);
}

async function walkJpeg(
  bytes: Uint8Array,
  mode: "source" | "output",
  signal?: AbortSignal,
): Promise<JpegWalkResult> {
  if (
    bytes.byteLength < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8
  ) {
    malformed("The JPEG signature is invalid.");
  }

  const outputParts: Uint8Array[] = [SOI];
  if (mode === "source") outputParts.push(CANONICAL_JFIF);
  const preservedParts: Uint8Array[] = [];
  const removed = new Set<string>();
  let offset = 2;
  let markerCount = 0;
  let inEntropy = false;
  let width: number | undefined;
  let height: number | undefined;
  let components: number | undefined;
  let sawSof = false;
  let sawSos = false;
  let sawEoi = false;
  let sawJfif = false;
  let sawCanonicalOutputJfif = false;
  let adobeTransform: number | undefined;
  let structuralMarkerSeen = false;
  const orientation: StrictOrientationState = { count: 0 };

  while (offset < bytes.byteLength) {
    throwIfCleanCopyAborted(signal);
    if (markerCount >= CLEAN_COPY_LIMITS.maxJpegMarkers) {
      unsupported("The JPEG marker graph is unreasonably complex.");
    }
    if (markerCount > 0 && markerCount % 256 === 0) {
      await yieldToBrowser(signal);
    }

    if (inEntropy) {
      const entropyStart = offset;
      let markerStart = -1;
      while (offset < bytes.byteLength) {
        if ((offset - entropyStart) % (64 * 1024) === 0) {
          throwIfCleanCopyAborted(signal);
        }
        if (
          offset > entropyStart &&
          (offset - entropyStart) % (1024 * 1024) === 0
        ) {
          await yieldToBrowser(signal);
        }
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const fillStart = offset;
        while (offset + 1 < bytes.byteLength && bytes[offset + 1] === 0xff) {
          offset += 1;
        }
        if (offset + 1 >= bytes.byteLength) {
          malformed("The JPEG entropy-coded scan is truncated.");
        }
        const next = bytes[offset + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          offset += 2;
          continue;
        }
        markerStart = offset;
        if (fillStart > entropyStart) {
          const entropy = bytes.subarray(entropyStart, fillStart);
          outputParts.push(entropy);
          preservedParts.push(entropy);
        }
        break;
      }
      if (markerStart < 0) {
        malformed("The JPEG is missing an end-of-image marker.");
      }
      offset = markerStart;
      inEntropy = false;
    }

    if (bytes[offset] !== 0xff) {
      malformed("The JPEG marker stream is malformed.");
    }
    while (offset + 1 < bytes.byteLength && bytes[offset + 1] === 0xff) {
      offset += 1;
    }
    if (offset + 1 >= bytes.byteLength) {
      malformed("The JPEG marker stream is truncated.");
    }
    const markerStart = offset;
    const marker = bytes[offset + 1];
    offset += 2;
    markerCount += 1;

    if (marker === 0x00) {
      malformed("The JPEG header contains an invalid stuffed marker byte.");
    }
    if (marker === 0xd8) {
      unsupported("The JPEG contains a nested image stream.");
    }
    if (marker === 0xd9) {
      sawEoi = true;
      outputParts.push(EOI);
      if (mode === "output" && offset !== bytes.byteLength) {
        throw new CleanCopyError(
          "verification-failed",
          "The generated JPEG contains data after its end marker.",
        );
      }
      if (mode === "source" && offset < bytes.byteLength) {
        if (await tailContainsRasterSignature(bytes, offset, signal)) {
          throw new CleanCopyError(
            "animated-media",
            "Multi-image or concatenated raster files are not eligible for a metadata-removed copy.",
          );
        }
        removed.add("Data after the JPEG end marker");
      }
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      unsupported("The JPEG contains a standalone marker outside a scan.");
    }
    if (offset + 2 > bytes.byteLength) {
      malformed("A JPEG segment length is truncated.");
    }
    const segmentLength = readU16(bytes, offset);
    if (segmentLength < 2 || segmentLength > bytes.byteLength - offset) {
      malformed("A JPEG segment has an invalid length.");
    }
    const segmentEnd = offset + segmentLength;
    const payload = bytes.subarray(offset + 2, segmentEnd);
    const segment = bytes.subarray(markerStart, segmentEnd);
    offset = segmentEnd;

    if (marker >= 0xe0 && marker <= 0xef) {
      if (
        marker === 0xe2 &&
        (matchesAscii(payload, 0, "ICC_PROFILE") ||
          matchesAscii(payload, 0, "ICC_PROFILE\0"))
      ) {
        throw new CleanCopyError(
          "colour-profile-unsupported",
          "JPEGs with embedded ICC profiles are not eligible for the lossless metadata-removal profile.",
        );
      }
      if (marker === 0xe0 && matchesAscii(payload, 0, "JFIF\0")) {
        if (payload.byteLength < 14) {
          malformed("The JPEG contains a truncated JFIF marker.");
        }
        const thumbnailBytes = 3 * payload[12] * payload[13];
        if (thumbnailBytes > payload.byteLength - 14) {
          malformed("The JPEG JFIF thumbnail is truncated.");
        }
        const densityUnit = payload[7];
        const xDensity = readU16(payload, 8);
        const yDensity = readU16(payload, 10);
        if (
          densityUnit > 2 ||
          xDensity === 0 ||
          yDensity === 0 ||
          xDensity !== yDensity
        ) {
          throw new CleanCopyError(
            "unsupported-structure",
            "JPEGs with ambiguous or non-square pixel density are not eligible for the canonical JFIF profile.",
          );
        }
        if (structuralMarkerSeen) {
          throw new CleanCopyError(
            "unsafe-colour-model",
            "A late JFIF marker cannot safely establish the JPEG colour interpretation.",
          );
        }
        if (sawJfif) {
          throw new CleanCopyError(
            "unsafe-colour-model",
            "The JPEG contains duplicate JFIF colour markers.",
          );
        }
        sawJfif = true;
        if (thumbnailBytes > 0) removed.add("JPEG JFIF embedded preview");
      }
      if (marker === 0xe1 && matchesAscii(payload, 0, "Exif\0\0")) {
        recordStrictExifOrientation(payload.subarray(6), orientation);
      }
      if (
        marker === 0xe1 &&
        matchesAscii(payload, 0, "http://ns.adobe.com/xmp/extension/")
      ) {
        throw new CleanCopyError(
          "orientation-unsupported",
          "This file stores rotation information in extended XMP in a form the tool cannot remove safely, so a metadata-removed copy is unavailable.",
        );
      }
      if (
        marker === 0xe1 &&
        matchesAscii(payload, 0, "http://ns.adobe.com/xap/1.0/") &&
        await containsAsciiCaseInsensitive(payload, "orientation", signal)
      ) {
        throw new CleanCopyError(
          "orientation-unsupported",
          "This file stores rotation information in XMP in a form the tool cannot remove safely, so a metadata-removed copy is unavailable.",
        );
      }
      if (marker === 0xe2 && matchesAscii(payload, 0, "MPF\0")) {
        throw new CleanCopyError(
          "animated-media",
          "MPO and other multi-picture JPEG files are not eligible for a metadata-removed copy.",
        );
      }
      if (marker === 0xee && matchesAscii(payload, 0, "Adobe")) {
        if (payload.byteLength < 12) {
          throw new CleanCopyError(
            "unsafe-colour-model",
            "The JPEG contains a malformed Adobe colour marker.",
          );
        }
        if (structuralMarkerSeen) {
          throw new CleanCopyError(
            "unsafe-colour-model",
            "A late Adobe marker cannot safely establish the JPEG colour interpretation.",
          );
        }
        const transform = payload[11];
        if (adobeTransform !== undefined) {
          throw new CleanCopyError(
            "unsafe-colour-model",
            "The JPEG contains duplicate or conflicting Adobe colour transforms.",
          );
        }
        adobeTransform = transform;
      }

      if (mode === "output") {
        if (
          marker !== 0xe0 ||
          structuralMarkerSeen ||
          sawCanonicalOutputJfif ||
          !equalBytes(segment, CANONICAL_JFIF)
        ) {
          throw new CleanCopyError(
            "verification-failed",
            "The generated JPEG contains an application marker outside its safe profile.",
          );
        }
        sawCanonicalOutputJfif = true;
        outputParts.push(segment);
      } else {
        removed.add(applicationCarrier(marker, payload));
      }
      continue;
    }
    if (marker === 0xfe) {
      if (mode === "output") {
        throw new CleanCopyError(
          "verification-failed",
          "The generated JPEG still contains a comment marker.",
        );
      }
      removed.add("JPEG comment");
      continue;
    }

    structuralMarkerSeen = true;
    if (SUPPORTED_SOF_MARKERS.has(marker)) {
      if (sawSof) unsupported("The JPEG contains multiple frame headers.");
      if (payload.byteLength < 6) malformed("The JPEG frame header is truncated.");
      const frameComponents = payload[5];
      if (
        payload[0] !== 8 ||
        frameComponents <= 0 ||
        payload.byteLength !== 6 + frameComponents * 3
      ) {
        throw new CleanCopyError(
          "unsupported-structure",
          "Only 8-bit Huffman DCT JPEG frame headers are eligible.",
        );
      }
      const frameHeight = readU16(payload, 1);
      const frameWidth = readU16(payload, 3);
      if (frameWidth <= 0 || frameHeight <= 0) {
        malformed("The JPEG dimensions are invalid.");
      }
      width = frameWidth;
      height = frameHeight;
      components = frameComponents;
      sawSof = true;
    } else if (marker === 0xda) {
      if (!sawSof) malformed("The JPEG scan appears before its frame header.");
      const scanComponents = payload[0];
      if (
        payload.byteLength < 1 ||
        scanComponents <= 0 ||
        payload.byteLength !== 4 + scanComponents * 2
      ) {
        malformed("The JPEG scan header is malformed.");
      }
      sawSos = true;
      inEntropy = true;
    } else if (!SUPPORTED_TABLE_MARKERS.has(marker)) {
      unsupported(
        `The JPEG uses unsupported structural marker 0x${marker.toString(16).padStart(2, "0")}.`,
      );
    }

    outputParts.push(segment);
    preservedParts.push(segment);
  }

  if (!sawEoi || !sawSof || !sawSos || !width || !height || !components) {
    malformed("The JPEG is missing a complete frame, scan, or end marker.");
  }
  if (mode === "output" && !sawCanonicalOutputJfif) {
    throw new CleanCopyError(
      "verification-failed",
      "The generated JPEG is missing its canonical colour marker.",
    );
  }
  if (components !== 1 && components !== 3) {
    throw new CleanCopyError(
      "unsafe-colour-model",
      "Only one-component grayscale and three-component YCbCr JPEGs are eligible.",
    );
  }
  if (components === 3) {
    if (adobeTransform === 0 || adobeTransform === 2) {
      throw new CleanCopyError(
        "unsafe-colour-model",
        "The JPEG colour transform cannot be represented by the metadata-removal profile.",
      );
    }
    if (!sawJfif && adobeTransform !== 1) {
      throw new CleanCopyError(
        "unsafe-colour-model",
        "The JPEG does not explicitly identify a safe YCbCr colour interpretation.",
      );
    }
  }
  assertStrictOrientationIsSafe(orientation);

  return {
    width,
    height,
    components,
    outputParts,
    preservedParts,
    removedCarriers: [...removed],
  };
}

export async function rewriteJpegCleanCopy(
  source: Uint8Array,
  maximumOutputBytes: number,
  signal?: AbortSignal,
): Promise<StructuralCleanCopy> {
  const parsed = await walkJpeg(source, "source", signal);
  return {
    bytes: await concatenateParts(parsed.outputParts, maximumOutputBytes, signal),
    width: parsed.width,
    height: parsed.height,
    preservedParts: parsed.preservedParts,
    removedCarriers: parsed.removedCarriers,
    preservedCarriers: [
      "Canonical zero-thumbnail JFIF colour marker",
      "JPEG coding tables, frame headers, and entropy-coded scans",
    ],
  };
}

export async function verifyJpegCleanCopy(
  output: Uint8Array,
  signal?: AbortSignal,
): Promise<StructuralCleanCopy> {
  const parsed = await walkJpeg(output, "output", signal);
  return {
    bytes: output,
    width: parsed.width,
    height: parsed.height,
    preservedParts: parsed.preservedParts,
    removedCarriers: [],
    preservedCarriers: [
      "Canonical zero-thumbnail JFIF colour marker",
      "JPEG coding tables, frame headers, and entropy-coded scans",
    ],
  };
}
