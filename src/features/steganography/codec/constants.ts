export const HEADER_BYTES = 84;
export const HEADER_BITS = HEADER_BYTES * 8;
export const MAX_MESSAGE_BYTES = 1024 * 1024;
export const AES_GCM_TAG_BYTES = 16;
export const MAX_ENCRYPTED_PAYLOAD_BYTES =
  MAX_MESSAGE_BYTES + AES_GCM_TAG_BYTES;
export const PBKDF2_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
export const NONCE_BYTES = 12;
export const DIGEST_BYTES = 32;
export const MAGIC = new Uint8Array([0x4c, 0x54, 0x53, 0x47]);

export const HEADER_OFFSETS = {
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
} as const;

export const VERSION = 1;
export const FLAGS = 0;
export const EMBEDDING_SUITE = 1;
export const PLAIN_SUITE = 0;
export const ENCRYPTED_SUITE = 1;

export type CryptoSuite =
  | typeof PLAIN_SUITE
  | typeof ENCRYPTED_SUITE;
