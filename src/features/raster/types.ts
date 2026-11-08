export type RasterKind = "png" | "jpeg" | "webp" | "bmp";

export type RasterPurpose = "hide" | "reveal";

export type RasterDimensions = {
  width: number;
  height: number;
};

export const RASTER_LIMITS = {
  hideMaxBytes: 25 * 1024 * 1024,
  revealMaxBytes: 80 * 1024 * 1024,
  maxWidth: 4_096,
  maxHeight: 4_096,
  maxOutputBytes: 80 * 1024 * 1024,
} as const;

export type RasterValidationCode =
  | "file-too-large"
  | "unsupported-format"
  | "mime-mismatch"
  | "malformed-image"
  | "animated-image"
  | "dimensions-too-large"
  | "dimension-mismatch"
  | "decode-failed"
  | "output-missing"
  | "output-too-large";

export type RasterValidationFailure = {
  ok: false;
  code: RasterValidationCode;
  message: string;
};

export type RasterInspection = {
  ok: true;
  kind: RasterKind;
  width: number;
  height: number;
};

export type RasterInspectionResult =
  | RasterInspection
  | RasterValidationFailure;

export class RasterValidationError extends Error {
  readonly code: RasterValidationCode;

  constructor(code: RasterValidationCode, message: string) {
    super(message);
    this.name = "RasterValidationError";
    this.code = code;
  }
}
