import type { RasterKind } from "./types";

const mimeByKind: Record<RasterKind, ReadonlySet<string>> = {
  png: new Set(["image/png"]),
  jpeg: new Set(["image/jpeg", "image/jpg", "image/pjpeg"]),
  webp: new Set(["image/webp"]),
  bmp: new Set(["image/bmp", "image/x-ms-bmp"]),
};

const genericMimeTypes = new Set([
  "",
  "application/octet-stream",
  "application/x-unknown",
  "binary/octet-stream",
]);

function matchesAscii(bytes: Uint8Array, offset: number, value: string) {
  if (offset + value.length > bytes.byteLength) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

export function hasPngSignature(bytes: Uint8Array) {
  return (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

export function detectRasterSignature(bytes: Uint8Array): RasterKind | null {
  if (hasPngSignature(bytes)) return "png";
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "jpeg";
  }
  if (
    bytes.byteLength >= 12 &&
    matchesAscii(bytes, 0, "RIFF") &&
    matchesAscii(bytes, 8, "WEBP")
  ) {
    return "webp";
  }
  if (
    bytes.byteLength >= 2 &&
    bytes[0] === 0x42 &&
    bytes[1] === 0x4d
  ) {
    return "bmp";
  }
  return null;
}

export function declaredMimeMatches(kind: RasterKind, declaredType: string) {
  const normalised = declaredType.trim().toLowerCase().split(";", 1)[0];
  return genericMimeTypes.has(normalised) || mimeByKind[kind].has(normalised);
}
