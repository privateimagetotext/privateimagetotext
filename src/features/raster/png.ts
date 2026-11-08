import { parsePngDimensions } from "./dimensions";
import { hasPngSignature } from "./signatures";
import {
  RASTER_LIMITS,
  type RasterDimensions,
  type RasterInspectionResult,
} from "./types";

export async function validateGeneratedPng(
  output: Blob | null,
  expected: RasterDimensions,
): Promise<RasterInspectionResult> {
  if (!output) {
    return {
      ok: false,
      code: "output-missing",
      message: "The browser did not create a PNG output.",
    };
  }
  if (output.size > RASTER_LIMITS.maxOutputBytes) {
    return {
      ok: false,
      code: "output-too-large",
      message:
        "This carrier cannot produce an output within the 80 MiB reopen limit.",
    };
  }

  try {
    const prefix = new Uint8Array(
      await output.slice(0, Math.min(24, output.size)).arrayBuffer(),
    );
    if (!hasPngSignature(prefix)) {
      return {
        ok: false,
        code: "malformed-image",
        message: "The browser output is not a PNG.",
      };
    }
    const parsed = parsePngDimensions(prefix);
    if (parsed.width !== expected.width || parsed.height !== expected.height) {
      return {
        ok: false,
        code: "dimension-mismatch",
        message: "The generated PNG dimensions changed unexpectedly.",
      };
    }
    return { ok: true, kind: "png", ...parsed };
  } catch {
    return {
      ok: false,
      code: "malformed-image",
      message: "The browser output is not a valid supported PNG.",
    };
  }
}
