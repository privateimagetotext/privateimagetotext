import {
  DIGEST_BYTES,
  PBKDF2_ITERATIONS,
} from "./constants";
import { constantTimeEqual } from "./cleanup";
import { CodecError } from "./results";

export type CryptoProvider = Pick<Crypto, "subtle" | "getRandomValues">;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function sha256(
  bytes: Uint8Array,
  provider: CryptoProvider = crypto,
) {
  return new Uint8Array(
    await provider.subtle.digest("SHA-256", toArrayBuffer(bytes)),
  );
}

export async function verifyDigest(
  bytes: Uint8Array,
  expected: Uint8Array,
  provider: CryptoProvider = crypto,
) {
  if (expected.byteLength !== DIGEST_BYTES) return false;
  return constantTimeEqual(await sha256(bytes, provider), expected);
}

export async function deriveAesKey(
  passwordBytes: Uint8Array,
  salt: Uint8Array,
  usage: KeyUsage,
  provider: CryptoProvider = crypto,
) {
  const baseKey = await provider.subtle.importKey(
    "raw",
    toArrayBuffer(passwordBytes),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return provider.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

export async function encryptPayload(
  plaintext: Uint8Array,
  passwordBytes: Uint8Array,
  salt: Uint8Array,
  nonce: Uint8Array,
  header: Uint8Array,
  provider: CryptoProvider = crypto,
  onKeyDerived?: () => void,
) {
  const key = await deriveAesKey(
    passwordBytes,
    salt,
    "encrypt",
    provider,
  );
  onKeyDerived?.();
  return new Uint8Array(
    await provider.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(nonce),
        additionalData: toArrayBuffer(header),
        tagLength: 128,
      },
      key,
      toArrayBuffer(plaintext),
    ),
  );
}

export async function decryptPayload(
  payload: Uint8Array,
  passwordBytes: Uint8Array,
  salt: Uint8Array,
  nonce: Uint8Array,
  header: Uint8Array,
  provider: CryptoProvider = crypto,
  onKeyDerived?: () => void,
) {
  try {
    const key = await deriveAesKey(
      passwordBytes,
      salt,
      "decrypt",
      provider,
    );
    onKeyDerived?.();
    return new Uint8Array(
      await provider.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: toArrayBuffer(nonce),
          additionalData: toArrayBuffer(header),
          tagLength: 128,
        },
        key,
        toArrayBuffer(payload),
      ),
    );
  } catch {
    throw new CodecError("unlock-failed");
  }
}
