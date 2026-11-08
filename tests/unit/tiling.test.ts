import { describe, expect, it } from "vitest";

import { FILE_LIMITS } from "../../src/config/product";
import {
  DEFAULT_NATIVE_TILE_OVERLAP,
  MAX_NATIVE_RECOGNITION_TILE_PIXELS,
  MAX_NATIVE_RECOGNITION_TILE_SIDE,
  assembleOwnedLines,
  nativeTilingEligibility,
  owningTileIndexAtY,
  planNativeVerticalTiles,
  type MappedTileLine,
  type NativeVerticalTilePlan,
} from "../../src/features/ocr/tiling";

const eligibleInput = {
  contentMode: "document",
  preset: "adaptive-document",
  orientedWidth: 900,
  orientedHeight: 8_000,
  wholePreparationAction: "reduced",
  sourceWidth: 900,
  sourceHeight: 8_000,
  sourceFileBytes: 2_000_000,
} as const;

describe("native vertical tiling eligibility", () => {
  it("allows a safeguarded long portrait page only for Document plus Adaptive document", () => {
    expect(nativeTilingEligibility(eligibleInput)).toEqual({ eligible: true });

    expect(
      nativeTilingEligibility({ ...eligibleInput, contentMode: "code" }),
    ).toEqual({ eligible: false, reason: "content-mode" });
    expect(
      nativeTilingEligibility({ ...eligibleInput, contentMode: "columns" }),
    ).toEqual({ eligible: false, reason: "content-mode" });
    expect(
      nativeTilingEligibility({ ...eligibleInput, preset: "document" }),
    ).toEqual({ eligible: false, reason: "preset" });
  });

  it.each([
    [{ orientedHeight: 4_096 }, "not-long"],
    [{ wholePreparationAction: "original" }, "whole-image-not-reduced"],
    [{ orientedWidth: 4_097 }, "page-too-wide"],
    [{ sourceWidth: 6_000, sourceHeight: 6_001 }, "source-pixel-limit"],
    [{ sourceFileBytes: FILE_LIMITS.maxBytes + 1 }, "source-file-limit"],
  ] as const)("rejects noneligible input %o", (change, reason) => {
    expect(nativeTilingEligibility({ ...eligibleInput, ...change })).toEqual({
      eligible: false,
      reason,
    });
  });

  it("rejects a quarter-turned landscape presentation", () => {
    expect(
      nativeTilingEligibility({
        ...eligibleInput,
        orientedWidth: 8_000,
        orientedHeight: 900,
      }),
    ).toEqual({ eligible: false, reason: "not-long" });
  });

  it("fails closed for invalid dimensions", () => {
    expect(
      nativeTilingEligibility({ ...eligibleInput, orientedHeight: Number.NaN }),
    ).toEqual({ eligible: false, reason: "invalid-dimensions" });
  });
});

function expectValidCoverage(plan: NativeVerticalTilePlan) {
  expect(plan.tiles[0]?.coreRect.y).toBe(0);
  let nextCoreY = 0;
  for (const tile of plan.tiles) {
    expect(tile.coreRect.y).toBe(nextCoreY);
    expect(tile.coreRect.x).toBe(0);
    expect(tile.coreRect.width).toBe(plan.pageWidth);
    expect(tile.coreRect.height).toBeGreaterThan(0);
    nextCoreY += tile.coreRect.height;

    expect(tile.inputRect.x).toBe(0);
    expect(tile.inputRect.y).toBeGreaterThanOrEqual(0);
    expect(tile.inputRect.y + tile.inputRect.height).toBeLessThanOrEqual(
      plan.pageHeight,
    );
    expect(tile.inputRect.width).toBe(plan.pageWidth);
    expect(tile.inputRect.width).toBeLessThanOrEqual(plan.maxTileSide);
    expect(tile.inputRect.height).toBeLessThanOrEqual(plan.maxTileSide);
    expect(tile.inputRect.width * tile.inputRect.height).toBeLessThanOrEqual(
      plan.maxTilePixels,
    );
  }
  expect(nextCoreY).toBe(plan.pageHeight);

  for (let index = 1; index < plan.tiles.length; index += 1) {
    const previous = plan.tiles[index - 1].inputRect;
    const current = plan.tiles[index].inputRect;
    const inputOverlap = previous.y + previous.height - current.y;
    expect(inputOverlap).toBe(plan.overlap);
  }
}

describe("native vertical tile planning", () => {
  it.each([
    [900, 8_000],
    [1_601, 7_201],
    [4_096, 8_789],
    [1, 4_097],
  ])("covers odd and long dimensions exactly for %i by %i", (width, height) => {
    const plan = planNativeVerticalTiles(width, height);

    expect(plan.tiles.length).toBeGreaterThan(1);
    expectValidCoverage(plan);
  });

  it("balances core bands instead of leaving a tiny final strip", () => {
    const plan = planNativeVerticalTiles(900, 8_000);
    const coreHeights = plan.tiles.map((tile) => tile.coreRect.height);

    expect(
      Math.max(...coreHeights) - Math.min(...coreHeights),
    ).toBeLessThanOrEqual(1);
    expect(plan.overlap).toBe(DEFAULT_NATIVE_TILE_OVERLAP);
  });

  it("respects custom side, pixel and overlap bounds", () => {
    const plan = planNativeVerticalTiles(2_000, 10_000, {
      maxTileSide: 3_000,
      maxTilePixels: 4_000_000,
      overlap: 200,
    });

    expectValidCoverage(plan);
    expect(plan.tiles.every((tile) => tile.inputRect.height <= 2_000)).toBe(true);
  });

  it("supports the largest full-width page inside the 36-megapixel safeguard", () => {
    const height = Math.floor(FILE_LIMITS.maxDecodedPixels / 4_096);
    const plan = planNativeVerticalTiles(4_096, height);

    expect(4_096 * height).toBeLessThanOrEqual(FILE_LIMITS.maxDecodedPixels);
    expectValidCoverage(plan);
  });

  it("publishes conservative limits no larger than the existing canvas ceiling", () => {
    expect(MAX_NATIVE_RECOGNITION_TILE_SIDE).toBe(FILE_LIMITS.maxWorkingSide);
    expect(MAX_NATIVE_RECOGNITION_TILE_PIXELS).toBeLessThanOrEqual(
      FILE_LIMITS.maxWorkingSide ** 2,
    );
  });

  it.each([
    [4_097, 8_000, {}, "Page width"],
    [4_096, 8_790, {}, "decoded-pixel"],
    [4_096, 8_000, { overlap: 2_048 }, "no usable"],
    [900, 8_000, { maxTileSide: 4_097 }, "working-side"],
    [900, 8_000, { maxTilePixels: 4_096 ** 2 + 1 }, "canvas"],
  ] as const)(
    "rejects out-of-budget planning for %i by %i",
    (width, height, options, message) => {
      expect(() => planNativeVerticalTiles(width, height, options)).toThrow(
        message,
      );
    },
  );
});

describe("geometric line ownership", () => {
  const plan = planNativeVerticalTiles(900, 8_000);
  const firstBoundary =
    plan.tiles[0].coreRect.y + plan.tiles[0].coreRect.height;

  it("assigns half-open boundaries to exactly one core", () => {
    expect(owningTileIndexAtY(plan, 0)).toBe(0);
    expect(owningTileIndexAtY(plan, firstBoundary - 0.5)).toBe(0);
    expect(owningTileIndexAtY(plan, firstBoundary)).toBe(1);
    expect(owningTileIndexAtY(plan, plan.pageHeight - 0.5)).toBe(
      plan.tiles.length - 1,
    );
    expect(owningTileIndexAtY(plan, plan.pageHeight)).toBeNull();
    expect(owningTileIndexAtY(plan, -1)).toBeNull();
  });

  it("keeps one overlap observation and preserves legitimate repeated text", () => {
    type Line = { text: string };
    const line = (
      tileIndex: number,
      centreY: number,
      text: string,
      sourceOrder: number,
    ): MappedTileLine<Line> => ({
      tileIndex,
      bbox: { x: 20, y: centreY - 10, width: 400, height: 20 },
      sourceOrder,
      line: { text },
    });
    const candidates = [
      line(2, 7_500, "TOTAL", 1),
      line(0, 200, "TOTAL", 0),
      // The same physical boundary line is seen in both overlapping inputs.
      line(0, firstBoundary + 10, "SEAM LINE", 2),
      line(1, firstBoundary + 10, "SEAM LINE", 0),
    ];

    const accepted = assembleOwnedLines(plan, candidates);

    expect(accepted.map((candidate) => candidate.line.text)).toEqual([
      "TOTAL",
      "SEAM LINE",
      "TOTAL",
    ]);
    expect(accepted.filter((candidate) => candidate.line.text === "SEAM LINE"))
      .toHaveLength(1);
  });
});
