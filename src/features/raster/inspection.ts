import {
  isJpegSofMarker,
  parseBmpDimensions,
  parsePngDimensions,
  parseWebpDimensions,
  readUint32BigEndian,
  readUint32LittleEndian,
} from "./dimensions";
import { declaredMimeMatches, detectRasterSignature } from "./signatures";
import {
  RASTER_LIMITS,
  RasterValidationError,
  type RasterDimensions,
  type RasterInspectionResult,
  type RasterKind,
  type RasterPurpose,
  type RasterValidationFailure,
} from "./types";

const MAX_CHUNK_COUNT = 4_096;
const MAX_JPEG_MARKERS = 4_096;
const MAX_JPEG_FILL_BYTES = 65_536;

async function readExact(blob: Blob, offset: number, length: number) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > blob.size
  ) {
    throw new RasterValidationError(
      "malformed-image",
      "The image header is malformed or incomplete.",
    );
  }
  const bytes = new Uint8Array(
    await blob.slice(offset, offset + length).arrayBuffer(),
  );
  if (bytes.byteLength !== length) {
    throw new RasterValidationError(
      "malformed-image",
      "The image header is malformed or incomplete.",
    );
  }
  return bytes;
}

function ascii(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function readUint16BigEndian(bytes: Uint8Array, offset: number) {
  return bytes[offset] * 0x100 + bytes[offset + 1];
}

async function inspectJpegDimensions(blob: Blob): Promise<RasterDimensions> {
  let offset = 2;
  let markerCount = 0;
  let fillByteCount = 0;

  while (offset < blob.size && markerCount < MAX_JPEG_MARKERS) {
    const markerBytes = await readExact(blob, offset, 2);
    if (markerBytes[0] !== 0xff) {
      throw new RasterValidationError(
        "malformed-image",
        "The JPEG marker stream is malformed.",
      );
    }
    if (markerBytes[1] === 0xff) {
      fillByteCount += 1;
      if (fillByteCount > MAX_JPEG_FILL_BYTES) {
        throw new RasterValidationError(
          "malformed-image",
          "The JPEG header is unreasonably complex.",
        );
      }
      offset += 1;
      continue;
    }

    const marker = markerBytes[1];
    offset += 2;
    markerCount += 1;

    if (marker === 0x00 || marker === 0xd9 || marker === 0xda) {
      throw new RasterValidationError(
        "malformed-image",
        "The JPEG has no supported start-of-frame header.",
      );
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;

    const lengthBytes = await readExact(blob, offset, 2);
    const segmentLength = readUint16BigEndian(lengthBytes, 0);
    if (segmentLength < 2) {
      throw new RasterValidationError(
        "malformed-image",
        "The JPEG contains an invalid segment length.",
      );
    }
    const segmentEnd = offset + segmentLength;
    if (!Number.isSafeInteger(segmentEnd) || segmentEnd > blob.size) {
      throw new RasterValidationError(
        "malformed-image",
        "The image header is malformed or incomplete.",
      );
    }

    if (isJpegSofMarker(marker)) {
      if (segmentLength < 7) {
        throw new RasterValidationError(
          "malformed-image",
          "The JPEG start-of-frame segment is too short.",
        );
      }
      const frame = await readExact(blob, offset, 7);
      const height = readUint16BigEndian(frame, 3);
      const width = readUint16BigEndian(frame, 5);
      if (width <= 0 || height <= 0) {
        throw new RasterValidationError(
          "malformed-image",
          "The image header contains invalid dimensions.",
        );
      }
      return { width, height };
    }
    offset = segmentEnd;
  }

  throw new RasterValidationError(
    "malformed-image",
    "The JPEG has no supported start-of-frame header.",
  );
}

async function pngIsAnimated(blob: Blob) {
  let offset = 8;
  for (let chunkCount = 0; chunkCount < MAX_CHUNK_COUNT; chunkCount += 1) {
    const header = await readExact(blob, offset, 8);
    const length = readUint32BigEndian(header, 0);
    if (length > 0x7fff_ffff) {
      throw new RasterValidationError(
        "malformed-image",
        "The PNG contains an invalid chunk length.",
      );
    }
    const type = ascii(header, 4);
    const nextOffset = offset + 12 + length;
    if (!Number.isSafeInteger(nextOffset) || nextOffset > blob.size) {
      throw new RasterValidationError(
        "malformed-image",
        "The PNG contains a truncated chunk.",
      );
    }
    if (type === "acTL") return true;
    if (type === "IEND") return false;
    offset = nextOffset;
  }
  throw new RasterValidationError(
    "malformed-image",
    "The PNG chunk structure is unreasonably complex.",
  );
}

async function webpIsAnimated(blob: Blob, prefix: Uint8Array) {
  const riffEnd = readUint32LittleEndian(prefix, 4) + 8;
  if (!Number.isSafeInteger(riffEnd) || riffEnd < 20 || riffEnd > blob.size) {
    throw new RasterValidationError(
      "malformed-image",
      "The WebP RIFF length is invalid.",
    );
  }

  let offset = 12;
  for (let chunkCount = 0; chunkCount < MAX_CHUNK_COUNT; chunkCount += 1) {
    if (offset === riffEnd) return false;
    const header = await readExact(blob, offset, 8);
    const type = ascii(header, 0);
    const length = readUint32LittleEndian(header, 4);
    const dataEnd = offset + 8 + length;
    const nextOffset = dataEnd + (length & 1);
    if (
      !Number.isSafeInteger(nextOffset) ||
      dataEnd > riffEnd ||
      nextOffset > riffEnd
    ) {
      throw new RasterValidationError(
        "malformed-image",
        "The WebP contains a truncated chunk.",
      );
    }
    if (type === "ANIM" || type === "ANMF") return true;
    if (type === "VP8X") {
      if (length < 10) {
        throw new RasterValidationError(
          "malformed-image",
          "The WebP VP8X header is too short.",
        );
      }
      const flags = await readExact(blob, offset + 8, 1);
      if ((flags[0] & 0x02) !== 0) return true;
    }
    offset = nextOffset;
  }
  throw new RasterValidationError(
    "malformed-image",
    "The WebP chunk structure is unreasonably complex.",
  );
}

function assertHeaderDimensions({ width, height }: RasterDimensions) {
  if (width > RASTER_LIMITS.maxWidth || height > RASTER_LIMITS.maxHeight) {
    throw new RasterValidationError(
      "dimensions-too-large",
      `Choose an image no larger than ${RASTER_LIMITS.maxWidth} by ${RASTER_LIMITS.maxHeight} pixels. Private Image to Text does not resize carrier images.`,
    );
  }
}

async function parseRasterHeaderDimensions(
  file: Blob,
  kind: RasterKind,
  prefix: Uint8Array,
): Promise<RasterDimensions> {
  if (kind === "jpeg") return inspectJpegDimensions(file);
  if (kind === "png") return parsePngDimensions(prefix);
  if (kind === "webp") {
    const riffEnd = readUint32LittleEndian(prefix, 4) + 8;
    if (!Number.isSafeInteger(riffEnd) || riffEnd < 20 || riffEnd > file.size) {
      throw new RasterValidationError(
        "malformed-image",
        "The WebP RIFF length is invalid.",
      );
    }
    return parseWebpDimensions(prefix);
  }
  return parseBmpDimensions(prefix);
}

export async function inspectRasterHeader(file: Blob) {
  const prefix = await readExact(file, 0, Math.min(30, file.size));
  const kind = detectRasterSignature(prefix);
  if (!kind) {
    throw new RasterValidationError(
      "unsupported-format",
      "The file contents are not a supported raster image.",
    );
  }
  const dimensions = await parseRasterHeaderDimensions(file, kind, prefix);
  return { kind, ...dimensions };
}

function failure(error: unknown): RasterValidationFailure {
  if (error instanceof RasterValidationError) {
    return { ok: false, code: error.code, message: error.message };
  }
  return {
    ok: false,
    code: "malformed-image",
    message: "The browser could not safely inspect this image.",
  };
}

export async function inspectRasterFile(
  file: Blob,
  purpose: RasterPurpose,
): Promise<RasterInspectionResult> {
  const maxBytes =
    purpose === "hide" ? RASTER_LIMITS.hideMaxBytes : RASTER_LIMITS.revealMaxBytes;
  if (file.size > maxBytes) {
    return {
      ok: false,
      code: "file-too-large",
      message: `Choose a file no larger than ${maxBytes / (1024 * 1024)} MiB.`,
    };
  }

  try {
    const prefix = await readExact(file, 0, Math.min(30, file.size));
    const kind = detectRasterSignature(prefix);
    if (!kind) {
      throw new RasterValidationError(
        "unsupported-format",
        purpose === "reveal"
          ? "Choose an LTSG-compatible PNG v1 or JPEG v2 image."
          : "Choose a PNG, JPEG, WebP or BMP image.",
      );
    }
    if (purpose === "reveal" && kind !== "png" && kind !== "jpeg") {
      throw new RasterValidationError(
        "unsupported-format",
        "Reveal accepts LTSG PNG v1 and JPEG v2 images.",
      );
    }
    if (!declaredMimeMatches(kind, file.type)) {
      throw new RasterValidationError(
        "mime-mismatch",
        "The image contents do not match the file type reported by the browser.",
      );
    }

    const parsed = await parseRasterHeaderDimensions(file, kind, prefix);
    if (kind === "png") {
      if (await pngIsAnimated(file)) {
        throw new RasterValidationError(
          "animated-image",
          "Animated PNG images are not supported.",
        );
      }
    } else if (kind === "webp") {
      if (await webpIsAnimated(file, prefix)) {
        throw new RasterValidationError(
          "animated-image",
          "Animated WebP images are not supported.",
        );
      }
    }
    assertHeaderDimensions(parsed);
    return { ok: true, kind, ...parsed };
  } catch (error) {
    return failure(error);
  }
}

export function validateDecodedRasterDimensions(
  kind: RasterKind,
  header: RasterDimensions,
  decoded: RasterDimensions,
): RasterValidationFailure | null {
  if (
    !Number.isSafeInteger(decoded.width) ||
    !Number.isSafeInteger(decoded.height) ||
    decoded.width <= 0 ||
    decoded.height <= 0
  ) {
    return {
      ok: false,
      code: "decode-failed",
      message: "The browser reported invalid decoded image dimensions.",
    };
  }
  if (
    decoded.width > RASTER_LIMITS.maxWidth ||
    decoded.height > RASTER_LIMITS.maxHeight
  ) {
    return {
      ok: false,
      code: "dimensions-too-large",
      message: `Choose an image no larger than ${RASTER_LIMITS.maxWidth} by ${RASTER_LIMITS.maxHeight} pixels. Private Image to Text does not resize carrier images.`,
    };
  }

  const exact =
    decoded.width === header.width && decoded.height === header.height;
  const jpegOrientationSwap =
    kind === "jpeg" &&
    decoded.width === header.height &&
    decoded.height === header.width;
  if (!exact && !jpegOrientationSwap) {
    return {
      ok: false,
      code: "dimension-mismatch",
      message: "The decoded image dimensions do not match its image header.",
    };
  }
  return null;
}
