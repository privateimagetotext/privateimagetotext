import { deflateSync } from "node:zlib";

/** Minimal PNG writer for synthetic steganography-analysis test vectors. */

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export function pngChunk(type: string, data: Uint8Array = new Uint8Array()) {
  const out = new Uint8Array(12 + data.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.byteLength);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.byteLength, crc(out.subarray(4, 8 + data.byteLength)));
  return out;
}

export function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export type RawPngOptions = {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colourType: number;
  readonly interlace?: number;
  /** Already-filtered scanlines (each starting with its filter byte). */
  readonly raw: Uint8Array;
  readonly before?: readonly Uint8Array[];
  readonly after?: Uint8Array;
};

export function encodeRawPng(options: RawPngOptions) {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, options.width);
  view.setUint32(4, options.height);
  header[8] = options.bitDepth;
  header[9] = options.colourType;
  header[12] = options.interlace ?? 0;
  return concat(
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    pngChunk("IHDR", header),
    ...(options.before ?? []),
    pngChunk("IDAT", new Uint8Array(deflateSync(options.raw))),
    pngChunk("IEND"),
    options.after ?? new Uint8Array(),
  );
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Filters 8-bit scanlines with one filter type (or cycles 0–4 when "mixed"). */
export function filterRows(rows: Uint8Array, rowsCount: number, stride: number, bpp: number, filter: number | "mixed") {
  const out = new Uint8Array(rowsCount * (stride + 1));
  for (let y = 0; y < rowsCount; y += 1) {
    const type = filter === "mixed" ? y % 5 : filter;
    out[y * (stride + 1)] = type;
    for (let x = 0; x < stride; x += 1) {
      const value = rows[y * stride + x];
      const left = x >= bpp ? rows[y * stride + x - bpp] : 0;
      const up = y > 0 ? rows[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? rows[(y - 1) * stride + x - bpp] : 0;
      const predicted = type === 1 ? left : type === 2 ? up : type === 3 ? (left + up) >> 1 : type === 4 ? paeth(left, up, upLeft) : 0;
      out[y * (stride + 1) + 1 + x] = (value - predicted) & 0xff;
    }
  }
  return out;
}

export function encodeRgbaPng(rgba: Uint8Array, width: number, height: number, options: { filter?: number | "mixed"; after?: Uint8Array } = {}) {
  return encodeRawPng({
    width,
    height,
    bitDepth: 8,
    colourType: 6,
    raw: filterRows(rgba, height, width * 4, 4, options.filter ?? 0),
    after: options.after,
  });
}

/** Writes `message` into the red-channel LSB of an RGBA buffer, MSB-first, row order. */
export function embedRedLsb(rgba: Uint8Array, message: Uint8Array) {
  let pixel = 0;
  for (const byte of message) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      rgba[pixel * 4] = (rgba[pixel * 4] & 0xfe) | ((byte >> bit) & 1);
      pixel += 1;
    }
  }
  return rgba;
}
