import { FILE_LIMITS } from "../../config/product";
import type {
  EnhancementPreset,
  PreparationMetadata,
  ThresholdingMethod,
} from "../ocr/types";

export const MAX_PREPARED_PIXELS = FILE_LIMITS.maxWorkingSide ** 2;
export const MAX_PREPARATION_SCALE = 3;

// The synthetic corpus selected built-in Sauvola over methods 0 and 1.
export const ADAPTIVE_DOCUMENT_THRESHOLDING_METHOD: ThresholdingMethod = 2;

const ADAPTIVE_LOW_PERCENTILE = 0.005;
const ADAPTIVE_HIGH_PERCENTILE = 0.995;
const ADAPTIVE_SHARPEN_AMOUNT = 0.18;

/**
 * A page-level tonal decision that can be applied consistently to every
 * recognition tile. The values are derived from a bounded whole-page preview,
 * never from an individual tile, so seams cannot acquire different contrast or
 * polarity decisions.
 */
export type AdaptiveTonalPlan = {
  low: number;
  high: number;
  stretchApplied: boolean;
  polarityInverted: boolean;
};

export type PreparationScale = {
  scale: number;
  width: number;
  height: number;
  action: PreparationMetadata["scaleAction"];
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function choosePreparationScale(
  width: number,
  height: number,
  allowEnlargement: boolean,
): PreparationScale {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error("Preparation dimensions must be positive finite numbers.");
  }

  const longestSide = Math.max(width, height);
  const candidateScale = allowEnlargement
    ? longestSide <= 900
      ? 3
      : longestSide <= 1_600
        ? 2
        : 1
    : 1;
  const sideScale = FILE_LIMITS.maxWorkingSide / longestSide;
  const pixelScale = Math.sqrt(MAX_PREPARED_PIXELS / (width * height));
  const boundedScale = Math.min(
    MAX_PREPARATION_SCALE,
    candidateScale,
    sideScale,
    pixelScale,
  );
  let preparedWidth = Math.max(
    1,
    Math.min(FILE_LIMITS.maxWorkingSide, Math.round(width * boundedScale)),
  );
  let preparedHeight = Math.max(
    1,
    Math.min(FILE_LIMITS.maxWorkingSide, Math.round(height * boundedScale)),
  );
  if (preparedWidth * preparedHeight > MAX_PREPARED_PIXELS) {
    const correction = Math.sqrt(
      MAX_PREPARED_PIXELS / (preparedWidth * preparedHeight),
    );
    preparedWidth = Math.max(1, Math.floor(preparedWidth * correction));
    preparedHeight = Math.max(1, Math.floor(preparedHeight * correction));
  }
  const scale = Math.min(preparedWidth / width, preparedHeight / height);
  const action =
    scale < 1 - Number.EPSILON
      ? "reduced"
      : scale > 1 + Number.EPSILON
        ? "enlarged"
        : "original";

  return {
    scale,
    width: preparedWidth,
    height: preparedHeight,
    action,
  };
}

export function pixelLuminance(red: number, green: number, blue: number) {
  return Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
}

export function convertToLuminance(pixels: Uint8ClampedArray) {
  for (let index = 0; index < pixels.length; index += 4) {
    const grey = pixelLuminance(
      pixels[index],
      pixels[index + 1],
      pixels[index + 2],
    );
    pixels[index] = grey;
    pixels[index + 1] = grey;
    pixels[index + 2] = grey;
  }
}

export function luminanceHistogram(pixels: Uint8ClampedArray) {
  const histogram = new Uint32Array(256);
  for (let index = 0; index < pixels.length; index += 4) {
    histogram[pixelLuminance(
      pixels[index],
      pixels[index + 1],
      pixels[index + 2],
    )] += 1;
  }
  return histogram;
}

export function histogramPercentile(
  histogram: Uint32Array,
  percentile: number,
) {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (total === 0) return 0;
  const target = Math.floor(clamp(percentile, 0, 1) * (total - 1));
  let cumulative = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative > target) return value;
  }
  return 255;
}

export function stretchLuminancePercentiles(
  pixels: Uint8ClampedArray,
  lowPercentile = ADAPTIVE_LOW_PERCENTILE,
  highPercentile = ADAPTIVE_HIGH_PERCENTILE,
) {
  const histogram = luminanceHistogram(pixels);
  const low = histogramPercentile(histogram, lowPercentile);
  const high = histogramPercentile(histogram, highPercentile);
  if (high <= low) return { low, high, applied: false } as const;

  for (let index = 0; index < pixels.length; index += 4) {
    const luminance = pixelLuminance(
      pixels[index],
      pixels[index + 1],
      pixels[index + 2],
    );
    const stretched = Math.round(
      clamp(((luminance - low) * 255) / (high - low), 0, 255),
    );
    pixels[index] = stretched;
    pixels[index + 1] = stretched;
    pixels[index + 2] = stretched;
  }
  return { low, high, applied: true } as const;
}

export function analyseAdaptiveTonalPlan(
  pixels: Uint8ClampedArray,
): AdaptiveTonalPlan {
  const histogram = luminanceHistogram(pixels);
  const low = histogramPercentile(histogram, ADAPTIVE_LOW_PERCENTILE);
  const high = histogramPercentile(histogram, ADAPTIVE_HIGH_PERCENTILE);
  return {
    low,
    high,
    stretchApplied: high > low,
    polarityInverted: shouldInvertDarkBackground(histogram),
  };
}

export function applyAdaptiveTonalPlan(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  plan: AdaptiveTonalPlan,
  sharpen: boolean,
) {
  convertToLuminance(pixels);

  if (plan.stretchApplied && plan.high > plan.low) {
    for (let index = 0; index < pixels.length; index += 4) {
      const stretched = Math.round(
        clamp(
          ((pixels[index] - plan.low) * 255) / (plan.high - plan.low),
          0,
          255,
        ),
      );
      pixels[index] = stretched;
      pixels[index + 1] = stretched;
      pixels[index + 2] = stretched;
    }
  }

  if (sharpen) sharpenLuminance(pixels, width, height);
  if (plan.polarityInverted) invertLuminance(pixels);
}

function histogramRangeTotal(
  histogram: Uint32Array,
  start: number,
  end: number,
) {
  let total = 0;
  for (let value = start; value <= end; value += 1) total += histogram[value];
  return total;
}

export function shouldInvertDarkBackground(histogram: Uint32Array) {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (total === 0) return false;

  const darkFraction = histogramRangeTotal(histogram, 0, 80) / total;
  const brightFraction = histogramRangeTotal(histogram, 192, 255) / total;
  return (
    darkFraction >= 0.68 &&
    brightFraction >= 0.015 &&
    brightFraction <= 0.3 &&
    darkFraction >= brightFraction * 2.5
  );
}

export function invertLuminance(pixels: Uint8ClampedArray) {
  for (let index = 0; index < pixels.length; index += 4) {
    const inverted = 255 - pixels[index];
    pixels[index] = inverted;
    pixels[index + 1] = inverted;
    pixels[index + 2] = inverted;
  }
}

export function sharpenLuminance(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  amount = ADAPTIVE_SHARPEN_AMOUNT,
) {
  if (width < 3 || height < 3 || amount <= 0) return;
  const source = new Uint8ClampedArray(pixels);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      const neighbourAverage =
        (source[index - 4] +
          source[index + 4] +
          source[index - width * 4] +
          source[index + width * 4]) /
        4;
      const sharpened = Math.round(
        clamp(source[index] + amount * (source[index] - neighbourAverage), 0, 255),
      );
      pixels[index] = sharpened;
      pixels[index + 1] = sharpened;
      pixels[index + 2] = sharpened;
    }
  }
}

function applyLegacyPreset(
  pixels: Uint8ClampedArray,
  preset: Exclude<EnhancementPreset, "original" | "adaptive-document">,
) {
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const grey = pixelLuminance(red, green, blue);

    if (preset === "document") {
      const contrasted = clamp((grey - 128) * 1.35 + 142, 0, 255);
      pixels[index] = contrasted;
      pixels[index + 1] = contrasted;
      pixels[index + 2] = contrasted;
    } else if (preset === "high-contrast") {
      const thresholded = grey >= 152 ? 255 : 0;
      pixels[index] = thresholded;
      pixels[index + 1] = thresholded;
      pixels[index + 2] = thresholded;
    } else {
      pixels[index] = 255 - red;
      pixels[index + 1] = 255 - green;
      pixels[index + 2] = 255 - blue;
    }
  }
}

export function applyTonalPreparation(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  preset: EnhancementPreset,
  scale: number,
) {
  if (preset === "original") {
    return { polarityInverted: false, adaptivePlan: undefined };
  }
  if (preset !== "adaptive-document") {
    applyLegacyPreset(pixels, preset);
    return { polarityInverted: false, adaptivePlan: undefined };
  }

  const adaptivePlan = analyseAdaptiveTonalPlan(pixels);
  applyAdaptiveTonalPlan(
    pixels,
    width,
    height,
    adaptivePlan,
    scale > 1 + Number.EPSILON,
  );
  return {
    polarityInverted: adaptivePlan.polarityInverted,
    adaptivePlan,
  };
}

export function applyPreparationToCanvas(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  preset: EnhancementPreset,
  scale: number,
) {
  if (preset === "original") {
    return { polarityInverted: false, adaptivePlan: undefined };
  }
  const imageData = context.getImageData(0, 0, width, height);
  const result = applyTonalPreparation(
    imageData.data,
    width,
    height,
    preset,
    scale,
  );
  context.putImageData(imageData, 0, 0);
  return result;
}

export function thresholdingMethodForPreset(
  preset: EnhancementPreset,
): ThresholdingMethod {
  return preset === "adaptive-document"
    ? ADAPTIVE_DOCUMENT_THRESHOLDING_METHOD
    : 0;
}
