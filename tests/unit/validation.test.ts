import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { FILE_LIMITS } from "../../src/config/product";
import {
  detectRasterSignature,
  formatFileSize,
  safeTextFilename,
  validateDecodedDimensions,
  validateImageFile,
} from "../../src/features/ocr/validation";

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

const signatures = {
  png: new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]),
  jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
  webp: new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]),
  bmp: new Uint8Array([0x42, 0x4d, 0x00, 0x00]),
} as const;

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

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set(signatures.png, 0);
  bytes.set(uint32BigEndian(13), 8);
  bytes.set(new TextEncoder().encode("IHDR"), 12);
  bytes.set(uint32BigEndian(width), 16);
  bytes.set(uint32BigEndian(height), 20);
  return bytes;
}

function jpegHeader(width: number, height: number) {
  return Uint8Array.of(
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x07, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
  );
}

function webpHeader(width: number, height: number) {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(uint32LittleEndian(22), 4);
  bytes.set(new TextEncoder().encode("WEBPVP8X"), 8);
  bytes.set(uint32LittleEndian(10), 16);
  bytes.set(uint32LittleEndian(width - 1).slice(0, 3), 24);
  bytes.set(uint32LittleEndian(height - 1).slice(0, 3), 27);
  return bytes;
}

function bmpHeader(width: number, height: number) {
  const bytes = new Uint8Array(26);
  bytes.set(signatures.bmp, 0);
  bytes.set(uint32LittleEndian(40), 14);
  bytes.set(uint32LittleEndian(width), 18);
  bytes.set(uint32LittleEndian(height), 22);
  return bytes;
}

const completeHeaders = {
  png: pngHeader,
  jpeg: jpegHeader,
  webp: webpHeader,
  bmp: bmpHeader,
} as const;

const rasterFixtures = [
  { extension: "png", kind: "png", type: "image/png" },
  { extension: "jpg", kind: "jpeg", type: "image/jpeg" },
  { extension: "webp", kind: "webp", type: "image/webp" },
  { extension: "bmp", kind: "bmp", type: "image/bmp" },
].map((fixture) => ({
  ...fixture,
  bytes: readFileSync(`tests/fixtures/ocr-intake/synthetic-text.${fixture.extension}`),
}));

function imageFile(
  bytes: Uint8Array,
  type: string,
  name = "source-image",
) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], name, { type });
}

describe("raster validation", () => {
  it.each([
    ["png", signatures.png],
    ["jpeg", signatures.jpeg],
    ["webp", signatures.webp],
    ["bmp", signatures.bmp],
  ] as const)("detects a %s signature from file contents", (kind, bytes) => {
    expect(detectRasterSignature(bytes)).toBe(kind);
  });

  it("rejects bytes without a supported raster signature", () => {
    expect(
      detectRasterSignature(
        new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'>"),
      ),
    ).toBeNull();
  });

  it.each([
    ["image/png", completeHeaders.png(800, 600), "png"],
    ["image/jpeg", completeHeaders.jpeg(800, 600), "jpeg"],
    ["image/jpg", completeHeaders.jpeg(800, 600), "jpeg"],
    ["image/pjpeg", completeHeaders.jpeg(800, 600), "jpeg"],
    ["image/webp", completeHeaders.webp(800, 600), "webp"],
    ["image/bmp", completeHeaders.bmp(800, 600), "bmp"],
    ["image/x-ms-bmp", completeHeaders.bmp(800, 600), "bmp"],
  ] as const)(
    "accepts matching %s content",
    async (type, bytes, expectedKind) => {
      await expect(validateImageFile(imageFile(bytes, type))).resolves.toEqual({
        ok: true,
        kind: expectedKind,
        width: 800,
        height: 600,
      });
    },
  );

  it("rejects an otherwise supported MIME type when the contents differ", async () => {
    await expect(
      validateImageFile(imageFile(completeHeaders.jpeg(800, 600), "image/png")),
    ).resolves.toEqual({
      ok: false,
      message:
        "The image contents do not match the file type reported by the browser.",
    });
  });

  describe.each(rasterFixtures)("complete $kind image intake", ({ bytes, kind, type }) => {
    it.each(["", "application/octet-stream", "application/x-unknown", "binary/octet-stream"])(
      "accepts MIME metadata '%s' using the image contents",
      async (declaredType) => {
        // A misleading extension must not determine the accepted image format.
        await expect(validateImageFile(imageFile(bytes, declaredType, "clipboard.bin"))).resolves.toEqual({
          ok: true, kind, width: 720, height: 180,
        });
      },
    );

    it("continues accepting matching explicit MIME metadata", async () => {
      await expect(validateImageFile(imageFile(bytes, type))).resolves.toEqual({
        ok: true, kind, width: 720, height: 180,
      });
    });

    it("rejects a contradictory explicit MIME declaration", async () => {
      await expect(validateImageFile(imageFile(bytes, kind === "png" ? "image/jpeg" : "image/png"))).resolves.toEqual({
        ok: false,
        message: "The image contents do not match the file type reported by the browser.",
      });
    });
  });

  it.each(["image/svg+xml", "application/pdf", "image/heic", "image/gif", "text/plain"])(
    "rejects an unsupported explicit MIME type %s even for raster bytes",
    async (type) => {
      await expect(validateImageFile(imageFile(rasterFixtures[0].bytes, type))).resolves.toEqual({
        ok: false,
        message: "The image contents do not match the file type reported by the browser.",
      });
    },
  );

  it.each(["", "application/octet-stream"])(
    "rejects unsupported content with generic MIME metadata '%s' regardless of extension",
    async (type) => {
      for (const content of [
        "<svg xmlns='http://www.w3.org/2000/svg'><text>test</text></svg>",
        "%PDF-1.7\n1 0 obj <<>> endobj",
        "GIF89a\u0001\u0000\u0001\u0000",
        "\u0000\u0000\u0000\u0018ftypheic\u0000\u0000\u0000\u0000heic",
        "this is plain text",
        "",
      ]) {
        await expect(validateImageFile(imageFile(new TextEncoder().encode(content), type, "renamed.png"))).resolves.toMatchObject({
          ok: false,
          message: expect.stringMatching(/not a supported raster image/i),
        });
      }
    },
  );

  it.each(["", "application/octet-stream"])(
    "still rejects malformed or truncated raster headers with MIME metadata '%s'",
    async (type) => {
      const malformedWebp = completeHeaders.webp(800, 600);
      malformedWebp.set(uint32LittleEndian(1_000), 4);
      for (const bytes of [
        ...rasterFixtures.map((fixture) => fixture.bytes.slice(0, fixture.kind === "bmp" ? 20 : 16)),
        completeHeaders.png(0, 600),
        completeHeaders.jpeg(0, 600),
        malformedWebp,
      ]) {
        await expect(validateImageFile(imageFile(bytes, type))).resolves.toMatchObject({
          ok: false,
          message: expect.stringMatching(/malformed|incomplete|invalid|too short/i),
        });
      }
    },
  );

  it("rejects unsupported bytes even when the browser reports a supported MIME type", async () => {
    const result = await validateImageFile(
      imageFile(new Uint8Array([0x00, 0x01, 0x02]), "image/png"),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/not a supported raster image/i);
    }
  });

  it.each(["image/png", "", "application/octet-stream"])("rejects oversized files with MIME metadata '%s' before reading contents", async (type) => {
    const file = imageFile(signatures.png, type);
    const read = vi.spyOn(file, "slice");
    Object.defineProperty(file, "size", {
      configurable: true,
      value: FILE_LIMITS.maxBytes + 1,
    });

    const result = await validateImageFile(file);

    expect(result).toEqual({
      ok: false,
      message: `That file is larger than ${FILE_LIMITS.maxBytes / (1024 * 1024)} MiB.`,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it.each(["", "application/octet-stream"])(
    "keeps the encoded pixel budget for generic MIME metadata '%s'",
    async (type) => {
      for (const header of Object.values(completeHeaders)) {
        await expect(validateImageFile(imageFile(header(6_000, 6_000), type))).resolves.toMatchObject({
          ok: true, width: 6_000, height: 6_000,
        });
        await expect(validateImageFile(imageFile(header(6_001, 6_000), type))).resolves.toEqual({
          ok: false,
          message: `The image exceeds the ${FILE_LIMITS.maxMegapixels}-megapixel safety limit.`,
        });
      }
    },
  );

  it.each([
    ["PNG", "image/png", completeHeaders.png],
    ["JPEG", "image/jpeg", completeHeaders.jpeg],
    ["WebP", "image/webp", completeHeaders.webp],
    ["BMP", "image/bmp", completeHeaders.bmp],
  ] as const)(
    "enforces the encoded %s pixel budget before browser decode",
    async (_label, type, header) => {
      await expect(
        validateImageFile(imageFile(header(6_000, 6_000), type)),
      ).resolves.toMatchObject({ ok: true, width: 6_000, height: 6_000 });

      await expect(
        validateImageFile(imageFile(header(6_001, 6_000), type)),
      ).resolves.toEqual({
        ok: false,
        message: `The image exceeds the ${FILE_LIMITS.maxMegapixels}-megapixel safety limit.`,
      });
    },
  );

  it("rejects maximum-width raster headers without unsafe multiplication", async () => {
    await expect(
      validateImageFile(imageFile(pngHeader(0xffff_ffff, 0xffff_ffff), "image/png")),
    ).resolves.toMatchObject({ ok: false, message: expect.stringMatching(/megapixel/i) });
    await expect(
      validateImageFile(imageFile(bmpHeader(0x7fff_ffff, 0x7fff_ffff), "image/bmp")),
    ).resolves.toMatchObject({ ok: false, message: expect.stringMatching(/megapixel/i) });
  });
});

describe("decoded image dimensions", () => {
  it("accepts safe integer dimensions up to the configured pixel limit", () => {
    expect(validateDecodedDimensions(6_000, 6_000)).toBeNull();
  });

  it.each([
    [0, 1],
    [1, -1],
    [1.5, 2],
    [Number.NaN, 2],
    [Number.MAX_SAFE_INTEGER + 1, 1],
  ])("rejects invalid dimensions %s x %s", (width, height) => {
    expect(validateDecodedDimensions(width, height)).toMatch(
      /invalid image dimensions/i,
    );
  });

  it("rejects decoded images beyond the configured pixel limit", () => {
    expect(validateDecodedDimensions(6_001, 6_000)).toBe(
      `The decoded image exceeds the ${FILE_LIMITS.maxMegapixels}-megapixel safety limit.`,
    );
  });
});

describe("safe text filenames", () => {
  it("derives a readable text filename from the source name", () => {
    expect(safeTextFilename("meeting notes.PNG")).toBe(
      "meeting-notes-ocr.txt",
    );
  });

  it.each(["CON.png", "nul.jpeg", "LPT9.webp", ".png"])(
    "falls back for an empty or Windows-reserved source name: %s",
    (sourceName) => {
      expect(safeTextFilename(sourceName)).toBe("private-image-to-text-ocr.txt");
    },
  );

  it("normalises Unicode and removes path and filename metacharacters", () => {
    const filename = safeTextFilename("../folder/\uFF21 report:*?.jpg");

    expect(filename).toBe("A-report-ocr.txt");
    for (const forbidden of [
      "<",
      ">",
      ":",
      '"',
      "/",
      "\\",
      "|",
      "?",
      "*",
      String.fromCharCode(0),
      String.fromCharCode(31),
    ]) {
      expect(filename).not.toContain(forbidden);
    }
  });

  it("caps the derived basename length", () => {
    const filename = safeTextFilename(`${"a".repeat(120)}.png`);

    expect(filename).toBe(`${"a".repeat(80)}-ocr.txt`);
  });

  it.each(bidiControls)("removes bidi control U+%s", (_codePoint, control) => {
    const filename = safeTextFilename(`report${control}draft.png`);

    expect(filename).toBe("reportdraft-ocr.txt");
    expect(filename).not.toMatch(/\p{Bidi_Control}/u);
  });

  it("neutralises a bidi extension spoof and falls back after unsafe removal", () => {
    expect(safeTextFilename("invoice\u202Etxt.exe")).toBe(
      "invoicetxt-ocr.txt",
    );
    expect(safeTextFilename("\u202E.png")).toBe("private-image-to-text-ocr.txt");
    expect(safeTextFilename("C\u202EON.png")).toBe("private-image-to-text-ocr.txt");
  });

  it("preserves non-bidi join controls in multilingual names", () => {
    expect(safeTextFilename("گزارش\u200Cنهایی.png")).toBe(
      "گزارش\u200Cنهایی-ocr.txt",
    );
  });
});

describe("file size formatting", () => {
  it.each([
    [0, "0 B"],
    [1_023, "1023 B"],
    [1_024, "1.0 KB"],
    [1_536, "1.5 KB"],
    [1_048_576, "1.0 MB"],
    [2_621_440, "2.5 MB"],
  ])("formats %s bytes as %s", (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});
