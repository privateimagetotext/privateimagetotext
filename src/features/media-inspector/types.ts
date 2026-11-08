export const MEDIA_INSPECTION_LIMITS = {
  maxReadBytes: 32 * 1024 * 1024,
  maxReadOperations: 8_192,
  maxSliceBytes: 4 * 1024 * 1024,
  maxMetadataBytes: 8 * 1024 * 1024,
  maxMetadataEntries: 1_024,
  maxMetadataValueBytes: 512 * 1024,
  maxHashBytes: 2 * 1024 * 1024 * 1024,
  hashChunkBytes: 1024 * 1024,
  maxContainerBoxes: 16_384,
  maxContainerDepth: 12,
} as const;

export type MediaFormatKind =
  | "jpeg"
  | "png"
  | "webp"
  | "gif"
  | "mp4"
  | "quicktime"
  | "m4a"
  | "webm"
  | "matroska"
  | "mp3"
  | "flac"
  | "wav"
  | "ogg"
  | "aac"
  | "aiff"
  | "unknown";

export type MediaCategory =
  | "image"
  | "video"
  | "audio"
  | "container"
  | "unknown";

export interface DetectedMediaFormat {
  readonly kind: MediaFormatKind;
  readonly category: MediaCategory;
  readonly label: string;
  readonly mimeType: string;
  readonly extensions: readonly string[];
  readonly signature: string;
  readonly brands?: readonly string[];
}

export type MetadataNamespace =
  | "file"
  | "exif"
  | "xmp"
  | "png"
  | "webp"
  | "jpeg"
  | "container"
  | "track";

export type MetadataValue =
  | string
  | number
  | boolean
  | readonly string[]
  | readonly number[];

export interface MetadataEntry {
  readonly key: string;
  readonly label: string;
  readonly value: MetadataValue;
  readonly namespace: MetadataNamespace;
  readonly sensitive?: boolean;
}

export type PrivacyFindingCategory =
  | "location"
  | "device-identifier"
  | "personal"
  | "timestamp"
  | "embedded-preview"
  | "generation-data"
  | "editing-history";

export type PrivacyFindingSeverity = "high" | "medium" | "low";

export interface PrivacyFinding {
  readonly id: string;
  readonly category: PrivacyFindingCategory;
  readonly severity: PrivacyFindingSeverity;
  readonly title: string;
  readonly detail: string;
  readonly metadataKeys: readonly string[];
}

export interface ImageMediaDetails {
  readonly width: number;
  readonly height: number;
  readonly bitDepth?: number;
  readonly orientation?: number;
  readonly animated?: boolean;
}

export type MediaTrackKind =
  | "video"
  | "audio"
  | "text"
  | "metadata"
  | "unknown";

export interface MediaTrack {
  readonly id?: number;
  readonly kind: MediaTrackKind;
  readonly codec?: string;
  readonly durationSeconds?: number;
  readonly language?: string;
  readonly width?: number;
  readonly height?: number;
  readonly channels?: number;
  readonly sampleRate?: number;
  readonly createdAt?: string;
  readonly modifiedAt?: string;
}

export interface ContainerMediaDetails {
  readonly brands: readonly string[];
  readonly durationSeconds?: number;
  readonly createdAt?: string;
  readonly modifiedAt?: string;
  readonly tracks: readonly MediaTrack[];
}

export type InspectionWarningCode =
  | "declared-type-mismatch"
  | "metadata-truncated"
  | "metadata-unsupported"
  | "timestamp-out-of-range";

export interface InspectionWarning {
  readonly code: InspectionWarningCode;
  readonly message: string;
}

export interface MediaInspectionResult {
  readonly format: DetectedMediaFormat;
  readonly file: {
    readonly name?: string;
    readonly size: number;
    readonly declaredMimeType: string;
    readonly sha256?: string;
  };
  readonly image?: ImageMediaDetails;
  readonly container?: ContainerMediaDetails;
  readonly metadata: readonly MetadataEntry[];
  readonly privacy: readonly PrivacyFinding[];
  readonly warnings: readonly InspectionWarning[];
  readonly stats: {
    readonly bytesRead: number;
    readonly readOperations: number;
  };
}

export type MediaInspectionErrorCode =
  | "cancelled"
  | "unsupported-format"
  | "malformed-file"
  | "invalid-range"
  | "read-limit-exceeded"
  | "metadata-limit-exceeded"
  | "file-too-large"
  | "hash-unavailable"
  | "read-failed";

export interface SerializedMediaInspectionError {
  readonly code: MediaInspectionErrorCode;
  readonly message: string;
}

export type MediaInspectionOutcome =
  | { readonly ok: true; readonly result: MediaInspectionResult }
  | { readonly ok: false; readonly error: SerializedMediaInspectionError };

export interface HashProgress {
  readonly processedBytes: number;
  readonly totalBytes: number;
}

export interface InspectMediaOptions {
  readonly signal?: AbortSignal;
  readonly includeSha256?: boolean;
  readonly maxReadBytes?: number;
  readonly maxMetadataBytes?: number;
  readonly maxHashBytes?: number;
  readonly onHashProgress?: (progress: HashProgress) => void;
}

export interface ReaderOptions {
  readonly signal?: AbortSignal;
  readonly maxReadBytes?: number;
  readonly maxReadOperations?: number;
  readonly maxSliceBytes?: number;
}

export interface HashBlobOptions {
  readonly signal?: AbortSignal;
  readonly maxBytes?: number;
  readonly chunkBytes?: number;
  readonly onProgress?: (progress: HashProgress) => void;
}
