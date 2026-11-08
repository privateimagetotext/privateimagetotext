import { deflateSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import {
  createCleanShareCopy,
  createCleanShareCopySafely,
  getCleanShareCopyPreflight,
  inspectMedia,
  type CleanCopyDecodedImage,
  type CleanCopyOptions,
} from "../../src/features/media-inspector";
import type { ProvenanceInspection } from "../../src/features/media-inspector/provenance";

const encoder = new TextEncoder();
const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function bytes(value: string) {
  return encoder.encode(value);
}

function concat(...values: readonly Uint8Array[]) {
  const output = new Uint8Array(
    values.reduce((total, value) => total + value.byteLength, 0),
  );
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.byteLength;
  }
  return output;
}

function u16(value: number) {
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);
}

function u32(value: number) {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function setU16Le(output: Uint8Array, offset: number, value: number) {
  output[offset] = value & 0xff;
  output[offset + 1] = (value >>> 8) & 0xff;
}

function setU32Le(output: Uint8Array, offset: number, value: number) {
  output[offset] = value & 0xff;
  output[offset + 1] = (value >>> 8) & 0xff;
  output[offset + 2] = (value >>> 16) & 0xff;
  output[offset + 3] = (value >>> 24) & 0xff;
}

function setU32(output: Uint8Array, offset: number, value: number) {
  output[offset] = (value >>> 24) & 0xff;
  output[offset + 1] = (value >>> 16) & 0xff;
  output[offset + 2] = (value >>> 8) & 0xff;
  output[offset + 3] = value & 0xff;
}

function file(value: Uint8Array, name: string, type = "") {
  return new File([value.slice().buffer as ArrayBuffer], name, { type });
}

function crc32(...values: readonly Uint8Array[]) {
  let crc = 0xffff_ffff;
  for (const value of values) {
    for (const byte of value) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
      }
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array = new Uint8Array()) {
  const typeBytes = bytes(type);
  return concat(
    u32(data.byteLength),
    typeBytes,
    data,
    u32(crc32(typeBytes, data)),
  );
}

interface PngOptions {
  readonly beforeIdat?: readonly (readonly [string, Uint8Array])[];
  readonly afterIdat?: readonly (readonly [string, Uint8Array])[];
  readonly metadata?: boolean;
  readonly tail?: Uint8Array;
  readonly width?: number;
  readonly height?: number;
}

function exifTiff(
  orientations: readonly number[] = [1],
  type = 3,
  count = 1,
) {
  const output = new Uint8Array(8 + 2 + orientations.length * 12 + 4);
  output.set(bytes("II"), 0);
  setU16Le(output, 2, 42);
  setU32Le(output, 4, 8);
  setU16Le(output, 8, orientations.length);
  orientations.forEach((orientation, index) => {
    const entry = 10 + index * 12;
    setU16Le(output, entry, 0x0112);
    setU16Le(output, entry + 2, type);
    setU32Le(output, entry + 4, count);
    if (type === 3) setU16Le(output, entry + 8, orientation);
    else setU32Le(output, entry + 8, orientation);
  });
  return output;
}

function makePng(options: PngOptions = {}) {
  const width = options.width ?? 2;
  const height = options.height ?? 1;
  const ihdr = new Uint8Array(13);
  setU32(ihdr, 0, width);
  setU32(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const metadata = options.metadata ?? true;
  const scanline = new Uint8Array(1 + width * 3);
  scanline[1] = 0x12;
  scanline[2] = 0x34;
  scanline[3] = 0x56;
  const parts: Uint8Array[] = [PNG_SIGNATURE, pngChunk("IHDR", ihdr)];
  if (metadata) {
    parts.push(
      pngChunk("eXIf", exifTiff()),
      pngChunk("tEXt", concat(bytes("parameters"), new Uint8Array([0]), bytes("private AI prompt"))),
      pngChunk("caBX", bytes("credential")),
      pngChunk("vpAg", bytes("private chunk")),
    );
  }
  for (const [type, data] of options.beforeIdat ?? []) {
    parts.push(pngChunk(type, data));
  }
  parts.push(pngChunk("IDAT", new Uint8Array(deflateSync(scanline))));
  for (const [type, data] of options.afterIdat ?? []) {
    parts.push(pngChunk(type, data));
  }
  parts.push(pngChunk("IEND"));
  if (options.tail) parts.push(options.tail);
  return concat(...parts);
}

function jpegSegment(marker: number, payload: Uint8Array) {
  return concat(new Uint8Array([0xff, marker]), u16(payload.byteLength + 2), payload);
}

function jfifPayload(
  xDensity = 1,
  yDensity = 1,
  thumbnail = false,
  densityUnit = 0,
) {
  const output = new Uint8Array(thumbnail ? 17 : 14);
  output.set(bytes("JFIF\0"), 0);
  output[5] = 1;
  output[6] = 1;
  output[7] = densityUnit;
  output[8] = (xDensity >>> 8) & 0xff;
  output[9] = xDensity & 0xff;
  output[10] = (yDensity >>> 8) & 0xff;
  output[11] = yDensity & 0xff;
  if (thumbnail) {
    output[12] = 1;
    output[13] = 1;
    output.set([1, 2, 3], 14);
  }
  return output;
}

interface JpegOptions {
  readonly orientations?: readonly number[];
  readonly orientationType?: number;
  readonly orientationCount?: number;
  readonly icc?: boolean;
  readonly mpf?: boolean;
  readonly lateJfif?: boolean;
  readonly extendedXmp?: boolean;
  readonly density?: readonly [number, number];
  readonly densityUnit?: number;
  readonly tail?: Uint8Array;
  readonly sofMarker?: number;
  readonly bitDepth?: number;
  readonly metadata?: boolean;
}

function makeJpeg(options: JpegOptions = {}) {
  const metadata = options.metadata ?? true;
  const density = options.density ?? [1, 1];
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
  if (!options.lateJfif) {
    parts.push(
      jpegSegment(
        0xe0,
        jfifPayload(
          density[0],
          density[1],
          metadata,
          options.densityUnit ?? 0,
        ),
      ),
    );
  }
  if (metadata) {
    parts.push(
      jpegSegment(
        0xe1,
        concat(
          bytes("Exif\0\0"),
          exifTiff(
            options.orientations ?? [1],
            options.orientationType ?? 3,
            options.orientationCount ?? 1,
          ),
        ),
      ),
      jpegSegment(
        0xe1,
        concat(
          bytes("http://ns.adobe.com/xap/1.0/\0"),
          bytes('<rdf:Description xmp:CreatorTool="ComfyUI" Iptc4xmpExt:AIPromptInfo="private prompt" />'),
        ),
      ),
      jpegSegment(0xfe, bytes("private comment")),
      jpegSegment(0xeb, concat(bytes("JP"), bytes("credential"))),
    );
  }
  if (options.extendedXmp) {
    parts.push(
      jpegSegment(
        0xe1,
        concat(bytes("http://ns.adobe.com/xmp/extension/\0"), bytes("guid")),
      ),
    );
  }
  if (options.icc) {
    parts.push(jpegSegment(0xe2, concat(bytes("ICC_PROFILE\0"), new Uint8Array([1, 1]))));
  }
  if (options.mpf) parts.push(jpegSegment(0xe2, concat(bytes("MPF\0"), bytes("index"))));
  const sof = new Uint8Array([
    options.bitDepth ?? 8,
    0,
    1,
    0,
    2,
    3,
    1,
    0x11,
    0,
    2,
    0x11,
    0,
    3,
    0x11,
    0,
  ]);
  parts.push(jpegSegment(options.sofMarker ?? 0xc0, sof));
  if (options.lateJfif) parts.push(jpegSegment(0xe0, jfifPayload()));
  parts.push(
    jpegSegment(
      0xda,
      new Uint8Array([3, 1, 0, 2, 0, 3, 0, 0, 63, 0]),
    ),
    new Uint8Array([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]),
  );
  if (metadata) parts.push(jpegSegment(0xfe, bytes("post-scan secret")));
  parts.push(new Uint8Array([0xff, 0xd9]));
  if (options.tail) parts.push(options.tail);
  return concat(...parts);
}

function notFound(format = "image/jpeg"): ProvenanceInspection {
  return { status: "not-found", format, networkPolicy: "embedded-only" };
}

function credentialsFound(format = "image/jpeg"): ProvenanceInspection {
  return {
    status: "credentials-found",
    format,
    networkPolicy: "embedded-only",
    validation: "valid",
    activeManifestLabel: "manifest",
    claimGenerator: "test",
    digitalSourceTypes: [],
    validationFailures: [],
    manifestStore: {},
  } as unknown as ProvenanceInspection;
}

function provenanceHarness(...results: ProvenanceInspection[]) {
  const inspect = vi.fn(async () => results.shift() ?? notFound());
  const dispose = vi.fn();
  return {
    inspect,
    dispose,
    factory: () => ({ inspect, dispose }),
  };
}

function decodeHarness(width = 2, height = 1) {
  const close = vi.fn();
  const decoder = vi.fn(async (): Promise<CleanCopyDecodedImage> => ({
    width,
    height,
    close,
  }));
  return { decoder, close };
}

function cleanOptions(
  format: "jpeg" | "png" = "jpeg",
  overrides: Partial<CleanCopyOptions> = {},
) {
  const provenance = provenanceHarness(
    notFound(format === "jpeg" ? "image/jpeg" : "image/png"),
    notFound(format === "jpeg" ? "image/jpeg" : "image/png"),
  );
  const decoded = decodeHarness();
  return {
    provenance,
    decoded,
    options: {
      provenanceInspectorFactory: provenance.factory,
      outputImageDecoder: decoded.decoder,
      ...overrides,
    } satisfies CleanCopyOptions,
  };
}

describe("clean share copy core", () => {
  it("creates a new verified JPEG, allows a credentialed source, and strips all APP/comment/tail metadata", async () => {
    const inputBytes = makeJpeg({ tail: bytes("trailing secret") });
    const input = file(inputBytes, "..\\CON\u202e.jpg", "image/png");
    const provenance = provenanceHarness(
      credentialsFound(),
      notFound(),
    );
    const decoded = decodeHarness();
    const result = await createCleanShareCopy(input, {
      provenanceInspectorFactory: provenance.factory,
      outputImageDecoder: decoded.decoder,
    });

    expect(result.output).not.toBe(input);
    expect(result.output.name).toBe("private-image-to-text-clean.jpg");
    expect(result.output.type).toBe("image/jpeg");
    expect(result.output.lastModified).toBe(0);
    expect(new Uint8Array(await input.arrayBuffer())).toEqual(inputBytes);
    expect(result.sourceProvenance.status).toBe("credentials-found");
    expect(result.outputProvenance.status).toBe("not-found");
    expect(result.cleaned.privacy).toEqual([]);
    expect(result.verification.removedCarriers).toEqual(
      expect.arrayContaining([
        "JPEG Exif metadata and previews",
        "JPEG XMP metadata",
        "JPEG comment",
        "JPEG JUMBF or Content Credentials",
        "Data after the JPEG end marker",
      ]),
    );
    expect(result.verification.preservedCarriers).toContain(
      "Canonical zero-thumbnail JFIF colour marker",
    );
    expect(result.verification.sourceSha256).not.toBe(
      result.verification.outputSha256,
    );
    expect(decoded.close).toHaveBeenCalledOnce();
    expect(provenance.dispose).toHaveBeenCalledOnce();
  });

  it("creates a PNG safe-profile copy and truthfully reports preserved HDR carriers", async () => {
    const { options } = cleanOptions("png");
    const result = await createCleanShareCopy(
      file(
        makePng({
          beforeIdat: [
            ["mDCV", new Uint8Array(24)],
            ["cICP", new Uint8Array([1, 13, 0, 1])],
            ["cLLI", new Uint8Array(8)],
            ["sTER", new Uint8Array([0])],
          ],
          tail: bytes("tail secret"),
        }),
        "photo.png",
        "image/png",
      ),
      options,
    );

    expect(result.output.name).toBe("photo-clean.png");
    expect(result.verification.removedCarriers).toEqual(
      expect.arrayContaining([
        "PNG eXIf metadata chunk",
        "PNG tEXt metadata chunk",
        "PNG caBX metadata chunk",
        "PNG private or unknown ancillary chunk vpAg",
        "Data after the PNG end marker",
      ]),
    );
    expect(result.verification.preservedCarriers).toEqual(
      expect.arrayContaining([
        "PNG cICP rendering chunk",
        "PNG mDCV rendering chunk",
        "PNG cLLI rendering chunk",
        "PNG sTER rendering chunk",
        "PNG IDAT image data",
      ]),
    );
  });

  it.each([2, 3, 4, 5, 6, 7, 8])(
    "rejects Exif orientation %s instead of silently changing visible orientation",
    async (orientation) => {
      const { options } = cleanOptions();
      await expect(
        createCleanShareCopySafely(
          file(makeJpeg({ orientations: [orientation] }), "oriented.jpg"),
          options,
        ),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "orientation-unsupported" },
      });
    },
  );

  it.each([
    ["duplicate", makeJpeg({ orientations: [1, 1] })],
    ["invalid type", makeJpeg({ orientationType: 4 })],
    ["invalid count", makeJpeg({ orientationCount: 2 })],
    ["invalid value", makeJpeg({ orientations: [9] })],
    ["extended XMP", makeJpeg({ extendedXmp: true })],
  ])("fails closed on %s orientation metadata", async (_label, value) => {
    const { options } = cleanOptions();
    const outcome = await createCleanShareCopySafely(
      file(value as Uint8Array, "ambiguous.jpg"),
      options,
    );
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: expect.stringMatching(/orientation|malformed/) },
    });
  });

  it.each([
    ["MPF", makeJpeg({ mpf: true })],
    ["JPEG plus PNG", makeJpeg({ tail: PNG_SIGNATURE })],
    ["PNG plus JPEG", makePng({ tail: new Uint8Array([0xff, 0xd8, 0xff]) })],
    ["JPEG plus JPEG", makeJpeg({ tail: makeJpeg({ metadata: false }) })],
    ["PNG plus PNG", makePng({ tail: makePng({ metadata: false }) })],
    ["APNG acTL", makePng({ beforeIdat: [["acTL", new Uint8Array(8)]] })],
    ["APNG fcTL", makePng({ beforeIdat: [["fcTL", new Uint8Array(26)]] })],
    ["APNG fdAT", makePng({ afterIdat: [["fdAT", new Uint8Array(4)]] })],
  ])("rejects multi-image input: %s", async (_label, value) => {
    const format = (value as Uint8Array)[0] === 0x89 ? "png" : "jpeg";
    const { options } = cleanOptions(format);
    await expect(
      createCleanShareCopySafely(
        file(value as Uint8Array, `multi.${format === "png" ? "png" : "jpg"}`),
        options,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "animated-media" },
    });
  });

  it.each([
    ["JPEG ICC", makeJpeg({ icc: true }), "jpeg"],
    ["PNG ICC", makePng({ beforeIdat: [["iCCP", bytes("profile")]] }), "png"],
    ["legacy PNG HDR", makePng({ beforeIdat: [["mDCv", new Uint8Array(24)]] }), "png"],
  ])("rejects unsupported colour state: %s", async (_label, value, format) => {
    const { options } = cleanOptions(format as "jpeg" | "png");
    await expect(
      createCleanShareCopySafely(
        file(value as Uint8Array, "profile.bin"),
        options,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "colour-profile-unsupported" },
    });
  });

  it.each([
    ["late JFIF", makeJpeg({ lateJfif: true })],
    ["non-square JFIF density", makeJpeg({ density: [72, 96] })],
    ["zero JFIF density", makeJpeg({ density: [0, 1] })],
    ["invalid JFIF density unit", makeJpeg({ densityUnit: 3 })],
    ["lossless JPEG", makeJpeg({ sofMarker: 0xc3 })],
    ["12-bit JPEG", makeJpeg({ bitDepth: 12 })],
    [
      "PLTE after tRNS",
      makePng({
        metadata: false,
        beforeIdat: [
          ["tRNS", new Uint8Array(6)],
          ["PLTE", new Uint8Array([0, 0, 0])],
        ],
      }),
    ],
    [
      "non-square PNG density",
      makePng({
        metadata: false,
        beforeIdat: [["pHYs", concat(u32(72), u32(96), new Uint8Array([0]))]],
      }),
    ],
  ])("fails closed on unsupported structure: %s", async (_label, value) => {
    const format = (value as Uint8Array)[0] === 0x89 ? "png" : "jpeg";
    const { options } = cleanOptions(format);
    const outcome = await createCleanShareCopySafely(
      file(value as Uint8Array, "unsupported.bin"),
      options,
    );
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: expect.stringMatching(/unsupported|unsafe|malformed/) },
    });
  });

  it.each([
    ["cICP matrix", [["cICP", new Uint8Array([1, 13, 1, 1])]]],
    ["cICP full-range", [["cICP", new Uint8Array([1, 13, 0, 2])]]],
    ["mDCV without cICP", [["mDCV", new Uint8Array(24)]]],
    ["invalid sTER", [["sTER", new Uint8Array([2])]]],
  ] as const)("rejects invalid PNG rendering state: %s", async (_label, beforeIdat) => {
    const { options } = cleanOptions("png");
    await expect(
      createCleanShareCopySafely(
        file(makePng({ metadata: false, beforeIdat }), "rendering.png"),
        options,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "malformed-source" },
    });
  });

  it("rejects sTER after IDAT", async () => {
    const { options } = cleanOptions("png");
    await expect(
      createCleanShareCopySafely(
        file(
          makePng({
            metadata: false,
            afterIdat: [["sTER", new Uint8Array([0])]],
          }),
          "late-stereo.png",
        ),
        options,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "malformed-source" },
    });
  });

  it("blocks source provenance errors and output credentials, always disposing the verifier", async () => {
    const sourceError = provenanceHarness({
      status: "error",
      code: "inspection-failed",
      message: "failed",
      format: "image/jpeg",
      networkPolicy: "embedded-only",
    });
    const decoded = decodeHarness();
    await expect(
      createCleanShareCopySafely(file(makeJpeg(), "source.jpg"), {
        provenanceInspectorFactory: sourceError.factory,
        outputImageDecoder: decoded.decoder,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "source-provenance-unverified" },
    });
    expect(sourceError.dispose).toHaveBeenCalledOnce();

    const outputCredentials = provenanceHarness(
      notFound(),
      credentialsFound(),
    );
    await expect(
      createCleanShareCopySafely(file(makeJpeg(), "output.jpg"), {
        provenanceInspectorFactory: outputCredentials.factory,
        outputImageDecoder: decoded.decoder,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "output-provenance-present" },
    });
    expect(outputCredentials.dispose).toHaveBeenCalledOnce();
  });

  it("fails closed when the generated output cannot be decoded", async () => {
    const provenance = provenanceHarness(notFound());
    const outcome = await createCleanShareCopySafely(
      file(makeJpeg(), "corrupt-entropy.jpg"),
      {
        provenanceInspectorFactory: provenance.factory,
        outputImageDecoder: async () => {
          throw new Error("decode failed");
        },
      },
    );
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "verification-failed" },
    });
    expect(provenance.inspect).toHaveBeenCalledOnce();
  });

  it("closes and rejects a decoded output with mismatched dimensions", async () => {
    const provenance = provenanceHarness(notFound());
    const close = vi.fn();
    const outcome = await createCleanShareCopySafely(
      file(makeJpeg(), "wrong-dimensions.jpg"),
      {
        provenanceInspectorFactory: provenance.factory,
        outputImageDecoder: async () => ({ width: 1, height: 1, close }),
      },
    );
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "verification-failed" },
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("cancels a late decoder without leaking its eventual decoded resource", async () => {
    const controller = new AbortController();
    const provenance = provenanceHarness(notFound());
    let resolveDecoded!: (decoded: CleanCopyDecodedImage) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const close = vi.fn();
    const decoder = () => {
      markStarted();
      return new Promise<CleanCopyDecodedImage>((resolve) => {
        resolveDecoded = resolve;
      });
    };
    const pending = createCleanShareCopySafely(file(makeJpeg(), "late.jpg"), {
      signal: controller.signal,
      provenanceInspectorFactory: provenance.factory,
      outputImageDecoder: decoder,
    });
    await started;
    controller.abort();
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    });
    resolveDecoded({ width: 2, height: 1, close });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(close).toHaveBeenCalledOnce();
    expect(provenance.dispose).toHaveBeenCalledOnce();
  });

  it("stops progress callbacks after cancellation and enforces lower caller limits", async () => {
    const controller = new AbortController();
    const provenance = provenanceHarness(notFound());
    const progress = vi.fn((value: { phase: string }) => {
      if (value.phase === "rewrite") controller.abort();
    });
    const decoded = decodeHarness();
    const outcome = await createCleanShareCopySafely(
      file(makeJpeg(), "cancel.jpg"),
      {
        signal: controller.signal,
        onProgress: progress,
        provenanceInspectorFactory: provenance.factory,
        outputImageDecoder: decoded.decoder,
      },
    );
    expect(outcome).toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(progress.mock.calls.at(-1)?.[0]).toMatchObject({ phase: "rewrite" });
    expect(progress).not.toHaveBeenCalledWith(expect.objectContaining({ phase: "complete" }));
    expect(decoded.decoder).not.toHaveBeenCalled();

    const { options } = cleanOptions();
    await expect(
      createCleanShareCopySafely(file(makeJpeg(), "limited.jpg"), {
        ...options,
        maxSourceBytes: 16,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "source-too-large" },
    });
  });

  it("provides synchronous preflight without treating cached credentials as a blocker", async () => {
    const inspected = await inspectMedia(file(makePng(), "source.png"));
    expect(getCleanShareCopyPreflight(inspected, credentialsFound("image/png"))).toMatchObject({
      eligible: true,
      format: "png",
      structuralCheckRequired: true,
    });
    expect(
      getCleanShareCopyPreflight(inspected, {
        status: "error",
        code: "inspection-failed",
        message: "stale failure",
        format: "image/png",
        networkPolicy: "embedded-only",
      }),
    ).toMatchObject({
      eligible: false,
      code: "source-provenance-unverified",
    });

    expect(
      getCleanShareCopyPreflight({
        ...inspected,
        format: {
          kind: "webp",
          category: "image",
          label: "WebP image",
          mimeType: "image/webp",
          extensions: ["webp"],
          signature: "RIFF WebP",
        },
      }),
    ).toEqual({
      eligible: false,
      code: "unsupported-format",
      reason: "Metadata removal currently supports only actual JPEG and PNG files.",
    });
  });
});
