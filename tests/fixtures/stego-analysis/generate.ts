/**
 * Regenerates the CTF-style fixtures in this folder. Deterministic: run with
 *   node --experimental-strip-types tests/fixtures/stego-analysis/generate.ts
 * Every flag and the setting that reveals it are listed in README.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
// Node's type stripping needs the explicit .ts path; TypeScript sees the types.
const encoderPath = "./png-encoder.ts";
const { concat, encodeRawPng, encodeRgbaPng, filterRows } = (await import(encoderPath)) as typeof import("./png-encoder");
const text = (value: string) => new TextEncoder().encode(value);

function cover(width: number, height: number) {
  const rgba = new Uint8Array(width * height * 4);
  let seed = 0x2f6b1c3d;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const i = (y * width + x) * 4;
      rgba[i] = (x * 3 + (seed >>> 28)) & 0xff;
      rgba[i + 1] = (y * 4 + ((seed >>> 24) & 7)) & 0xff;
      rgba[i + 2] = ((x + y) * 2 + ((seed >>> 20) & 7)) & 0xff;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

type Spec = { channels: string; bits: number; order: "xy" | "xY" | "yx"; firstBitIsMsb: boolean };

/** Writes `message` the way zsteg reads it (see tests/unit/stego-analysis.test.ts). */
function embed(rgba: Uint8Array, width: number, height: number, spec: Spec, message: Uint8Array) {
  const stream: number[] = [];
  for (const byte of message) for (let i = 0; i < 8; i += 1) stream.push(spec.firstBitIsMsb ? (byte >> (7 - i)) & 1 : (byte >> i) & 1);
  const offset: Record<string, number> = { r: 0, g: 1, b: 2, a: 3 };
  const indexes = Array.from({ length: spec.bits }, (_, i) => spec.bits - 1 - i);
  let cursor = 0;
  const byColumns = spec.order === "yx";
  const outer = byColumns ? width : height;
  const inner = byColumns ? height : width;
  for (let a = 0; a < outer && cursor < stream.length; a += 1) {
    const row = spec.order === "xY" ? height - 1 - a : a;
    for (let b = 0; b < inner && cursor < stream.length; b += 1) {
      const pixel = byColumns ? (b * width + a) * 4 : (row * width + b) * 4;
      for (const channel of spec.channels) for (const index of indexes) {
        if (cursor >= stream.length) break;
        const at = pixel + offset[channel];
        rgba[at] = (rgba[at] & ~(1 << index)) | (stream[cursor] << index);
        cursor += 1;
      }
    }
  }
  return rgba;
}

// 3×5 pixel font for the plane fixture.
const FONT: Record<string, string[]> = {
  F: ["111", "100", "110", "100", "100"], L: ["100", "100", "100", "100", "111"],
  A: ["010", "101", "111", "101", "101"], G: ["011", "100", "101", "101", "011"],
};

function drawInPlane(rgba: Uint8Array, width: number, channel: number, bit: number, word: string, scale: number, x0: number, y0: number) {
  for (let i = 0; i < rgba.length; i += 4) rgba[i + channel] &= ~(1 << bit);
  [...word].forEach((letter, n) => FONT[letter].forEach((row, y) => [...row].forEach((on, x) => {
    if (on !== "1") return;
    for (let dy = 0; dy < scale; dy += 1) for (let dx = 0; dx < scale; dx += 1) {
      const px = x0 + (n * 4 + x) * scale + dx;
      const py = y0 + y * scale + dy;
      rgba[(py * width + px) * 4 + channel] |= 1 << bit;
    }
  })));
  return rgba;
}

let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array) {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A minimal, valid stored (uncompressed) ZIP with one file. */
function storedZip(name: string, content: Uint8Array) {
  const nameBytes = text(name);
  const crc = crc32(content);
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true); local.setUint16(4, 10, true);
  local.setUint32(14, crc, true); local.setUint32(18, content.length, true); local.setUint32(22, content.length, true);
  local.setUint16(26, nameBytes.length, true);
  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 10, true);
  central.setUint32(16, crc, true); central.setUint32(20, content.length, true); central.setUint32(24, content.length, true);
  central.setUint16(28, nameBytes.length, true);
  const localSize = 30 + nameBytes.length + content.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true);
  end.setUint32(12, 46 + nameBytes.length, true); end.setUint32(16, localSize, true);
  return concat(new Uint8Array(local.buffer), nameBytes, content, new Uint8Array(central.buffer), nameBytes, new Uint8Array(end.buffer));
}

const W = 96;
const H = 64;
const out = (name: string, bytes: Uint8Array) => writeFileSync(join(here, name), bytes);

out("lsb-rgb-rows.png", encodeRgbaPng(embed(cover(W, H), W, H, { channels: "rgb", bits: 1, order: "xy", firstBitIsMsb: true }, text("flag{rgb_rows_msb_first}")), W, H, { filter: "mixed" }));
out("lsb-bgr-columns-lsb-first.png", encodeRgbaPng(embed(cover(W, H), W, H, { channels: "bgr", bits: 1, order: "yx", firstBitIsMsb: false }, text("flag{bgr_columns_lsb_first}")), W, H, { filter: "mixed" }));
out("lsb-green-two-bits.png", encodeRgbaPng(embed(cover(W, H), W, H, { channels: "g", bits: 2, order: "xy", firstBitIsMsb: true }, text("flag{green_bits_1_and_0}")), W, H, { filter: "mixed" }));
{
  // Alpha varies but stays opaque enough to see; ABGR, read from the bottom row.
  const rgba = cover(W, H);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 200 + ((i >> 2) % 56);
  out("lsb-abgr-bottom-up.png", encodeRgbaPng(embed(rgba, W, H, { channels: "abgr", bits: 1, order: "xY", firstBitIsMsb: true }, text("flag{abgr_from_the_bottom}")), W, H, { filter: "mixed" }));
}
{
  // 16-bit RGB: the flag lives in bit 0 of each sample's low byte (zsteg's b1,rgb,lsb,xy).
  const rgb8 = cover(W, H);
  const lowBytes = embed(cover(W, H).map((value) => value ^ 0x5a), W, H, { channels: "rgb", bits: 1, order: "xy", firstBitIsMsb: true }, text("flag{sixteen_bit_lsb}"));
  const rows = new Uint8Array(W * H * 6);
  for (let p = 0; p < W * H; p += 1) for (let c = 0; c < 3; c += 1) {
    rows[p * 6 + c * 2] = rgb8[p * 4 + c];
    rows[p * 6 + c * 2 + 1] = lowBytes[p * 4 + c];
  }
  out("lsb-16bit-low-byte.png", encodeRawPng({ width: W, height: H, bitDepth: 16, colourType: 2, raw: filterRows(rows, H, W * 6, 6, "mixed") }));
}
out("plane-blue-5.png", encodeRgbaPng(drawInPlane(cover(W, H), W, 2, 5, "FLAG", 5, 8, 20), W, H, { filter: "mixed" }));
out("trailing-zip.png", encodeRgbaPng(cover(W, H), W, H, { filter: "mixed", after: storedZip("flag.txt", text("flag{zip_after_iend}\n")) }));
out("trailing-text.jpg", concat(new Uint8Array(readFileSync(join(here, "../jpeg-v2/libjpeg-testorig.jpg"))), text("flag{text_after_eoi}")));
