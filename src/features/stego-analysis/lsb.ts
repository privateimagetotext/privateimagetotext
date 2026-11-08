import { STEGO_ANALYSIS_LIMITS, StegoAnalysisError } from "./limits";
import type { ChannelKey } from "./planes";

/** rows = zsteg xy; rows-bottom-up = zsteg xY (BMP file order); columns = zsteg yx. */
export type Traversal = "rows" | "rows-bottom-up" | "columns";
const TRAVERSALS: readonly Traversal[] = ["rows", "rows-bottom-up", "columns"];
export type BitPacking = "msb-first" | "lsb-first";
export type ChannelOrder = "rgba" | "bgra" | "abgr";

/** Read order for each channel order; selected channels are read in this sequence. */
export const CHANNEL_ORDERS: Record<ChannelOrder, readonly ChannelKey[]> = {
  rgba: ["r", "g", "b", "a"],
  bgra: ["b", "g", "r", "a"],
  abgr: ["a", "b", "g", "r"],
};

export type LsbOptions = {
  /** Selected channels; they are read in `channelOrder` (R, G, B, A by default). */
  readonly channels: readonly ChannelKey[];
  readonly channelOrder?: ChannelOrder;
  /** Bit positions 0–7, read from the highest selected bit to the lowest. */
  readonly bits: readonly number[];
  readonly traversal: Traversal;
  readonly packing: BitPacking;
};

export type LsbResult = {
  readonly bytes: Uint8Array;
  readonly totalBits: number;
  readonly truncated: boolean;
};

const CHANNEL_INDEX: Record<ChannelKey, number> = { r: 0, g: 1, b: 2, a: 3 };

export function normaliseLsbOptions(options: LsbOptions): LsbOptions {
  const channelOrder = options.channelOrder ?? "rgba";
  if (!Object.hasOwn(CHANNEL_ORDERS, channelOrder)) {
    throw new StegoAnalysisError("invalid-options", "Choose a channel order.");
  }
  const channels = CHANNEL_ORDERS[channelOrder].filter((channel) => options.channels.includes(channel));
  const bits = [...new Set(options.bits)].filter((bit) => Number.isInteger(bit) && bit >= 0 && bit <= 7).sort((a, b) => b - a);
  if (!channels.length) throw new StegoAnalysisError("invalid-options", "Choose at least one channel.");
  if (!bits.length) throw new StegoAnalysisError("invalid-options", "Choose at least one bit position.");
  if (!TRAVERSALS.includes(options.traversal)) {
    throw new StegoAnalysisError("invalid-options", "Choose a pixel order.");
  }
  if (options.packing !== "msb-first" && options.packing !== "lsb-first") {
    throw new StegoAnalysisError("invalid-options", "Choose a bit packing order.");
  }
  return { channels, channelOrder, bits, traversal: options.traversal, packing: options.packing };
}

/**
 * Reads the selected bits from every pixel and packs them into bytes.
 * A final partial byte is dropped. Output is capped at maxBytes.
 */
export function extractLsb(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  rawOptions: LsbOptions,
  maxBytes: number = STEGO_ANALYSIS_LIMITS.maxExtractBytes,
): LsbResult {
  const options = normaliseLsbOptions(rawOptions);
  const offsets = options.channels.map((channel) => CHANNEL_INDEX[channel]);
  const bits = options.bits;
  const bitsPerPixel = offsets.length * bits.length;
  const totalBits = width * height * bitsPerPixel;
  const fullBytes = Math.floor(totalBits / 8);
  const outputLength = Math.min(fullBytes, maxBytes);
  const output = new Uint8Array(outputLength);
  const msbFirst = options.packing === "msb-first";
  let byte = 0;
  let bitCount = 0;
  let written = 0;
  const byColumns = options.traversal === "columns";
  const bottomUp = options.traversal === "rows-bottom-up";
  const outer = byColumns ? width : height;
  const inner = byColumns ? height : width;
  outerLoop: for (let a = 0; a < outer; a += 1) {
    const row = bottomUp ? height - 1 - a : a;
    for (let b = 0; b < inner; b += 1) {
      const pixel = byColumns ? (b * width + a) * 4 : (row * width + b) * 4;
      for (const offset of offsets) {
        const value = rgba[pixel + offset];
        for (const bit of bits) {
          const bitValue = (value >> bit) & 1;
          byte = msbFirst ? (byte << 1) | bitValue : byte | (bitValue << bitCount);
          bitCount += 1;
          if (bitCount === 8) {
            output[written] = byte & 0xff;
            written += 1;
            byte = 0;
            bitCount = 0;
            if (written >= outputLength) break outerLoop;
          }
        }
      }
    }
  }
  return { bytes: output, totalBits, truncated: fullBytes > outputLength };
}
