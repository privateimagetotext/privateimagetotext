import { describe, expect, it, vi } from "vitest";

import {
  AES_GCM_TAG_BYTES,
  DIGEST_BYTES,
  EMBEDDING_SUITE,
  ENCRYPTED_SUITE,
  FLAGS,
  HEADER_BITS,
  HEADER_BYTES,
  HEADER_OFFSETS,
  MAGIC,
  MAX_ENCRYPTED_PAYLOAD_BYTES,
  MAX_MESSAGE_BYTES,
  NONCE_BYTES,
  PLAIN_SUITE,
  SALT_BYTES,
  VERSION,
  analyseCapacity,
  constantTimeEqual,
  containsUnpairedSurrogate,
  decodeEnvelope,
  decodeMessage,
  encodeCarrier,
  encodeEnvelope,
  encodeMessage,
  encryptPayload,
  generatePermutation,
  greatestCommonDivisor,
  inspectCarrier,
  messageByteLength,
  passwordsMatch,
  preparePassword,
  readPayload,
  readSequentialHeader,
  sha256,
  unlockCarrier,
  validateEnvelope,
  validatePermutation,
  writePayload,
  writeSequentialHeader,
  zeroBuffer,
  type CryptoProvider,
  type RandomSource,
} from "../../src/features/steganography/codec";

const encoder = new TextEncoder();

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string) {
  return new Uint8Array(value.match(/../g)?.map((part) => Number.parseInt(part, 16)) ?? []);
}

function opaqueCarrier(width: number, height: number, rgb = 0xa0) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = rgb;
    pixels[offset + 1] = rgb;
    pixels[offset + 2] = rgb;
    pixels[offset + 3] = 255;
  }
  return pixels;
}

const plainMessage = encoder.encode("Line 1\nπ🙂");
const plainDigest = fromHex(
  "dbfcdce5f2a6467669326e2e77554ce14c5a3117b736c37625702a6b3e9b132a",
);
const plainHeaderHex =
  "4c545347010001000000000d0000000000000000000000000000000000000000000000000000000000000000dbfcdce5f2a6467669326e2e77554ce14c5a3117b736c37625702a6b3e9b132a000002a500000005";
const encryptedHeaderHex =
  "4c545347010001010000001d000927c0000102030405060708090a0b0c0d0e0fa0a1a2a3a4a5a6a7a8a9aaab0000000000000000000000000000000000000000000000000000000000000000000003e900000005";
const encryptedPayloadHex =
  "0fcf1426f648ccef238d88b2b7f96f282b196d99ae9af411e94bad109b";

describe("v1 envelope", () => {
  const header = encodeEnvelope({
    cryptoSuite: PLAIN_SUITE,
    payloadLength: plainMessage.byteLength,
    iterations: 0,
    salt: new Uint8Array(SALT_BYTES),
    nonce: new Uint8Array(NONCE_BYTES),
    digest: plainDigest,
    permutationStart: 677,
    permutationStep: 5,
  });

  it("is exactly 84 bytes with fixed field offsets and identifiers", () => {
    expect(header).toHaveLength(HEADER_BYTES);
    expect(HEADER_BYTES).toBe(84);
    expect(HEADER_BITS).toBe(672);
    expect(header.slice(HEADER_OFFSETS.magic, 4)).toEqual(MAGIC);
    expect(header[HEADER_OFFSETS.version]).toBe(VERSION);
    expect(header[HEADER_OFFSETS.flags]).toBe(FLAGS);
    expect(header[HEADER_OFFSETS.embeddingSuite]).toBe(EMBEDDING_SUITE);
    expect(header[HEADER_OFFSETS.cryptoSuite]).toBe(PLAIN_SUITE);
    expect(HEADER_OFFSETS).toEqual({
      magic: 0,
      version: 4,
      flags: 5,
      embeddingSuite: 6,
      cryptoSuite: 7,
      payloadLength: 8,
      iterations: 12,
      salt: 16,
      nonce: 32,
      digest: 44,
      permutationStart: 76,
      permutationStep: 80,
    });
  });

  it("encodes big-endian integers and the exact published plain vector", () => {
    expect(hex(header)).toBe(plainHeaderHex);
    expect(Array.from(header.slice(8, 12))).toEqual([0, 0, 0, 13]);
    expect(Array.from(header.slice(76, 84))).toEqual([
      0, 0, 2, 0xa5, 0, 0, 0, 5,
    ]);
  });

  it("uses canonical plain zero fields", () => {
    expect(header.slice(12, 44)).toEqual(new Uint8Array(32));
    expect(header.slice(44, 76)).toEqual(plainDigest);
  });

  it.each([
    ["unsupported-version", HEADER_OFFSETS.version, 2],
    ["damaged", HEADER_OFFSETS.flags, 1],
    ["unsupported-format", HEADER_OFFSETS.embeddingSuite, 2],
    ["unsupported-format", HEADER_OFFSETS.cryptoSuite, 2],
  ] as const)("returns %s for a malformed identifier", (kind, offset, value) => {
    const changed = header.slice();
    changed[offset] = value;
    expect(validateEnvelope(changed, 1536, 108).kind).toBe(kind);
  });

  it("returns no-message only when magic is absent", () => {
    const changed = header.slice();
    changed[0] ^= 1;
    expect(validateEnvelope(changed, 1536, 108)).toEqual({ kind: "no-message" });
  });

  it.each([
    [HEADER_OFFSETS.iterations + 3, 1, "non-canonical iterations"],
    [HEADER_OFFSETS.salt, 1, "non-canonical salt"],
    [HEADER_OFFSETS.nonce, 1, "non-canonical nonce"],
  ] as const)("rejects %s", (offset, value, _description) => {
    const changed = header.slice();
    changed[offset] = value;
    expect(validateEnvelope(changed, 1536, 108).kind).toBe("damaged");
  });

  it("rejects non-zero encrypted digest and arbitrary iterations", () => {
    const encrypted = fromHex(encryptedHeaderHex);
    encrypted[HEADER_OFFSETS.digest] = 1;
    expect(validateEnvelope(encrypted, 1536, 108).kind).toBe("damaged");
    encrypted[HEADER_OFFSETS.digest] = 0;
    encrypted[HEADER_OFFSETS.iterations + 3] ^= 1;
    expect(validateEnvelope(encrypted, 1536, 108).kind).toBe("damaged");
  });

  it.each([
    [PLAIN_SUITE, 0, "damaged"],
    [PLAIN_SUITE, MAX_MESSAGE_BYTES + 1, "damaged"],
    [ENCRYPTED_SUITE, AES_GCM_TAG_BYTES, "damaged"],
    [ENCRYPTED_SUITE, MAX_ENCRYPTED_PAYLOAD_BYTES + 1, "damaged"],
  ] as const)("rejects suite %s payload length %s", (suite, length, kind) => {
    const base = suite === PLAIN_SUITE ? header : fromHex(encryptedHeaderHex);
    const changed = base.slice();
    new DataView(changed.buffer).setUint32(HEADER_OFFSETS.payloadLength, length, false);
    expect(validateEnvelope(changed, 1536, Number.MAX_SAFE_INTEGER).kind).toBe(kind);
  });

  it("rejects lengths beyond the available carrier capacity", () => {
    expect(validateEnvelope(header, 1536, 12).kind).toBe("damaged");
  });

  it.each([
    [1536, 5],
    [1, 1536],
    [1, 6],
  ])("rejects invalid permutation start %s and step %s", (start, step) => {
    const changed = header.slice();
    const view = new DataView(changed.buffer);
    view.setUint32(HEADER_OFFSETS.permutationStart, start, false);
    view.setUint32(HEADER_OFFSETS.permutationStep, step, false);
    expect(validateEnvelope(changed, 1536, 108).kind).toBe("damaged");
  });
});

describe("Unicode and password preparation", () => {
  it("round-trips exact Unicode, newline forms, whitespace and a leading BOM", () => {
    const values = ["秘密🙂", "line 1\nline 2", "line 1\r\nline 2", "  kept  ", "\ufeffstart"];
    for (const value of values) {
      expect(decodeMessage(encodeMessage(value))).toBe(value);
    }
  });

  it("rejects empty messages, unpaired surrogates and invalid UTF-8", () => {
    expect(() => encodeMessage("")).toThrowError("invalid-message");
    expect(containsUnpairedSurrogate("\ud800")).toBe(true);
    expect(containsUnpairedSurrogate("\udc00")).toBe(true);
    expect(() => encodeMessage("x\ud800y")).toThrowError("invalid-message");
    expect(() => decodeMessage(new Uint8Array([0xc3, 0x28]))).toThrowError("damaged");
  });

  it("reports exact UTF-8 byte counts without normalising message content", () => {
    expect(messageByteLength("e\u0301")).toBe(3);
    expect(messageByteLength("é")).toBe(2);
    expect(messageByteLength("\ud800")).toBeNull();
  });

  it("enforces the exact one MiB boundary", () => {
    expect(encodeMessage("a".repeat(MAX_MESSAGE_BYTES))).toHaveLength(MAX_MESSAGE_BYTES);
    expect(() => encodeMessage("a".repeat(MAX_MESSAGE_BYTES + 1))).toThrowError(
      "invalid-message",
    );
  });

  it("normalises passwords to NFC and compares prepared values", () => {
    const decomposed = "pa\u0308ssphrase-012";
    const composed = "pässphrase-012";
    const prepared = preparePassword(decomposed);
    expect(prepared.normalised).toBe(composed);
    expect(prepared.bytes).toEqual(encoder.encode(composed));
    expect(passwordsMatch(decomposed, composed)).toBe(true);
  });

  it("counts password code points after NFC at both boundaries", () => {
    expect(preparePassword("🙂".repeat(12)).codePoints).toBe(12);
    expect(preparePassword("a".repeat(256)).codePoints).toBe(256);
    expect(() => preparePassword("a".repeat(11))).toThrowError("invalid-password");
    expect(() => preparePassword("a".repeat(257))).toThrowError("invalid-password");
    expect(() => preparePassword(`valid-password\ud800`)).toThrowError(
      "invalid-password",
    );
  });
});

describe("capacity and affine embedding", () => {
  it("subtracts the header and encrypted authentication tag exactly", () => {
    const pixels = opaqueCarrier(32, 16);
    expect(analyseCapacity(pixels, 32, 16)).toMatchObject({
      opaquePixelCount: 512,
      eligibleBits: 1536,
      embeddedByteCapacity: 108,
      plainMessageCapacity: 108,
      encryptedMessageCapacity: 92,
    });
  });

  it("reports insufficient header capacity", () => {
    const result = analyseCapacity(opaqueCarrier(223, 1), 223, 1);
    expect(result.eligibleBits).toBe(669);
    expect(result.embeddedByteCapacity).toBe(0);
  });

  it("writes and reads the header MSB-first in row-major R/G/B order", () => {
    const pixels = opaqueCarrier(32, 16);
    const header = fromHex(plainHeaderHex);
    const channels = writeSequentialHeader(pixels, 32, 16, header);
    expect(channels.slice(0, 6)).toEqual(new Uint32Array([0, 1, 2, 3, 4, 5]));
    expect(Array.from(pixels.slice(0, 8))).toEqual([
      0xa0, 0xa1, 0xa0, 0xff, 0xa0, 0xa1, 0xa1, 0xff,
    ]);
    expect(readSequentialHeader(pixels, 32, 16)?.bytes).toEqual(header);
  });

  it("matches the published plain raw-RGBA golden hash", async () => {
    const pixels = opaqueCarrier(32, 16);
    const header = fromHex(plainHeaderHex);
    const channels = writeSequentialHeader(pixels, 32, 16, header);
    writePayload(pixels, 32, 16, channels, 677, 5, plainMessage);
    expect(hex(await sha256(new Uint8Array(pixels.buffer)))).toBe(
      "f89db5db3ffa279ee7da0da573e4e256666e1203e569a033e45c948ad71c2073",
    );
    expect(Array.from(readPayload(pixels, 32, 16, channels, 677, 5, 13))).toEqual(
      Array.from(plainMessage),
    );
  });

  it("skips transparent pixels and preserves their RGB and every alpha", () => {
    const pixels = opaqueCarrier(40, 12, 0x6a);
    for (let pixel = 0; pixel < 40 * 12; pixel += 11) {
      pixels[pixel * 4] = 17;
      pixels[pixel * 4 + 1] = 33;
      pixels[pixel * 4 + 2] = 65;
      pixels[pixel * 4 + 3] = 128;
    }
    const before = pixels.slice();
    const header = encodeEnvelope({
      cryptoSuite: PLAIN_SUITE,
      payloadLength: 1,
      iterations: 0,
      salt: new Uint8Array(SALT_BYTES),
      nonce: new Uint8Array(NONCE_BYTES),
      digest: new Uint8Array(DIGEST_BYTES),
      permutationStart: 677,
      permutationStep: 7,
    });
    const channels = writeSequentialHeader(pixels, 40, 12, header);
    writePayload(pixels, 40, 12, channels, 677, 7, new Uint8Array([0xff]));
    for (let offset = 0; offset < pixels.length; offset += 4) {
      expect(pixels[offset + 3]).toBe(before[offset + 3]);
      if (before[offset + 3] < 255) {
        expect(pixels.slice(offset, offset + 4)).toEqual(before.slice(offset, offset + 4));
      }
      expect(pixels[offset] & 0xfe).toBe(before[offset] & 0xfe);
      expect(pixels[offset + 1] & 0xfe).toBe(before[offset + 1] & 0xfe);
      expect(pixels[offset + 2] & 0xfe).toBe(before[offset + 2] & 0xfe);
    }
  });

  it("visits the complete affine domain exactly once without an index map", () => {
    const domain = 1536;
    const values = new Set<number>();
    let current = 1001;
    for (let count = 0; count < domain; count += 1) {
      values.add(current);
      current = (current + 5) % domain;
    }
    expect(values.size).toBe(domain);
    expect(validatePermutation(1001, 5, domain)).toBe(true);
    expect(validatePermutation(0, 6, domain)).toBe(false);
    expect(greatestCommonDivisor(5, domain)).toBe(1);
  });

  it("uses unbiased rejection sampling and retries non-coprime steps", () => {
    const supplied = [0xffffffff, 7, 5, 2];
    const random: RandomSource = (target) => {
      target[0] = supplied.shift() ?? 0;
      return target;
    };
    const result = generatePermutation(10, random);
    expect(result).toEqual({ start: 7, step: 3 });
  });
});

describe("cryptography and complete codec", () => {
  it("matches the deterministic PBKDF2/AES-GCM vector with complete-header AAD", async () => {
    const header = fromHex(encryptedHeaderHex);
    const password = preparePassword("pässphrase-012").bytes;
    const payload = await encryptPayload(
      plainMessage,
      password,
      fromHex("000102030405060708090a0b0c0d0e0f"),
      fromHex("a0a1a2a3a4a5a6a7a8a9aaab"),
      header,
    );
    expect(hex(payload)).toBe(encryptedPayloadHex);
    expect(header.slice(44, 76)).toEqual(new Uint8Array(DIGEST_BYTES));
  });

  it("round-trips plain Unicode and detects digest damage", async () => {
    const pixels = opaqueCarrier(80, 40);
    const original = "exact\r\n秘密🙂";
    const encoded = await encodeCarrier({
      pixels,
      width: 80,
      height: 40,
      message: encodeMessage(original),
    });
    await expect(inspectCarrier(pixels, 80, 40)).resolves.toEqual({
      kind: "plain-ready",
      message: original,
    });
    const envelope = decodeEnvelope(encoded.header);
    expect(envelope).not.toBeNull();
    const headerChannels = readSequentialHeader(pixels, 80, 40)?.channels;
    expect(headerChannels).toBeDefined();
    const excluded = new Set(headerChannels);
    let physicalIndex = envelope?.permutationStart ?? 0;
    while (excluded.has(physicalIndex)) {
      physicalIndex =
        (physicalIndex + (envelope?.permutationStep ?? 1)) % (80 * 40 * 3);
    }
    const pixel = Math.floor(physicalIndex / 3);
    const offset = pixel * 4 + (physicalIndex % 3);
    pixels[offset] ^= 1;
    await expect(inspectCarrier(pixels, 80, 40)).resolves.toEqual({
      kind: "damaged",
    });
  });

  it("round-trips encrypted Unicode with the real 600,000-iteration suite", async () => {
    const pixels = opaqueCarrier(80, 40);
    const password = preparePassword("pässphrase-012").bytes;
    const original = "exact\n秘密🙂";
    await encodeCarrier({
      pixels,
      width: 80,
      height: 40,
      message: encodeMessage(original),
      password,
    });
    const inspected = await inspectCarrier(pixels, 80, 40);
    expect(inspected.kind).toBe("password-required");
    if (inspected.kind !== "password-required") return;
    await expect(
      unlockCarrier(inspected.header, inspected.payload, preparePassword("pässphrase-012").bytes),
    ).resolves.toBe(original);
    await expect(
      unlockCarrier(inspected.header, inspected.payload, preparePassword("wrong-password-012").bytes),
    ).rejects.toThrowError("unlock-failed");
  });

  it("rejects authenticated header and ciphertext tampering through one path", async () => {
    const header = fromHex(encryptedHeaderHex);
    const payload = fromHex(encryptedPayloadHex);
    const password = preparePassword("pässphrase-012").bytes;
    const changedHeader = header.slice();
    changedHeader[HEADER_OFFSETS.permutationStart + 3] ^= 1;
    await expect(unlockCarrier(changedHeader, payload, password)).rejects.toThrowError(
      "unlock-failed",
    );
    const changedPayload = payload.slice();
    changedPayload[0] ^= 1;
    await expect(unlockCarrier(header, changedPayload, password)).rejects.toThrowError(
      "unlock-failed",
    );
  });

  it("does not derive a key while structurally inspecting ordinary or malformed images", async () => {
    const provider: CryptoProvider = {
      subtle: {
        ...crypto.subtle,
        deriveKey: vi.fn(),
      } as unknown as SubtleCrypto,
      getRandomValues: crypto.getRandomValues.bind(crypto),
    };
    const ordinary = opaqueCarrier(32, 16);
    expect((await inspectCarrier(ordinary, 32, 16, provider)).kind).toBe("no-message");
    expect(provider.subtle.deriveKey).not.toHaveBeenCalled();
  });

  it("draws fresh salt, nonce and permutation for separate encrypted operations", async () => {
    const first = opaqueCarrier(80, 40);
    const second = opaqueCarrier(80, 40);
    const password = preparePassword("pässphrase-012").bytes;
    const message = encodeMessage("same message");
    const firstResult = await encodeCarrier({ pixels: first, width: 80, height: 40, message, password });
    const secondResult = await encodeCarrier({ pixels: second, width: 80, height: 40, message, password });
    expect(firstResult.header.slice(16, 44)).not.toEqual(secondResult.header.slice(16, 44));
    expect(firstResult.header.slice(76, 84)).not.toEqual(secondResult.header.slice(76, 84));
    expect(first).not.toEqual(second);
  });

  it("clears mutable buffers and compares digests without early content returns", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    zeroBuffer(bytes);
    expect(bytes).toEqual(new Uint8Array(3));
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(false);
  });
});
