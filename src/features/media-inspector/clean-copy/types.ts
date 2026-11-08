import type {
  MediaInspectionResult,
  MetadataEntry,
  PrivacyFinding,
} from "../types";
import type {
  C2paProvenanceInspector,
  ProvenanceInspection,
  ProvenanceNotFound,
} from "../provenance/types";

export const CLEAN_COPY_LIMITS = {
  maxSourceBytes: 32 * 1024 * 1024,
  maxPixels: 36_000_000,
  maxDimension: 8_192,
  readChunkBytes: 1024 * 1024,
  maxJpegMarkers: 16_384,
  maxPngChunks: 4_096,
} as const;

export type CleanCopyFormat = "jpeg" | "png";

export type CleanCopyProfile =
  | "jpeg-safe-structural-v1"
  | "png-safe-structural-v1";

export type CleanCopyProgressPhase =
  | "inspect-source"
  | "verify-source-provenance"
  | "rewrite"
  | "inspect-output"
  | "verify-output-provenance"
  | "complete";

export interface CleanCopyProgress {
  readonly phase: CleanCopyProgressPhase;
  readonly processedBytes?: number;
  readonly totalBytes?: number;
}

export type CleanCopyErrorCode =
  | "cancelled"
  | "invalid-options"
  | "unsupported-format"
  | "animated-media"
  | "orientation-unsupported"
  | "colour-profile-unsupported"
  | "unsafe-colour-model"
  | "source-too-large"
  | "dimensions-too-large"
  | "unsupported-structure"
  | "malformed-source"
  | "source-provenance-unverified"
  | "rewrite-limit-exceeded"
  | "verification-failed"
  | "output-provenance-present"
  | "read-failed";

export interface SerializedCleanCopyError {
  readonly code: CleanCopyErrorCode;
  readonly message: string;
}

export type CleanCopyPreflight =
  | {
      readonly eligible: true;
      readonly format: CleanCopyFormat;
      readonly strategy: "lossless-metadata-rewrite";
      readonly profile: CleanCopyProfile;
      readonly structuralCheckRequired: true;
    }
  | {
      readonly eligible: false;
      readonly code: CleanCopyErrorCode;
      readonly reason: string;
    };

export type CleanCopyProvenanceInspectorFactory =
  () => C2paProvenanceInspector;

export interface CleanCopyDecodedImage {
  readonly width: number;
  readonly height: number;
  close(): void;
}

export type CleanCopyImageDecoder = (
  blob: Blob,
  signal?: AbortSignal,
) => Promise<CleanCopyDecodedImage>;

export interface CleanCopyOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: CleanCopyProgress) => void;
  /** May lower, but never raise, the hard source-byte ceiling. */
  readonly maxSourceBytes?: number;
  /** May lower, but never raise, the hard decoded-pixel ceiling. */
  readonly maxPixels?: number;
  /** Deterministic dependency seam; normal callers should omit this. */
  readonly provenanceInspectorFactory?: CleanCopyProvenanceInspectorFactory;
  /** Deterministic decode-verification seam; normal callers should omit this. */
  readonly outputImageDecoder?: CleanCopyImageDecoder;
}

export interface CleanCopyVerification {
  readonly profile: CleanCopyProfile;
  readonly strategy: "lossless-metadata-rewrite";
  readonly sourceSha256: string;
  readonly outputSha256: string;
  readonly pixelsPreserved: true;
  readonly orientationPreserved: true;
  readonly colourAppearancePreserved: true;
  readonly contentCredentialsRemoved: true;
  readonly removedMetadata: readonly MetadataEntry[];
  readonly remainingMetadata: readonly MetadataEntry[];
  readonly removedPrivacy: readonly PrivacyFinding[];
  readonly removedCarriers: readonly string[];
  readonly preservedCarriers: readonly string[];
}

export interface CleanCopyResult {
  readonly output: File;
  readonly source: MediaInspectionResult;
  readonly cleaned: MediaInspectionResult;
  readonly sourceProvenance: ProvenanceInspection;
  readonly outputProvenance: ProvenanceNotFound;
  readonly verification: CleanCopyVerification;
}

export type CleanCopyOutcome =
  | { readonly ok: true; readonly result: CleanCopyResult }
  | { readonly ok: false; readonly error: SerializedCleanCopyError };
