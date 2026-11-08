import {
  constantTimeEqual,
  zeroBuffer,
} from "../codec/cleanup";
import {
  decryptPayload,
  encryptPayload,
  sha256,
  verifyDigest,
  type CryptoProvider,
} from "../codec/crypto";
import { generatePermutation, type RandomSource } from "../codec/permutation";
import { CodecError } from "../codec/results";
import { decodeMessage } from "../codec/unicode";
import {
  analyseJpegV2,
  encodeJpegV2Bytes,
  inspectJpegV2Bytes,
} from "./codec-adapter";
import {
  JPEG_V2_AES_GCM_TAG_BYTES,
  JPEG_V2_ENCRYPTED_SUITE,
  JPEG_V2_MAX_MESSAGE_BYTES,
  JPEG_V2_PBKDF2_ITERATIONS,
  JPEG_V2_PLAIN_SUITE,
} from "./constants";
import {
  decodeJpegV2Envelope,
  encodeJpegV2Envelope,
  validateJpegV2Envelope,
} from "./envelope";
import { JpegV2CodecError } from "./types";

export type JpegV2InspectionResult =
  | { readonly kind: "no-message" }
  | { readonly kind: "unsupported-version" }
  | { readonly kind: "unsupported-format" }
  | { readonly kind: "damaged" }
  | { readonly kind: "plain-ready"; readonly message: string }
  | { readonly kind: "password-required"; readonly header: Uint8Array; readonly payload: Uint8Array };

function randomBytes(length: number, provider: CryptoProvider) {
  return provider.getRandomValues(new Uint8Array(length));
}

function selfVerificationFailure(): never {
  throw new JpegV2CodecError("jpeg-self-verification-failed");
}

export async function encodeJpegV2Carrier(options: {
  source: Uint8Array;
  message: Uint8Array;
  password?: Uint8Array;
  randomSource?: RandomSource;
  cryptoProvider?: CryptoProvider;
  onStage?: (stage:
    | "hashing-message"
    | "deriving-encryption-key"
    | "encrypting-message"
    | "writing-jpeg"
    | "reopening-jpeg"
    | "verifying-output") => void;
}) {
  const { source, message, password, cryptoProvider = crypto } = options;
  if (message.byteLength < 1 || message.byteLength > JPEG_V2_MAX_MESSAGE_BYTES) {
    throw new CodecError("invalid-message");
  }
  const capacity = await analyseJpegV2(source);
  const encrypted = password !== undefined;
  const messageCapacity = encrypted
    ? capacity.encryptedMessageCapacity
    : capacity.plainMessageCapacity;
  if (message.byteLength > messageCapacity) throw new CodecError("capacity-unavailable");
  const traversal = generatePermutation(capacity.physicalDomainSize, options.randomSource);
  let header = new Uint8Array(0);
  let payload = new Uint8Array(0);
  let verificationHeader: Uint8Array | undefined;
  let verificationPayload: Uint8Array | undefined;
  let output: Uint8Array | undefined;
  let succeeded = false;
  try {
    if (encrypted) {
      const salt = randomBytes(16, cryptoProvider);
      const nonce = randomBytes(12, cryptoProvider);
      try {
        header = encodeJpegV2Envelope({
          cryptoSuite: JPEG_V2_ENCRYPTED_SUITE,
          payloadLength: message.byteLength + JPEG_V2_AES_GCM_TAG_BYTES,
          iterations: JPEG_V2_PBKDF2_ITERATIONS,
          salt,
          nonce,
          digest: new Uint8Array(32),
          traversalStart: traversal.start,
          traversalStep: traversal.step,
        });
        options.onStage?.("deriving-encryption-key");
        payload = await encryptPayload(
          message,
          password,
          salt,
          nonce,
          header,
          cryptoProvider,
          () => options.onStage?.("encrypting-message"),
        );
      } finally {
        zeroBuffer(salt);
        zeroBuffer(nonce);
      }
    } else {
      options.onStage?.("hashing-message");
      header = encodeJpegV2Envelope({
        cryptoSuite: JPEG_V2_PLAIN_SUITE,
        payloadLength: message.byteLength,
        iterations: 0,
        salt: new Uint8Array(16),
        nonce: new Uint8Array(12),
        digest: await sha256(message, cryptoProvider),
        traversalStart: traversal.start,
        traversalStep: traversal.step,
      });
      payload = message.slice();
    }

    options.onStage?.("writing-jpeg");
    output = await encodeJpegV2Bytes(source, header, payload);
    options.onStage?.("reopening-jpeg");
    const verification = await inspectJpegV2Bytes(output);
    if (
      verification.kind !== "payload" ||
      !constantTimeEqual(verification.header, header) ||
      !constantTimeEqual(verification.payload, payload)
    ) {
      zeroBuffer(output);
      selfVerificationFailure();
    }
    verificationHeader = verification.header;
    verificationPayload = verification.payload;
    options.onStage?.("verifying-output");
    if (encrypted) {
      const envelope = decodeJpegV2Envelope(verification.header);
      if (!envelope) {
        zeroBuffer(output);
        selfVerificationFailure();
      }
      const recovered = await decryptPayload(
        verification.payload,
        password,
        envelope.salt,
        envelope.nonce,
        verification.header,
        cryptoProvider,
      );
      const matches = constantTimeEqual(recovered, message);
      zeroBuffer(recovered);
      if (!matches) {
        zeroBuffer(output);
        selfVerificationFailure();
      }
    } else if (!(await verifyDigest(verification.payload, header.subarray(44, 76), cryptoProvider))) {
      zeroBuffer(output);
      selfVerificationFailure();
    }
    succeeded = true;
    return { bytes: output, capacity };
  } finally {
    zeroBuffer(header);
    zeroBuffer(payload);
    zeroBuffer(verificationHeader);
    zeroBuffer(verificationPayload);
    if (!succeeded) zeroBuffer(output);
  }
}

export async function inspectJpegV2Carrier(
  source: Uint8Array,
  provider: CryptoProvider = crypto,
): Promise<JpegV2InspectionResult> {
  const result = await inspectJpegV2Bytes(source);
  if (result.kind !== "payload") return result;
  const validation = validateJpegV2Envelope(
    result.header,
    result.capacity.physicalDomainSize,
    result.capacity.embeddedByteCapacity,
  );
  if (validation.kind !== "valid") {
    zeroBuffer(result.header);
    zeroBuffer(result.payload);
    return validation;
  }
  if (validation.envelope.cryptoSuite === JPEG_V2_PLAIN_SUITE) {
    const valid = await verifyDigest(result.payload, validation.envelope.digest, provider);
    if (!valid) {
      zeroBuffer(result.header);
      zeroBuffer(result.payload);
      return { kind: "damaged" };
    }
    try {
      return { kind: "plain-ready", message: decodeMessage(result.payload) };
    } catch {
      return { kind: "damaged" };
    } finally {
      zeroBuffer(result.header);
      zeroBuffer(result.payload);
    }
  }
  return { kind: "password-required", header: result.header, payload: result.payload };
}

export async function unlockJpegV2Carrier(
  header: Uint8Array,
  payload: Uint8Array,
  password: Uint8Array,
  provider: CryptoProvider = crypto,
  onKeyDerived?: () => void,
) {
  const envelope = decodeJpegV2Envelope(header);
  if (!envelope || envelope.cryptoSuite !== JPEG_V2_ENCRYPTED_SUITE) {
    throw new CodecError("unlock-failed");
  }
  const plaintext = await decryptPayload(
    payload,
    password,
    envelope.salt,
    envelope.nonce,
    header,
    provider,
    onKeyDerived,
  );
  try {
    return decodeMessage(plaintext);
  } catch {
    throw new CodecError("unlock-failed");
  } finally {
    zeroBuffer(plaintext);
  }
}
