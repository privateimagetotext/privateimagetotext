import { FILE_LIMITS, OCR_TEXT_OUTPUT, productConfig } from "../../config/product";
import {
  RasterValidationError,
  declaredMimeMatches,
  inspectRasterHeader,
  sanitiseSourceBase,
  type RasterKind,
} from "../raster";

export { detectRasterSignature } from "../raster";

export type ValidationResult =
  | { ok: true; kind: RasterKind; width: number; height: number }
  | { ok: false; message: string };

export async function validateImageFile(file: File): Promise<ValidationResult> {
  if (file.size > FILE_LIMITS.maxBytes) {
    return {
      ok: false,
      message: `That file is larger than ${productConfig.fileLimits.maximumFileSizeLabel}.`,
    };
  }

  let header: Awaited<ReturnType<typeof inspectRasterHeader>>;
  try {
    header = await inspectRasterHeader(file);
  } catch (error) {
    const detail =
      error instanceof RasterValidationError && error.code !== "unsupported-format"
        ? error.message
        : "The file contents are not a supported raster image. SVG, PDF and HEIC are not accepted.";
    return {
      ok: false,
      message: detail,
    };
  }

  // File MIME metadata may be missing or generic after a drop, paste or OS copy.
  // Trust the inspected raster signature while rejecting contradictory types.
  if (!declaredMimeMatches(header.kind, file.type)) {
    return {
      ok: false,
      message: "The image contents do not match the file type reported by the browser.",
    };
  }

  if (exceedsPixelBudget(header.width, header.height)) {
    return {
      ok: false,
      message: `The image exceeds the ${FILE_LIMITS.maxMegapixels}-megapixel safety limit.`,
    };
  }

  return { ok: true, ...header };
}

function exceedsPixelBudget(width: number, height: number) {
  return width > Math.floor(FILE_LIMITS.maxDecodedPixels / height);
}

export function validateDecodedDimensions(width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return "The browser reported invalid image dimensions.";
  }
  if (exceedsPixelBudget(width, height)) {
    return `The decoded image exceeds the ${FILE_LIMITS.maxMegapixels}-megapixel safety limit.`;
  }
  return null;
}

export function safeTextFilename(sourceName: string) {
  const base = sanitiseSourceBase(sourceName);
  return `${base || "private-image-to-text"}-ocr${OCR_TEXT_OUTPUT.extension}`;
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
