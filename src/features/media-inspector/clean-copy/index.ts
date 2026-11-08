import { sanitiseSourceBase } from "../../raster/filenames";
import { MediaInspectionError } from "../errors";
import { inspectMedia } from "../inspect";
import { createC2paProvenanceInspector } from "../provenance";
import type {
  ProvenanceInspection,
  ProvenanceNotFound,
} from "../provenance/types";
import type { MediaInspectionResult, MetadataEntry } from "../types";
import {
  awaitWithAbort,
  bytePartsEqual,
  readBlobBounded,
  reportCleanCopyProgress,
  type StructuralCleanCopy,
} from "./common";
import { decodeCleanCopyInBrowser, verifyDecodedCleanCopy } from "./decode";
import {
  CleanCopyError,
  normaliseCleanCopyError,
  positiveBoundedOption,
  throwIfCleanCopyAborted,
} from "./errors";
import { rewriteJpegCleanCopy, verifyJpegCleanCopy } from "./jpeg";
import { rewritePngCleanCopy, verifyPngCleanCopy } from "./png";
import {
  CLEAN_COPY_LIMITS,
  type CleanCopyFormat,
  type CleanCopyOptions,
  type CleanCopyOutcome,
  type CleanCopyPreflight,
  type CleanCopyProfile,
  type CleanCopyResult,
} from "./types";

export { CleanCopyError } from "./errors";
export { CLEAN_COPY_LIMITS } from "./types";
export type {
  CleanCopyErrorCode,
  CleanCopyDecodedImage,
  CleanCopyFormat,
  CleanCopyImageDecoder,
  CleanCopyOptions,
  CleanCopyOutcome,
  CleanCopyPreflight,
  CleanCopyProfile,
  CleanCopyProgress,
  CleanCopyProgressPhase,
  CleanCopyProvenanceInspectorFactory,
  CleanCopyResult,
  CleanCopyVerification,
  SerializedCleanCopyError,
} from "./types";

function profileFor(format: CleanCopyFormat): CleanCopyProfile {
  return format === "jpeg"
    ? "jpeg-safe-structural-v1"
    : "png-safe-structural-v1";
}

function ineligible(
  code: Exclude<CleanCopyPreflight, { eligible: true }>["code"],
  reason: string,
): CleanCopyPreflight {
  return { eligible: false, code, reason };
}

function provenancePreflight(
  provenance?: ProvenanceInspection,
): CleanCopyPreflight | undefined {
  if (!provenance) return undefined;
  if (provenance.status === "error") {
    return ineligible(
      "source-provenance-unverified",
      "Content Credentials could not be checked for the selected source.",
    );
  }
  if (provenance.status === "unsupported-format") {
    return ineligible(
      "source-provenance-unverified",
      "The source format is not supported by the embedded Content Credentials verifier.",
    );
  }
  return undefined;
}

export function getCleanShareCopyPreflight(
  inspection: MediaInspectionResult,
  sourceProvenance?: ProvenanceInspection,
): CleanCopyPreflight {
  const provenanceFailure = provenancePreflight(sourceProvenance);
  if (provenanceFailure) return provenanceFailure;

  if (inspection.format.kind !== "jpeg" && inspection.format.kind !== "png") {
    return ineligible(
      "unsupported-format",
      "Metadata removal currently supports only actual JPEG and PNG files.",
    );
  }
  if (!inspection.image) {
    return ineligible(
      "malformed-source",
      "The image dimensions could not be established safely.",
    );
  }
  if (inspection.image.animated) {
    return ineligible(
      "animated-media",
      "Animated and multi-frame images are not eligible for a metadata-removed copy.",
    );
  }
  if (
    inspection.image.orientation !== undefined &&
    inspection.image.orientation !== 1
  ) {
    return ineligible(
      "orientation-unsupported",
      "This image relies on orientation metadata that cannot be removed without changing pixels.",
    );
  }
  if (
    inspection.image.width >
      Math.floor(CLEAN_COPY_LIMITS.maxPixels / inspection.image.height) ||
    inspection.image.width > CLEAN_COPY_LIMITS.maxDimension ||
    inspection.image.height > CLEAN_COPY_LIMITS.maxDimension
  ) {
    return ineligible(
      "dimensions-too-large",
      "The image exceeds the metadata-removal decoded-pixel limit.",
    );
  }
  if (inspection.file.size > CLEAN_COPY_LIMITS.maxSourceBytes) {
    return ineligible(
      "source-too-large",
      "The image exceeds the metadata-removal source-byte limit.",
    );
  }
  if (
    inspection.warnings.some(
      ({ code }) => code !== "declared-type-mismatch",
    )
  ) {
    return ineligible(
      "malformed-source",
      "The source contains metadata that could not be parsed unambiguously.",
    );
  }
  const orientationEntries = inspection.metadata.filter(
    ({ key }) => key === "exif.orientation",
  );
  if (
    orientationEntries.length > 1 ||
    orientationEntries.some(({ value }) => value !== 1)
  ) {
    return ineligible(
      "orientation-unsupported",
      "The source contains duplicate, conflicting, or unsupported Orientation tags.",
    );
  }
  if (
    inspection.metadata.some(
      ({ key, value }) =>
        key === "xmp.packet" &&
        typeof value === "string" &&
        /orientation/i.test(value),
    )
  ) {
    return ineligible(
      "orientation-unsupported",
      "This file stores rotation information in XMP in a form the tool cannot remove safely, so a metadata-removed copy is unavailable.",
    );
  }
  if (
    inspection.metadata.some(({ key }) =>
      ["jpeg.iccProfile", "png.iccProfile"].includes(key),
    )
  ) {
    return ineligible(
      "colour-profile-unsupported",
      "Embedded ICC profiles are not supported by the lossless metadata-removal profile.",
    );
  }
  const format = inspection.format.kind;
  return {
    eligible: true,
    format,
    strategy: "lossless-metadata-rewrite",
    profile: profileFor(format),
    structuralCheckRequired: true,
  };
}

function canonicalFilename(source: File, format: CleanCopyFormat) {
  const sanitised = sanitiseSourceBase(source.name);
  const withoutExistingSuffix = sanitised?.replace(/-clean$/iu, "") || null;
  const base = withoutExistingSuffix || "private-image-to-text";
  return `${base}-clean.${format === "jpeg" ? "jpg" : "png"}`;
}

function canonicalMimeType(format: CleanCopyFormat) {
  return format === "jpeg" ? "image/jpeg" : "image/png";
}

function assertPixelLimit(
  width: number,
  height: number,
  maximumPixels: number,
) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > CLEAN_COPY_LIMITS.maxDimension ||
    height > CLEAN_COPY_LIMITS.maxDimension ||
    width > Math.floor(maximumPixels / height)
  ) {
    throw new CleanCopyError(
      "dimensions-too-large",
      "The image exceeds the metadata-removal decoded-pixel limit.",
    );
  }
}

function inspectSourceError(error: unknown): never {
  if (error instanceof CleanCopyError) throw error;
  if (error instanceof MediaInspectionError) {
    if (error.code === "cancelled") {
      throw new CleanCopyError("cancelled", "Creating the metadata-removed copy was cancelled.");
    }
    if (error.code === "file-too-large" || error.code === "read-limit-exceeded") {
      throw new CleanCopyError("source-too-large", error.message);
    }
    if (error.code === "unsupported-format") {
      throw new CleanCopyError("unsupported-format", error.message);
    }
    throw new CleanCopyError(
      "malformed-source",
      "The source could not be parsed unambiguously enough to remove metadata safely.",
    );
  }
  throw error;
}

function verifyOutputError(error: unknown): never {
  if (error instanceof CleanCopyError) throw error;
  if (error instanceof MediaInspectionError) {
    if (error.code === "cancelled") {
      throw new CleanCopyError("cancelled", "Creating the metadata-removed copy was cancelled.");
    }
    throw new CleanCopyError(
      "verification-failed",
      "The generated file did not pass independent media inspection.",
    );
  }
  throw error;
}

function assertSourceProvenance(provenance: ProvenanceInspection) {
  const failure = provenancePreflight(provenance);
  if (failure && !failure.eligible) {
    throw new CleanCopyError(failure.code, failure.reason);
  }
}

function removedMetadata(
  source: readonly MetadataEntry[],
  output: readonly MetadataEntry[],
) {
  const remaining = new Map<string, string[]>();
  for (const entry of output) {
    const identity = `${entry.namespace}\u0000${entry.key}`;
    const values = remaining.get(identity) ?? [];
    values.push(JSON.stringify(entry.value));
    remaining.set(identity, values);
  }
  return source.filter((entry) => {
    const identity = `${entry.namespace}\u0000${entry.key}`;
    const values = remaining.get(identity);
    const encoded = JSON.stringify(entry.value);
    const index = values?.indexOf(encoded) ?? -1;
    if (index < 0 || !values) return true;
    values.splice(index, 1);
    return false;
  });
}

async function rewriteForFormat(
  format: CleanCopyFormat,
  bytes: Uint8Array,
  maximumOutputBytes: number,
  signal?: AbortSignal,
) {
  return format === "jpeg"
    ? await rewriteJpegCleanCopy(bytes, maximumOutputBytes, signal)
    : await rewritePngCleanCopy(bytes, maximumOutputBytes, signal);
}

async function verifyForFormat(
  format: CleanCopyFormat,
  bytes: Uint8Array,
  signal?: AbortSignal,
) {
  return format === "jpeg"
    ? await verifyJpegCleanCopy(bytes, signal)
    : await verifyPngCleanCopy(bytes, signal);
}

async function assertStructuralParity(
  source: StructuralCleanCopy,
  output: StructuralCleanCopy,
  signal?: AbortSignal,
) {
  if (
    source.width !== output.width ||
    source.height !== output.height ||
    !(await bytePartsEqual(source.preservedParts, output.preservedParts, signal))
  ) {
    throw new CleanCopyError(
      "verification-failed",
      "The generated file did not preserve the source image coding bytes exactly.",
    );
  }
}

function assertCleanInspection(
  source: MediaInspectionResult,
  output: MediaInspectionResult,
  format: CleanCopyFormat,
) {
  const allowedMetadata =
    format === "jpeg"
      ? new Set([
          "jpeg.app0",
          "jpeg.jfifVersion",
          "jpeg.densityUnit",
          "jpeg.xDensity",
          "jpeg.yDensity",
        ])
      : new Set(["png.colourType"]);
  if (
    output.format.kind !== format ||
    output.file.declaredMimeType !== canonicalMimeType(format) ||
    !output.image ||
    !source.image ||
    output.image.width !== source.image.width ||
    output.image.height !== source.image.height ||
    (output.image.orientation !== undefined && output.image.orientation !== 1) ||
    output.image.animated === true ||
    output.privacy.length !== 0 ||
    output.warnings.length !== 0 ||
    output.metadata.some(({ key }) => !allowedMetadata.has(key)) ||
    !output.file.sha256
  ) {
    throw new CleanCopyError(
      "verification-failed",
      "The generated file did not pass the clean structural and metadata profile.",
    );
  }
  if (format === "jpeg") {
    const exactSafeMetadata = new Map<string, unknown>([
      ["jpeg.app0", "JFIF (14 bytes)"],
      ["jpeg.jfifVersion", "1.01"],
      ["jpeg.densityUnit", 0],
      ["jpeg.xDensity", 1],
      ["jpeg.yDensity", 1],
    ]);
    if (
      output.metadata.length !== exactSafeMetadata.size ||
      output.metadata.some(
        ({ key, value }) => exactSafeMetadata.get(key) !== value,
      )
    ) {
      throw new CleanCopyError(
        "verification-failed",
        "The generated JPEG does not contain exactly the canonical safe JFIF metadata.",
      );
    }
  }
}

export async function createCleanShareCopy(
  file: File,
  options: CleanCopyOptions = {},
): Promise<CleanCopyResult> {
  const maximumSourceBytes = positiveBoundedOption(
    options.maxSourceBytes,
    CLEAN_COPY_LIMITS.maxSourceBytes,
    "Maximum source bytes",
  );
  const maximumPixels = positiveBoundedOption(
    options.maxPixels,
    CLEAN_COPY_LIMITS.maxPixels,
    "Maximum decoded pixels",
  );
  throwIfCleanCopyAborted(options.signal);
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    file.size > maximumSourceBytes
  ) {
    throw new CleanCopyError(
      "source-too-large",
      "The selected file exceeds the metadata-removal source-byte limit.",
    );
  }

  reportCleanCopyProgress(options.onProgress, options.signal, {
    phase: "inspect-source",
    processedBytes: 0,
    totalBytes: file.size,
  });
  let source: MediaInspectionResult;
  try {
    source = await inspectMedia(file, {
      signal: options.signal,
      includeSha256: true,
      maxReadBytes: maximumSourceBytes,
      maxHashBytes: maximumSourceBytes,
      onHashProgress: ({ processedBytes, totalBytes }) =>
        reportCleanCopyProgress(options.onProgress, options.signal, {
          phase: "inspect-source",
          processedBytes,
          totalBytes,
        }),
    });
  } catch (error) {
    inspectSourceError(error);
  }

  let preflight = getCleanShareCopyPreflight(source);
  if (!preflight.eligible) {
    throw new CleanCopyError(preflight.code, preflight.reason);
  }
  assertPixelLimit(source.image!.width, source.image!.height, maximumPixels);

  let inspector;
  try {
    inspector = (options.provenanceInspectorFactory ??
      createC2paProvenanceInspector)();
  } catch {
    throw new CleanCopyError(
      "source-provenance-unverified",
      "The embedded Content Credentials verifier could not be started.",
    );
  }

  try {
    reportCleanCopyProgress(options.onProgress, options.signal, {
      phase: "verify-source-provenance",
    });
    const sourceProvenance = await awaitWithAbort(
      inspector.inspect(file, canonicalMimeType(preflight.format)),
      options.signal,
    );
    throwIfCleanCopyAborted(options.signal);
    assertSourceProvenance(sourceProvenance);
    preflight = getCleanShareCopyPreflight(source, sourceProvenance);
    if (!preflight.eligible) {
      throw new CleanCopyError(preflight.code, preflight.reason);
    }

    reportCleanCopyProgress(options.onProgress, options.signal, {
      phase: "rewrite",
      processedBytes: 0,
      totalBytes: file.size,
    });
    const sourceBytes = await readBlobBounded(
      file,
      maximumSourceBytes,
      options.signal,
      (processedBytes) =>
        reportCleanCopyProgress(options.onProgress, options.signal, {
          phase: "rewrite",
          processedBytes,
          totalBytes: file.size,
        }),
    );
    const structuralSource = await rewriteForFormat(
      preflight.format,
      sourceBytes,
      maximumSourceBytes,
      options.signal,
    );
    assertPixelLimit(
      structuralSource.width,
      structuralSource.height,
      maximumPixels,
    );
    if (
      structuralSource.width !== source.image!.width ||
      structuralSource.height !== source.image!.height
    ) {
      throw new CleanCopyError(
        "malformed-source",
        "Independent structure parsing disagreed with the inspected source dimensions.",
      );
    }

    const output = new File(
      [structuralSource.bytes.slice().buffer as ArrayBuffer],
      canonicalFilename(file, preflight.format),
      {
        type: canonicalMimeType(preflight.format),
        lastModified: 0,
      },
    );
    if (output === file || output.size > maximumSourceBytes) {
      throw new CleanCopyError(
        "rewrite-limit-exceeded",
        "The metadata-removed copy could not be created within its bounded output profile.",
      );
    }
    reportCleanCopyProgress(options.onProgress, options.signal, {
      phase: "inspect-output",
      processedBytes: 0,
      totalBytes: output.size,
    });
    const outputBytes = await readBlobBounded(
      output,
      maximumSourceBytes,
      options.signal,
      (processedBytes) =>
        reportCleanCopyProgress(options.onProgress, options.signal, {
          phase: "inspect-output",
          processedBytes,
          totalBytes: output.size,
        }),
    );
    const structuralOutput = await verifyForFormat(
      preflight.format,
      outputBytes,
      options.signal,
    );
    await assertStructuralParity(
      structuralSource,
      structuralOutput,
      options.signal,
    );

    let cleaned: MediaInspectionResult;
    try {
      cleaned = await inspectMedia(output, {
        signal: options.signal,
        includeSha256: true,
        maxReadBytes: maximumSourceBytes,
        maxHashBytes: maximumSourceBytes,
        onHashProgress: ({ processedBytes, totalBytes }) =>
          reportCleanCopyProgress(options.onProgress, options.signal, {
            phase: "inspect-output",
            processedBytes,
            totalBytes,
          }),
      });
    } catch (error) {
      verifyOutputError(error);
    }
    assertCleanInspection(source, cleaned, preflight.format);
    await verifyDecodedCleanCopy(
      output,
      structuralOutput.width,
      structuralOutput.height,
      options.outputImageDecoder ?? decodeCleanCopyInBrowser,
      options.signal,
    );

    reportCleanCopyProgress(options.onProgress, options.signal, {
      phase: "verify-output-provenance",
    });
    const outputProvenance = await awaitWithAbort(
      inspector.inspect(output, canonicalMimeType(preflight.format)),
      options.signal,
    );
    throwIfCleanCopyAborted(options.signal);
    if (outputProvenance.status === "credentials-found") {
      throw new CleanCopyError(
        "output-provenance-present",
        "The generated file still contains Content Credentials and was not exposed.",
      );
    }
    if (outputProvenance.status !== "not-found") {
      throw new CleanCopyError(
        "verification-failed",
        "The generated file's embedded Content Credentials state could not be verified as absent.",
      );
    }
    const verifiedOutputProvenance: ProvenanceNotFound = outputProvenance;
    if (!source.file.sha256 || !cleaned.file.sha256) {
      throw new CleanCopyError(
        "verification-failed",
        "The before-and-after SHA-256 evidence is incomplete.",
      );
    }

    reportCleanCopyProgress(options.onProgress, options.signal, {
      phase: "complete",
      processedBytes: output.size,
      totalBytes: output.size,
    });
    return {
      output,
      source,
      cleaned,
      sourceProvenance,
      outputProvenance: verifiedOutputProvenance,
      verification: {
        profile: profileFor(preflight.format),
        strategy: "lossless-metadata-rewrite",
        sourceSha256: source.file.sha256,
        outputSha256: cleaned.file.sha256,
        pixelsPreserved: true,
        orientationPreserved: true,
        colourAppearancePreserved: true,
        contentCredentialsRemoved: true,
        removedMetadata: removedMetadata(source.metadata, cleaned.metadata),
        remainingMetadata: cleaned.metadata,
        removedPrivacy: source.privacy,
        removedCarriers: structuralSource.removedCarriers,
        preservedCarriers: structuralOutput.preservedCarriers,
      },
    };
  } finally {
    inspector.dispose();
  }
}

export async function createCleanShareCopySafely(
  file: File,
  options: CleanCopyOptions = {},
): Promise<CleanCopyOutcome> {
  try {
    return { ok: true, result: await createCleanShareCopy(file, options) };
  } catch (error) {
    return { ok: false, error: normaliseCleanCopyError(error) };
  }
}
