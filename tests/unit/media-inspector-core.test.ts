import { createHash } from "node:crypto";
import { Blob as NodeBlob } from "node:buffer";
import { deflateSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import {
  detectMediaFormat,
  detectMediaSignature,
  derivePrivacyFindings,
  inspectMedia,
  inspectMediaSafely,
  sha256Blob,
  type MetadataEntry,
} from "../../src/features/media-inspector";
import { BoundedBlobReader } from "../../src/features/media-inspector/reader";

const encoder = new TextEncoder();

function bytes(value: string) {
  return encoder.encode(value);
}

function concat(...values: readonly Uint8Array[]) {
  const result = new Uint8Array(
    values.reduce((total, value) => total + value.byteLength, 0),
  );
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
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

function setU16(bytesValue: Uint8Array, offset: number, value: number) {
  bytesValue[offset] = (value >>> 8) & 0xff;
  bytesValue[offset + 1] = value & 0xff;
}

function setU32(bytesValue: Uint8Array, offset: number, value: number) {
  bytesValue[offset] = (value >>> 24) & 0xff;
  bytesValue[offset + 1] = (value >>> 16) & 0xff;
  bytesValue[offset + 2] = (value >>> 8) & 0xff;
  bytesValue[offset + 3] = value & 0xff;
}

function setU16LittleEndian(
  bytesValue: Uint8Array,
  offset: number,
  value: number,
) {
  bytesValue[offset] = value & 0xff;
  bytesValue[offset + 1] = (value >>> 8) & 0xff;
}

function setU32LittleEndian(
  bytesValue: Uint8Array,
  offset: number,
  value: number,
) {
  bytesValue[offset] = value & 0xff;
  bytesValue[offset + 1] = (value >>> 8) & 0xff;
  bytesValue[offset + 2] = (value >>> 16) & 0xff;
  bytesValue[offset + 3] = (value >>> 24) & 0xff;
}

function asBlobPart(value: Uint8Array) {
  return value.slice().buffer as ArrayBuffer;
}

function file(value: Uint8Array, name: string, type = "") {
  return new File([asBlobPart(value)], name, { type });
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

function pngChunk(
  type: string,
  data = new Uint8Array(),
  corruptCrc = false,
) {
  const typeBytes = bytes(type);
  const checksum = crc32(typeBytes, data) ^ (corruptCrc ? 1 : 0);
  return concat(u32(data.byteLength), typeBytes, data, u32(checksum >>> 0));
}

function makePng(options: { corruptHeaderCrc?: boolean; corruptTextCrc?: boolean } = {}) {
  const header = new Uint8Array(13);
  setU32(header, 0, 320);
  setU32(header, 4, 180);
  header[8] = 8;
  header[9] = 2;
  return concat(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header, options.corruptHeaderCrc),
    pngChunk(
      "tEXt",
      concat(bytes("parameters"), new Uint8Array([0]), bytes("prompt: private castle; seed: 42")),
      options.corruptTextCrc,
    ),
    pngChunk("IEND"),
  );
}

function compressedPngText(keyword: string, value: string) {
  return pngChunk(
    "zTXt",
    concat(
      bytes(keyword),
      new Uint8Array([0, 0]),
      new Uint8Array(deflateSync(bytes(value))),
    ),
  );
}

function makeCompressedMetadataPng() {
  const header = new Uint8Array(13);
  setU32(header, 0, 1);
  setU32(header, 4, 1);
  header[8] = 8;
  header[9] = 2;
  return concat(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    compressedPngText("comment-one", "A".repeat(80)),
    compressedPngText("comment-two", "B".repeat(80)),
    pngChunk("IEND"),
  );
}

function jpegSegment(marker: number, payload: Uint8Array) {
  return concat(new Uint8Array([0xff, marker]), u16(payload.byteLength + 2), payload);
}

function makeExifTiff() {
  const result = new Uint8Array(70);
  result.set(bytes("II"), 0);
  setU16LittleEndian(result, 2, 42);
  setU32LittleEndian(result, 4, 8);
  setU16LittleEndian(result, 8, 3);

  setU16LittleEndian(result, 10, 0x0112);
  setU16LittleEndian(result, 12, 3);
  setU32LittleEndian(result, 14, 1);
  setU16LittleEndian(result, 18, 6);

  setU16LittleEndian(result, 22, 0x0131);
  setU16LittleEndian(result, 24, 2);
  setU32LittleEndian(result, 26, 3);
  result.set(bytes("AI\0"), 30);

  setU16LittleEndian(result, 34, 0x0132);
  setU16LittleEndian(result, 36, 2);
  setU32LittleEndian(result, 38, 20);
  setU32LittleEndian(result, 42, 50);
  setU32LittleEndian(result, 46, 0);
  result.set(bytes("2026:08:07 12:34:56\0"), 50);
  return result;
}

function makeJpeg() {
  const exif = jpegSegment(
    0xe1,
    concat(bytes("Exif\0\0"), makeExifTiff()),
  );
  const xmp = jpegSegment(
    0xe1,
    concat(
      bytes("http://ns.adobe.com/xap/1.0/\0"),
      bytes(
        '<rdf:Description xmp:CreatorTool="ComfyUI" Iptc4xmpExt:AIPromptInfo="a hidden prompt" />',
      ),
    ),
  );
  const comment = jpegSegment(0xfe, bytes("private project note"));
  const sof = jpegSegment(
    0xc0,
    new Uint8Array([8, 0x01, 0xe0, 0x02, 0x80, 1, 1, 0x11, 0]),
  );
  return concat(
    new Uint8Array([0xff, 0xd8]),
    exif,
    xmp,
    comment,
    sof,
    new Uint8Array([0xff, 0xd9]),
  );
}

function isoBox(type: string, ...payloadParts: readonly Uint8Array[]) {
  const payload = concat(...payloadParts);
  return concat(u32(payload.byteLength + 8), bytes(type), payload);
}

function makeMp4() {
  const ftyp = isoBox(
    "ftyp",
    bytes("isom"),
    u32(0x200),
    bytes("isom"),
    bytes("mp42"),
  );

  const mvhd = new Uint8Array(100);
  setU32(mvhd, 4, 2_082_844_800);
  setU32(mvhd, 8, 2_082_844_860);
  setU32(mvhd, 12, 1_000);
  setU32(mvhd, 16, 12_000);

  const tkhd = new Uint8Array(84);
  tkhd[3] = 7;
  setU32(tkhd, 4, 2_082_844_800);
  setU32(tkhd, 8, 2_082_844_860);
  setU32(tkhd, 12, 1);
  setU32(tkhd, 20, 12_000);
  setU32(tkhd, 76, 1_920 * 65_536);
  setU32(tkhd, 80, 1_080 * 65_536);

  const mdhd = new Uint8Array(24);
  setU32(mdhd, 4, 2_082_844_800);
  setU32(mdhd, 8, 2_082_844_860);
  setU32(mdhd, 12, 90_000);
  setU32(mdhd, 16, 1_080_000);
  setU16(mdhd, 20, (5 << 10) | (14 << 5) | 7);

  const hdlr = new Uint8Array(24);
  hdlr.set(bytes("vide"), 8);

  const visualSampleEntry = new Uint8Array(36);
  setU32(visualSampleEntry, 0, visualSampleEntry.byteLength);
  visualSampleEntry.set(bytes("avc1"), 4);
  setU16(visualSampleEntry, 14, 1);
  setU16(visualSampleEntry, 32, 1_920);
  setU16(visualSampleEntry, 34, 1_080);
  const stsd = isoBox(
    "stsd",
    new Uint8Array(4),
    u32(1),
    visualSampleEntry,
  );
  const stbl = isoBox("stbl", stsd);
  const minf = isoBox("minf", stbl);
  const mdia = isoBox("mdia", isoBox("mdhd", mdhd), isoBox("hdlr", hdlr), minf);
  const trak = isoBox("trak", isoBox("tkhd", tkhd), mdia);
  const moov = isoBox("moov", isoBox("mvhd", mvhd), trak);

  const mediaPayload = new Uint8Array(1024 * 1024);
  const mdat = isoBox("mdat", mediaPayload);
  return concat(ftyp, mdat, moov);
}

function ebmlDocType(value: string) {
  const element = concat(
    new Uint8Array([0x42, 0x82]),
    new Uint8Array([0x80 | value.length]),
    bytes(value),
  );
  return concat(
    new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80 | element.byteLength]),
    element,
  );
}

describe("media type detection", () => {
  it.each([
    [new Uint8Array([0xff, 0xd8, 0xff]), "jpeg"],
    [new Uint8Array([0x89, ...bytes("PNG\r\n\x1a\n")]), "png"],
    [bytes("GIF89a"), "gif"],
    [concat(bytes("RIFF"), new Uint8Array(4), bytes("WEBP")), "webp"],
    [bytes("fLaC"), "flac"],
    [bytes("OggS"), "ogg"],
    [concat(bytes("FORM"), new Uint8Array(4), bytes("AIFF")), "aiff"],
    [concat(bytes("RIFF"), new Uint8Array(4), bytes("WAVE")), "wav"],
    [new Uint8Array([0xff, 0xf1, 0x50, 0x80, 0, 0, 0]), "aac"],
  ])("identifies %s by bytes, not its filename", (signature, kind) => {
    expect(detectMediaSignature(signature as Uint8Array).kind).toBe(kind);
  });

  it("finds ISO BMFF brands without trusting the declared MIME type", async () => {
    const detected = await detectMediaFormat(
      file(makeMp4(), "actually-a-movie.txt", "text/plain"),
    );
    expect(detected.kind).toBe("mp4");
    expect(detected.brands).toEqual(["isom", "mp42"]);
  });

  it("requires an explicit supported EBML DocType", () => {
    expect(detectMediaSignature(ebmlDocType("webm")).kind).toBe("webm");
    expect(detectMediaSignature(ebmlDocType("matroska")).kind).toBe("matroska");
    expect(
      detectMediaSignature(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80])).kind,
    ).toBe("unknown");
    expect(detectMediaSignature(ebmlDocType("not-media")).kind).toBe("unknown");
  });
});

describe("bounded hashing and reads", () => {
  it("calculates SHA-256 incrementally with progress", async () => {
    const progress = vi.fn();
    await expect(
      sha256Blob(new Blob(["abc"]), { chunkBytes: 1, onProgress: progress }),
    ).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(progress).toHaveBeenLastCalledWith({
      processedBytes: 3,
      totalBytes: 3,
    });
    expect(progress).toHaveBeenCalledTimes(4);
  });

  it("enforces read, hash and cancellation limits", async () => {
    const reader = new BoundedBlobReader(new Blob(["12345678"]), {
      maxReadBytes: 4,
      maxSliceBytes: 4,
    });
    await reader.read(0, 4);
    await expect(reader.read(4, 1)).rejects.toMatchObject({
      code: "read-limit-exceeded",
    });
    await expect(
      sha256Blob(new Blob(["12345"]), { maxBytes: 4 }),
    ).rejects.toMatchObject({ code: "file-too-large" });

    const controller = new AbortController();
    controller.abort();
    await expect(
      inspectMedia(new Blob([makePng()]), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "cancelled" });
  });

  it("matches SHA-256 across empty, padding-boundary and multi-block inputs", async () => {
    for (const length of [0, 55, 56, 63, 64, 65, 1_041]) {
      const value = new Uint8Array(length);
      for (let index = 0; index < value.byteLength; index += 1) {
        value[index] = (index * 31 + 17) & 0xff;
      }
      const expected = createHash("sha256").update(value).digest("hex");
      await expect(
        sha256Blob(new Blob([asBlobPart(value)]), { chunkBytes: 17 }),
      ).resolves.toBe(expected);
    }
  });

  it("stops hashing after cancellation between chunks", async () => {
    const controller = new AbortController();
    const progress = vi.fn(({ processedBytes }: { processedBytes: number }) => {
      if (processedBytes === 2) controller.abort();
    });
    await expect(
      sha256Blob(new Blob(["abcdef"]), {
        chunkBytes: 2,
        signal: controller.signal,
        onProgress: progress,
      }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(progress).toHaveBeenLastCalledWith({
      processedBytes: 2,
      totalBytes: 6,
    });
  });
});

describe("image metadata inspection", () => {
  it("parses EXIF, XMP and JPEG comments into normalised findings", async () => {
    const result = await inspectMedia(
      file(makeJpeg(), "renamed.png", "image/png"),
    );

    expect(result.format.kind).toBe("jpeg");
    expect(result.image).toMatchObject({
      width: 640,
      height: 480,
      bitDepth: 8,
      orientation: 6,
    });
    expect(result.metadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "exif.software", value: "AI" }),
        expect.objectContaining({ key: "xmp.creatorTool", value: "ComfyUI" }),
        expect.objectContaining({ key: "jpeg.comment", value: "private project note" }),
      ]),
    );
    expect(result.privacy.map((finding) => finding.category)).toEqual(
      expect.arrayContaining(["timestamp", "generation-data", "editing-history"]),
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "declared-type-mismatch" }),
    );
  });

  it("recognises PNG AI recipes and rejects malicious chunk lengths", async () => {
    const result = await inspectMedia(file(makePng(), "recipe.png", "image/png"));
    expect(result.image).toMatchObject({ width: 320, height: 180, bitDepth: 8 });
    expect(result.metadata).toContainEqual(
      expect.objectContaining({
        key: "png.text.parameters",
        sensitive: true,
      }),
    );
    expect(result.privacy).toContainEqual(
      expect.objectContaining({ category: "generation-data" }),
    );

    const malicious = concat(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      new Uint8Array([0x7f, 0xff, 0xff, 0xff]),
      bytes("tEXt"),
    );
    await expect(inspectMedia(new Blob([malicious]))).rejects.toMatchObject({
      code: "malformed-file",
    });
  });

  it("rejects corrupted structural and extracted PNG metadata chunks", async () => {
    await expect(
      inspectMedia(file(makePng({ corruptHeaderCrc: true }), "header.png")),
    ).rejects.toMatchObject({ code: "malformed-file" });
    await expect(
      inspectMedia(file(makePng({ corruptTextCrc: true }), "text.png")),
    ).rejects.toMatchObject({ code: "malformed-file" });
  });

  it("charges decompressed PNG text against the aggregate metadata budget", async () => {
    const input = file(makeCompressedMetadataPng(), "compressed.png");
    vi.stubGlobal("Blob", NodeBlob);
    try {
      const withinBudget = await inspectMedia(input);
      expect(withinBudget.metadata).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "png.text.comment.one",
            value: "A".repeat(80),
          }),
          expect.objectContaining({
            key: "png.text.comment.two",
            value: "B".repeat(80),
          }),
        ]),
      );
      await expect(
        inspectMedia(input, { maxMetadataBytes: 160 }),
      ).rejects.toMatchObject({ code: "metadata-limit-exceeded" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("ISO BMFF metadata inspection", () => {
  it("skips media payloads and reads a trailing moov box", async () => {
    const input = file(makeMp4(), "clip.mov", "video/quicktime");
    const result = await inspectMedia(input);

    expect(result.format.kind).toBe("mp4");
    expect(result.container).toMatchObject({
      brands: ["isom", "mp42"],
      durationSeconds: 12,
      createdAt: "1970-01-01T00:00:00.000Z",
      tracks: [
        expect.objectContaining({
          id: 1,
          kind: "video",
          codec: "avc1",
          durationSeconds: 12,
          language: "eng",
          width: 1_920,
          height: 1_080,
        }),
      ],
    });
    expect(result.stats.bytesRead).toBeLessThan(100_000);
    expect(result.stats.bytesRead).toBeLessThan(input.size / 5);
    expect(result.privacy).toContainEqual(
      expect.objectContaining({ category: "timestamp" }),
    );
  });
});

describe("safe outcomes and privacy grouping", () => {
  it("serialises unsupported files without losing the error code", async () => {
    await expect(inspectMediaSafely(new Blob(["not media"]))).resolves.toEqual({
      ok: false,
      error: {
        code: "unsupported-format",
        message: expect.stringMatching(/supported/i),
      },
    });
  });

  it("groups matching metadata without exposing values in the finding", () => {
    const metadata: MetadataEntry[] = [
      {
        key: "exif.gpsLatitude",
        label: "GPS latitude",
        value: -31.95,
        namespace: "exif",
        sensitive: true,
      },
      {
        key: "exif.bodySerialNumber",
        label: "Body serial number",
        value: "SECRET-123",
        namespace: "exif",
        sensitive: true,
      },
    ];
    const findings = derivePrivacyFindings(metadata);
    expect(findings.map((finding) => finding.category)).toEqual([
      "location",
      "device-identifier",
    ]);
    expect(JSON.stringify(findings)).not.toContain("SECRET-123");
  });
});
