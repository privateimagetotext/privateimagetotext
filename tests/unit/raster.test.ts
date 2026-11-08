import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RASTER_LIMITS,
  RasterValidationError,
  declaredMimeMatches,
  decodeRasterWithoutResizing,
  detectRasterSignature,
  hasPngSignature,
  inspectRasterHeader,
  inspectRasterFile,
  parseBmpDimensions,
  parseJpegDimensions,
  parsePngDimensions,
  parseWebpDimensions,
  safeEncodedPngFilename,
  safeRevealedTextFilename,
  sanitiseSourceBase,
  validateDecodedRasterDimensions,
  validateGeneratedPng,
} from "../../src/features/raster";

const bidiControls = [
  "\u061c",
  "\u200e",
  "\u200f",
  "\u202a",
  "\u202b",
  "\u202c",
  "\u202d",
  "\u202e",
  "\u2066",
  "\u2067",
  "\u2068",
  "\u2069",
].map((control) => [
  control.codePointAt(0)!.toString(16).toUpperCase(),
  control,
] as const);

function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function ascii(value: string) {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function uint32BigEndian(value: number) {
  return Uint8Array.of(
    Math.floor(value / 0x1_000_000) & 0xff,
    Math.floor(value / 0x1_0000) & 0xff,
    Math.floor(value / 0x100) & 0xff,
    value & 0xff,
  );
}

function uint32LittleEndian(value: number) {
  return Uint8Array.of(
    value & 0xff,
    Math.floor(value / 0x100) & 0xff,
    Math.floor(value / 0x1_0000) & 0xff,
    Math.floor(value / 0x1_000_000) & 0xff,
  );
}

function pngChunk(type: string, data = new Uint8Array()) {
  return concat(
    uint32BigEndian(data.length),
    ascii(type),
    data,
    new Uint8Array(4),
  );
}

function pngBytes(
  width: number,
  height: number,
  options: { animated?: boolean } = {},
) {
  const ihdr = concat(
    uint32BigEndian(width),
    uint32BigEndian(height),
    Uint8Array.of(8, 6, 0, 0, 0),
  );
  return concat(
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    pngChunk("IHDR", ihdr),
    ...(options.animated
      ? [pngChunk("acTL", concat(uint32BigEndian(2), uint32BigEndian(0)))]
      : []),
    pngChunk("IDAT"),
    pngChunk("IEND"),
  );
}

function jpegBytes(width: number, height: number) {
  return Uint8Array.of(
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  );
}

function webpChunk(type: string, data: Uint8Array) {
  return concat(
    ascii(type),
    uint32LittleEndian(data.length),
    data,
    data.length % 2 === 0 ? new Uint8Array() : Uint8Array.of(0),
  );
}

function webpFile(...chunks: Uint8Array[]) {
  const body = concat(ascii("WEBP"), ...chunks);
  return concat(ascii("RIFF"), uint32LittleEndian(body.length), body);
}

function webpExtendedBytes(width: number, height: number, flags = 0) {
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  const data = Uint8Array.of(
    flags, 0, 0, 0,
    widthMinusOne & 0xff,
    (widthMinusOne >> 8) & 0xff,
    (widthMinusOne >> 16) & 0xff,
    heightMinusOne & 0xff,
    (heightMinusOne >> 8) & 0xff,
    (heightMinusOne >> 16) & 0xff,
  );
  return webpFile(webpChunk("VP8X", data));
}

function webpLossyBytes(width: number, height: number) {
  const data = Uint8Array.of(
    0, 0, 0,
    0x9d, 0x01, 0x2a,
    width & 0xff, (width >> 8) & 0x3f,
    height & 0xff, (height >> 8) & 0x3f,
  );
  return webpFile(webpChunk("VP8 ", data));
}

function webpLosslessBytes(width: number, height: number) {
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  const data = Uint8Array.of(
    0x2f,
    widthMinusOne & 0xff,
    ((widthMinusOne >> 8) & 0x3f) | ((heightMinusOne & 0x03) << 6),
    (heightMinusOne >> 2) & 0xff,
    (heightMinusOne >> 10) & 0x0f,
  );
  return webpFile(webpChunk("VP8L", data));
}

function bmpBytes(width: number, height: number, topDown = false) {
  const bytes = new Uint8Array(54);
  bytes.set(ascii("BM"), 0);
  bytes.set(uint32LittleEndian(bytes.length), 2);
  bytes.set(uint32LittleEndian(54), 10);
  bytes.set(uint32LittleEndian(40), 14);
  bytes.set(uint32LittleEndian(width), 18);
  const storedHeight = topDown ? 0x1_0000_0000 - height : height;
  bytes.set(uint32LittleEndian(storedHeight), 22);
  bytes[26] = 1;
  bytes[28] = 24;
  return bytes;
}

function imageFile(bytes: Uint8Array, type: string, name = "carrier") {
  const copy = new Uint8Array(bytes);
  return new File([copy.buffer], name, { type });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("raster signatures and MIME declarations", () => {
  it.each([
    ["png", pngBytes(2, 3)],
    ["jpeg", jpegBytes(2, 3)],
    ["webp", webpExtendedBytes(2, 3)],
    ["bmp", bmpBytes(2, 3)],
  ] as const)("detects the actual %s signature", (kind, bytes) => {
    expect(detectRasterSignature(bytes)).toBe(kind);
  });

  it("does not identify unsupported active or document formats", () => {
    expect(detectRasterSignature(ascii("<svg xmlns='http://www.w3.org/2000/svg'>"))).toBeNull();
    expect(detectRasterSignature(ascii("%PDF-1.7"))).toBeNull();
  });

  it("exposes a strict PNG signature check", () => {
    expect(hasPngSignature(pngBytes(1, 1))).toBe(true);
    expect(hasPngSignature(jpegBytes(1, 1))).toBe(false);
  });

  it("accepts empty and generic MIME types but rejects direct contradictions", () => {
    expect(declaredMimeMatches("png", "")).toBe(true);
    expect(declaredMimeMatches("png", "application/octet-stream")).toBe(true);
    expect(declaredMimeMatches("jpeg", "image/jpeg")).toBe(true);
    expect(declaredMimeMatches("png", "image/jpeg")).toBe(false);
    expect(declaredMimeMatches("png", "image/svg+xml")).toBe(false);
  });
});

describe("bounded dimension parsing", () => {
  it("reads PNG IHDR dimensions", () => {
    expect(parsePngDimensions(pngBytes(4_096, 2_048))).toEqual({
      width: 4_096,
      height: 2_048,
    });
  });

  it("walks JPEG segments to a supported SOF marker", () => {
    expect(parseJpegDimensions(jpegBytes(1_920, 1_080))).toEqual({
      width: 1_920,
      height: 1_080,
    });
  });

  it.each([
    [webpExtendedBytes(701, 503), { width: 701, height: 503 }],
    [webpLossyBytes(701, 503), { width: 701, height: 503 }],
    [webpLosslessBytes(701, 503), { width: 701, height: 503 }],
  ])("reads VP8X, VP8 and VP8L dimensions", (bytes, expected) => {
    expect(parseWebpDimensions(bytes)).toEqual(expected);
  });

  it("reads bottom-up and top-down BMP DIB dimensions", () => {
    expect(parseBmpDimensions(bmpBytes(800, 600))).toEqual({
      width: 800,
      height: 600,
    });
    expect(parseBmpDimensions(bmpBytes(800, 600, true))).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("rejects truncated or malformed headers before browser decode", () => {
    expect(() => parsePngDimensions(pngBytes(10, 10).slice(0, 20))).toThrow(
      RasterValidationError,
    );
    expect(() => parseJpegDimensions(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9))).toThrow(
      /no supported start-of-frame/i,
    );
    expect(() => parseWebpDimensions(webpFile(webpChunk("NOPE", new Uint8Array(10))))).toThrow(
      /no supported image header/i,
    );
  });
});

describe("policy-free raster header inspection", () => {
  it.each([
    ["PNG", pngBytes(6_000, 6_000), "png", { width: 6_000, height: 6_000 }],
    ["JPEG", jpegBytes(6_000, 6_000), "jpeg", { width: 6_000, height: 6_000 }],
    ["WebP", webpExtendedBytes(6_000, 6_000), "webp", { width: 6_000, height: 6_000 }],
    ["BMP", bmpBytes(6_000, 6_000), "bmp", { width: 6_000, height: 6_000 }],
  ] as const)(
    "reads %s dimensions without applying steganography policy",
    async (_label, bytes, kind, dimensions) => {
      await expect(inspectRasterHeader(imageFile(bytes, `image/${kind}`))).resolves.toEqual({
        kind,
        ...dimensions,
      });
    },
  );

  it("rejects a WebP whose declared RIFF length exceeds the file", async () => {
    const bytes = webpExtendedBytes(640, 480);
    bytes.set(uint32LittleEndian(bytes.length + 1_024), 4);

    await expect(inspectRasterHeader(imageFile(bytes, "image/webp"))).rejects.toMatchObject({
      code: "malformed-image",
    });
  });
});

describe("steganography raster inspection", () => {
  it.each([
    [pngBytes(640, 480), "image/png", "png"],
    [jpegBytes(640, 480), "image/jpeg", "jpeg"],
    [webpExtendedBytes(640, 480), "image/webp", "webp"],
    [bmpBytes(640, 480), "image/bmp", "bmp"],
  ] as const)("accepts supported hide carriers", async (bytes, type, kind) => {
    await expect(inspectRasterFile(imageFile(bytes, type), "hide")).resolves.toEqual({
      ok: true,
      kind,
      width: 640,
      height: 480,
    });
  });

  it("accepts a generic MIME type when the signature is valid", async () => {
    const result = await inspectRasterFile(
      imageFile(pngBytes(32, 24), "application/octet-stream"),
      "hide",
    );
    expect(result).toMatchObject({ ok: true, kind: "png" });
  });

  it("rejects a non-empty MIME declaration that contradicts the signature", async () => {
    await expect(
      inspectRasterFile(imageFile(pngBytes(32, 24), "image/jpeg"), "hide"),
    ).resolves.toMatchObject({ ok: false, code: "mime-mismatch" });
  });

  it("accepts PNG v1 and JPEG v2 signatures in Reveal mode", async () => {
    await expect(
      inspectRasterFile(imageFile(jpegBytes(32, 24), "image/jpeg"), "reveal"),
    ).resolves.toMatchObject({ ok: true, kind: "jpeg" });
    await expect(
      inspectRasterFile(imageFile(pngBytes(32, 24), "image/png"), "reveal"),
    ).resolves.toMatchObject({ ok: true, kind: "png" });
  });

  it("rejects animated PNG and WebP inputs", async () => {
    const animatedWebp = webpExtendedBytes(32, 24, 0x02);
    await expect(
      inspectRasterFile(imageFile(pngBytes(32, 24, { animated: true }), "image/png"), "hide"),
    ).resolves.toMatchObject({ ok: false, code: "animated-image" });
    await expect(
      inspectRasterFile(imageFile(animatedWebp, "image/webp"), "hide"),
    ).resolves.toMatchObject({ ok: false, code: "animated-image" });
  });

  it("also rejects an explicit WebP ANIM chunk", async () => {
    const extended = webpExtendedBytes(32, 24);
    const vp8xChunk = extended.slice(12);
    const animated = webpFile(vp8xChunk, webpChunk("ANIM", new Uint8Array(6)));
    await expect(
      inspectRasterFile(imageFile(animated, "image/webp"), "hide"),
    ).resolves.toMatchObject({ ok: false, code: "animated-image" });
  });

  it("uses separate 25 MiB Hide and 80 MiB Reveal limits", async () => {
    const file = imageFile(pngBytes(32, 24), "image/png");
    Object.defineProperty(file, "size", {
      configurable: true,
      value: RASTER_LIMITS.hideMaxBytes + 1,
    });
    await expect(inspectRasterFile(file, "hide")).resolves.toMatchObject({
      ok: false,
      code: "file-too-large",
    });
    await expect(inspectRasterFile(file, "reveal")).resolves.toMatchObject({
      ok: true,
      kind: "png",
    });
  });

  it("accepts 4096 per side and rejects either side above the limit", async () => {
    await expect(
      inspectRasterFile(imageFile(pngBytes(4_096, 4_096), "image/png"), "hide"),
    ).resolves.toMatchObject({ ok: true, width: 4_096, height: 4_096 });
    await expect(
      inspectRasterFile(imageFile(pngBytes(4_097, 10), "image/png"), "hide"),
    ).resolves.toMatchObject({ ok: false, code: "dimensions-too-large" });
    await expect(
      inspectRasterFile(imageFile(pngBytes(10, 4_097), "image/png"), "hide"),
    ).resolves.toMatchObject({ ok: false, code: "dimensions-too-large" });
  });
});

describe("decoded dimension verification and browser decode", () => {
  it("rejects suspicious mismatches but permits a JPEG orientation swap", () => {
    expect(
      validateDecodedRasterDimensions(
        "png",
        { width: 640, height: 480 },
        { width: 641, height: 480 },
      ),
    ).toMatchObject({ code: "dimension-mismatch" });
    expect(
      validateDecodedRasterDimensions(
        "jpeg",
        { width: 640, height: 480 },
        { width: 480, height: 640 },
      ),
    ).toBeNull();
  });

  it("decodes with no resize options and exposes explicit cleanup", async () => {
    const close = vi.fn();
    const createImageBitmapMock = vi.fn(async () => ({
      width: 640,
      height: 480,
      close,
    }));
    vi.stubGlobal("createImageBitmap", createImageBitmapMock);
    const file = imageFile(pngBytes(640, 480), "image/png");

    const decoded = await decodeRasterWithoutResizing(file, "png", {
      width: 640,
      height: 480,
    });

    expect(createImageBitmapMock).toHaveBeenCalledTimes(1);
    expect(createImageBitmapMock.mock.calls[0]).toEqual([file]);
    expect(decoded).toMatchObject({ width: 640, height: 480 });
    decoded.close();
    decoded.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes the decoded bitmap when dimensions mismatch", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({
      width: 320,
      height: 200,
      close,
    })));
    const file = imageFile(pngBytes(640, 480), "image/png");

    await expect(
      decodeRasterWithoutResizing(file, "png", { width: 640, height: 480 }),
    ).rejects.toMatchObject({ code: "dimension-mismatch" });
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("safe output names and PNG output validation", () => {
  it("derives deterministic encoded PNG and revealed text names", () => {
    expect(safeEncodedPngFilename("Meeting notes.JPEG")).toBe(
      "Meeting-notes-encoded.png",
    );
    expect(safeRevealedTextFilename("Meeting notes-encoded.png")).toBe(
      "Meeting-notes-encoded-message.txt",
    );
  });

  it.each(["CON.png", "nul.webp", ".png", "../.png"])(
    "uses safe fallbacks for %s",
    (name) => {
      expect(safeEncodedPngFilename(name)).toBe("private-image-to-text-encoded.png");
      expect(safeRevealedTextFilename(name)).toBe("private-image-to-text-message.txt");
    },
  );

  it("normalises Unicode, strips path components and caps the base", () => {
    expect(sanitiseSourceBase("../folder/\uFF21 report:*?.png")).toBe("A-report");
    expect(sanitiseSourceBase(`${"a".repeat(100)}.png`)).toBe("a".repeat(80));
  });

  it.each(bidiControls)(
    "removes bidi control U+%s from every generated output name",
    (_codePoint, control) => {
      const sourceName = `report${control}draft.png`;

      expect(safeEncodedPngFilename(sourceName)).toBe(
        "reportdraft-encoded.png",
      );
      expect(safeRevealedTextFilename(sourceName)).toBe(
        "reportdraft-message.txt",
      );
    },
  );

  it("falls back when bidi removal exposes a reserved name", () => {
    expect(safeEncodedPngFilename("C\u202EON.png")).toBe(
      "private-image-to-text-encoded.png",
    );
    expect(safeRevealedTextFilename("C\u202EON.png")).toBe(
      "private-image-to-text-message.txt",
    );
  });

  it("preserves non-bidi join controls in multilingual names", () => {
    expect(sanitiseSourceBase("گزارش\u200Cنهایی.png")).toBe("گزارش\u200Cنهایی");
  });

  it("accepts a PNG output only when its signature and dimensions are exact", async () => {
    const output = new Blob([pngBytes(640, 480)], { type: "image/png" });
    await expect(
      validateGeneratedPng(output, { width: 640, height: 480 }),
    ).resolves.toEqual({ ok: true, kind: "png", width: 640, height: 480 });
    await expect(
      validateGeneratedPng(output, { width: 641, height: 480 }),
    ).resolves.toMatchObject({ ok: false, code: "dimension-mismatch" });
  });

  it("rejects missing, non-PNG and oversized output", async () => {
    await expect(
      validateGeneratedPng(null, { width: 1, height: 1 }),
    ).resolves.toMatchObject({ ok: false, code: "output-missing" });
    await expect(
      validateGeneratedPng(new Blob([jpegBytes(1, 1)]), { width: 1, height: 1 }),
    ).resolves.toMatchObject({ ok: false, code: "malformed-image" });

    const oversized = new Blob([pngBytes(1, 1)], { type: "image/png" });
    Object.defineProperty(oversized, "size", {
      configurable: true,
      value: RASTER_LIMITS.maxOutputBytes + 1,
    });
    await expect(
      validateGeneratedPng(oversized, { width: 1, height: 1 }),
    ).resolves.toMatchObject({ ok: false, code: "output-too-large" });
  });
});
