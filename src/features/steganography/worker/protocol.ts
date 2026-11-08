import type { CarrierCapacity } from "../codec";
import type { JpegV2Capacity } from "../jpeg-v2";

export type OperationId = number;

export type WorkerStage =
  | "loading-jpeg-codec"
  | "parsing-jpeg"
  | "validating-jpeg-profile"
  | "analysing-capacity"
  | "hashing-message"
  | "deriving-encryption-key"
  | "encrypting-message"
  | "embedding-payload"
  | "writing-jpeg"
  | "reopening-jpeg"
  | "encoding-jpeg"
  | "verifying-output"
  | "inspecting-header"
  | "extracting-payload"
  | "decrypting-message";

export type WorkerErrorCode =
  | "unsupported-version"
  | "unsupported-format"
  | "damaged"
  | "unlock-failed"
  | "cancelled"
  | "capacity-unavailable"
  | "invalid-message"
  | "invalid-password"
  | "malformed-jpeg"
  | "unsupported-jpeg-profile"
  | "jpeg-codec-unavailable"
  | "jpeg-self-verification-failed"
  | "jpeg-output-too-large"
  | "jpeg-allocation-failed"
  | "worker-failed";

type PngRasterRequest = {
  readonly format: "png-v1";
  readonly pixels: ArrayBuffer;
  readonly width: number;
  readonly height: number;
};

type JpegRequest = {
  readonly format: "jpeg-v2";
  readonly bytes: ArrayBuffer;
};

export type AnalyseRequest = {
  readonly type: "analyse";
  readonly operationId: OperationId;
} & (PngRasterRequest | JpegRequest);

export type EncodeRequest = {
  readonly type: "encode";
  readonly operationId: OperationId;
  readonly message: ArrayBuffer;
  readonly password?: ArrayBuffer;
} & (PngRasterRequest | JpegRequest);

export type InspectRequest = {
  readonly type: "inspect";
  readonly operationId: OperationId;
} & (PngRasterRequest | JpegRequest);

export type UnlockRequest = {
  readonly type: "unlock";
  readonly operationId: OperationId;
  readonly password: ArrayBuffer;
};

export type DisposeRequest = {
  readonly type: "dispose";
  readonly operationId: OperationId;
};

export type SteganographyWorkerRequest =
  | AnalyseRequest
  | EncodeRequest
  | InspectRequest
  | UnlockRequest
  | DisposeRequest;

export type ProgressResponse = {
  readonly type: "progress";
  readonly operationId: OperationId;
  readonly stage: WorkerStage;
};

export type CapacityResponse = {
  readonly type: "capacity";
  readonly operationId: OperationId;
  readonly capacity: CarrierCapacity | JpegV2Capacity;
};

export type EncodedResponse =
  | {
      readonly type: "encoded";
      readonly operationId: OperationId;
      readonly format: "png-v1";
      readonly pixels: ArrayBuffer;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly type: "encoded";
      readonly operationId: OperationId;
      readonly format: "jpeg-v2";
      readonly bytes: ArrayBuffer;
      readonly width: number;
      readonly height: number;
    };

export type InspectionResponse = {
  readonly type: "inspection";
  readonly operationId: OperationId;
  readonly result:
    | { readonly kind: "no-message" }
    | { readonly kind: "plain-ready"; readonly message: string }
    | { readonly kind: "password-required" }
    | {
        readonly kind:
          | "unsupported-version"
          | "unsupported-format"
          | "damaged"
          | "capacity-unavailable";
      };
};

export type UnlockedResponse = {
  readonly type: "unlocked";
  readonly operationId: OperationId;
  readonly message: string;
};

export type ErrorResponse = {
  readonly type: "error";
  readonly operationId: OperationId;
  readonly code: WorkerErrorCode;
};

export type DisposedResponse = {
  readonly type: "disposed";
  readonly operationId: OperationId;
};

export type SteganographyWorkerResponse =
  | ProgressResponse
  | CapacityResponse
  | EncodedResponse
  | InspectionResponse
  | UnlockedResponse
  | ErrorResponse
  | DisposedResponse;

export const workerErrorMessages: Record<WorkerErrorCode, string> = {
  "unsupported-version":
    "This image uses an LTSG message version that this app does not support.",
  "unsupported-format":
    "This image uses an LTSG message format that this app does not support.",
  damaged: "The hidden message is damaged or the LTSG header is invalid.",
  "unlock-failed":
    "The password is incorrect or the hidden message has been damaged.",
  cancelled: "The operation was cancelled.",
  "capacity-unavailable":
    "This image does not have enough usable carrier capacity for the message.",
  "invalid-message": "Enter a valid non-empty message within the supported limit.",
  "invalid-password": "Enter a valid password from 12 to 256 Unicode characters.",
  "malformed-jpeg": "The JPEG is malformed or incomplete.",
  "unsupported-jpeg-profile":
    "This JPEG profile is not supported for JPEG v2. You can still use PNG v1.",
  "jpeg-codec-unavailable":
    "The optional JPEG codec is not available. Connect once and select JPEG v2 to prepare it for offline use.",
  "jpeg-self-verification-failed":
    "The generated JPEG did not pass the mandatory reopen verification.",
  "jpeg-output-too-large": "The generated JPEG would exceed the 80 MiB output limit.",
  "jpeg-allocation-failed": "Local processing could not allocate bounded codec memory.",
  "worker-failed": "Local processing stopped before it could finish.",
};
