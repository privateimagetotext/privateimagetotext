import { validateDecodedRasterDimensions } from "./inspection";
import {
  RasterValidationError,
  type RasterDimensions,
  type RasterKind,
} from "./types";

export type DecodedRaster = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

function decodeFailure(): RasterValidationError {
  return new RasterValidationError(
    "decode-failed",
    "The browser could not decode this image.",
  );
}

async function decodeWithoutValidation(file: Blob): Promise<DecodedRaster> {
  if (typeof globalThis.createImageBitmap === "function") {
    try {
      const bitmap = await globalThis.createImageBitmap(file);
      let closed = false;
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => {
          if (closed) return;
          closed = true;
          bitmap.close();
        },
      };
    } catch {
      throw decodeFailure();
    }
  }

  if (
    typeof document === "undefined" ||
    typeof Image === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    throw decodeFailure();
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(decodeFailure()), {
        once: true,
      });
      image.src = objectUrl;
    });
  } catch {
    URL.revokeObjectURL(objectUrl);
    throw decodeFailure();
  }

  let closed = false;
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => {
      if (closed) return;
      closed = true;
      image.removeAttribute("src");
      URL.revokeObjectURL(objectUrl);
    },
  };
}

export async function decodeRasterWithoutResizing(
  file: Blob,
  kind: RasterKind,
  headerDimensions: RasterDimensions,
): Promise<DecodedRaster> {
  const decoded = await decodeWithoutValidation(file);
  const mismatch = validateDecodedRasterDimensions(kind, headerDimensions, {
    width: decoded.width,
    height: decoded.height,
  });
  if (mismatch) {
    decoded.close();
    throw new RasterValidationError(mismatch.code, mismatch.message);
  }
  return decoded;
}
