import { MediaInspectionError } from "./errors";
import {
  BoundedBlobReader,
  ascii,
  matchesAscii,
  readUint32BigEndian,
  readUint64BigEndian,
} from "./reader";
import type { DetectedMediaFormat, ReaderOptions } from "./types";

const UNKNOWN_FORMAT: DetectedMediaFormat = {
  kind: "unknown",
  category: "unknown",
  label: "Unknown file",
  mimeType: "application/octet-stream",
  extensions: [],
  signature: "No supported signature found",
};

function format(
  value: Omit<DetectedMediaFormat, "extensions"> & {
    extensions: readonly string[];
  },
) {
  return value;
}

function isMpegAudioFrame(bytes: Uint8Array) {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || (bytes[1] & 0xe0) !== 0xe0) {
    return false;
  }
  const version = (bytes[1] >> 3) & 0x03;
  const layer = (bytes[1] >> 1) & 0x03;
  const bitRateIndex = (bytes[2] >> 4) & 0x0f;
  const sampleRateIndex = (bytes[2] >> 2) & 0x03;
  return (
    version !== 0x01 &&
    layer !== 0 &&
    bitRateIndex !== 0 &&
    bitRateIndex !== 0x0f &&
    sampleRateIndex !== 0x03
  );
}

function isAacAdts(bytes: Uint8Array) {
  return (
    bytes.byteLength >= 7 &&
    bytes[0] === 0xff &&
    (bytes[1] & 0xf6) === 0xf0 &&
    ((bytes[2] >> 2) & 0x0f) !== 0x0f
  );
}

function readEbmlVint(bytes: Uint8Array, offset: number) {
  if (offset >= bytes.byteLength) return null;
  const first = bytes[offset];
  let mask = 0x80;
  let length = 1;
  while (length <= 8 && (first & mask) === 0) {
    mask >>= 1;
    length += 1;
  }
  if (length > 8 || offset + length > bytes.byteLength) return null;
  let value = first & (mask - 1);
  for (let index = 1; index < length; index += 1) {
    value = value * 0x100 + bytes[offset + index];
    if (!Number.isSafeInteger(value)) return null;
  }
  return { length, value };
}

function detectEbmlDocType(bytes: Uint8Array) {
  if (
    bytes.byteLength < 5 ||
    bytes[0] !== 0x1a ||
    bytes[1] !== 0x45 ||
    bytes[2] !== 0xdf ||
    bytes[3] !== 0xa3
  ) {
    return null;
  }
  const headerSize = readEbmlVint(bytes, 4);
  if (!headerSize) return "unknown";
  const headerStart = 4 + headerSize.length;
  const headerEnd = Math.min(bytes.byteLength, headerStart + headerSize.value);
  for (let offset = headerStart; offset + 3 <= headerEnd; offset += 1) {
    if (bytes[offset] !== 0x42 || bytes[offset + 1] !== 0x82) continue;
    const size = readEbmlVint(bytes, offset + 2);
    if (!size || size.value > 32) return "unknown";
    const valueOffset = offset + 2 + size.length;
    if (valueOffset + size.value > headerEnd) return "unknown";
    return ascii(bytes, valueOffset, size.value).toLowerCase();
  }
  return "unknown";
}

export function detectMediaSignature(bytes: Uint8Array): DetectedMediaFormat {
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    matchesAscii(bytes, 1, "PNG\r\n\x1a\n")
  ) {
    return format({
      kind: "png",
      category: "image",
      label: "PNG image",
      mimeType: "image/png",
      extensions: ["png"],
      signature: "89 50 4E 47 0D 0A 1A 0A",
    });
  }
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return format({
      kind: "jpeg",
      category: "image",
      label: "JPEG image",
      mimeType: "image/jpeg",
      extensions: ["jpg", "jpeg"],
      signature: "FF D8 FF",
    });
  }
  if (
    bytes.byteLength >= 12 &&
    matchesAscii(bytes, 0, "RIFF") &&
    matchesAscii(bytes, 8, "WEBP")
  ) {
    return format({
      kind: "webp",
      category: "image",
      label: "WebP image",
      mimeType: "image/webp",
      extensions: ["webp"],
      signature: "RIFF....WEBP",
    });
  }
  if (
    bytes.byteLength >= 6 &&
    (matchesAscii(bytes, 0, "GIF87a") || matchesAscii(bytes, 0, "GIF89a"))
  ) {
    return format({
      kind: "gif",
      category: "image",
      label: "GIF image",
      mimeType: "image/gif",
      extensions: ["gif"],
      signature: ascii(bytes, 0, 6),
    });
  }
  if (
    bytes.byteLength >= 12 &&
    matchesAscii(bytes, 0, "RIFF") &&
    matchesAscii(bytes, 8, "WAVE")
  ) {
    return format({
      kind: "wav",
      category: "audio",
      label: "WAVE audio",
      mimeType: "audio/wav",
      extensions: ["wav"],
      signature: "RIFF....WAVE",
    });
  }
  if (
    bytes.byteLength >= 12 &&
    matchesAscii(bytes, 0, "FORM") &&
    (matchesAscii(bytes, 8, "AIFF") || matchesAscii(bytes, 8, "AIFC"))
  ) {
    return format({
      kind: "aiff",
      category: "audio",
      label: "AIFF audio",
      mimeType: "audio/aiff",
      extensions: ["aif", "aiff", "aifc"],
      signature: `FORM....${ascii(bytes, 8, 4)}`,
    });
  }
  if (matchesAscii(bytes, 0, "fLaC")) {
    return format({
      kind: "flac",
      category: "audio",
      label: "FLAC audio",
      mimeType: "audio/flac",
      extensions: ["flac"],
      signature: "fLaC",
    });
  }
  if (matchesAscii(bytes, 0, "OggS")) {
    return format({
      kind: "ogg",
      category: "container",
      label: "Ogg media",
      mimeType: "application/ogg",
      extensions: ["ogg", "oga", "ogv", "opus"],
      signature: "OggS",
    });
  }
  if (matchesAscii(bytes, 0, "ID3") || isMpegAudioFrame(bytes)) {
    return format({
      kind: "mp3",
      category: "audio",
      label: "MPEG audio",
      mimeType: "audio/mpeg",
      extensions: ["mp3", "mp2"],
      signature: matchesAscii(bytes, 0, "ID3") ? "ID3" : "MPEG audio frame",
    });
  }
  if (isAacAdts(bytes)) {
    return format({
      kind: "aac",
      category: "audio",
      label: "AAC audio",
      mimeType: "audio/aac",
      extensions: ["aac"],
      signature: "AAC ADTS sync word",
    });
  }
  const docType = detectEbmlDocType(bytes);
  if (docType === "webm" || docType === "matroska") {
    const isWebm = docType === "webm";
    return format({
      kind: isWebm ? "webm" : "matroska",
      category: "video",
      label: isWebm ? "WebM media" : "Matroska media",
      mimeType: isWebm ? "video/webm" : "video/x-matroska",
      extensions: isWebm ? ["webm"] : ["mkv", "mka", "mks"],
      signature: `EBML DocType ${docType}`,
    });
  }
  return UNKNOWN_FORMAT;
}

type IsoBoxHeader = {
  readonly type: string;
  readonly size: number;
  readonly headerSize: number;
};

async function readIsoBoxHeader(reader: BoundedBlobReader, offset: number) {
  if (reader.size - offset < 8) return null;
  const basic = await reader.read(offset, 8);
  const size32 = readUint32BigEndian(basic, 0);
  const type = ascii(basic, 4, 4);
  let size = size32;
  let headerSize = 8;
  if (size32 === 1) {
    if (reader.size - offset < 16) {
      throw new MediaInspectionError("malformed-file", "An ISO media box is truncated.");
    }
    const extended = await reader.read(offset + 8, 8);
    size = readUint64BigEndian(extended, 0);
    headerSize = 16;
  } else if (size32 === 0) {
    size = reader.size - offset;
  }
  if (size < headerSize || size > reader.size - offset) {
    throw new MediaInspectionError(
      "malformed-file",
      "An ISO media box has an invalid length.",
    );
  }
  return { type, size, headerSize } satisfies IsoBoxHeader;
}

const M4A_BRANDS = new Set(["M4A ", "M4B ", "M4P ", "F4A ", "F4B "]);

async function detectIsoBaseMedia(reader: BoundedBlobReader) {
  const scanEnd = Math.min(reader.size, 1024 * 1024);
  let offset = 0;
  for (let index = 0; index < 128 && offset + 8 <= scanEnd; index += 1) {
    const box = await readIsoBoxHeader(reader, offset);
    if (!box) break;
    if (box.type === "ftyp") {
      const payloadLength = box.size - box.headerSize;
      if (payloadLength < 8) {
        throw new MediaInspectionError("malformed-file", "The ISO ftyp box is too short.");
      }
      const bytes = await reader.read(
        offset + box.headerSize,
        Math.min(payloadLength, 8 + 4 * 64),
      );
      const brands = [ascii(bytes, 0, 4)];
      for (let brandOffset = 8; brandOffset + 4 <= bytes.byteLength; brandOffset += 4) {
        const brand = ascii(bytes, brandOffset, 4);
        if (!brands.includes(brand)) brands.push(brand);
      }
      const quicktime = brands.includes("qt  ");
      const m4a = brands.some((brand) => M4A_BRANDS.has(brand));
      return format({
        kind: quicktime ? "quicktime" : m4a ? "m4a" : "mp4",
        category: m4a ? "audio" : "video",
        label: quicktime ? "QuickTime media" : m4a ? "MPEG-4 audio" : "MPEG-4 media",
        mimeType: quicktime ? "video/quicktime" : m4a ? "audio/mp4" : "video/mp4",
        extensions: quicktime ? ["mov", "qt"] : m4a ? ["m4a", "m4b"] : ["mp4", "m4v"],
        signature: `ISO BMFF ftyp ${brands[0]}`,
        brands,
      });
    }
    if (box.size === 0) break;
    offset += box.size;
  }
  return null;
}

const ISO_TOP_LEVEL_TYPES = new Set([
  "ftyp",
  "free",
  "skip",
  "wide",
  "uuid",
  "moov",
  "mdat",
]);

function looksLikeIsoBaseMedia(bytes: Uint8Array) {
  return bytes.byteLength >= 8 && ISO_TOP_LEVEL_TYPES.has(ascii(bytes, 4, 4));
}

export async function detectMediaFormat(
  blob: Blob,
  options: ReaderOptions = {},
): Promise<DetectedMediaFormat> {
  const reader = new BoundedBlobReader(blob, options);
  const prefix = await reader.readHead(Math.min(64 * 1024, reader.maxSliceBytes));
  const direct = detectMediaSignature(prefix);
  if (direct.kind !== "unknown") return direct;
  if (!looksLikeIsoBaseMedia(prefix)) return UNKNOWN_FORMAT;
  return (await detectIsoBaseMedia(reader)) ?? UNKNOWN_FORMAT;
}

export async function detectMediaFormatWithReader(reader: BoundedBlobReader) {
  const prefix = await reader.readHead(Math.min(64 * 1024, reader.maxSliceBytes));
  const direct = detectMediaSignature(prefix);
  if (direct.kind !== "unknown") return direct;
  if (!looksLikeIsoBaseMedia(prefix)) return UNKNOWN_FORMAT;
  return (await detectIsoBaseMedia(reader)) ?? UNKNOWN_FORMAT;
}
