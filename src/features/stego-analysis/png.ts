import { STEGO_ANALYSIS_LIMITS, StegoAnalysisError } from "./limits";

export const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

export type PngChunkSummary = {
  readonly type: string;
  readonly offset: number;
  readonly length: number;
  readonly crcOk: boolean;
};

export type PngHeader = {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colourType: number;
  readonly interlace: number;
};

export type PngStructure = {
  readonly chunks: readonly PngChunkSummary[];
  readonly chunkCount: number;
  readonly crcMismatches: number;
  /** Offset just after the IEND chunk's CRC, or null if IEND was not reached. */
  readonly endOffset: number | null;
  readonly header: PngHeader | null;
  readonly problems: readonly string[];
};

/** Which byte of a 16-bit PNG sample becomes the 8-bit value that is shown and extracted. */
export type SixteenBitByte = "high" | "low";

export type DecodedImage = {
  readonly width: number;
  readonly height: number;
  /** Straight (not premultiplied) RGBA, 8 bits per sample. */
  readonly rgba: Uint8ClampedArray;
  readonly notes: readonly string[];
};

let crcTable: Uint32Array | null = null;

function table() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

export function crc32(bytes: Uint8Array, start = 0, end = bytes.byteLength) {
  const lookup = table();
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = lookup[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

export function hasPngSignature(bytes: Uint8Array) {
  if (bytes.byteLength < 8) return false;
  for (let index = 0; index < 8; index += 1) if (bytes[index] !== PNG_SIGNATURE[index]) return false;
  return true;
}

function chunkType(bytes: Uint8Array, offset: number) {
  let type = "";
  for (let index = 0; index < 4; index += 1) {
    const code = bytes[offset + index];
    type += code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : "?";
  }
  return type;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ALLOWED_DEPTHS: Record<number, readonly number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

function parseHeader(bytes: Uint8Array, offset: number, length: number, problems: string[]): PngHeader | null {
  if (length !== 13) {
    problems.push("IHDR has an unexpected length.");
    return null;
  }
  return {
    width: u32(bytes, offset),
    height: u32(bytes, offset + 4),
    bitDepth: bytes[offset + 8],
    colourType: bytes[offset + 9],
    interlace: bytes[offset + 12],
  };
}

/** Walks the chunk list without decompressing anything. Never throws for structure problems. */
export function parsePngStructure(bytes: Uint8Array): PngStructure {
  const chunks: PngChunkSummary[] = [];
  const problems: string[] = [];
  let header: PngHeader | null = null;
  let offset = 8;
  let chunkCount = 0;
  let crcMismatches = 0;
  let endOffset: number | null = null;
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) {
      problems.push(`Truncated chunk header at offset ${offset}.`);
      break;
    }
    const length = u32(bytes, offset);
    const type = chunkType(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (length > 0x7fffffff || dataEnd + 4 > bytes.byteLength) {
      problems.push(`Chunk ${type} at offset ${offset} claims more bytes than the file contains.`);
      break;
    }
    const crcOk = crc32(bytes, offset + 4, dataEnd) === u32(bytes, dataEnd);
    if (!crcOk) crcMismatches += 1;
    chunkCount += 1;
    if (chunks.length < STEGO_ANALYSIS_LIMITS.maxListedStructures) chunks.push({ type, offset, length, crcOk });
    if (chunkCount === 1) {
      if (type !== "IHDR") problems.push("The first chunk is not IHDR.");
      else header = parseHeader(bytes, dataStart, length, problems);
    }
    offset = dataEnd + 4;
    if (type === "IEND") {
      endOffset = offset;
      break;
    }
  }
  if (endOffset === null && !problems.length) problems.push("No IEND chunk was found.");
  return { chunks, chunkCount, crcMismatches, endOffset, header, problems };
}

function rowBytes(width: number, channels: number, bitDepth: number) {
  return Math.ceil((width * channels * bitDepth) / 8);
}

const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

type Pass = { x0: number; y0: number; dx: number; dy: number; width: number; height: number };

function passes(header: PngHeader): Pass[] {
  if (header.interlace === 0) {
    return [{ x0: 0, y0: 0, dx: 1, dy: 1, width: header.width, height: header.height }];
  }
  return ADAM7.map(([x0, y0, dx, dy]) => ({
    x0, y0, dx, dy,
    width: Math.max(0, Math.ceil((header.width - x0) / dx)),
    height: Math.max(0, Math.ceil((header.height - y0) / dy)),
  }));
}

export function expectedInflatedBytes(header: PngHeader) {
  const channels = CHANNELS[header.colourType];
  return passes(header).reduce((sum, pass) =>
    pass.width === 0 || pass.height === 0
      ? sum
      : sum + pass.height * (1 + rowBytes(pass.width, channels, header.bitDepth)), 0);
}

export function validatePngHeader(header: PngHeader) {
  const depths = ALLOWED_DEPTHS[header.colourType];
  if (!depths || !depths.includes(header.bitDepth)) {
    throw new StegoAnalysisError("unsupported-png", "The PNG colour type and bit depth combination is not valid.");
  }
  if (header.interlace !== 0 && header.interlace !== 1) {
    throw new StegoAnalysisError("unsupported-png", "The PNG uses an unknown interlace method.");
  }
  if (header.width === 0 || header.height === 0) {
    throw new StegoAnalysisError("malformed-png", "The PNG header has zero width or height.");
  }
  if (header.width > STEGO_ANALYSIS_LIMITS.maxWidth || header.height > STEGO_ANALYSIS_LIMITS.maxHeight) {
    throw new StegoAnalysisError(
      "dimensions-too-large",
      `Choose an image no larger than ${STEGO_ANALYSIS_LIMITS.maxWidth} by ${STEGO_ANALYSIS_LIMITS.maxHeight} pixels.`,
    );
  }
}

/** Compressed bytes fed to the decompressor per pull. Deflate expands at most ~1032:1. */
const INFLATE_INPUT_CHUNK = 4_096;

/**
 * Inflates zlib data into a buffer of exactly `expected` bytes. Input is fed in
 * small chunks only when the reader pulls, so a decompression bomb stops after
 * at most a few megabytes of surplus output instead of inflating completely.
 */
/** Deflate cannot expand input by more than about 1032:1, plus zlib framing. */
const MAX_DEFLATE_RATIO = 1032;

export async function inflateBounded(input: Uint8Array | readonly Uint8Array[], expected: number): Promise<{ bytes: Uint8Array; extra: boolean }> {
  const parts = input instanceof Uint8Array ? [input] : input;
  const compressedBytes = parts.reduce((sum, part) => sum + part.byteLength, 0);
  // Reject impossible sizes before allocating the output buffer.
  if (expected > compressedBytes * MAX_DEFLATE_RATIO + MAX_DEFLATE_RATIO) {
    throw new StegoAnalysisError("malformed-png", "The PNG image data is too short for its stated dimensions.");
  }
  const output = new Uint8Array(expected);
  let written = 0;
  let extra = false;
  let part = 0;
  let position = 0;
  // Feed each IDAT chunk in small slices, without concatenating them first.
  const source = new ReadableStream<Uint8Array>({
    pull(controller) {
      while (part < parts.length && position >= parts[part].byteLength) {
        part += 1;
        position = 0;
      }
      if (part >= parts.length) {
        controller.close();
        return;
      }
      const end = Math.min(parts[part].byteLength, position + INFLATE_INPUT_CHUNK);
      controller.enqueue(parts[part].slice(position, end));
      position = end;
    },
  }, { highWaterMark: 0 });
  const stream = source.pipeThrough(new DecompressionStream("deflate") as unknown as TransformStream<Uint8Array, Uint8Array>);
  const reader = stream.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const room = expected - written;
      if (value.byteLength > room) {
        output.set(value.subarray(0, room), written);
        written = expected;
        extra = true;
        break;
      }
      output.set(value, written);
      written += value.byteLength;
    }
  } catch {
    // A corrupt or truncated tail is tolerated when every expected byte arrived.
    if (written < expected) {
      throw new StegoAnalysisError("malformed-png", "The PNG image data could not be decompressed.");
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  if (written < expected) {
    throw new StegoAnalysisError("malformed-png", "The PNG image data ends before every row is present.");
  }
  return { bytes: output, extra };
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Reverses PNG row filters in place. Returns the offset after this pass. */
export function unfilter(data: Uint8Array, offset: number, rows: number, stride: number, bpp: number) {
  let previous = -1;
  for (let row = 0; row < rows; row += 1) {
    const filter = data[offset];
    const start = offset + 1;
    if (filter > 4) throw new StegoAnalysisError("malformed-png", `Unknown PNG filter type ${filter}.`);
    for (let index = 0; index < stride; index += 1) {
      const left = index >= bpp ? data[start + index - bpp] : 0;
      const up = previous >= 0 ? data[previous + index] : 0;
      const upLeft = previous >= 0 && index >= bpp ? data[previous + index - bpp] : 0;
      const value = data[start + index];
      switch (filter) {
        case 1: data[start + index] = (value + left) & 0xff; break;
        case 2: data[start + index] = (value + up) & 0xff; break;
        case 3: data[start + index] = (value + ((left + up) >> 1)) & 0xff; break;
        case 4: data[start + index] = (value + paeth(left, up, upLeft)) & 0xff; break;
        default: break;
      }
    }
    previous = start;
    offset = start + stride;
  }
  return offset;
}

type Ancillary = { palette: Uint8Array | null; transparency: Uint8Array | null };

function sampleReader(data: Uint8Array, rowStart: number, bitDepth: number) {
  return (sampleIndex: number) => {
    if (bitDepth === 8) return data[rowStart + sampleIndex];
    if (bitDepth === 16) return (data[rowStart + sampleIndex * 2] << 8) | data[rowStart + sampleIndex * 2 + 1];
    const bitOffset = sampleIndex * bitDepth;
    const byte = data[rowStart + (bitOffset >> 3)];
    const shift = 8 - bitDepth - (bitOffset & 7);
    return (byte >> shift) & ((1 << bitDepth) - 1);
  };
}

/** Decodes a PNG to exact straight-alpha RGBA8 without a canvas. */
export async function decodePng(
  bytes: Uint8Array,
  structure = parsePngStructure(bytes),
  sixteenBitByte: SixteenBitByte = "high",
): Promise<DecodedImage> {
  const header = structure.header;
  if (!header) throw new StegoAnalysisError("malformed-png", "The PNG has no readable IHDR chunk.");
  validatePngHeader(header);
  const notes: string[] = [];
  const ancillary: Ancillary = { palette: null, transparency: null };
  const idat: Uint8Array[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.byteLength) {
    const length = u32(bytes, offset);
    const type = chunkType(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (length > 0x7fffffff || dataEnd + 4 > bytes.byteLength) break;
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "IDAT") {
      idat.push(data);
    } else if (type === "PLTE") ancillary.palette = data;
    else if (type === "tRNS") ancillary.transparency = data;
    else if (type === "acTL") notes.push("Animated PNG: only the default image is shown.");
    offset = dataEnd + 4;
    if (type === "IEND") break;
  }
  if (!idat.length) throw new StegoAnalysisError("malformed-png", "The PNG has no IDAT image data.");
  if (header.colourType === 3 && !ancillary.palette) {
    throw new StegoAnalysisError("malformed-png", "The palette PNG has no PLTE chunk.");
  }
  const { bytes: raw, extra } = await inflateBounded(idat, expectedInflatedBytes(header));
  if (extra) notes.push("The compressed image data contains more bytes than the image needs; the extra bytes were ignored.");
  if (header.bitDepth === 16) {
    notes.push(sixteenBitByte === "high"
      ? "16-bit samples are shown and extracted using their high byte."
      : "16-bit samples are shown and extracted using their low byte, where least significant bits are stored.");
  }

  const { width, height, bitDepth, colourType } = header;
  const channels = CHANNELS[colourType];
  const bpp = Math.max(1, (channels * bitDepth) >> 3);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const maxSample = (1 << bitDepth) - 1;
  const scale = (value: number) => (bitDepth === 16 ? (sixteenBitByte === "high" ? value >> 8 : value & 0xff) : bitDepth === 8 ? value : Math.round((value * 255) / maxSample));
  const palette = ancillary.palette;
  const trns = ancillary.transparency;
  const greyKey = colourType === 0 && trns && trns.byteLength >= 2 ? (trns[0] << 8) | trns[1] : -1;
  const rgbKey = colourType === 2 && trns && trns.byteLength >= 6
    ? [(trns[0] << 8) | trns[1], (trns[2] << 8) | trns[3], (trns[4] << 8) | trns[5]]
    : null;
  let paletteOverflow = false;

  let cursor = 0;
  for (const pass of passes(header)) {
    if (pass.width === 0 || pass.height === 0) continue;
    const stride = rowBytes(pass.width, channels, bitDepth);
    const passStart = cursor;
    cursor = unfilter(raw, cursor, pass.height, stride, bpp);
    for (let row = 0; row < pass.height; row += 1) {
      const read = sampleReader(raw, passStart + row * (stride + 1) + 1, bitDepth);
      const y = pass.y0 + row * pass.dy;
      for (let column = 0; column < pass.width; column += 1) {
        const x = pass.x0 + column * pass.dx;
        const target = (y * width + x) * 4;
        const base = column * channels;
        let r: number, g: number, b: number, a = 255;
        if (colourType === 3) {
          const index = read(base);
          if (palette && index * 3 + 2 < palette.byteLength) {
            r = palette[index * 3];
            g = palette[index * 3 + 1];
            b = palette[index * 3 + 2];
          } else {
            r = g = b = 0;
            paletteOverflow = true;
          }
          if (trns && index < trns.byteLength) a = trns[index];
        } else if (colourType === 0 || colourType === 4) {
          const grey = read(base);
          r = g = b = scale(grey);
          if (colourType === 4) a = scale(read(base + 1));
          else if (grey === greyKey) a = 0;
        } else {
          const rr = read(base);
          const gg = read(base + 1);
          const bb = read(base + 2);
          r = scale(rr);
          g = scale(gg);
          b = scale(bb);
          if (colourType === 6) a = scale(read(base + 3));
          else if (rgbKey && rr === rgbKey[0] && gg === rgbKey[1] && bb === rgbKey[2]) a = 0;
        }
        rgba[target] = r;
        rgba[target + 1] = g;
        rgba[target + 2] = b;
        rgba[target + 3] = a;
      }
    }
  }
  raw.fill(0);
  if (paletteOverflow) notes.push("Some palette indexes point past the palette and are shown as black.");
  if (bitDepth < 8 && colourType !== 3) notes.push(`${bitDepth}-bit grey samples are scaled to 8 bits.`);
  return { width, height, rgba, notes };
}
