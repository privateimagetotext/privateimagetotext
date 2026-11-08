import { awaitWithAbort } from "./common";
import {
  cleanCopyCancelledError,
  CleanCopyError,
  throwIfCleanCopyAborted,
} from "./errors";
import type {
  CleanCopyDecodedImage,
  CleanCopyImageDecoder,
} from "./types";

function decodedBitmap(
  bitmap: ImageBitmap,
  signal?: AbortSignal,
): CleanCopyDecodedImage {
  if (signal?.aborted) {
    bitmap.close();
    throw cleanCopyCancelledError();
  }
  return {
    width: bitmap.width,
    height: bitmap.height,
    close: () => bitmap.close(),
  };
}

function decodeWithImageElement(
  blob: Blob,
  signal?: AbortSignal,
): Promise<CleanCopyDecodedImage> {
  if (
    typeof Image === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    throw new CleanCopyError(
      "verification-failed",
      "This browser cannot independently decode the generated image.",
    );
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    let settled = false;
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener("abort", onAbort);
      URL.revokeObjectURL(url);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      image.src = "";
      cleanup();
      reject(cleanCopyCancelledError());
    };
    image.onload = () => {
      if (settled) return;
      settled = true;
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      cleanup();
      if (signal?.aborted) {
        image.src = "";
        reject(cleanCopyCancelledError());
        return;
      }
      resolve({
        width,
        height,
        close: () => {
          image.src = "";
        },
      });
    };
    image.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new CleanCopyError(
          "verification-failed",
          "The generated image could not be decoded by the browser.",
        ),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else image.src = url;
  });
}

export const decodeCleanCopyInBrowser: CleanCopyImageDecoder = async (
  blob,
  signal,
) => {
  throwIfCleanCopyAborted(signal);
  if (typeof createImageBitmap === "function") {
    const pending = createImageBitmap(blob, {
      imageOrientation: "none",
      premultiplyAlpha: "default",
      colorSpaceConversion: "default",
    }).then((bitmap) => decodedBitmap(bitmap, signal));
    return awaitWithAbort(pending, signal);
  }
  return decodeWithImageElement(blob, signal);
};

export async function verifyDecodedCleanCopy(
  blob: Blob,
  expectedWidth: number,
  expectedHeight: number,
  decoder: CleanCopyImageDecoder,
  signal?: AbortSignal,
) {
  const pending = decoder(blob, signal).then((decoded) => {
    if (signal?.aborted) {
      decoded.close();
      throw cleanCopyCancelledError();
    }
    return decoded;
  });
  let decoded: CleanCopyDecodedImage;
  try {
    decoded = await awaitWithAbort(pending, signal);
  } catch (error) {
    if (error instanceof CleanCopyError) throw error;
    throw new CleanCopyError(
      "verification-failed",
      "The generated image could not be decoded by the browser.",
    );
  }
  try {
    throwIfCleanCopyAborted(signal);
    if (
      decoded.width !== expectedWidth ||
      decoded.height !== expectedHeight
    ) {
      throw new CleanCopyError(
        "verification-failed",
        "The decoded metadata-removed copy dimensions do not match the verified source.",
      );
    }
  } finally {
    decoded.close();
  }
}
