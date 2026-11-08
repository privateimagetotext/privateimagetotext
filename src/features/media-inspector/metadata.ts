import { MediaInspectionError } from "./errors";
import { MEDIA_INSPECTION_LIMITS } from "./types";
import type {
  InspectionWarning,
  MetadataEntry,
  MetadataNamespace,
  MetadataValue,
} from "./types";

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });

export class MetadataBudget {
  readonly maxBytes: number;
  #usedBytes = 0;

  constructor(maxBytes = MEDIA_INSPECTION_LIMITS.maxMetadataBytes) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new MediaInspectionError(
        "invalid-range",
        "The metadata byte limit is invalid.",
      );
    }
    this.maxBytes = maxBytes;
  }

  get usedBytes() {
    return this.#usedBytes;
  }

  consume(byteLength: number) {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new MediaInspectionError(
        "malformed-file",
        "A metadata block has an invalid length.",
      );
    }
    if (byteLength > this.maxBytes - this.#usedBytes) {
      throw new MediaInspectionError(
        "metadata-limit-exceeded",
        "The file contains more metadata than the inspection safety limit allows.",
      );
    }
    this.#usedBytes += byteLength;
  }
}

export class MetadataCollector {
  readonly entries: MetadataEntry[] = [];
  readonly warnings: InspectionWarning[] = [];
  readonly #keys = new Map<string, number>();

  add(
    key: string,
    label: string,
    value: MetadataValue | null | undefined,
    namespace: MetadataNamespace,
    sensitive = false,
  ) {
    if (value === null || value === undefined || value === "") return;
    if (this.entries.length >= MEDIA_INSPECTION_LIMITS.maxMetadataEntries) {
      throw new MediaInspectionError(
        "metadata-limit-exceeded",
        "The file contains too many metadata fields to inspect safely.",
      );
    }
    const count = this.#keys.get(key) ?? 0;
    this.#keys.set(key, count + 1);
    this.entries.push({
      key: count === 0 ? key : `${key}.${count + 1}`,
      label,
      value,
      namespace,
      ...(sensitive ? { sensitive: true } : {}),
    });
  }

  warn(code: InspectionWarning["code"], message: string) {
    if (this.warnings.some((warning) => warning.code === code && warning.message === message)) {
      return;
    }
    this.warnings.push({ code, message });
  }
}

export function decodeUtf8(bytes: Uint8Array) {
  return utf8Decoder.decode(bytes).replace(/\0+$/g, "").trim();
}

export function decodeLatin1(bytes: Uint8Array) {
  let value = "";
  const chunkSize = 8_192;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    value += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return value.replace(/\0+$/g, "").trim();
}

export function boundedTextBytes(bytes: Uint8Array) {
  if (bytes.byteLength > MEDIA_INSPECTION_LIMITS.maxMetadataValueBytes) {
    throw new MediaInspectionError(
      "metadata-limit-exceeded",
      "An individual metadata value exceeds the inspection safety limit.",
    );
  }
  return bytes;
}

export function normaliseMetadataKey(value: string) {
  const key = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80);
  return key || "unknown";
}

export function safeMetadataLabel(value: string) {
  const printable = Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
      ? " "
      : character;
  }).join("");
  return printable
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || "Unnamed metadata";
}
