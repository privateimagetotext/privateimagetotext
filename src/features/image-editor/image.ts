import type {
  CropRect,
  ImageTransform,
  PreparationMetadata,
} from "../ocr/types";
import {
  applyAdaptiveTonalPlan,
  applyPreparationToCanvas,
  choosePreparationScale,
  thresholdingMethodForPreset,
  type AdaptiveTonalPlan,
} from "./preparation";
import {
  compose,
  orientedSize,
  sourceToOrientedTransform,
  translation,
  type PixelRect,
} from "./coordinates";

export type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

export async function decodeImage(file: Blob): Promise<DecodedImage> {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("The browser could not decode the image."));
  });
  image.src = objectUrl;
  await loaded;

  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => URL.revokeObjectURL(objectUrl),
  };
}

export async function readImageDimensions(file: Blob) {
  const decoded = await decodeImage(file);
  try {
    return { width: decoded.width, height: decoded.height };
  } finally {
    decoded.close();
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normaliseCrop(crop: CropRect, minimum = 0.04): CropRect {
  const x = clamp(crop.x, 0, 1 - minimum);
  const y = clamp(crop.y, 0, 1 - minimum);
  const width = clamp(crop.width, minimum, 1 - x);
  const height = clamp(crop.height, minimum, 1 - y);
  return { x, y, width, height };
}

export type CropEdge = "left" | "top" | "right" | "bottom";

export function setCropEdge(
  crop: CropRect,
  edge: CropEdge,
  value: number,
): CropRect {
  const next = { ...crop };
  const normalisedValue = clamp(value, 0, 1);

  if (edge === "left") {
    const right = crop.x + crop.width;
    next.x = Math.min(normalisedValue, right - 0.04);
    next.width = right - next.x;
  } else if (edge === "top") {
    const bottom = crop.y + crop.height;
    next.y = Math.min(normalisedValue, bottom - 0.04);
    next.height = bottom - next.y;
  } else if (edge === "right") {
    next.width = Math.max(0.04, normalisedValue - crop.x);
  } else {
    next.height = Math.max(0.04, normalisedValue - crop.y);
  }

  return normaliseCrop(next);
}

export function cropToSourcePixels(
  crop: CropRect,
  sourceWidth: number,
  sourceHeight: number,
) {
  const normalised = normaliseCrop(crop);
  const sourceX = clamp(
    Math.round(sourceWidth * normalised.x),
    0,
    sourceWidth - 1,
  );
  const sourceY = clamp(
    Math.round(sourceHeight * normalised.y),
    0,
    sourceHeight - 1,
  );
  const sourceRight = clamp(
    Math.round(sourceWidth * (normalised.x + normalised.width)),
    sourceX + 1,
    sourceWidth,
  );
  const sourceBottom = clamp(
    Math.round(sourceHeight * (normalised.y + normalised.height)),
    sourceY + 1,
    sourceHeight,
  );

  return {
    x: sourceX,
    y: sourceY,
    width: sourceRight - sourceX,
    height: sourceBottom - sourceY,
  };
}

export async function renderWorkingImage(
  file: Blob,
  transform: ImageTransform,
) {
  const decoded = await decodeImage(file);
  try {
    const sourceCrop = cropToSourcePixels(
      transform.crop,
      decoded.width,
      decoded.height,
    );
    const sourceX = sourceCrop.x;
    const sourceY = sourceCrop.y;
    const sourceWidth = sourceCrop.width;
    const sourceHeight = sourceCrop.height;
    const scaleSelection = choosePreparationScale(
      sourceWidth,
      sourceHeight,
      transform.preset === "adaptive-document",
    );
    const unrotatedWidth = scaleSelection.width;
    const unrotatedHeight = scaleSelection.height;
    const swapsAxes =
      transform.rotation === 90 || transform.rotation === 270;
    const outputWidth = swapsAxes ? unrotatedHeight : unrotatedWidth;
    const outputHeight = swapsAxes ? unrotatedWidth : unrotatedHeight;

    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: transform.preset !== "original",
    });
    if (!context) throw new Error("Canvas rendering is not available.");

    context.save();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, outputWidth, outputHeight);
    context.translate(outputWidth / 2, outputHeight / 2);
    context.rotate((transform.rotation * Math.PI) / 180);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      decoded.source,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      -unrotatedWidth / 2,
      -unrotatedHeight / 2,
      unrotatedWidth,
      unrotatedHeight,
    );
    context.restore();
    const preparation = applyPreparationToCanvas(
      context,
      outputWidth,
      outputHeight,
      transform.preset,
      scaleSelection.scale,
    );
    const orientedSourceSize = orientedSize(sourceCrop, transform.rotation);

    const metadata: PreparationMetadata = {
      scale: scaleSelection.scale,
      scaleX: outputWidth / orientedSourceSize.width,
      scaleY: outputHeight / orientedSourceSize.height,
      scaleAction: scaleSelection.action,
      profile: transform.preset,
      thresholdingMethod: thresholdingMethodForPreset(transform.preset),
      polarityInverted: preparation.polarityInverted,
      sourceWidth,
      sourceHeight,
      preparedWidth: outputWidth,
      preparedHeight: outputHeight,
      adaptivePlan: preparation.adaptivePlan,
    };

    return {
      canvas,
      width: outputWidth,
      height: outputHeight,
      metadata,
    };
  } finally {
    decoded.close();
  }
}

/**
 * Render one native-detail rectangle from the manually oriented crop without
 * allocating a full native-resolution page canvas. The decoded source can be
 * reused for every sequential tile in an OCR operation.
 */
export function renderRecognitionTile(
  decoded: DecodedImage,
  transform: ImageTransform,
  sourceCrop: PixelRect,
  inputRect: PixelRect,
  canvas: HTMLCanvasElement,
  adaptivePlan?: AdaptiveTonalPlan,
) {
  if (
    !Number.isInteger(inputRect.x) ||
    !Number.isInteger(inputRect.y) ||
    !Number.isInteger(inputRect.width) ||
    !Number.isInteger(inputRect.height) ||
    inputRect.width < 1 ||
    inputRect.height < 1
  ) {
    throw new Error("Recognition tile edges must be positive integers.");
  }

  canvas.width = inputRect.width;
  canvas.height = inputRect.height;
  const context = canvas.getContext("2d", {
    alpha: false,
    willReadFrequently: transform.preset !== "original",
  });
  if (!context) throw new Error("Canvas rendering is not available.");

  context.save();
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const sourceToTile = compose(
    sourceToOrientedTransform(sourceCrop, transform.rotation),
    translation(-inputRect.x, -inputRect.y),
  );
  context.setTransform(...sourceToTile);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(decoded.source, 0, 0);
  context.restore();

  if (transform.preset === "adaptive-document") {
    if (!adaptivePlan) {
      throw new Error("Adaptive document tiles require a page-level tonal plan.");
    }
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    applyAdaptiveTonalPlan(
      imageData.data,
      canvas.width,
      canvas.height,
      adaptivePlan,
      false,
    );
    context.putImageData(imageData, 0, 0);
    return { polarityInverted: adaptivePlan.polarityInverted };
  }

  return applyPreparationToCanvas(
    context,
    canvas.width,
    canvas.height,
    transform.preset,
    1,
  );
}

export function clearCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  context?.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
}
