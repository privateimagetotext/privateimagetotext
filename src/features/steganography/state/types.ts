export type SteganographyWorkflow = "hide" | "reveal";

export type ProtectionMode = "encrypted" | "plain";
export type SteganographyFormat = "png-v1" | "jpeg-v2";

export type SteganographyRasterKind = "png" | "jpeg" | "webp" | "bmp";

export type SteganographySourceImage = {
  readonly file: File | null;
  readonly objectUrl: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly kind: SteganographyRasterKind;
};

export type SourceState =
  | { readonly status: "empty" }
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly image: SteganographySourceImage;
    };

export type PngV1Capacity = {
  readonly format: "png-v1";
  readonly opaquePixelCount: number;
  readonly embeddedByteCapacity: number;
  readonly plainMessageCapacity: number;
  readonly encryptedMessageCapacity: number;
};

export type JpegV2Capacity = {
  readonly format: "jpeg-v2";
  readonly physicalDomainSize: number;
  readonly eligibleCoefficientCount: number;
  readonly reservedHeaderCoefficientCount: 1568;
  readonly embeddedByteCapacity: number;
  readonly plainMessageCapacity: number;
  readonly encryptedMessageCapacity: number;
};

export type Capacity = PngV1Capacity | JpegV2Capacity;

export type CapacityState =
  | { readonly status: "idle" }
  | { readonly status: "analysing" }
  | {
      readonly status: "ready";
      readonly value: Capacity;
    }
  | { readonly status: "unavailable" };

export type GenerationState =
  | { readonly status: "idle" }
  | { readonly status: "generating" }
  | { readonly status: "succeeded" }
  | { readonly status: "failed" };

export type InspectionState =
  | { readonly status: "idle" }
  | { readonly status: "inspecting" }
  | { readonly status: "password-required" }
  | { readonly status: "unlocking" }
  | { readonly status: "complete" }
  | { readonly status: "failed" };

export type PasswordRequiredState = {
  readonly operationId: number;
  readonly failedAttempts: number;
};

export type GeneratedImageResult = Readonly<{
  kind: "generated-image";
  blob: Blob;
  format: SteganographyFormat;
  mime: "image/png" | "image/jpeg";
  objectUrl: string;
  filename: string;
  width: number;
  height: number;
  byteLength: number;
  protection: ProtectionMode;
  messageByteCount: number;
}>;

export type RevealedTextResult = Readonly<{
  kind: "revealed-text";
  text: string;
  filename: string;
  protection: ProtectionMode;
}>;

export type NoMessageResult = Readonly<{
  kind: "no-message";
}>;

export type SteganographyResult =
  | GeneratedImageResult
  | RevealedTextResult
  | NoMessageResult;

export type SteganographyProgressStage =
  | "loading-jpeg-codec"
  | "parsing-jpeg"
  | "validating-jpeg-profile"
  | "analysing-capacity"
  | "hashing-message"
  | "deriving-encryption-key"
  | "encrypting-message"
  | "embedding-message"
  | "inspecting-header"
  | "extracting-payload"
  | "decrypting-message"
  | "encoding-png"
  | "encoding-jpeg"
  | "verifying-output";

export type SteganographyProgress = {
  readonly stage: SteganographyProgressStage;
  readonly value: number | null;
};

export type SteganographyErrorCode =
  | "unsupported-input"
  | "file-too-large"
  | "dimension-limit"
  | "animated-image"
  | "decode-failed"
  | "capacity-unavailable"
  | "invalid-message"
  | "message-too-large"
  | "invalid-password"
  | "password-mismatch"
  | "unsupported-version"
  | "unsupported-format"
  | "damaged"
  | "unlock-failed"
  | "output-too-large"
  | "png-encode-failed"
  | "malformed-jpeg"
  | "unsupported-jpeg-profile"
  | "jpeg-codec-unavailable"
  | "jpeg-output-too-large"
  | "jpeg-allocation-failed"
  | "jpeg-self-verification-failed"
  | "worker-failed"
  | "worker-message-error"
  | "clipboard-failed"
  | "download-failed";

export type SteganographyError = Readonly<{
  code: SteganographyErrorCode;
}>;

export type SteganographyState = {
  readonly workflow: SteganographyWorkflow;
  readonly format: SteganographyFormat;
  readonly currentOperationId: number;
  readonly source: SourceState;
  readonly capacity: CapacityState;
  readonly protection: ProtectionMode;
  readonly messageByteCount: number;
  readonly generation: GenerationState;
  readonly inspection: InspectionState;
  readonly passwordRequired: PasswordRequiredState | null;
  readonly result: SteganographyResult | null;
  readonly progress: SteganographyProgress | null;
  readonly error: SteganographyError | null;
};

export function createInitialSteganographyState(
  workflow: SteganographyWorkflow = "hide",
  currentOperationId = 0,
): SteganographyState {
  return {
    workflow,
    format: "png-v1",
    currentOperationId,
    source: { status: "empty" },
    capacity: { status: "idle" },
    protection: "encrypted",
    messageByteCount: 0,
    generation: { status: "idle" },
    inspection: { status: "idle" },
    passwordRequired: null,
    result: null,
    progress: null,
    error: null,
  };
}

export const initialSteganographyState = createInitialSteganographyState();
