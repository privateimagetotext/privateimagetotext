import {
  AES_GCM_TAG_BYTES,
  HEADER_BITS,
  MAX_MESSAGE_BYTES,
} from "./constants";
import { CodecError } from "./results";

export type CarrierCapacity = {
  readonly format: "png-v1";
  readonly opaquePixelCount: number;
  readonly eligibleBits: number;
  readonly embeddedByteCapacity: number;
  readonly plainMessageCapacity: number;
  readonly encryptedMessageCapacity: number;
};

export function validateRaster(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new CodecError("damaged");
  }
  const pixelCount = width * height;
  if (
    !Number.isSafeInteger(pixelCount) ||
    pixelCount > Math.floor(Number.MAX_SAFE_INTEGER / 4) ||
    pixels.byteLength !== pixelCount * 4
  ) {
    throw new CodecError("damaged");
  }
  const physicalDomain = pixelCount * 3;
  if (!Number.isSafeInteger(physicalDomain) || physicalDomain > 0xffffffff) {
    throw new CodecError("damaged");
  }
}
export function analyseCapacity(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): CarrierCapacity {
  validateRaster(pixels, width, height);
  let opaquePixelCount = 0;
  for (let offset = 3; offset < pixels.byteLength; offset += 4) {
    if (pixels[offset] === 255) opaquePixelCount += 1;
  }
  const eligibleBits = opaquePixelCount * 3;
  const embeddedByteCapacity =
    eligibleBits < HEADER_BITS
      ? 0
      : Math.floor((eligibleBits - HEADER_BITS) / 8);
  return {
    format: "png-v1",
    opaquePixelCount,
    eligibleBits,
    embeddedByteCapacity,
    plainMessageCapacity: Math.min(
      MAX_MESSAGE_BYTES,
      embeddedByteCapacity,
    ),
    encryptedMessageCapacity: Math.min(
      MAX_MESSAGE_BYTES,
      Math.max(0, embeddedByteCapacity - AES_GCM_TAG_BYTES),
    ),
  };
}
