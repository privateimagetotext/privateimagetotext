import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { CryptoProvider } from "../../src/features/steganography/codec";
import {
  JPEG_V2_EMBEDDING_SUITE,
  JPEG_V2_ENCRYPTED_SUITE,
  JPEG_V2_FLAGS,
  JPEG_V2_HEADER_BYTES,
  JPEG_V2_MAGIC,
  JPEG_V2_OFFSETS,
  JPEG_V2_PBKDF2_ITERATIONS,
  JPEG_V2_PLAIN_SUITE,
  JPEG_V2_RESERVED_HEADER_COEFFICIENTS,
  JPEG_V2_VERSION,
  analyseJpegV2,
  decodeJpegV2Envelope,
  encodeJpegV2Carrier,
  encodeJpegV2Envelope,
  inspectJpegV2Carrier,
  unlockJpegV2Carrier,
  validateJpegV2Envelope,
} from "../../src/features/steganography/jpeg-v2";

const fixturePath = resolve(
  process.cwd(),
  "tests/fixtures/jpeg-v2/libjpeg-testorig.jpg",
);
const wasmPath = resolve(process.cwd(), "public/steg/jpeg-v2-codec.wasm");
const encoder = new TextEncoder();

function fixedRandom(values: Uint32Array) {
  values.fill(0);
  return values;
}

function deterministicCrypto(): CryptoProvider {
  let next = 1;
  return {
    subtle: crypto.subtle,
    getRandomValues<T extends ArrayBufferView | null>(values: T): T {
      if (!values) return values;
      const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
      for (let index = 0; index < bytes.byteLength; index += 1) {
        bytes[index] = next & 0xff;
        next += 1;
      }
      return values;
    },
  } as CryptoProvider;
}

describe("JPEG v2 envelope", () => {
  const plain = encodeJpegV2Envelope({
    cryptoSuite: JPEG_V2_PLAIN_SUITE,
    payloadLength: 5,
    iterations: 0,
    salt: new Uint8Array(16),
    nonce: new Uint8Array(12),
    digest: new Uint8Array(32).fill(0xa5),
    traversalStart: 17,
    traversalStep: 5,
  });

  it("uses the exact 84-byte big-endian v2 layout", () => {
    expect(plain).toHaveLength(JPEG_V2_HEADER_BYTES);
    expect(plain.subarray(0, 4)).toEqual(JPEG_V2_MAGIC);
    expect(plain[JPEG_V2_OFFSETS.version]).toBe(JPEG_V2_VERSION);
    expect(plain[JPEG_V2_OFFSETS.flags]).toBe(JPEG_V2_FLAGS);
    expect(plain[JPEG_V2_OFFSETS.embeddingSuite]).toBe(JPEG_V2_EMBEDDING_SUITE);
    expect(plain[JPEG_V2_OFFSETS.cryptoSuite]).toBe(JPEG_V2_PLAIN_SUITE);
    expect(Array.from(plain.subarray(8, 16))).toEqual([0, 0, 0, 5, 0, 0, 0, 0]);
    expect(Array.from(plain.subarray(76, 84))).toEqual([0, 0, 0, 17, 0, 0, 0, 5]);
    expect(JPEG_V2_RESERVED_HEADER_COEFFICIENTS).toBe(1_568);
    expect(decodeJpegV2Envelope(plain)).toMatchObject({
      cryptoSuite: JPEG_V2_PLAIN_SUITE,
      payloadLength: 5,
      iterations: 0,
      traversalStart: 17,
      traversalStep: 5,
    });
  });

  it("classifies magic, version, suite and canonical-field failures", () => {
    const valid = validateJpegV2Envelope(plain, 128, 10);
    expect(valid.kind).toBe("valid");

    const missingMagic = plain.slice();
    missingMagic[0] ^= 1;
    expect(validateJpegV2Envelope(missingMagic, 128, 10).kind).toBe("no-message");

    const version = plain.slice();
    version[JPEG_V2_OFFSETS.version] = 3;
    expect(validateJpegV2Envelope(version, 128, 10).kind).toBe("unsupported-version");

    const suite = plain.slice();
    suite[JPEG_V2_OFFSETS.embeddingSuite] = 3;
    expect(validateJpegV2Envelope(suite, 128, 10).kind).toBe("unsupported-format");

    const noncanonicalPlain = plain.slice();
    noncanonicalPlain[JPEG_V2_OFFSETS.salt] = 1;
    expect(validateJpegV2Envelope(noncanonicalPlain, 128, 10).kind).toBe("damaged");
  });

  it("requires the encrypted suite's exact KDF and zero digest", () => {
    const encrypted = encodeJpegV2Envelope({
      cryptoSuite: JPEG_V2_ENCRYPTED_SUITE,
      payloadLength: 17,
      iterations: JPEG_V2_PBKDF2_ITERATIONS,
      salt: new Uint8Array(16).fill(1),
      nonce: new Uint8Array(12).fill(2),
      digest: new Uint8Array(32),
      traversalStart: 0,
      traversalStep: 1,
    });
    expect(validateJpegV2Envelope(encrypted, 128, 20).kind).toBe("valid");
    encrypted[JPEG_V2_OFFSETS.digest] = 1;
    expect(validateJpegV2Envelope(encrypted, 128, 20).kind).toBe("damaged");
  });
});

describe("JPEG v2 pinned WASM integration", () => {
  let source: Uint8Array;

  beforeAll(async () => {
    const [fixture, wasm] = await Promise.all([readFile(fixturePath), readFile(wasmPath)]);
    source = new Uint8Array(fixture);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (!url.endsWith("/steg/jpeg-v2-codec.wasm")) {
          throw new Error(`Unexpected test fetch: ${url}`);
        }
        return new Response(wasm, {
          status: 200,
          headers: { "Content-Type": "application/wasm" },
        });
      }),
    );
  });

  it("analyses the accepted upstream fixture without pixel decoding", async () => {
    const capacity = await analyseJpegV2(source);
    expect(capacity).toMatchObject({
      format: "jpeg-v2",
      width: 227,
      height: 149,
      componentCount: 3,
      reservedHeaderCoefficientCount: 1_568,
    });
    expect(capacity.plainMessageCapacity).toBeGreaterThanOrEqual(5);
  });

  it("round-trips an exact plain UTF-8 message and rejects trailing input", async () => {
    const message = encoder.encode("v2 π");
    const encoded = await encodeJpegV2Carrier({
      source,
      message,
      randomSource: fixedRandom,
    });
    expect(encoded.bytes[0]).toBe(0xff);
    expect(encoded.bytes[1]).toBe(0xd8);
    expect(encoded.bytes.at(-2)).toBe(0xff);
    expect(encoded.bytes.at(-1)).toBe(0xd9);
    await expect(inspectJpegV2Carrier(encoded.bytes)).resolves.toEqual({
      kind: "plain-ready",
      message: "v2 π",
    });

    const trailing = new Uint8Array(source.byteLength + 1);
    trailing.set(source);
    await expect(analyseJpegV2(trailing)).rejects.toMatchObject({
      code: "malformed-jpeg",
    });
  });

  it("round-trips encrypted content and preserves retry semantics", async () => {
    const provider = deterministicCrypto();
    const password = encoder.encode("correct horse");
    const message = encoder.encode("secret");
    const encoded = await encodeJpegV2Carrier({
      source,
      message,
      password,
      randomSource: fixedRandom,
      cryptoProvider: provider,
    });
    const inspected = await inspectJpegV2Carrier(encoded.bytes, provider);
    expect(inspected.kind).toBe("password-required");
    if (inspected.kind !== "password-required") return;
    await expect(
      unlockJpegV2Carrier(inspected.header, inspected.payload, encoder.encode("wrong password"), provider),
    ).rejects.toMatchObject({ code: "unlock-failed" });
    await expect(
      unlockJpegV2Carrier(inspected.header, inspected.payload, password, provider),
    ).resolves.toBe("secret");
  });
});
