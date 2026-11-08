import { HEADER_BITS, HEADER_BYTES } from "./constants";
import { validateRaster } from "./capacity";
import { CodecError } from "./results";
import { validatePermutation } from "./permutation";

export type HeaderRead = {
  readonly bytes: Uint8Array;
  readonly channels: Uint32Array;
};

function physicalToByteOffset(physicalIndex: number) {
  return Math.floor(physicalIndex / 3) * 4 + (physicalIndex % 3);
}
function eligiblePhysicalChannel(
  pixels: Uint8Array | Uint8ClampedArray,
  physicalIndex: number,
) {
  const pixelIndex = Math.floor(physicalIndex / 3);
  return pixels[pixelIndex * 4 + 3] === 255;
}

export function readSequentialHeader(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): HeaderRead | null {
  validateRaster(pixels, width, height);
  const domainSize = width * height * 3;
  const bytes = new Uint8Array(HEADER_BYTES);
  const channels = new Uint32Array(HEADER_BITS);
  let bitIndex = 0;
  for (
    let physicalIndex = 0;
    physicalIndex < domainSize && bitIndex < HEADER_BITS;
    physicalIndex += 1
  ) {
    if (!eligiblePhysicalChannel(pixels, physicalIndex)) continue;
    const offset = physicalToByteOffset(physicalIndex);
    const byteIndex = Math.floor(bitIndex / 8);
    const bitWithinByte = 7 - (bitIndex % 8);
    bytes[byteIndex] |= (pixels[offset] & 1) << bitWithinByte;
    channels[bitIndex] = physicalIndex;
    bitIndex += 1;
  }
  return bitIndex === HEADER_BITS ? { bytes, channels } : null;
}

export function writeSequentialHeader(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  header: Uint8Array,
) {
  validateRaster(pixels, width, height);
  if (header.byteLength !== HEADER_BYTES) {
    throw new CodecError("damaged");
  }
  const domainSize = width * height * 3;
  const channels = new Uint32Array(HEADER_BITS);
  let bitIndex = 0;
  for (
    let physicalIndex = 0;
    physicalIndex < domainSize && bitIndex < HEADER_BITS;
    physicalIndex += 1
  ) {
    if (!eligiblePhysicalChannel(pixels, physicalIndex)) continue;
    const offset = physicalToByteOffset(physicalIndex);
    const byteIndex = Math.floor(bitIndex / 8);
    const bitWithinByte = 7 - (bitIndex % 8);
    const bit = (header[byteIndex] >> bitWithinByte) & 1;
    pixels[offset] = (pixels[offset] & 0xfe) | bit;
    channels[bitIndex] = physicalIndex;
    bitIndex += 1;
  }
  if (bitIndex !== HEADER_BITS) {
    throw new CodecError("capacity-unavailable");
  }
  return channels;
}

function traversePayload(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  headerChannels: Uint32Array,
  start: number,
  step: number,
  bitLength: number,
  visit: (offset: number, bitIndex: number) => void,
) {
  validateRaster(pixels, width, height);
  const domainSize = width * height * 3;
  if (
    !validatePermutation(start, step, domainSize) ||
    !Number.isSafeInteger(bitLength) ||
    bitLength < 0
  ) {
    throw new CodecError("damaged");
  }
  const excluded = new Set<number>(headerChannels);
  let physicalIndex = start;
  let bitIndex = 0;
  for (let visited = 0; visited < domainSize && bitIndex < bitLength; visited += 1) {
    if (
      !excluded.has(physicalIndex) &&
      eligiblePhysicalChannel(pixels, physicalIndex)
    ) {
      visit(physicalToByteOffset(physicalIndex), bitIndex);
      bitIndex += 1;
    }
    physicalIndex = (physicalIndex + step) % domainSize;
  }
  if (bitIndex !== bitLength) {
    throw new CodecError("capacity-unavailable");
  }
}

export function writePayload(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  headerChannels: Uint32Array,
  start: number,
  step: number,
  payload: Uint8Array,
) {
  traversePayload(
    pixels,
    width,
    height,
    headerChannels,
    start,
    step,
    payload.byteLength * 8,
    (offset, bitIndex) => {
      const byteIndex = Math.floor(bitIndex / 8);
      const bitWithinByte = 7 - (bitIndex % 8);
      const bit = (payload[byteIndex] >> bitWithinByte) & 1;
      pixels[offset] = (pixels[offset] & 0xfe) | bit;
    },
  );
}

export function readPayload(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  headerChannels: Uint32Array,
  start: number,
  step: number,
  byteLength: number,
) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new CodecError("damaged");
  }
  const payload = new Uint8Array(byteLength);
  traversePayload(
    pixels,
    width,
    height,
    headerChannels,
    start,
    step,
    byteLength * 8,
    (offset, bitIndex) => {
      const byteIndex = Math.floor(bitIndex / 8);
      const bitWithinByte = 7 - (bitIndex % 8);
      payload[byteIndex] |= (pixels[offset] & 1) << bitWithinByte;
    },
  );
  return payload;
}
