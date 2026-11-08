import { MediaInspectionError } from "./errors";
import {
  boundedTextBytes,
  decodeLatin1,
  decodeUtf8,
  MetadataCollector,
} from "./metadata";
import { MEDIA_INSPECTION_LIMITS, type MetadataValue } from "./types";

type ByteOrder = "little" | "big";
type IfdKind = "image" | "exif" | "gps" | "thumbnail";

type TagDefinition = {
  readonly key: string;
  readonly label: string;
  readonly sensitive?: boolean;
  readonly decoder?: "user-comment" | "utf16le" | "version";
};

const IMAGE_TAGS: Record<number, TagDefinition> = {
  0x010e: { key: "exif.imageDescription", label: "Image description", sensitive: true },
  0x010f: { key: "exif.make", label: "Camera make" },
  0x0110: { key: "exif.model", label: "Camera model" },
  0x0112: { key: "exif.orientation", label: "Orientation" },
  0x0131: { key: "exif.software", label: "Software" },
  0x0132: { key: "exif.dateTime", label: "File change date/time", sensitive: true },
  0x013b: { key: "exif.artist", label: "Artist", sensitive: true },
  0x8298: { key: "exif.copyright", label: "Copyright" },
  0x9c9b: { key: "exif.xpTitle", label: "Windows title", sensitive: true, decoder: "utf16le" },
  0x9c9c: { key: "exif.xpComment", label: "Windows comment", sensitive: true, decoder: "utf16le" },
  0x9c9d: { key: "exif.xpAuthor", label: "Windows author", sensitive: true, decoder: "utf16le" },
};

const EXIF_TAGS: Record<number, TagDefinition> = {
  0x829a: { key: "exif.exposureTime", label: "Exposure time" },
  0x829d: { key: "exif.fNumber", label: "F-number" },
  0x8827: { key: "exif.iso", label: "ISO speed" },
  0x9000: { key: "exif.version", label: "Exif version", decoder: "version" },
  0x9003: { key: "exif.dateTimeOriginal", label: "Original capture date/time", sensitive: true },
  0x9004: { key: "exif.dateTimeDigitized", label: "Digitised date/time", sensitive: true },
  0x9010: { key: "exif.offsetTime", label: "Time-zone offset", sensitive: true },
  0x9011: { key: "exif.offsetTimeOriginal", label: "Original time-zone offset", sensitive: true },
  0x9012: { key: "exif.offsetTimeDigitized", label: "Digitised time-zone offset", sensitive: true },
  0x920a: { key: "exif.focalLength", label: "Focal length" },
  0x9286: { key: "exif.userComment", label: "User comment", sensitive: true, decoder: "user-comment" },
  0xa002: { key: "exif.pixelWidth", label: "Exif pixel width" },
  0xa003: { key: "exif.pixelHeight", label: "Exif pixel height" },
  0xa430: { key: "exif.ownerName", label: "Camera owner name", sensitive: true },
  0xa431: { key: "exif.bodySerialNumber", label: "Camera body serial number", sensitive: true },
  0xa433: { key: "exif.lensMake", label: "Lens make" },
  0xa434: { key: "exif.lensModel", label: "Lens model" },
  0xa435: { key: "exif.lensSerialNumber", label: "Lens serial number", sensitive: true },
};

const GPS_TAGS: Record<number, TagDefinition> = {
  0x0001: { key: "exif.gpsLatitudeRef", label: "GPS latitude reference", sensitive: true },
  0x0002: { key: "exif.gpsLatitudeComponents", label: "GPS latitude components", sensitive: true },
  0x0003: { key: "exif.gpsLongitudeRef", label: "GPS longitude reference", sensitive: true },
  0x0004: { key: "exif.gpsLongitudeComponents", label: "GPS longitude components", sensitive: true },
  0x0005: { key: "exif.gpsAltitudeRef", label: "GPS altitude reference", sensitive: true },
  0x0006: { key: "exif.gpsAltitude", label: "GPS altitude", sensitive: true },
  0x0007: { key: "exif.gpsTimeStamp", label: "GPS time", sensitive: true },
  0x0008: { key: "exif.gpsSatellites", label: "GPS satellites", sensitive: true },
  0x0010: { key: "exif.gpsImageDirectionRef", label: "GPS image direction reference", sensitive: true },
  0x0011: { key: "exif.gpsImageDirection", label: "GPS image direction", sensitive: true },
  0x001d: { key: "exif.gpsDateStamp", label: "GPS date", sensitive: true },
};

const TYPE_SIZES: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
};

function ensureRange(bytes: Uint8Array, offset: number, length: number) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > bytes.byteLength ||
    length > bytes.byteLength - offset
  ) {
    throw new MediaInspectionError("malformed-file", "The Exif/TIFF data is truncated.");
  }
}

function u16(bytes: Uint8Array, offset: number, order: ByteOrder) {
  ensureRange(bytes, offset, 2);
  return order === "little"
    ? bytes[offset] + bytes[offset + 1] * 0x100
    : bytes[offset] * 0x100 + bytes[offset + 1];
}

function u32(bytes: Uint8Array, offset: number, order: ByteOrder) {
  ensureRange(bytes, offset, 4);
  return order === "little"
    ? bytes[offset] +
        bytes[offset + 1] * 0x100 +
        bytes[offset + 2] * 0x1_0000 +
        bytes[offset + 3] * 0x1_000_000
    : bytes[offset] * 0x1_000_000 +
        bytes[offset + 1] * 0x1_0000 +
        bytes[offset + 2] * 0x100 +
        bytes[offset + 3];
}

function signed(value: number, bits: 8 | 16 | 32) {
  const threshold = 2 ** (bits - 1);
  return value >= threshold ? value - 2 ** bits : value;
}

function decodeUserComment(bytes: Uint8Array) {
  if (bytes.byteLength <= 8) return decodeLatin1(bytes);
  const marker = decodeLatin1(bytes.subarray(0, 8)).toUpperCase();
  const content = bytes.subarray(8);
  if (marker.startsWith("UNICODE")) {
    try {
      return new TextDecoder("utf-16", { fatal: false })
        .decode(content)
        .replace(/\0+$/g, "")
        .trim();
    } catch {
      return decodeUtf8(content);
    }
  }
  return marker.startsWith("ASCII") ? decodeLatin1(content) : decodeUtf8(content);
}

function decodeUtf16LittleEndian(bytes: Uint8Array) {
  return new TextDecoder("utf-16le", { fatal: false })
    .decode(bytes)
    .replace(/\0+$/g, "")
    .trim();
}

function valueBytes(
  bytes: Uint8Array,
  entryOffset: number,
  type: number,
  count: number,
  order: ByteOrder,
) {
  const typeSize = TYPE_SIZES[type];
  if (!typeSize || !Number.isSafeInteger(count) || count < 0) return null;
  const length = typeSize * count;
  if (
    !Number.isSafeInteger(length) ||
    length > MEDIA_INSPECTION_LIMITS.maxMetadataValueBytes
  ) {
    throw new MediaInspectionError(
      "metadata-limit-exceeded",
      "An Exif value exceeds the inspection safety limit.",
    );
  }
  const offset = length <= 4 ? entryOffset + 8 : u32(bytes, entryOffset + 8, order);
  ensureRange(bytes, offset, length);
  return bytes.subarray(offset, offset + length);
}

function parseNumericValues(
  bytes: Uint8Array,
  type: number,
  count: number,
  order: ByteOrder,
) {
  const values: number[] = [];
  const cappedCount = Math.min(count, 64);
  for (let index = 0; index < cappedCount; index += 1) {
    if (type === 1 || type === 7) values.push(bytes[index]);
    else if (type === 6) values.push(signed(bytes[index], 8));
    else if (type === 3) values.push(u16(bytes, index * 2, order));
    else if (type === 8) values.push(signed(u16(bytes, index * 2, order), 16));
    else if (type === 4) values.push(u32(bytes, index * 4, order));
    else if (type === 9) values.push(signed(u32(bytes, index * 4, order), 32));
    else if (type === 5 || type === 10) {
      const numeratorRaw = u32(bytes, index * 8, order);
      const denominatorRaw = u32(bytes, index * 8 + 4, order);
      const numerator = type === 10 ? signed(numeratorRaw, 32) : numeratorRaw;
      const denominator = type === 10 ? signed(denominatorRaw, 32) : denominatorRaw;
      if (denominator !== 0) values.push(numerator / denominator);
    }
  }
  return values;
}

function parsedValue(
  raw: Uint8Array,
  type: number,
  count: number,
  order: ByteOrder,
  definition?: TagDefinition,
): MetadataValue | null {
  if (definition?.decoder === "user-comment") return decodeUserComment(raw);
  if (definition?.decoder === "utf16le") return decodeUtf16LittleEndian(raw);
  if (definition?.decoder === "version") return decodeLatin1(raw);
  if (type === 2) return decodeLatin1(raw);
  const values = parseNumericValues(raw, type, count, order);
  if (values.length === 0) return null;
  return values.length === 1 ? values[0] : values;
}

function decimalGps(value: unknown, reference: unknown) {
  if (!Array.isArray(value) || value.length < 3 || typeof reference !== "string") {
    return null;
  }
  const [degrees, minutes, seconds] = value;
  if (
    typeof degrees !== "number" ||
    typeof minutes !== "number" ||
    typeof seconds !== "number"
  ) {
    return null;
  }
  const decimal = degrees + minutes / 60 + seconds / 3600;
  return /^[SW]$/i.test(reference.trim()) ? -decimal : decimal;
}

export interface ExifParseResult {
  readonly orientation?: number;
}

export function parseExifTiff(
  input: Uint8Array,
  collector: MetadataCollector,
): ExifParseResult {
  const bytes = boundedTextBytes(input);
  ensureRange(bytes, 0, 8);
  const byteOrderMarker = String.fromCharCode(bytes[0], bytes[1]);
  const order: ByteOrder =
    byteOrderMarker === "II"
      ? "little"
      : byteOrderMarker === "MM"
        ? "big"
        : (() => {
            throw new MediaInspectionError(
              "malformed-file",
              "The Exif/TIFF byte-order marker is invalid.",
            );
          })();
  if (u16(bytes, 2, order) !== 42) {
    throw new MediaInspectionError("malformed-file", "The Exif/TIFF header is invalid.");
  }

  const queue: Array<{ offset: number; kind: IfdKind }> = [
    { offset: u32(bytes, 4, order), kind: "image" },
  ];
  const visited = new Set<string>();
  const gpsValues = new Map<number, MetadataValue>();
  let orientation: number | undefined;
  let directoryCount = 0;

  while (queue.length > 0) {
    const directory = queue.shift()!;
    const identity = `${directory.kind}:${directory.offset}`;
    if (visited.has(identity)) continue;
    visited.add(identity);
    directoryCount += 1;
    if (directoryCount > 16) {
      throw new MediaInspectionError(
        "metadata-limit-exceeded",
        "The Exif directory graph is unreasonably complex.",
      );
    }
    ensureRange(bytes, directory.offset, 2);
    const entryCount = u16(bytes, directory.offset, order);
    if (entryCount > 512) {
      throw new MediaInspectionError(
        "metadata-limit-exceeded",
        "An Exif directory contains too many entries.",
      );
    }
    const entriesStart = directory.offset + 2;
    const entriesLength = entryCount * 12;
    ensureRange(bytes, entriesStart, entriesLength + 4);

    for (let index = 0; index < entryCount; index += 1) {
      const entryOffset = entriesStart + index * 12;
      const tag = u16(bytes, entryOffset, order);
      const type = u16(bytes, entryOffset + 2, order);
      const count = u32(bytes, entryOffset + 4, order);
      const raw = valueBytes(bytes, entryOffset, type, count, order);
      if (!raw) continue;

      if (directory.kind === "image" && (tag === 0x8769 || tag === 0x8825)) {
        const pointer = parsedValue(raw, type, count, order);
        if (typeof pointer === "number" && pointer !== 0) {
          queue.push({ offset: pointer, kind: tag === 0x8769 ? "exif" : "gps" });
        }
        continue;
      }

      const definitions =
        directory.kind === "image"
          ? IMAGE_TAGS
          : directory.kind === "exif"
            ? EXIF_TAGS
            : directory.kind === "gps"
              ? GPS_TAGS
              : {};
      const definition = definitions[tag];
      const value = parsedValue(raw, type, count, order, definition);
      if (directory.kind === "gps" && value !== null) gpsValues.set(tag, value);
      if (definition) {
        collector.add(
          definition.key,
          definition.label,
          value,
          "exif",
          definition.sensitive,
        );
      }
      if (directory.kind === "image" && tag === 0x0112 && typeof value === "number") {
        orientation = value;
      }
    }

    const nextOffset = u32(bytes, entriesStart + entriesLength, order);
    if (nextOffset !== 0 && directory.kind === "image") {
      queue.push({ offset: nextOffset, kind: "thumbnail" });
    }
    if (directory.kind === "thumbnail") {
      collector.add(
        "exif.embeddedThumbnail",
        "Embedded Exif thumbnail",
        true,
        "exif",
        true,
      );
    }
  }

  const latitude = decimalGps(gpsValues.get(0x0002), gpsValues.get(0x0001));
  const longitude = decimalGps(gpsValues.get(0x0004), gpsValues.get(0x0003));
  collector.add("exif.gpsLatitude", "GPS latitude", latitude, "exif", true);
  collector.add("exif.gpsLongitude", "GPS longitude", longitude, "exif", true);
  return { orientation };
}
