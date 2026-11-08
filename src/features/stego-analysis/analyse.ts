import { parseRasterDimensions } from "../raster/dimensions";
import { detectRasterSignature } from "../raster/signatures";
import { hexRows, identifySignature, scanSignatures, scanStrings, type HexRow, type SignatureMatch, type StringScan } from "./bytes";
import { parseJpegStructure, type JpegStructure } from "./jpeg";
import { STEGO_ANALYSIS_LIMITS, StegoAnalysisError } from "./limits";
import { decodePng, parsePngStructure, type DecodedImage, type PngStructure, type SixteenBitByte } from "./png";

export type DetectedKind = "png" | "jpeg" | "webp" | "bmp" | "gif";

export const KIND_LABELS: Record<DetectedKind, string> = {
  png: "PNG image",
  jpeg: "JPEG image",
  webp: "WebP image",
  bmp: "BMP image",
  gif: "GIF image",
};

export type TrailingData = {
  /** Offset of the first byte after the image's end marker. */
  readonly offset: number;
  readonly length: number;
  readonly signature: string | null;
  readonly preview: readonly HexRow[];
};

export type FileReport = {
  readonly size: number;
  readonly sha256: string;
  readonly kind: DetectedKind | null;
  readonly png: Omit<PngStructure, "endOffset"> | null;
  readonly jpeg: Omit<JpegStructure, "endOffset"> | null;
  /** Offset just after IEND/EOI, or null when unknown or not applicable. */
  readonly imageEndOffset: number | null;
  readonly trailing: TrailingData | null;
  readonly signatures: { readonly matches: readonly SignatureMatch[]; readonly total: number };
};

export type ImageDecoder = "exact-png" | "browser";

export type ImageReport = {
  readonly width: number;
  readonly height: number;
  readonly decoder: ImageDecoder;
  readonly hasTransparency: boolean;
  /** Set for 16-bit PNGs decoded exactly: which sample byte is in use. */
  readonly sixteenBitByte: SixteenBitByte | null;
  readonly notes: readonly string[];
};

function isGif(bytes: Uint8Array) {
  return bytes.byteLength >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
}

export function detectKind(bytes: Uint8Array): DetectedKind | null {
  const raster = detectRasterSignature(bytes.subarray(0, 30));
  if (raster) return raster;
  return isGif(bytes) ? "gif" : null;
}

export function findTrailingData(bytes: Uint8Array, endOffset: number | null): TrailingData | null {
  if (endOffset === null || endOffset >= bytes.byteLength) return null;
  const tail = bytes.subarray(endOffset);
  return {
    offset: endOffset,
    length: tail.byteLength,
    signature: identifySignature(tail),
    preview: hexRows(tail, 256),
  };
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function analyseFile(bytes: Uint8Array): Promise<FileReport> {
  if (bytes.byteLength === 0) throw new StegoAnalysisError("empty-file", "The file is empty.");
  if (bytes.byteLength > STEGO_ANALYSIS_LIMITS.maxFileBytes) {
    throw new StegoAnalysisError("file-too-large", `Choose a file no larger than ${STEGO_ANALYSIS_LIMITS.maxFileLabel}.`);
  }
  const kind = detectKind(bytes);
  let png: PngStructure | null = null;
  let jpeg: JpegStructure | null = null;
  let imageEndOffset: number | null = null;
  if (kind === "png") {
    png = parsePngStructure(bytes);
    imageEndOffset = png.endOffset;
  } else if (kind === "jpeg") {
    jpeg = parseJpegStructure(bytes);
    imageEndOffset = jpeg.endOffset;
  }
  const strip = <T extends { endOffset: number | null }>(value: T | null) => {
    if (!value) return null;
    const { endOffset: _ignored, ...rest } = value;
    void _ignored;
    return rest;
  };
  return {
    size: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    kind,
    png: strip(png),
    jpeg: strip(jpeg),
    imageEndOffset,
    trailing: findTrailingData(bytes, imageEndOffset),
    signatures: scanSignatures(bytes, STEGO_ANALYSIS_LIMITS.maxSignatureMatches),
  };
}

export function fileStrings(bytes: Uint8Array, minLength: number): StringScan {
  const length = Math.min(64, Math.max(3, Math.floor(minLength)));
  return scanStrings(bytes, length, STEGO_ANALYSIS_LIMITS.maxListedStrings);
}

function headerDimensions(kind: DetectedKind, bytes: Uint8Array) {
  if (kind === "gif") return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) };
  try {
    return parseRasterDimensions(kind, kind === "jpeg" ? bytes : bytes.subarray(0, 64));
  } catch {
    throw new StegoAnalysisError("decode-failed", "The image header could not be read, so the image was not decoded.");
  }
}

function assertDimensions(width: number, height: number) {
  if (width <= 0 || height <= 0) throw new StegoAnalysisError("decode-failed", "The image reports zero width or height.");
  if (width > STEGO_ANALYSIS_LIMITS.maxWidth || height > STEGO_ANALYSIS_LIMITS.maxHeight) {
    throw new StegoAnalysisError(
      "dimensions-too-large",
      `Choose an image no larger than ${STEGO_ANALYSIS_LIMITS.maxWidth} by ${STEGO_ANALYSIS_LIMITS.maxHeight} pixels.`,
    );
  }
}

async function bitmapFor(blob: Blob) {
  try {
    return await createImageBitmap(blob, {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
      imageOrientation: "none",
    } as ImageBitmapOptions);
  } catch {
    return createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  }
}

/** Decodes with the browser's image decoder (used for JPEG, WebP, BMP and GIF). */
export async function decodeWithBrowser(bytes: Uint8Array, kind: DetectedKind): Promise<DecodedImage> {
  const header = headerDimensions(kind, bytes);
  assertDimensions(header.width, header.height);
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    throw new StegoAnalysisError("decode-failed", "This browser cannot decode images in a background worker.");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await bitmapFor(new Blob([bytes as BlobPart]));
  } catch {
    throw new StegoAnalysisError("decode-failed", "The browser could not decode this image.");
  }
  try {
    assertDimensions(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new StegoAnalysisError("decode-failed", "A drawing surface was not available.");
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    canvas.width = 0;
    canvas.height = 0;
    const notes = [
      "Pixels came from the browser's image decoder, so low bits can differ between browsers and devices.",
    ];
    if (kind === "jpeg") notes.push("JPEG is lossy: pixel LSBs rarely carry data. Check the file strings and trailing bytes too.");
    if (kind === "gif") notes.push("Only the first GIF frame is shown.");
    return { width: bitmap.width, height: bitmap.height, rgba: data, notes };
  } finally {
    bitmap.close();
  }
}

export async function decodeImage(
  bytes: Uint8Array,
  kind: DetectedKind | null,
  sixteenBitByte: SixteenBitByte = "high",
): Promise<{ image: DecodedImage; report: ImageReport }> {
  if (!kind) throw new StegoAnalysisError("no-image", "This file is not a PNG, JPEG, WebP, BMP or GIF image.");
  let image: DecodedImage;
  let decoder: ImageDecoder;
  if (kind === "png") {
    try {
      image = await decodePng(bytes, undefined, sixteenBitByte);
      decoder = "exact-png";
    } catch (error) {
      if (!(error instanceof StegoAnalysisError) || error.code === "dimensions-too-large") throw error;
      // Fall back to the browser so damaged-but-viewable PNGs still open.
      let fallback: DecodedImage;
      try {
        fallback = await decodeWithBrowser(bytes, kind);
      } catch {
        throw error;
      }
      image = { ...fallback, notes: [`The exact PNG decoder stopped: ${error.message}`, ...fallback.notes] };
      decoder = "browser";
    }
  } else {
    image = await decodeWithBrowser(bytes, kind);
    decoder = "browser";
  }
  let hasTransparency = false;
  for (let i = 3; i < image.rgba.length; i += 4) {
    if (image.rgba[i] !== 255) {
      hasTransparency = true;
      break;
    }
  }
  const notes = decoder === "browser" && hasTransparency
    ? [...image.notes, "This image has transparency: the browser alters or discards colour under transparent and semi-transparent pixels, so those bits are not reliable here."]
    : image.notes;
  return {
    image,
    report: {
      width: image.width,
      height: image.height,
      decoder,
      hasTransparency,
      sixteenBitByte: decoder === "exact-png" && parsePngStructure(bytes).header?.bitDepth === 16 ? sixteenBitByte : null,
      notes,
    },
  };
}
