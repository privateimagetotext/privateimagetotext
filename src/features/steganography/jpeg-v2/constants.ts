export const JPEG_V2_HEADER_BYTES = 84;
export const JPEG_V2_RESERVED_HEADER_COEFFICIENTS = 1_568;
export const JPEG_V2_VERSION = 2;
export const JPEG_V2_FLAGS = 0;
export const JPEG_V2_EMBEDDING_SUITE = 2;
export const JPEG_V2_PLAIN_SUITE = 0;
export const JPEG_V2_ENCRYPTED_SUITE = 1;
export const JPEG_V2_MAX_MESSAGE_BYTES = 1_024 * 1_024;
export const JPEG_V2_AES_GCM_TAG_BYTES = 16;
export const JPEG_V2_PBKDF2_ITERATIONS = 600_000;
export const JPEG_V2_WASM_PATH = "/steg/jpeg-v2-codec.wasm";

export const JPEG_V2_OFFSETS = {
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
  traversalStart: 76,
  traversalStep: 80,
} as const;

export const JPEG_V2_MAGIC = new Uint8Array([0x4c, 0x54, 0x53, 0x47]);
