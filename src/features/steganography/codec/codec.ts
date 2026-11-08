import {
  AES_GCM_TAG_BYTES,
  DIGEST_BYTES,
  ENCRYPTED_SUITE,
  NONCE_BYTES,
  PBKDF2_ITERATIONS,
  PLAIN_SUITE,
  SALT_BYTES,
} from "./constants";
import { analyseCapacity } from "./capacity";
import { zeroBuffer } from "./cleanup";
import {
  decryptPayload,
  encryptPayload,
  sha256,
  verifyDigest,
  type CryptoProvider,
} from "./crypto";
import {
  decodeEnvelope,
  encodeEnvelope,
  validateEnvelope,
} from "./envelope";
import {
  readPayload,
  readSequentialHeader,
  writePayload,
  writeSequentialHeader,
} from "./embedding";
import {
  generatePermutation,
  type RandomSource,
} from "./permutation";
import { CodecError, type InspectionResult } from "./results";
import { decodeMessage } from "./unicode";

export type EncodeOptions = {
  readonly pixels: Uint8Array | Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly message: Uint8Array;
  readonly password?: Uint8Array;
  readonly randomSource?: RandomSource;
  readonly cryptoProvider?: CryptoProvider;
};

function randomBytes(
  length: number,
  provider: CryptoProvider,
) {
  return provider.getRandomValues(new Uint8Array(length));
}
export async function encodeCarrier(options: EncodeOptions) {
  const {
    pixels,
    width,
    height,
    message,
    password,
    cryptoProvider = crypto,
  } = options;
  if (message.byteLength === 0) throw new CodecError("invalid-message");
  const capacity = analyseCapacity(pixels, width, height);
  const encrypted = password !== undefined;
  const messageCapacity = encrypted
    ? capacity.encryptedMessageCapacity
    : capacity.plainMessageCapacity;
  if (message.byteLength > messageCapacity) {
    throw new CodecError("capacity-unavailable");
  }
  const domainSize = width * height * 3;
  const permutation = generatePermutation(
    domainSize,
    options.randomSource,
  );
  let payload: Uint8Array;
  let header: Uint8Array;

  if (encrypted) {
    const salt = randomBytes(SALT_BYTES, cryptoProvider);
    const nonce = randomBytes(NONCE_BYTES, cryptoProvider);
    header = encodeEnvelope({
      cryptoSuite: ENCRYPTED_SUITE,
      payloadLength: message.byteLength + AES_GCM_TAG_BYTES,
      iterations: PBKDF2_ITERATIONS,
      salt,
      nonce,
      digest: new Uint8Array(DIGEST_BYTES),
      permutationStart: permutation.start,
      permutationStep: permutation.step,
    });
    payload = await encryptPayload(
      message,
      password,
      salt,
      nonce,
      header,
      cryptoProvider,
    );
  } else {
    const digest = await sha256(message, cryptoProvider);
    payload = message.slice();
    header = encodeEnvelope({
      cryptoSuite: PLAIN_SUITE,
      payloadLength: payload.byteLength,
      iterations: 0,
      salt: new Uint8Array(SALT_BYTES),
      nonce: new Uint8Array(NONCE_BYTES),
      digest,
      permutationStart: permutation.start,
      permutationStep: permutation.step,
    });
  }

  const headerChannels = writeSequentialHeader(
    pixels,
    width,
    height,
    header,
  );
  writePayload(
    pixels,
    width,
    height,
    headerChannels,
    permutation.start,
    permutation.step,
    payload,
  );
  if (payload !== message) zeroBuffer(payload);
  return { pixels, width, height, header };
}

export async function inspectCarrier(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  provider: CryptoProvider = crypto,
): Promise<InspectionResult> {
  const capacity = analyseCapacity(pixels, width, height);
  if (capacity.eligibleBits < 672) return { kind: "capacity-unavailable" };
  const headerRead = readSequentialHeader(pixels, width, height);
  if (!headerRead) return { kind: "capacity-unavailable" };
  const validation = validateEnvelope(
    headerRead.bytes,
    width * height * 3,
    capacity.embeddedByteCapacity,
  );
  if (validation.kind !== "valid") return validation;
  const { envelope, raw } = validation;
  let payload: Uint8Array;
  try {
    payload = readPayload(
      pixels,
      width,
      height,
      headerRead.channels,
      envelope.permutationStart,
      envelope.permutationStep,
      envelope.payloadLength,
    );
  } catch {
    return { kind: "damaged" };
  }
  if (envelope.cryptoSuite === PLAIN_SUITE) {
    if (!(await verifyDigest(payload, envelope.digest, provider))) {
      zeroBuffer(payload);
      return { kind: "damaged" };
    }
    try {
      const message = decodeMessage(payload);
      zeroBuffer(payload);
      return { kind: "plain-ready", message };
    } catch {
      zeroBuffer(payload);
      return { kind: "damaged" };
    }
  }
  return { kind: "password-required", header: raw, payload };
}

export async function unlockCarrier(
  header: Uint8Array,
  payload: Uint8Array,
  password: Uint8Array,
  provider: CryptoProvider = crypto,
) {
  const envelope = decodeEnvelope(header);
  if (!envelope || envelope.cryptoSuite !== ENCRYPTED_SUITE) {
    throw new CodecError("damaged");
  }
  const plaintext = await decryptPayload(
    payload,
    password,
    envelope.salt,
    envelope.nonce,
    header,
    provider,
  );
  try {
    return decodeMessage(plaintext);
  } catch {
    throw new CodecError("unlock-failed");
  } finally {
    zeroBuffer(plaintext);
  }
}
