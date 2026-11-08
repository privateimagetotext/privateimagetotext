import {
  DIGEST_BYTES,
  EMBEDDING_SUITE,
  ENCRYPTED_SUITE,
  FLAGS,
  HEADER_BYTES,
  HEADER_OFFSETS,
  MAGIC,
  MAX_ENCRYPTED_PAYLOAD_BYTES,
  MAX_MESSAGE_BYTES,
  NONCE_BYTES,
  PBKDF2_ITERATIONS,
  PLAIN_SUITE,
  SALT_BYTES,
  VERSION,
  type CryptoSuite,
} from "./constants";
import { constantTimeEqual } from "./cleanup";
import { validatePermutation } from "./permutation";

export type Envelope = {
  readonly version: number;
  readonly flags: number;
  readonly embeddingSuite: number;
  readonly cryptoSuite: CryptoSuite;
  readonly payloadLength: number;
  readonly iterations: number;
  readonly salt: Uint8Array;
  readonly nonce: Uint8Array;
  readonly digest: Uint8Array;
  readonly permutationStart: number;
  readonly permutationStep: number;
};

export type EnvelopeFields = Omit<
  Envelope,
  "version" | "flags" | "embeddingSuite"
>;

export type EnvelopeValidation =
  | { readonly kind: "no-message" }
  | { readonly kind: "unsupported-version" }
  | { readonly kind: "unsupported-format" }
  | { readonly kind: "damaged" }
  | {
      readonly kind: "valid";
      readonly envelope: Envelope;
      readonly raw: Uint8Array;
    };

function copyRange(bytes: Uint8Array, offset: number, length: number) {
  return bytes.slice(offset, offset + length);
}
function allZero(bytes: Uint8Array) {
  let combined = 0;
  for (const value of bytes) combined |= value;
  return combined === 0;
}

export function encodeEnvelope(fields: EnvelopeFields) {
  if (
    fields.salt.byteLength !== SALT_BYTES ||
    fields.nonce.byteLength !== NONCE_BYTES ||
    fields.digest.byteLength !== DIGEST_BYTES
  ) {
    throw new RangeError("Invalid envelope field length");
  }
  const bytes = new Uint8Array(HEADER_BYTES);
  bytes.set(MAGIC, HEADER_OFFSETS.magic);
  bytes[HEADER_OFFSETS.version] = VERSION;
  bytes[HEADER_OFFSETS.flags] = FLAGS;
  bytes[HEADER_OFFSETS.embeddingSuite] = EMBEDDING_SUITE;
  bytes[HEADER_OFFSETS.cryptoSuite] = fields.cryptoSuite;
  const view = new DataView(bytes.buffer);
  view.setUint32(HEADER_OFFSETS.payloadLength, fields.payloadLength, false);
  view.setUint32(HEADER_OFFSETS.iterations, fields.iterations, false);
  bytes.set(fields.salt, HEADER_OFFSETS.salt);
  bytes.set(fields.nonce, HEADER_OFFSETS.nonce);
  bytes.set(fields.digest, HEADER_OFFSETS.digest);
  view.setUint32(
    HEADER_OFFSETS.permutationStart,
    fields.permutationStart,
    false,
  );
  view.setUint32(
    HEADER_OFFSETS.permutationStep,
    fields.permutationStep,
    false,
  );
  return bytes;
}

export function decodeEnvelope(bytes: Uint8Array): Envelope | null {
  if (bytes.byteLength !== HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cryptoSuite = bytes[HEADER_OFFSETS.cryptoSuite];
  if (cryptoSuite !== PLAIN_SUITE && cryptoSuite !== ENCRYPTED_SUITE) {
    return null;
  }
  return {
    version: bytes[HEADER_OFFSETS.version],
    flags: bytes[HEADER_OFFSETS.flags],
    embeddingSuite: bytes[HEADER_OFFSETS.embeddingSuite],
    cryptoSuite,
    payloadLength: view.getUint32(HEADER_OFFSETS.payloadLength, false),
    iterations: view.getUint32(HEADER_OFFSETS.iterations, false),
    salt: copyRange(bytes, HEADER_OFFSETS.salt, SALT_BYTES),
    nonce: copyRange(bytes, HEADER_OFFSETS.nonce, NONCE_BYTES),
    digest: copyRange(bytes, HEADER_OFFSETS.digest, DIGEST_BYTES),
    permutationStart: view.getUint32(
      HEADER_OFFSETS.permutationStart,
      false,
    ),
    permutationStep: view.getUint32(
      HEADER_OFFSETS.permutationStep,
      false,
    ),
  };
}

export function validateEnvelope(
  bytes: Uint8Array,
  domainSize: number,
  embeddedByteCapacity: number,
): EnvelopeValidation {
  if (bytes.byteLength !== HEADER_BYTES) return { kind: "damaged" };
  if (!constantTimeEqual(bytes.subarray(0, MAGIC.byteLength), MAGIC)) {
    return { kind: "no-message" };
  }
  if (bytes[HEADER_OFFSETS.version] !== VERSION) {
    return { kind: "unsupported-version" };
  }
  if (bytes[HEADER_OFFSETS.flags] !== FLAGS) return { kind: "damaged" };
  if (bytes[HEADER_OFFSETS.embeddingSuite] !== EMBEDDING_SUITE) {
    return { kind: "unsupported-format" };
  }
  const suite = bytes[HEADER_OFFSETS.cryptoSuite];
  if (suite !== PLAIN_SUITE && suite !== ENCRYPTED_SUITE) {
    return { kind: "unsupported-format" };
  }
  const envelope = decodeEnvelope(bytes);
  if (!envelope) return { kind: "unsupported-format" };
  if (
    !Number.isSafeInteger(embeddedByteCapacity) ||
    embeddedByteCapacity < 0 ||
    !validatePermutation(
      envelope.permutationStart,
      envelope.permutationStep,
      domainSize,
    )
  ) {
    return { kind: "damaged" };
  }

  if (envelope.cryptoSuite === PLAIN_SUITE) {
    if (
      envelope.iterations !== 0 ||
      !allZero(envelope.salt) ||
      !allZero(envelope.nonce) ||
      envelope.payloadLength < 1 ||
      envelope.payloadLength > MAX_MESSAGE_BYTES ||
      envelope.payloadLength > embeddedByteCapacity
    ) {
      return { kind: "damaged" };
    }
  } else if (
    envelope.iterations !== PBKDF2_ITERATIONS ||
    !allZero(envelope.digest) ||
    envelope.payloadLength <= 16 ||
    envelope.payloadLength > MAX_ENCRYPTED_PAYLOAD_BYTES ||
    envelope.payloadLength > embeddedByteCapacity
  ) {
    return { kind: "damaged" };
  }

  return { kind: "valid", envelope, raw: bytes.slice() };
}
