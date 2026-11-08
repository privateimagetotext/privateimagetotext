import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { analyseFile, decodeImage, fileStrings, findTrailingData } from "../../src/features/stego-analysis/analyse";
import { hexRows, identifySignature, scanSignatures, scanStrings } from "../../src/features/stego-analysis/bytes";
import { parseJpegStructure } from "../../src/features/stego-analysis/jpeg";
import { StegoAnalysisError } from "../../src/features/stego-analysis/limits";
import { extractLsb } from "../../src/features/stego-analysis/lsb";
import { PLANE_DEFINITIONS, renderPlane } from "../../src/features/stego-analysis/planes";
import { crc32, decodePng, inflateBounded, parsePngStructure } from "../../src/features/stego-analysis/png";
import { concat, embedRedLsb, encodeRawPng, encodeRgbaPng, filterRows, pngChunk } from "../fixtures/stego-analysis/png-encoder";

const text = (value: string) => new TextEncoder().encode(value);

function patternRgba(width: number, height: number) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 1) rgba[i] = (i * 37 + (i >> 3) * 11) & 0xff;
  return rgba;
}

describe("PNG structure", () => {
  it("computes the standard CRC-32 check value", () => {
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
  });

  it("lists chunks, finds IEND and reports CRC mismatches without throwing", () => {
    const png = encodeRgbaPng(patternRgba(2, 2), 2, 2);
    const ok = parsePngStructure(png);
    expect(ok.chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(ok.endOffset).toBe(png.byteLength);
    expect(ok.crcMismatches).toBe(0);
    expect(ok.header).toMatchObject({ width: 2, height: 2, bitDepth: 8, colourType: 6, interlace: 0 });

    const damaged = png.slice();
    damaged[29] ^= 0xff; // IHDR CRC
    const report = parsePngStructure(damaged);
    expect(report.crcMismatches).toBe(1);
    expect(report.chunks[0]).toMatchObject({ type: "IHDR", crcOk: false });
  });

  it("stops at a chunk whose length exceeds the file", () => {
    const png = encodeRgbaPng(patternRgba(1, 1), 1, 1);
    const truncated = png.subarray(0, png.byteLength - 20);
    const report = parsePngStructure(truncated);
    expect(report.endOffset).toBeNull();
    expect(report.problems[0]).toMatch(/claims more bytes|Truncated/);
  });
});

describe("exact PNG decoder", () => {
  it.each([0, 1, 2, 3, 4, "mixed"] as const)("reverses filter %s exactly", async (filter) => {
    const rgba = patternRgba(7, 5);
    const decoded = await decodePng(encodeRgbaPng(rgba, 7, 5, { filter }));
    expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba));
  });

  it("keeps RGB values under fully transparent pixels (no premultiplication)", async () => {
    const rgba = Uint8Array.of(201, 13, 77, 0, 3, 2, 1, 1);
    const decoded = await decodePng(encodeRgbaPng(rgba, 2, 1));
    expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba));
  });

  it("decodes 1-bit greyscale with scaling and grey tRNS", async () => {
    // 10 pixels: 1011001110 then padding.
    const raw = Uint8Array.of(0, 0b10110011, 0b10000000);
    const png = encodeRawPng({ width: 10, height: 1, bitDepth: 1, colourType: 0, raw, before: [pngChunk("tRNS", Uint8Array.of(0, 0))] });
    const decoded = await decodePng(png);
    const greys = Array.from({ length: 10 }, (_, i) => decoded.rgba[i * 4]);
    const alphas = Array.from({ length: 10 }, (_, i) => decoded.rgba[i * 4 + 3]);
    expect(greys).toEqual([255, 0, 255, 255, 0, 0, 255, 255, 255, 0]);
    expect(alphas).toEqual(greys.map((grey) => (grey === 0 ? 0 : 255)));
  });

  it("decodes 2-bit palette images with tRNS alpha", async () => {
    const palette = Uint8Array.of(10, 20, 30, 40, 50, 60, 70, 80, 90);
    const raw = Uint8Array.of(0, 0b00011000);
    const png = encodeRawPng({
      width: 3, height: 1, bitDepth: 2, colourType: 3, raw,
      before: [pngChunk("PLTE", palette), pngChunk("tRNS", Uint8Array.of(255, 128))],
    });
    const decoded = await decodePng(png);
    expect(Array.from(decoded.rgba)).toEqual([10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 255]);
  });

  it("reduces 16-bit RGB samples to their high byte and notes it", async () => {
    const raw = Uint8Array.of(0, 0x12, 0x34, 0xab, 0xcd, 0x01, 0xff);
    const decoded = await decodePng(encodeRawPng({ width: 1, height: 1, bitDepth: 16, colourType: 2, raw }));
    expect(Array.from(decoded.rgba)).toEqual([0x12, 0xab, 0x01, 255]);
    expect(decoded.notes.join(" ")).toMatch(/high byte/);
  });

  it("shows palette colours, not palette-index bits (documented limitation)", async () => {
    // Indexes 0 and 1 both map to the same colour, so index LSB data is not visible.
    const palette = Uint8Array.of(9, 9, 9, 9, 9, 9);
    const decoded = await decodePng(encodeRawPng({
      width: 2, height: 1, bitDepth: 8, colourType: 3, raw: Uint8Array.of(0, 0, 1), before: [pngChunk("PLTE", palette)],
    }));
    expect(Array.from(decoded.rgba)).toEqual([9, 9, 9, 255, 9, 9, 9, 255]);
  });

  it("uses the low byte of 16-bit samples when asked", async () => {
    const raw = Uint8Array.of(0, 0x12, 0x34, 0xab, 0xcd, 0x01, 0xff);
    const decoded = await decodePng(encodeRawPng({ width: 1, height: 1, bitDepth: 16, colourType: 2, raw }), undefined, "low");
    expect(Array.from(decoded.rgba)).toEqual([0x34, 0xcd, 0xff, 255]);
    expect(decoded.notes.join(" ")).toMatch(/low byte/);
  });

  it("rejects image data too short for the dimensions before allocating", async () => {
    await expect(inflateBounded(new Uint8Array(10), 4096 * 4097 * 8)).rejects.toMatchObject({ code: "malformed-png" });
    await expect(inflateBounded([new Uint8Array(deflateSync(new Uint8Array(30)).subarray(0, 4)), new Uint8Array(deflateSync(new Uint8Array(30)).subarray(4))], 30))
      .resolves.toMatchObject({ extra: false });
  });

  it("decodes grey-alpha", async () => {
    const decoded = await decodePng(encodeRawPng({ width: 2, height: 1, bitDepth: 8, colourType: 4, raw: Uint8Array.of(0, 9, 200, 7, 3) }));
    expect(Array.from(decoded.rgba)).toEqual([9, 9, 9, 200, 7, 7, 7, 3]);
  });

  it("de-interlaces Adam7 images", async () => {
    const width = 9;
    const height = 9;
    const rgba = patternRgba(width, height);
    const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
    const parts: Uint8Array[] = [];
    for (const [x0, y0, dx, dy] of passes) {
      const pw = Math.ceil((width - x0) / dx);
      const ph = Math.ceil((height - y0) / dy);
      if (pw <= 0 || ph <= 0) continue;
      const rows = new Uint8Array(pw * ph * 4);
      for (let y = 0; y < ph; y += 1) {
        for (let x = 0; x < pw; x += 1) {
          const source = ((y0 + y * dy) * width + x0 + x * dx) * 4;
          rows.set(rgba.subarray(source, source + 4), (y * pw + x) * 4);
        }
      }
      parts.push(filterRows(rows, ph, pw * 4, 4, "mixed"));
    }
    const decoded = await decodePng(encodeRawPng({ width, height, bitDepth: 8, colourType: 6, interlace: 1, raw: concat(...parts) }));
    expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba));
  });

  it("still decodes when a CRC is wrong (a common CTF corruption)", async () => {
    const rgba = patternRgba(3, 3);
    const png = encodeRgbaPng(rgba, 3, 3);
    png[png.byteLength - 5] ^= 1; // IEND CRC
    const decoded = await decodePng(png);
    expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba));
  });

  it("bounds decompression to the exact expected size", async () => {
    const bomb = new Uint8Array(1_000_000);
    const { bytes, extra } = await inflateBounded(new Uint8Array(deflateSync(bomb)), 5);
    expect(bytes.byteLength).toBe(5);
    expect(extra).toBe(true);
    const decoded = await decodePng(encodeRawPng({ width: 1, height: 1, bitDepth: 8, colourType: 0, raw: bomb }));
    expect(decoded.notes.join(" ")).toMatch(/more bytes than the image needs/);
  });

  it("rejects truncated image data, oversized dimensions and invalid depths", async () => {
    await expect(decodePng(encodeRawPng({ width: 4, height: 4, bitDepth: 8, colourType: 6, raw: new Uint8Array(10) })))
      .rejects.toMatchObject({ code: "malformed-png" });
    await expect(decodePng(encodeRawPng({ width: 5000, height: 1, bitDepth: 8, colourType: 0, raw: new Uint8Array(5001) })))
      .rejects.toMatchObject({ code: "dimensions-too-large" });
    await expect(decodePng(encodeRawPng({ width: 1, height: 1, bitDepth: 4, colourType: 2, raw: new Uint8Array(3) })))
      .rejects.toMatchObject({ code: "unsupported-png" });
  });

  it("rejects an unknown filter type", async () => {
    await expect(decodePng(encodeRawPng({ width: 1, height: 1, bitDepth: 8, colourType: 0, raw: Uint8Array.of(9, 1) })))
      .rejects.toThrow(/filter type 9/);
  });
});

describe("bit planes", () => {
  const rgba = new Uint8ClampedArray([0b10000001, 0b00000010, 0xff, 0x00, 0x00, 0x01, 0x80, 0xff]);

  it("defines 47 views including 32 single-bit planes", () => {
    expect(PLANE_DEFINITIONS).toHaveLength(47);
    expect(PLANE_DEFINITIONS.filter((plane) => plane.view.kind === "bit")).toHaveLength(32);
    expect(new Set(PLANE_DEFINITIONS.map((plane) => plane.id)).size).toBe(47);
  });

  it("renders a single bit as black or white", () => {
    expect(Array.from(renderPlane(rgba, { kind: "bit", channel: "r", bit: 0 }))).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
    expect(Array.from(renderPlane(rgba, { kind: "bit", channel: "r", bit: 7 }))).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
    expect(Array.from(renderPlane(rgba, { kind: "bit", channel: "g", bit: 1 }))).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
    expect(Array.from(renderPlane(rgba, { kind: "bit", channel: "a", bit: 0 }))).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it("renders combined RGB, inversion, opaque and channel views", () => {
    expect(Array.from(renderPlane(rgba, { kind: "rgb-bit", bit: 0 }))).toEqual([255, 0, 255, 255, 0, 255, 0, 255]);
    expect(Array.from(renderPlane(rgba, { kind: "inverted" }))).toEqual([126, 253, 0, 255, 255, 254, 127, 255]);
    expect(Array.from(renderPlane(rgba, { kind: "opaque" }))).toEqual([129, 2, 255, 255, 0, 1, 128, 255]);
    expect(Array.from(renderPlane(rgba, { kind: "channel", channel: "b" }))).toEqual([0, 0, 255, 255, 0, 0, 128, 255]);
    expect(Array.from(renderPlane(rgba, { kind: "channel", channel: "a" }))).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
    expect(Array.from(renderPlane(rgba, { kind: "normal" }))).toEqual(Array.from(rgba));
  });
});

describe("LSB extraction", () => {
  // 2×2 image: pixel values chosen so each bit is distinguishable.
  const rgba = new Uint8ClampedArray([
    1, 0, 1, 0, /* (0,0) */ 0, 1, 0, 1, /* (1,0) */
    1, 1, 0, 0, /* (0,1) */ 0, 0, 1, 1, /* (1,1) */
  ]);

  it("reads RGBA bit 0 in row order, MSB-first", () => {
    const result = extractLsb(rgba, 2, 2, { channels: ["r", "g", "b", "a"], bits: [0], traversal: "rows", packing: "msb-first" });
    expect(Array.from(result.bytes)).toEqual([0b10100101, 0b11000011]);
    expect(result.totalBits).toBe(16);
  });

  it("reads in column order", () => {
    const result = extractLsb(rgba, 2, 2, { channels: ["r", "g", "b", "a"], bits: [0], traversal: "columns", packing: "msb-first" });
    expect(Array.from(result.bytes)).toEqual([0b10101100, 0b01010011]);
  });

  it("packs LSB-first", () => {
    const result = extractLsb(rgba, 2, 2, { channels: ["r", "g", "b", "a"], bits: [0], traversal: "rows", packing: "lsb-first" });
    expect(Array.from(result.bytes)).toEqual([0b10100101, 0b11000011]);
    const asymmetric = extractLsb(new Uint8ClampedArray([1, 1, 1, 0, 0, 0, 0, 0]), 2, 1, { channels: ["r", "g", "b", "a"], bits: [0], traversal: "rows", packing: "lsb-first" });
    expect(Array.from(asymmetric.bytes)).toEqual([0b00000111]);
  });

  it("uses R, G, B, A order whatever order channels are given in, and drops a partial byte", () => {
    const pixels = new Uint8ClampedArray([1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0]);
    const result = extractLsb(pixels, 4, 1, { channels: ["b", "r"], bits: [0], traversal: "rows", packing: "msb-first" });
    expect(Array.from(result.bytes)).toEqual([0b10011100]);
    const partial = extractLsb(pixels, 4, 1, { channels: ["r"], bits: [0], traversal: "rows", packing: "msb-first" });
    expect(partial.bytes.byteLength).toBe(0);
    expect(partial.totalBits).toBe(4);
  });

  it("reads multiple bits from highest to lowest", () => {
    const pixels = new Uint8ClampedArray([0b10, 0, 0, 0, 0b01, 0, 0, 0, 0b11, 0, 0, 0, 0b00, 0, 0, 0]);
    const result = extractLsb(pixels, 4, 1, { channels: ["r"], bits: [0, 1], traversal: "rows", packing: "msb-first" });
    expect(Array.from(result.bytes)).toEqual([0b10011100]);
  });

  it("recovers a red-LSB message from a PNG decoded exactly", async () => {
    const width = 16;
    const height = 8;
    const rgba = embedRedLsb(patternRgba(width, height), text("CTF{planes}"));
    const decoded = await decodePng(encodeRgbaPng(rgba, width, height, { filter: "mixed" }));
    const result = extractLsb(decoded.rgba, width, height, { channels: ["r"], bits: [0], traversal: "rows", packing: "msb-first" });
    expect(new TextDecoder().decode(result.bytes.subarray(0, 11))).toBe("CTF{planes}");
  });

  it("caps output and validates options", () => {
    const pixels = new Uint8ClampedArray(64 * 4);
    const result = extractLsb(pixels, 8, 8, { channels: ["r", "g", "b", "a"], bits: [0], traversal: "rows", packing: "msb-first" }, 3);
    expect(result.bytes.byteLength).toBe(3);
    expect(result.truncated).toBe(true);
    expect(() => extractLsb(pixels, 8, 8, { channels: [], bits: [0], traversal: "rows", packing: "msb-first" })).toThrow(StegoAnalysisError);
    expect(() => extractLsb(pixels, 8, 8, { channels: ["r"], bits: [9], traversal: "rows", packing: "msb-first" })).toThrow(/bit position/);
  });
});

describe("raw byte analysis", () => {
  it("finds printable strings with offsets and limits the list", () => {
    const bytes = concat(Uint8Array.of(0, 1), text("flag{abc}"), Uint8Array.of(0), text("ab"), Uint8Array.of(0xff), text("tail"));
    const scan = scanStrings(bytes, 4, 10);
    expect(scan.strings).toEqual([{ offset: 2, text: "flag{abc}" }, { offset: 15, text: "tail" }]);
    expect(scanStrings(bytes, 4, 1)).toMatchObject({ total: 2, truncated: true });
    expect(fileStrings(bytes, 1).strings.map((item) => item.text)).toEqual(["flag{abc}", "tail"]);
  });

  it("identifies and scans embedded signatures", () => {
    const bytes = concat(text("xxPK"), Uint8Array.of(3, 4), text("%PDF-1.7"));
    expect(identifySignature(bytes, 2)).toBe("ZIP local file header");
    expect(scanSignatures(bytes, 10).matches).toEqual([
      { offset: 2, name: "ZIP local file header" },
      { offset: 6, name: "PDF document" },
    ]);
  });

  it("formats hex rows", () => {
    expect(hexRows(text("AB\n"), 16)).toEqual([{ offset: 0, hex: "41 42 0a", ascii: "AB." }]);
  });
});

describe("trailing data", () => {
  const zip = concat(Uint8Array.of(0x50, 0x4b, 0x03, 0x04), text("secret.txt"));

  it("finds bytes after PNG IEND and identifies a ZIP", async () => {
    const png = encodeRgbaPng(patternRgba(2, 2), 2, 2, { after: zip });
    const report = await analyseFile(png);
    expect(report.kind).toBe("png");
    expect(report.trailing).toMatchObject({ offset: png.byteLength - zip.byteLength, length: zip.byteLength, signature: "ZIP local file header" });
    expect(report.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.signatures.matches.some((match) => match.name === "ZIP local file header")).toBe(true);
  });

  it("reports no trailing data for a clean PNG", async () => {
    const report = await analyseFile(encodeRgbaPng(patternRgba(2, 2), 2, 2));
    expect(report.trailing).toBeNull();
    expect(findTrailingData(new Uint8Array(4), null)).toBeNull();
  });

  it("skips APP1 thumbnails, stuffed bytes and restart markers before EOI", () => {
    const thumbnail = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);
    const app1 = concat(Uint8Array.of(0xff, 0xe1, 0, 2 + thumbnail.byteLength), thumbnail);
    const sof = Uint8Array.of(0xff, 0xc0, 0, 11, 8, 0, 16, 0, 32, 1, 1, 0x11, 0);
    const sos = Uint8Array.of(0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0);
    const entropy = Uint8Array.of(0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56);
    const jpeg = concat(Uint8Array.of(0xff, 0xd8), app1, sof, sos, entropy, Uint8Array.of(0xff, 0xd9));
    const withTail = concat(jpeg, text("hidden after EOI"));
    const structure = parseJpegStructure(withTail);
    expect(structure.endOffset).toBe(jpeg.byteLength);
    expect(structure).toMatchObject({ width: 32, height: 16 });
    expect(structure.markers.map((marker) => marker.name)).toEqual(["SOI", "APP1", "SOF0 baseline", "SOS", "EOI"]);
  });

  it("handles progressive multi-scan JPEGs", () => {
    const scan = Uint8Array.of(0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0xaa, 0xbb);
    const jpeg = concat(Uint8Array.of(0xff, 0xd8), Uint8Array.of(0xff, 0xc2, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0), scan, Uint8Array.of(0xff, 0xc4, 0, 2), scan, Uint8Array.of(0xff, 0xd9));
    expect(parseJpegStructure(jpeg).endOffset).toBe(jpeg.byteLength);
  });

  it("finds trailing bytes after a real JPEG", async () => {
    const jpeg = new Uint8Array(await readFile("tests/fixtures/jpeg-v2/libjpeg-testorig.jpg"));
    const clean = await analyseFile(jpeg);
    expect(clean.kind).toBe("jpeg");
    expect(clean.trailing).toBeNull();
    const report = await analyseFile(concat(jpeg, zip));
    expect(report.trailing).toMatchObject({ offset: jpeg.byteLength, length: zip.byteLength, signature: "ZIP local file header" });
  });

  it("reports an unterminated JPEG without inventing trailing data", () => {
    const structure = parseJpegStructure(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 40));
    expect(structure.endOffset).toBeNull();
    expect(structure.problems.length).toBeGreaterThan(0);
  });
});

describe("file analysis bounds", () => {
  it("rejects empty files and accepts non-images for raw analysis", async () => {
    await expect(analyseFile(new Uint8Array())).rejects.toMatchObject({ code: "empty-file" });
    const report = await analyseFile(text("just some text file"));
    expect(report.kind).toBeNull();
    await expect(decodeImage(text("x"), null)).rejects.toMatchObject({ code: "no-image" });
  });

  it("reports transparency and the exact decoder for PNG", async () => {
    const { report } = await decodeImage(encodeRgbaPng(Uint8Array.of(1, 2, 3, 0), 1, 1), "png");
    expect(report).toMatchObject({ decoder: "exact-png", hasTransparency: true, width: 1, height: 1 });
  });
});

/**
 * Reference embedder written from zsteg's ColorExtractor semantics
 * (zed-0xff/zsteg lib/zsteg/extractor/color_extractor.rb, checked 6 Nov 2026):
 * - `bN` reads bit indexes [N-1, …, 0] from each channel, highest first;
 * - channels are read in the order named (for example `rgb` or `bgr`);
 * - `xy` iterates x fastest (rows), `yx` iterates y fastest (columns);
 * - with zsteg's default `lsb` bit order the first stream bit becomes the byte's
 *   most significant bit; with `msb` it becomes the least significant bit.
 */
function zstegEmbed(
  rgba: Uint8Array, width: number, height: number,
  spec: { bits: number; channels: string; order: "xy" | "xY" | "yx"; bitOrder: "lsb" | "msb" },
  message: Uint8Array,
) {
  const stream: number[] = [];
  for (const byte of message) {
    for (let i = 0; i < 8; i += 1) stream.push(spec.bitOrder === "lsb" ? (byte >> (7 - i)) & 1 : (byte >> i) & 1);
  }
  const indexes = Array.from({ length: spec.bits }, (_, i) => spec.bits - 1 - i);
  const offset: Record<string, number> = { r: 0, g: 1, b: 2, a: 3 };
  let cursor = 0;
  const byColumns = spec.order === "yx";
  const outer = byColumns ? width : height;
  const inner = byColumns ? height : width;
  for (let a = 0; a < outer && cursor < stream.length; a += 1) {
    const row = spec.order === "xY" ? height - 1 - a : a;
    for (let b = 0; b < inner && cursor < stream.length; b += 1) {
      const pixel = byColumns ? (b * width + a) * 4 : (row * width + b) * 4;
      for (const channel of spec.channels) {
        for (const index of indexes) {
          if (cursor >= stream.length) break;
          const at = pixel + offset[channel];
          rgba[at] = (rgba[at] & ~(1 << index)) | (stream[cursor] << index);
          cursor += 1;
        }
      }
    }
  }
  if (cursor < stream.length) throw new Error("message does not fit");
  return rgba;
}

describe("LSB extraction matches zsteg conventions", () => {
  const message = new TextEncoder().encode("CTF{zsteg-compatible-0123456789}");
  const cases = [] as { bits: number; channels: string; order: "xy" | "xY" | "yx"; bitOrder: "lsb" | "msb" }[];
  for (const channels of ["r", "g", "b", "rgb", "bgr", "rgba", "bgra", "abgr"]) {
    for (const bits of [1, 2, 3]) {
      for (const order of ["xy", "xY", "yx"] as const) {
        for (const bitOrder of ["lsb", "msb"] as const) cases.push({ bits, channels, order, bitOrder });
      }
    }
  }

  it.each(cases)("b$bits,$channels,$bitOrder,$order", async (spec) => {
    const width = 37;
    const height = 23;
    const rgba = embedRedLsb(patternRgba(width, height), new Uint8Array()); // arbitrary cover
    zstegEmbed(rgba, width, height, spec, message);
    // Round-trip through an encoded, filtered PNG and the exact decoder.
    const decoded = await decodePng(encodeRgbaPng(rgba, width, height, { filter: "mixed" }));
    const result = extractLsb(decoded.rgba, width, height, {
      channels: spec.channels.split("") as ("r" | "g" | "b" | "a")[],
      channelOrder: spec.channels.length === 1 ? "rgba" : spec.channels.startsWith("a") ? "abgr" : spec.channels.startsWith("b") ? "bgra" : "rgba",
      bits: Array.from({ length: spec.bits }, (_, i) => i),
      traversal: spec.order === "xy" ? "rows" : spec.order === "xY" ? "rows-bottom-up" : "columns",
      packing: spec.bitOrder === "lsb" ? "msb-first" : "lsb-first",
    });
    expect(new TextDecoder().decode(result.bytes.subarray(0, message.byteLength))).toBe("CTF{zsteg-compatible-0123456789}");
  });

  it("finds data drawn in one specific bit plane", () => {
    const width = 16;
    const height = 8;
    const rgba = new Uint8ClampedArray(patternRgba(width, height));
    // Clear blue bit 5 everywhere, then set it only inside a 4×4 square.
    for (let i = 0; i < rgba.length; i += 4) rgba[i + 2] &= ~(1 << 5);
    for (let y = 2; y < 6; y += 1) for (let x = 4; x < 8; x += 1) rgba[(y * width + x) * 4 + 2] |= 1 << 5;
    const plane = renderPlane(rgba, { kind: "bit", channel: "b", bit: 5 });
    const white = [] as string[];
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (plane[(y * width + x) * 4] === 255) white.push(`${x},${y}`);
    expect(white).toHaveLength(16);
    expect(white[0]).toBe("4,2");
    expect(white.at(-1)).toBe("7,5");
  });
});

describe("committed CTF-style fixtures", () => {
  const dir = "tests/fixtures/stego-analysis/";
  const load = async (name: string) => new Uint8Array(await readFile(`${dir}${name}`));
  const lsbCases = [
    ["lsb-rgb-rows.png", { channels: ["r", "g", "b"], channelOrder: "rgba", bits: [0], traversal: "rows", packing: "msb-first" }, "flag{rgb_rows_msb_first}"],
    ["lsb-bgr-columns-lsb-first.png", { channels: ["r", "g", "b"], channelOrder: "bgra", bits: [0], traversal: "columns", packing: "lsb-first" }, "flag{bgr_columns_lsb_first}"],
    ["lsb-green-two-bits.png", { channels: ["g"], bits: [0, 1], traversal: "rows", packing: "msb-first" }, "flag{green_bits_1_and_0}"],
    ["lsb-abgr-bottom-up.png", { channels: ["r", "g", "b", "a"], channelOrder: "abgr", bits: [0], traversal: "rows-bottom-up", packing: "msb-first" }, "flag{abgr_from_the_bottom}"],
  ] as const;

  it("lsb-16bit-low-byte.png hides its flag in the low byte only", async () => {
    const bytes = await load("lsb-16bit-low-byte.png");
    const options = { channels: ["r", "g", "b"], bits: [0], traversal: "rows", packing: "msb-first" } as const;
    const read = async (byte: "high" | "low") => {
      const decoded = await decodePng(bytes, undefined, byte);
      return new TextDecoder("latin1").decode(extractLsb(decoded.rgba, decoded.width, decoded.height, options).bytes.subarray(0, 21));
    };
    expect(await read("low")).toBe("flag{sixteen_bit_lsb}");
    expect(await read("high")).not.toBe("flag{sixteen_bit_lsb}");
  });

  it.each(lsbCases)("%s reveals its flag with the documented settings only", async (name, options, flag) => {
    const decoded = await decodePng(await load(name));
    const read = (opts: Parameters<typeof extractLsb>[3]) =>
      new TextDecoder("latin1").decode(extractLsb(decoded.rgba, decoded.width, decoded.height, opts).bytes.subarray(0, flag.length));
    expect(read(options)).toBe(flag);
    // Flipping the packing order must not reveal it.
    expect(read({ ...options, packing: options.packing === "msb-first" ? "lsb-first" : "msb-first" })).not.toBe(flag);
  });

  it("trailing-zip.png carries a ZIP after IEND", async () => {
    const report = await analyseFile(await load("trailing-zip.png"));
    expect(report.trailing).toMatchObject({ signature: "ZIP local file header" });
    expect(fileStrings(await load("trailing-zip.png"), 6).strings.map((item) => item.text)).toContain("flag.txtflag{zip_after_iend}");
  });

  it("trailing-text.jpg carries text after EOI", async () => {
    const bytes = await load("trailing-text.jpg");
    const report = await analyseFile(bytes);
    expect(report.trailing?.length).toBe("flag{text_after_eoi}".length);
    expect(new TextDecoder().decode(bytes.subarray(report.trailing!.offset))).toBe("flag{text_after_eoi}");
  });
});
