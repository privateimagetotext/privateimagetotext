import { FILE_LIMITS } from "../../config/product";
import type {
  EnhancementPreset,
  OcrContentMode,
  PreparationMetadata,
} from "./types";

/**
 * A rectangle in source-relative, quarter-turn-oriented page pixels.
 * The right and bottom edges are exclusive.
 */
export type OrientedPageRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type NativeRecognitionTile = {
  index: number;
  /** Pixels rendered and sent to one recognition call. */
  inputRect: OrientedPageRect;
  /** Non-overlapping page band whose recognised line centres this tile owns. */
  coreRect: OrientedPageRect;
};

export type NativeVerticalTilePlan = {
  pageWidth: number;
  pageHeight: number;
  overlap: number;
  maxTileSide: number;
  maxTilePixels: number;
  tiles: readonly NativeRecognitionTile[];
};

export const MAX_NATIVE_RECOGNITION_TILE_SIDE = FILE_LIMITS.maxWorkingSide;

// A native tile is intentionally bounded below the general 4096 x 4096 canvas
// ceiling. It limits peak recognition-canvas memory while retaining source detail.
export const MAX_NATIVE_RECOGNITION_TILE_PIXELS = 8_388_608;

export const DEFAULT_NATIVE_TILE_OVERLAP = 256;

export type NativeTilingEligibilityInput = {
  contentMode: OcrContentMode;
  preset: EnhancementPreset;
  orientedWidth: number;
  orientedHeight: number;
  wholePreparationAction: PreparationMetadata["scaleAction"];
  sourceWidth: number;
  sourceHeight: number;
  sourceFileBytes: number;
};

export type NativeTilingIneligibilityReason =
  | "content-mode"
  | "preset"
  | "not-long"
  | "whole-image-not-reduced"
  | "page-too-wide"
  | "invalid-dimensions"
  | "source-pixel-limit"
  | "source-file-limit";

export type NativeTilingEligibility =
  | { eligible: true }
  | { eligible: false; reason: NativeTilingIneligibilityReason };

function isPositivePixelDimension(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * This first tiling slice is deliberately restricted to the Document content
 * mode with the opt-in Adaptive document preset. Existing preset behaviour is
 * therefore unchanged, and source files must still pass the established input
 * safeguards before native tiles can be planned.
 */
export function nativeTilingEligibility(
  input: NativeTilingEligibilityInput,
): NativeTilingEligibility {
  if (
    !isPositivePixelDimension(input.orientedWidth) ||
    !isPositivePixelDimension(input.orientedHeight) ||
    !isPositivePixelDimension(input.sourceWidth) ||
    !isPositivePixelDimension(input.sourceHeight) ||
    !Number.isFinite(input.sourceFileBytes) ||
    input.sourceFileBytes < 0
  ) {
    return { eligible: false, reason: "invalid-dimensions" };
  }
  if (input.sourceFileBytes > FILE_LIMITS.maxBytes) {
    return { eligible: false, reason: "source-file-limit" };
  }
  if (
    input.sourceWidth >
    Math.floor(FILE_LIMITS.maxDecodedPixels / input.sourceHeight)
  ) {
    return { eligible: false, reason: "source-pixel-limit" };
  }
  if (input.contentMode !== "document") {
    return { eligible: false, reason: "content-mode" };
  }
  if (input.preset !== "adaptive-document") {
    return { eligible: false, reason: "preset" };
  }
  if (input.orientedHeight <= MAX_NATIVE_RECOGNITION_TILE_SIDE) {
    return { eligible: false, reason: "not-long" };
  }
  if (input.wholePreparationAction !== "reduced") {
    return { eligible: false, reason: "whole-image-not-reduced" };
  }
  if (input.orientedWidth > MAX_NATIVE_RECOGNITION_TILE_SIDE) {
    return { eligible: false, reason: "page-too-wide" };
  }
  return { eligible: true };
}

export type PlanNativeVerticalTilesOptions = {
  overlap?: number;
  maxTileSide?: number;
  maxTilePixels?: number;
};

function assertPositiveInteger(value: number, label: string) {
  if (!isPositivePixelDimension(value)) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

/**
 * Splits an oriented portrait page into full-width native-resolution strips.
 * Core bands partition [0, pageHeight) exactly. Input rectangles add overlap
 * around those bands but remain within the side and pixel budgets.
 */
export function planNativeVerticalTiles(
  pageWidth: number,
  pageHeight: number,
  options: PlanNativeVerticalTilesOptions = {},
): NativeVerticalTilePlan {
  assertPositiveInteger(pageWidth, "Page width");
  assertPositiveInteger(pageHeight, "Page height");

  const maxTileSide = options.maxTileSide ?? MAX_NATIVE_RECOGNITION_TILE_SIDE;
  const maxTilePixels =
    options.maxTilePixels ?? MAX_NATIVE_RECOGNITION_TILE_PIXELS;
  const overlap = options.overlap ?? DEFAULT_NATIVE_TILE_OVERLAP;

  assertPositiveInteger(maxTileSide, "Maximum tile side");
  assertPositiveInteger(maxTilePixels, "Maximum tile pixel budget");
  assertPositiveInteger(overlap, "Tile overlap");
  if (maxTileSide > FILE_LIMITS.maxWorkingSide) {
    throw new Error("Maximum tile side exceeds the working-side safeguard.");
  }
  if (maxTilePixels > FILE_LIMITS.maxWorkingSide ** 2) {
    throw new Error("Maximum tile pixel budget exceeds the canvas safeguard.");
  }
  if (pageWidth > maxTileSide) {
    throw new Error("Page width exceeds the native tile side limit.");
  }
  if (pageWidth > Math.floor(FILE_LIMITS.maxDecodedPixels / pageHeight)) {
    throw new Error("Page dimensions exceed the decoded-pixel safeguard.");
  }

  const maximumInputHeight = Math.min(
    maxTileSide,
    Math.floor(maxTilePixels / pageWidth),
  );
  if (maximumInputHeight <= overlap) {
    throw new Error("Tile overlap leaves no usable non-overlapping core band.");
  }

  const leadingOverlap = Math.floor(overlap / 2);
  const trailingOverlap = overlap - leadingOverlap;
  const maximumCoreHeight = maximumInputHeight - overlap;
  const tileCount = Math.max(1, Math.ceil(pageHeight / maximumCoreHeight));

  // Balanced core heights avoid a very short final recognition tile while
  // retaining exactly one owner for every vertical page coordinate.
  const baseCoreHeight = Math.floor(pageHeight / tileCount);
  const extraCorePixels = pageHeight % tileCount;
  const tiles: NativeRecognitionTile[] = [];
  let coreY = 0;

  for (let index = 0; index < tileCount; index += 1) {
    const coreHeight = baseCoreHeight + (index < extraCorePixels ? 1 : 0);
    const coreBottom = coreY + coreHeight;
    const inputY = index === 0 ? 0 : coreY - leadingOverlap;
    const inputBottom =
      index === tileCount - 1
        ? pageHeight
        : coreBottom + trailingOverlap;

    tiles.push({
      index,
      inputRect: {
        x: 0,
        y: inputY,
        width: pageWidth,
        height: inputBottom - inputY,
      },
      coreRect: { x: 0, y: coreY, width: pageWidth, height: coreHeight },
    });
    coreY = coreBottom;
  }

  return {
    pageWidth,
    pageHeight,
    overlap,
    maxTileSide,
    maxTilePixels,
    tiles,
  };
}

/** Returns the sole half-open core band that owns an oriented page y value. */
export function owningTileIndexAtY(
  plan: NativeVerticalTilePlan,
  orientedY: number,
): number | null {
  if (!Number.isFinite(orientedY) || orientedY < 0 || orientedY >= plan.pageHeight) {
    return null;
  }

  // Tile counts are small for the 36-megapixel input ceiling. A linear search
  // keeps boundary semantics obvious and deterministic.
  for (const tile of plan.tiles) {
    const bottom = tile.coreRect.y + tile.coreRect.height;
    if (orientedY >= tile.coreRect.y && orientedY < bottom) {
      return tile.index;
    }
  }
  return null;
}

export type MappedTileLine<TLine> = {
  /** Tile whose OCR response produced this candidate. */
  tileIndex: number;
  /** Line envelope mapped into oriented-page pixels. */
  bbox: OrientedPageRect;
  /** Stable order within a tile for exact geometric ties. */
  sourceOrder: number;
  line: TLine;
};

function rectCentre(rect: OrientedPageRect) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

/**
 * Keeps a line only when its mapped centre belongs to the producing tile's
 * core, then orders accepted structured lines geometrically. Text is never
 * compared or suffix-matched, so legitimate repeated lines remain intact.
 */
export function assembleOwnedLines<TLine>(
  plan: NativeVerticalTilePlan,
  candidates: readonly MappedTileLine<TLine>[],
): MappedTileLine<TLine>[] {
  return candidates
    .filter((candidate) => {
      if (!Number.isSafeInteger(candidate.tileIndex)) return false;
      const centre = rectCentre(candidate.bbox);
      return owningTileIndexAtY(plan, centre.y) === candidate.tileIndex;
    })
    .sort((left, right) => {
      const leftCentre = rectCentre(left.bbox);
      const rightCentre = rectCentre(right.bbox);
      return (
        leftCentre.y - rightCentre.y ||
        leftCentre.x - rightCentre.x ||
        left.tileIndex - right.tileIndex ||
        left.sourceOrder - right.sourceOrder
      );
    });
}
