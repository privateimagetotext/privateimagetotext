import { constantTimeEqual } from "../codec/cleanup";
import { validatePermutation } from "../codec/permutation";
import {
  JPEG_V2_AES_GCM_TAG_BYTES,
  JPEG_V2_EMBEDDING_SUITE,
  JPEG_V2_ENCRYPTED_SUITE,
  JPEG_V2_FLAGS,
  JPEG_V2_HEADER_BYTES,
  JPEG_V2_MAGIC,
  JPEG_V2_MAX_MESSAGE_BYTES,
  JPEG_V2_OFFSETS,
  JPEG_V2_PBKDF2_ITERATIONS,
  JPEG_V2_PLAIN_SUITE,
  JPEG_V2_VERSION,
} from "./constants";

export type JpegV2Envelope = Readonly<{
  cryptoSuite: 0 | 1;
  payloadLength: number;
  iterations: number;
  salt: Uint8Array;
  nonce: Uint8Array;
  digest: Uint8Array;
  traversalStart: number;
  traversalStep: number;
}>;

function allZero(bytes: Uint8Array) {
  let combined = 0;
  for (const byte of bytes) combined |= byte;
  return combined === 0;
}

export function encodeJpegV2Envelope(fields: JpegV2Envelope) {
  if (
    fields.salt.byteLength !== 16 ||
    fields.nonce.byteLength !== 12 ||
    fields.digest.byteLength !== 32
  ) {
    throw new RangeError("Invalid JPEG v2 envelope field length");
  }
  const bytes = new Uint8Array(JPEG_V2_HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  bytes.set(JPEG_V2_MAGIC, JPEG_V2_OFFSETS.magic);
  bytes[JPEG_V2_OFFSETS.version] = JPEG_V2_VERSION;
  bytes[JPEG_V2_OFFSETS.flags] = JPEG_V2_FLAGS;
  bytes[JPEG_V2_OFFSETS.embeddingSuite] = JPEG_V2_EMBEDDING_SUITE;
  bytes[JPEG_V2_OFFSETS.cryptoSuite] = fields.cryptoSuite;
  view.setUint32(JPEG_V2_OFFSETS.payloadLength, fields.payloadLength, false);
  view.setUint32(JPEG_V2_OFFSETS.iterations, fields.iterations, false);
  bytes.set(fields.salt, JPEG_V2_OFFSETS.salt);
  bytes.set(fields.nonce, JPEG_V2_OFFSETS.nonce);
  bytes.set(fields.digest, JPEG_V2_OFFSETS.digest);
  view.setUint32(JPEG_V2_OFFSETS.traversalStart, fields.traversalStart, false);
  view.setUint32(JPEG_V2_OFFSETS.traversalStep, fields.traversalStep, false);
  return bytes;
}

export function decodeJpegV2Envelope(bytes: Uint8Array): JpegV2Envelope | null {
  if (bytes.byteLength !== JPEG_V2_HEADER_BYTES) return null;
  const cryptoSuite = bytes[JPEG_V2_OFFSETS.cryptoSuite];
  if (cryptoSuite !== JPEG_V2_PLAIN_SUITE && cryptoSuite !== JPEG_V2_ENCRYPTED_SUITE) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    cryptoSuite,
    payloadLength: view.getUint32(JPEG_V2_OFFSETS.payloadLength, false),
    iterations: view.getUint32(JPEG_V2_OFFSETS.iterations, false),
    salt: bytes.slice(JPEG_V2_OFFSETS.salt, JPEG_V2_OFFSETS.salt + 16),
    nonce: bytes.slice(JPEG_V2_OFFSETS.nonce, JPEG_V2_OFFSETS.nonce + 12),
    digest: bytes.slice(JPEG_V2_OFFSETS.digest, JPEG_V2_OFFSETS.digest + 32),
    traversalStart: view.getUint32(JPEG_V2_OFFSETS.traversalStart, false),
    traversalStep: view.getUint32(JPEG_V2_OFFSETS.traversalStep, false),
  };
}

export type JpegV2EnvelopeValidation =
  | { readonly kind: "no-message" }
  | { readonly kind: "unsupported-version" }
  | { readonly kind: "unsupported-format" }
  | { readonly kind: "damaged" }
  | { readonly kind: "valid"; readonly envelope: JpegV2Envelope };

export function validateJpegV2Envelope(
  bytes: Uint8Array,
  physicalDomainSize: number,
  physicalPayloadCapacity: number,
): JpegV2EnvelopeValidation {
  if (bytes.byteLength !== JPEG_V2_HEADER_BYTES) return { kind: "damaged" };
  if (!constantTimeEqual(bytes.subarray(0, 4), JPEG_V2_MAGIC)) return { kind: "no-message" };
  if (bytes[JPEG_V2_OFFSETS.version] !== JPEG_V2_VERSION) return { kind: "unsupported-version" };
  if (bytes[JPEG_V2_OFFSETS.flags] !== JPEG_V2_FLAGS) return { kind: "damaged" };
  if (bytes[JPEG_V2_OFFSETS.embeddingSuite] !== JPEG_V2_EMBEDDING_SUITE) {
    return { kind: "unsupported-format" };
  }
  const envelope = decodeJpegV2Envelope(bytes);
  if (!envelope) return { kind: "unsupported-format" };
  if (
    !Number.isSafeInteger(physicalPayloadCapacity) ||
    physicalPayloadCapacity < 0 ||
    !validatePermutation(envelope.traversalStart, envelope.traversalStep, physicalDomainSize) ||
    envelope.payloadLength < 1 ||
    envelope.payloadLength > physicalPayloadCapacity
  ) {
    return { kind: "damaged" };
  }
  if (envelope.cryptoSuite === JPEG_V2_PLAIN_SUITE) {
    if (
      envelope.payloadLength > JPEG_V2_MAX_MESSAGE_BYTES ||
      envelope.iterations !== 0 ||
      !allZero(envelope.salt) ||
      !allZero(envelope.nonce)
    ) {
      return { kind: "damaged" };
    }
  } else if (
    envelope.payloadLength <= JPEG_V2_AES_GCM_TAG_BYTES ||
    envelope.payloadLength > JPEG_V2_MAX_MESSAGE_BYTES + JPEG_V2_AES_GCM_TAG_BYTES ||
    envelope.iterations !== JPEG_V2_PBKDF2_ITERATIONS ||
    !allZero(envelope.digest)
  ) {
    return { kind: "damaged" };
  }
  return { kind: "valid", envelope };
}
