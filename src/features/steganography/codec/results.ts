export type CodecErrorCode =
  | "unsupported-version"
  | "unsupported-format"
  | "damaged"
  | "unlock-failed"
  | "capacity-unavailable"
  | "cancelled"
  | "invalid-message"
  | "invalid-password";

export class CodecError extends Error {
  readonly code: CodecErrorCode;

  constructor(code: CodecErrorCode) {
    super(code);
    this.name = "CodecError";
    this.code = code;
  }
}

export type InspectionResult =
  | { readonly kind: "no-message" }
  | {
      readonly kind: "plain-ready";
      readonly message: string;
    }
  | {
      readonly kind: "password-required";
      readonly header: Uint8Array;
      readonly payload: Uint8Array;
    }
  | {
      readonly kind:
        | "unsupported-version"
        | "unsupported-format"
        | "damaged"
        | "capacity-unavailable";
    };
