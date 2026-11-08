import { describe, expect, it } from "vitest";

import {
  MAX_PREPARED_PIXELS,
  analyseAdaptiveTonalPlan,
  applyAdaptiveTonalPlan,
  applyTonalPreparation,
  choosePreparationScale,
  convertToLuminance,
  histogramPercentile,
  luminanceHistogram,
  sharpenLuminance,
  shouldInvertDarkBackground,
  stretchLuminancePercentiles,
  thresholdingMethodForPreset,
} from "../../src/features/image-editor/preparation";

describe("preparation scale selection", () => {
  it.each([
    [900, 300, true, 3, 2_700, 900, "enlarged"],
    [901, 300, true, 2, 1_802, 600, "enlarged"],
    [1_600, 400, true, 2, 3_200, 800, "enlarged"],
    [1_601, 400, true, 1, 1_601, 400, "original"],
    [800, 600, false, 1, 800, 600, "original"],
  ] as const)(
    "selects the bounded scale for %i by %i",
    (width, height, allowEnlargement, scale, preparedWidth, preparedHeight, action) => {
      expect(
        choosePreparationScale(width, height, allowEnlargement),
      ).toMatchObject({
        scale,
        width: preparedWidth,
        height: preparedHeight,
        action,
      });
    },
  );

  it("keeps large inputs inside the side and pixel budgets", () => {
    const selected = choosePreparationScale(6_000, 6_000, true);

    expect(selected.width).toBe(4_096);
    expect(selected.height).toBe(4_096);
    expect(selected.action).toBe("reduced");
    expect(selected.width * selected.height).toBeLessThanOrEqual(
      MAX_PREPARED_PIXELS,
    );
  });

  it("uses Sauvola only for Adaptive document and resets legacy presets to Otsu", () => {
    expect(thresholdingMethodForPreset("adaptive-document")).toBe(2);
    expect(thresholdingMethodForPreset("original")).toBe(0);
    expect(thresholdingMethodForPreset("document")).toBe(0);
    expect(thresholdingMethodForPreset("high-contrast")).toBe(0);
    expect(thresholdingMethodForPreset("inverted")).toBe(0);
  });

  it("rejects invalid dimensions", () => {
    expect(() => choosePreparationScale(0, 100, true)).toThrow(
      "positive finite",
    );
  });
});

describe("adaptive tonal helpers", () => {
  it("converts RGB pixels to luminance without changing alpha", () => {
    const pixels = new Uint8ClampedArray([100, 150, 200, 73]);
    convertToLuminance(pixels);

    expect([...pixels]).toEqual([141, 141, 141, 73]);
    expect([...luminanceHistogram(pixels)]).toHaveLength(256);
    expect(luminanceHistogram(pixels)[141]).toBe(1);
  });

  it("finds histogram percentiles and stretches a bounded range", () => {
    const pixels = new Uint8ClampedArray([
      50, 50, 50, 10,
      100, 100, 100, 20,
      150, 150, 150, 30,
    ]);
    const histogram = luminanceHistogram(pixels);

    expect(histogramPercentile(histogram, 0)).toBe(50);
    expect(histogramPercentile(histogram, 0.5)).toBe(100);
    expect(histogramPercentile(histogram, 1)).toBe(150);
    expect(stretchLuminancePercentiles(pixels, 0, 1)).toEqual({
      low: 50,
      high: 150,
      applied: true,
    });
    expect([...pixels]).toEqual([
      0, 0, 0, 10,
      128, 128, 128, 20,
      255, 255, 255, 30,
    ]);
  });

  it("leaves a degenerate luminance range unchanged", () => {
    const pixels = new Uint8ClampedArray([80, 80, 80, 41, 80, 80, 80, 42]);
    expect(stretchLuminancePercentiles(pixels)).toEqual({
      low: 80,
      high: 80,
      applied: false,
    });
    expect([...pixels]).toEqual([80, 80, 80, 41, 80, 80, 80, 42]);
  });

  it("inverts only strong dark-background evidence", () => {
    const darkWithLightText = new Uint32Array(256);
    darkWithLightText[30] = 80;
    darkWithLightText[230] = 20;
    const ordinaryDocument = new Uint32Array(256);
    ordinaryDocument[30] = 15;
    ordinaryDocument[230] = 85;
    const uniformlyDim = new Uint32Array(256);
    uniformlyDim[30] = 100;
    const ambiguous = new Uint32Array(256);
    ambiguous[30] = 50;
    ambiguous[230] = 50;

    expect(shouldInvertDarkBackground(darkWithLightText)).toBe(true);
    expect(shouldInvertDarkBackground(ordinaryDocument)).toBe(false);
    expect(shouldInvertDarkBackground(uniformlyDim)).toBe(false);
    expect(shouldInvertDarkBackground(ambiguous)).toBe(false);
  });

  it("sharpens interior luminance within bounds and preserves alpha", () => {
    const pixels = new Uint8ClampedArray(3 * 3 * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 80;
      pixels[index + 1] = 80;
      pixels[index + 2] = 80;
      pixels[index + 3] = 37 + index / 4;
    }
    const centre = (1 * 3 + 1) * 4;
    pixels[centre] = 180;
    pixels[centre + 1] = 180;
    pixels[centre + 2] = 180;
    const alphaBefore = Array.from(pixels).filter((_, index) => index % 4 === 3);

    sharpenLuminance(pixels, 3, 3, 0.5);

    expect(pixels[centre]).toBe(230);
    expect(pixels[centre + 1]).toBe(230);
    expect(pixels[centre + 2]).toBe(230);
    expect(Array.from(pixels).filter((_, index) => index % 4 === 3)).toEqual(
      alphaBefore,
    );
  });

  it("clamps sharpening at both luminance bounds and leaves borders unchanged", () => {
    const makePixels = (border: number, centre: number) => {
      const pixels = new Uint8ClampedArray(3 * 3 * 4);
      for (let index = 0; index < pixels.length; index += 4) {
        pixels[index] = border;
        pixels[index + 1] = border;
        pixels[index + 2] = border;
        pixels[index + 3] = 91;
      }
      const centreIndex = (1 * 3 + 1) * 4;
      pixels[centreIndex] = centre;
      pixels[centreIndex + 1] = centre;
      pixels[centreIndex + 2] = centre;
      return { pixels, centreIndex };
    };
    const bright = makePixels(0, 250);
    const dark = makePixels(255, 5);

    sharpenLuminance(bright.pixels, 3, 3, 1);
    sharpenLuminance(dark.pixels, 3, 3, 1);

    expect(bright.pixels[bright.centreIndex]).toBe(255);
    expect(dark.pixels[dark.centreIndex]).toBe(0);
    expect([...bright.pixels.slice(0, 4)]).toEqual([0, 0, 0, 91]);
    expect([...dark.pixels.slice(0, 4)]).toEqual([255, 255, 255, 91]);
  });

  it("reuses one page-level tonal and polarity decision across tiles", () => {
    const page = new Uint8ClampedArray(100 * 4);
    for (let pixel = 0; pixel < 100; pixel += 1) {
      const index = pixel * 4;
      const value = pixel < 80 ? 20 : 230;
      page[index] = value;
      page[index + 1] = value;
      page[index + 2] = value;
      page[index + 3] = 11 + (pixel % 20);
    }
    const plan = analyseAdaptiveTonalPlan(page);
    const firstTile = new Uint8ClampedArray([20, 20, 20, 51]);
    const secondTile = new Uint8ClampedArray([230, 230, 230, 52]);

    applyAdaptiveTonalPlan(firstTile, 1, 1, plan, false);
    applyAdaptiveTonalPlan(secondTile, 1, 1, plan, false);

    expect(plan).toMatchObject({
      low: 20,
      high: 230,
      stretchApplied: true,
      polarityInverted: true,
    });
    expect([...firstTile]).toEqual([255, 255, 255, 51]);
    expect([...secondTile]).toEqual([0, 0, 0, 52]);
  });
});

describe("legacy preset compatibility", () => {
  it.each([
    ["document", [160, 160, 160, 73]],
    ["high-contrast", [0, 0, 0, 73]],
    ["inverted", [155, 105, 55, 73]],
  ] as const)("preserves the %s pixel transform", (preset, expected) => {
    const pixels = new Uint8ClampedArray([100, 150, 200, 73]);

    applyTonalPreparation(pixels, 1, 1, preset, 1);

    expect([...pixels]).toEqual(expected);
  });
});
