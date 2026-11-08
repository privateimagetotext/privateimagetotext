export const CONTENT_SAMPLE_SIDE = 192;

export type ContentSuggestion = {
  contentMode: "document" | "screenshot";
  preset: "original" | "adaptive-document";
  reason: "clipboard" | "interface" | "photograph" | "ambiguous";
};

const fallback: ContentSuggestion = { contentMode: "document", preset: "original", reason: "ambiguous" };

/** A bounded luminance histogram, neighbour differences and axis-aligned edge runs.
 * No OCR, metadata, filename rules, training data, network, or retained pixels. */
export function classifyContentPixels({ data, width, height }: Pick<ImageData, "data" | "width" | "height">): ContentSuggestion {
  if (width < 8 || height < 8 || width > CONTENT_SAMPLE_SIDE || height > CONTENT_SAMPLE_SIDE
    || !Number.isInteger(width) || !Number.isInteger(height) || data.length !== width * height * 4) return fallback;
  const count = width * height;
  const luminance = new Uint8Array(count);
  const histogram = new Uint32Array(32);
  for (let index = 0; index < count; index++) {
    const offset = index * 4;
    const alpha = data[offset + 3] / 255;
    const value = Math.round((data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722) * alpha + 255 * (1 - alpha));
    luminance[index] = value;
    histogram[value >> 3]++;
  }
  let flat = 0;
  let gradients = 0;
  let contrast = 0;
  let pairs = 0;
  let longestHorizontal = 0;
  let longestVertical = 0;
  // An edge runs along a row when the pixels above it differ, and along a
  // column when the pixels to its left differ. Ignore the outside image border.
  const verticalRuns = new Uint16Array(width);
  for (let y = 0; y < height; y++) {
    let horizontalRun = 0;
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const left = x ? Math.abs(luminance[index] - luminance[index - 1]) : 0;
      const above = y ? Math.abs(luminance[index] - luminance[index - width]) : 0;
      for (const difference of [left, above]) {
        // Border zeros have negligible weight and are included consistently.
        pairs++;
        if (difference <= 2) flat++;
        else if (difference < 20) gradients++;
        if (difference >= 40) contrast++;
      }
      horizontalRun = above >= 20 ? horizontalRun + 1 : 0;
      verticalRuns[x] = left >= 20 ? verticalRuns[x] + 1 : 0;
      longestHorizontal = Math.max(longestHorizontal, horizontalRun);
      longestVertical = Math.max(longestVertical, verticalRuns[x]);
    }
  }
  let backgroundShare = 0;
  let occupiedBins = 0;
  for (let bin = 0; bin < histogram.length; bin++) {
    // Uniform dark/light surfaces, with adjacent bins to tolerate compression.
    if (bin <= 8 || bin >= 23) backgroundShare = Math.max(backgroundShare,
      (histogram[bin] + (histogram[bin + 1] ?? 0)) / count);
    if (histogram[bin] / count >= 0.01) occupiedBins++;
  }
  const straightEdge = longestHorizontal >= Math.max(16, width * 0.5)
    || longestVertical >= Math.max(16, height * 0.5);
  if (backgroundShare >= 0.35 && flat / pairs >= 0.65 && gradients / pairs <= 0.2
    && contrast / pairs >= 0.005 && straightEdge) {
    return { contentMode: "screenshot", preset: "original", reason: "interface" };
  }
  if (occupiedBins >= 10 && flat / pairs < 0.65 && !straightEdge) {
    return { contentMode: "document", preset: "adaptive-document", reason: "photograph" };
  }
  return fallback;
}

export function suggestContentDefaults(preview: HTMLCanvasElement, clipboard = false): ContentSuggestion {
  if (clipboard) return { contentMode: "screenshot", preset: "original", reason: "clipboard" };
  const sample = document.createElement("canvas");
  try {
    const scale = Math.min(1, CONTENT_SAMPLE_SIDE / Math.max(preview.width, preview.height));
    sample.width = Math.max(1, Math.round(preview.width * scale));
    sample.height = Math.max(1, Math.round(preview.height * scale));
    // There is only one readback. Let the browser downsample before transferring
    // pixels, rather than requesting a software canvas for repeated reads.
    const context = sample.getContext("2d", { alpha: false });
    if (!context) return fallback;
    context.fillStyle = "white";
    context.fillRect(0, 0, sample.width, sample.height);
    context.drawImage(preview, 0, 0, sample.width, sample.height);
    return classifyContentPixels(context.getImageData(0, 0, sample.width, sample.height));
  } catch {
    // A suggestion must never prevent OCR (for example if canvas readback fails).
    return fallback;
  } finally {
    sample.width = sample.height = 0;
  }
}
