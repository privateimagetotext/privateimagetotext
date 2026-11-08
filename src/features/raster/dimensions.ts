import {
  RasterValidationError,
  type RasterDimensions,
  type RasterKind,
} from "./types";

function malformed(message = "The image header is malformed or incomplete."): never {
  throw new RasterValidationError("malformed-image", message);
}

function requireBytes(bytes: Uint8Array, offset: number, count: number) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(count) ||
    offset < 0 ||
    count < 0 ||
    offset + count > bytes.byteLength
  ) {
    malformed();
  }
}

function readUint16BigEndian(bytes: Uint8Array, offset: number) {
  requireBytes(bytes, offset, 2);
  return bytes[offset] * 0x100 + bytes[offset + 1];
}

export function readUint32BigEndian(bytes: Uint8Array, offset: number) {
  requireBytes(bytes, offset, 4);
  return (
    bytes[offset] * 0x1_000_000 +
    bytes[offset + 1] * 0x1_0000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

export function readUint32LittleEndian(bytes: Uint8Array, offset: number) {
  requireBytes(bytes, offset, 4);
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x1_0000 +
    bytes[offset + 3] * 0x1_000_000
  );
}

function readInt32LittleEndian(bytes: Uint8Array, offset: number) {
  const unsigned = readUint32LittleEndian(bytes, offset);
  return unsigned >= 0x8000_0000 ? unsigned - 0x1_0000_0000 : unsigned;
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number) {
  requireBytes(bytes, offset, 3);
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x1_0000;
}

function dimensions(width: number, height: number): RasterDimensions {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    malformed("The image header contains invalid dimensions.");
  }
  return { width, height };
}

export function parsePngDimensions(bytes: Uint8Array): RasterDimensions {
  requireBytes(bytes, 0, 24);
  if (
    readUint32BigEndian(bytes, 8) !== 13 ||
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) {
    malformed("The PNG does not begin with a canonical IHDR chunk.");
  }
  return dimensions(
    readUint32BigEndian(bytes, 16),
    readUint32BigEndian(bytes, 20),
  );
}

const jpegSofMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export function parseJpegDimensions(bytes: Uint8Array): RasterDimensions {
  requireBytes(bytes, 0, 4);
  let offset = 2;

  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) malformed("The JPEG marker stream is malformed.");
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    requireBytes(bytes, offset, 1);
    const marker = bytes[offset];
    offset += 1;

    if (marker === 0x00 || marker === 0xd9 || marker === 0xda) {
      malformed("The JPEG has no supported start-of-frame header.");
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;

    const segmentLength = readUint16BigEndian(bytes, offset);
    if (segmentLength < 2) malformed("The JPEG contains an invalid segment length.");
    const segmentEnd = offset + segmentLength;
    if (!Number.isSafeInteger(segmentEnd) || segmentEnd > bytes.byteLength) malformed();

    if (jpegSofMarkers.has(marker)) {
      if (segmentLength < 7) malformed("The JPEG start-of-frame segment is too short.");
      return dimensions(
        readUint16BigEndian(bytes, offset + 5),
        readUint16BigEndian(bytes, offset + 3),
      );
    }
    offset = segmentEnd;
  }

  return malformed("The JPEG has no supported start-of-frame header.");
}

export function parseWebpDimensions(bytes: Uint8Array): RasterDimensions {
  requireBytes(bytes, 0, 20);
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);

  if (chunk === "VP8X") {
    requireBytes(bytes, 0, 30);
    return dimensions(
      readUint24LittleEndian(bytes, 24) + 1,
      readUint24LittleEndian(bytes, 27) + 1,
    );
  }
  if (chunk === "VP8 ") {
    requireBytes(bytes, 0, 30);
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      malformed("The WebP VP8 frame header is malformed.");
    }
    return dimensions(
      (bytes[26] + bytes[27] * 0x100) & 0x3fff,
      (bytes[28] + bytes[29] * 0x100) & 0x3fff,
    );
  }
  if (chunk === "VP8L") {
    requireBytes(bytes, 0, 25);
    if (bytes[20] !== 0x2f) malformed("The WebP VP8L signature is malformed.");
    return dimensions(
      1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
    );
  }
  return malformed("The WebP has no supported image header.");
}

export function parseBmpDimensions(bytes: Uint8Array): RasterDimensions {
  requireBytes(bytes, 0, 26);
  const dibSize = readUint32LittleEndian(bytes, 14);
  if (dibSize === 12) {
    return dimensions(
      bytes[18] + bytes[19] * 0x100,
      bytes[20] + bytes[21] * 0x100,
    );
  }
  if (dibSize >= 40) {
    const width = readInt32LittleEndian(bytes, 18);
    const signedHeight = readInt32LittleEndian(bytes, 22);
    if (width <= 0 || signedHeight === 0 || signedHeight === -0x8000_0000) {
      malformed("The BMP contains invalid dimensions.");
    }
    return dimensions(width, Math.abs(signedHeight));
  }
  return malformed("The BMP uses an unsupported DIB header.");
}

export function parseRasterDimensions(
  kind: RasterKind,
  bytes: Uint8Array,
): RasterDimensions {
  switch (kind) {
    case "png":
      return parsePngDimensions(bytes);
    case "jpeg":
      return parseJpegDimensions(bytes);
    case "webp":
      return parseWebpDimensions(bytes);
    case "bmp":
      return parseBmpDimensions(bytes);
  }
}

export function isJpegSofMarker(marker: number) {
  return jpegSofMarkers.has(marker);
}
