import {
  MediaInspectionError,
  normaliseInspectionError,
  throwIfAborted,
} from "./errors";
import {
  parseGifMetadata,
  parseJpegMetadata,
  parsePngMetadata,
  parseWebpMetadata,
} from "./image";
import { parseIsoBmffMetadata } from "./iso-bmff";
import { MetadataBudget } from "./metadata";
import { derivePrivacyFindings } from "./privacy";
import { BoundedBlobReader } from "./reader";
import { sha256Blob } from "./sha256";
import { detectMediaFormatWithReader } from "./signatures";
import {
  MEDIA_INSPECTION_LIMITS,
  type InspectMediaOptions,
  type InspectionWarning,
  type MediaInspectionOutcome,
  type MediaInspectionResult,
} from "./types";

const DECLARED_TYPE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  jpeg: ["image/jpeg", "image/jpg", "image/pjpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
  gif: ["image/gif"],
  mp4: ["video/mp4", "application/mp4", "audio/mp4"],
  quicktime: ["video/quicktime"],
  m4a: ["audio/mp4", "audio/x-m4a", "audio/m4a"],
  webm: ["video/webm", "audio/webm"],
  matroska: ["video/x-matroska", "audio/x-matroska"],
  mp3: ["audio/mpeg", "audio/mp3"],
  flac: ["audio/flac", "audio/x-flac"],
  wav: ["audio/wav", "audio/x-wav", "audio/wave"],
  ogg: ["application/ogg", "audio/ogg", "video/ogg"],
  aac: ["audio/aac", "audio/aacp"],
  aiff: ["audio/aiff", "audio/x-aiff"],
};

function declaredTypeWarning(
  declaredMimeType: string,
  kind: string,
  detectedMimeType: string,
): InspectionWarning | undefined {
  const declared = declaredMimeType.trim().toLowerCase().split(";", 1)[0];
  if (!declared || declared === "application/octet-stream") return undefined;
  const expected = DECLARED_TYPE_ALIASES[kind] ?? [detectedMimeType];
  if (expected.includes(declared)) return undefined;
  return {
    code: "declared-type-mismatch",
    message: `The browser declared ${declared}, but the file signature identifies ${detectedMimeType}.`,
  };
}

function fileName(blob: Blob) {
  if (!("name" in blob)) return undefined;
  const value = (blob as Blob & { readonly name?: unknown }).name;
  if (typeof value !== "string" || value.length === 0) return undefined;
  return Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f ? " " : character;
  })
    .join("")
    .slice(0, 1_024);
}

export async function inspectMedia(
  blob: Blob,
  options: InspectMediaOptions = {},
): Promise<MediaInspectionResult> {
  throwIfAborted(options.signal);
  const maxMetadataBytes =
    options.maxMetadataBytes ?? MEDIA_INSPECTION_LIMITS.maxMetadataBytes;
  // Validate this option even for formats that do not currently expose metadata.
  void new MetadataBudget(maxMetadataBytes);

  const reader = new BoundedBlobReader(blob, {
    signal: options.signal,
    ...(options.maxReadBytes !== undefined
      ? { maxReadBytes: options.maxReadBytes }
      : {}),
  });
  const format = await detectMediaFormatWithReader(reader);
  if (format.kind === "unknown") {
    throw new MediaInspectionError(
      "unsupported-format",
      "This file does not have a supported image, video or audio signature.",
    );
  }

  let image: MediaInspectionResult["image"];
  let container: MediaInspectionResult["container"];
  let metadata: MediaInspectionResult["metadata"] = [];
  let warnings: readonly InspectionWarning[] = [];
  if (format.kind === "jpeg") {
    const parsed = await parseJpegMetadata(reader, maxMetadataBytes);
    ({ image, metadata, warnings } = parsed);
  } else if (format.kind === "png") {
    const parsed = await parsePngMetadata(reader, maxMetadataBytes);
    ({ image, metadata, warnings } = parsed);
  } else if (format.kind === "webp") {
    const parsed = await parseWebpMetadata(reader, maxMetadataBytes);
    ({ image, metadata, warnings } = parsed);
  } else if (format.kind === "gif") {
    const parsed = await parseGifMetadata(reader);
    ({ image, metadata, warnings } = parsed);
  } else if (
    format.kind === "mp4" ||
    format.kind === "quicktime" ||
    format.kind === "m4a"
  ) {
    const parsed = await parseIsoBmffMetadata(reader, format);
    ({ container, metadata, warnings } = parsed);
  }

  const declaredMimeType = blob.type ?? "";
  const mismatch = declaredTypeWarning(
    declaredMimeType,
    format.kind,
    format.mimeType,
  );
  if (mismatch) warnings = [...warnings, mismatch];

  const sha256 = options.includeSha256
    ? await sha256Blob(blob, {
        signal: options.signal,
        ...(options.maxHashBytes !== undefined
          ? { maxBytes: options.maxHashBytes }
          : {}),
        onProgress: options.onHashProgress,
      })
    : undefined;
  throwIfAborted(options.signal);

  return {
    format,
    file: {
      ...(fileName(blob) ? { name: fileName(blob) } : {}),
      size: blob.size,
      declaredMimeType,
      ...(sha256 ? { sha256 } : {}),
    },
    ...(image ? { image } : {}),
    ...(container ? { container } : {}),
    metadata,
    privacy: derivePrivacyFindings(metadata),
    warnings,
    stats: {
      bytesRead: reader.bytesRead,
      readOperations: reader.readOperations,
    },
  };
}

export async function inspectMediaSafely(
  blob: Blob,
  options: InspectMediaOptions = {},
): Promise<MediaInspectionOutcome> {
  try {
    return { ok: true, result: await inspectMedia(blob, options) };
  } catch (error) {
    return { ok: false, error: normaliseInspectionError(error) };
  }
}
