import { parseJpegDimensions } from "./dimensions";
import { detectRasterSignature } from "./signatures";
import {
  RASTER_LIMITS,
  type RasterDimensions,
  type RasterInspectionResult,
} from "./types";

export async function validateGeneratedJpeg(
  output: Blob | null,
  expected: RasterDimensions,
): Promise<RasterInspectionResult> {
  if (!output) {
    return { ok: false, code: "output-missing", message: "The worker did not create a JPEG output." };
  }
  if (output.size > RASTER_LIMITS.maxOutputBytes) {
    return { ok: false, code: "output-too-large", message: "The generated JPEG exceeds the 80 MiB reopen limit." };
  }
  let bytes: Uint8Array | undefined;
  try {
    bytes = new Uint8Array(await output.arrayBuffer());
    if (
      detectRasterSignature(bytes) !== "jpeg" ||
      bytes.byteLength < 4 ||
      bytes[bytes.byteLength - 2] !== 0xff ||
      bytes[bytes.byteLength - 1] !== 0xd9
    ) {
      return { ok: false, code: "malformed-image", message: "The worker output is not a complete JPEG." };
    }
    const parsed = parseJpegDimensions(bytes);
    if (parsed.width !== expected.width || parsed.height !== expected.height) {
      return { ok: false, code: "dimension-mismatch", message: "The generated JPEG dimensions changed unexpectedly." };
    }
    return { ok: true, kind: "jpeg", ...parsed };
  } catch {
    return { ok: false, code: "malformed-image", message: "The worker output is not a valid supported JPEG." };
  } finally {
    bytes?.fill(0);
  }
}
