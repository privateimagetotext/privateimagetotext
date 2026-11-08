export type JpegV2Capacity = Readonly<{
  format: "jpeg-v2";
  width: number;
  height: number;
  componentCount: number;
  progressiveInput: boolean;
  sampling: 400 | 420 | 422 | 444;
  physicalDomainSize: number;
  eligibleCoefficientCount: number;
  reservedHeaderCoefficientCount: 1568;
  embeddedByteCapacity: number;
  plainMessageCapacity: number;
  encryptedMessageCapacity: number;
  orientation: number;
}>;

export type JpegV2CodecErrorCode =
  | "malformed-jpeg"
  | "unsupported-jpeg-profile"
  | "jpeg-codec-unavailable"
  | "allocation-failed"
  | "output-too-large"
  | "capacity-unavailable"
  | "no-message"
  | "unsupported-version"
  | "unsupported-format"
  | "damaged"
  | "jpeg-self-verification-failed"
  | "invalid-argument";

export class JpegV2CodecError extends Error {
  readonly code: JpegV2CodecErrorCode;

  constructor(code: JpegV2CodecErrorCode) {
    super(code);
    this.name = "JpegV2CodecError";
    this.code = code;
  }
}

export type JpegV2RawInspection =
  | { readonly kind: "no-message" }
  | { readonly kind: "unsupported-version" }
  | { readonly kind: "unsupported-format" }
  | { readonly kind: "damaged" }
  | {
      readonly kind: "payload";
      readonly header: Uint8Array;
      readonly payload: Uint8Array;
      readonly capacity: JpegV2Capacity;
    };
