import { MediaInspectionError, throwIfAborted } from "./errors";
import { MEDIA_INSPECTION_LIMITS, type HashBlobOptions } from "./types";

const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, bits: number) {
  return (value >>> bits) | (value << (32 - bits));
}

class IncrementalSha256 {
  readonly #state = new Uint32Array([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ]);
  readonly #buffer = new Uint8Array(64);
  readonly #words = new Uint32Array(64);
  #bufferLength = 0;
  #bytesHashed = 0;
  #finished = false;

  update(input: Uint8Array) {
    if (this.#finished) {
      throw new MediaInspectionError("hash-unavailable", "The SHA-256 state is already finalised.");
    }
    if (this.#bytesHashed > Number.MAX_SAFE_INTEGER - input.byteLength) {
      throw new MediaInspectionError("file-too-large", "The file is too large to hash safely.");
    }
    this.#bytesHashed += input.byteLength;
    let offset = 0;
    while (offset < input.byteLength) {
      const copied = Math.min(64 - this.#bufferLength, input.byteLength - offset);
      this.#buffer.set(input.subarray(offset, offset + copied), this.#bufferLength);
      this.#bufferLength += copied;
      offset += copied;
      if (this.#bufferLength === 64) {
        this.#compress(this.#buffer);
        this.#bufferLength = 0;
      }
    }
  }

  digestHex() {
    if (this.#finished) {
      throw new MediaInspectionError("hash-unavailable", "The SHA-256 state is already finalised.");
    }
    this.#finished = true;
    this.#buffer[this.#bufferLength] = 0x80;
    this.#bufferLength += 1;
    if (this.#bufferLength > 56) {
      this.#buffer.fill(0, this.#bufferLength);
      this.#compress(this.#buffer);
      this.#bufferLength = 0;
    }
    this.#buffer.fill(0, this.#bufferLength, 56);

    const bitLengthHigh = Math.floor(this.#bytesHashed / 0x2000_0000);
    const bitLengthLow = (this.#bytesHashed << 3) >>> 0;
    this.#buffer[56] = (bitLengthHigh >>> 24) & 0xff;
    this.#buffer[57] = (bitLengthHigh >>> 16) & 0xff;
    this.#buffer[58] = (bitLengthHigh >>> 8) & 0xff;
    this.#buffer[59] = bitLengthHigh & 0xff;
    this.#buffer[60] = (bitLengthLow >>> 24) & 0xff;
    this.#buffer[61] = (bitLengthLow >>> 16) & 0xff;
    this.#buffer[62] = (bitLengthLow >>> 8) & 0xff;
    this.#buffer[63] = bitLengthLow & 0xff;
    this.#compress(this.#buffer);

    return Array.from(this.#state, (value) => value.toString(16).padStart(8, "0")).join("");
  }

  #compress(chunk: Uint8Array) {
    const words = this.#words;
    for (let index = 0; index < 16; index += 1) {
      const offset = index * 4;
      words[index] =
        (chunk[offset] << 24) |
        (chunk[offset + 1] << 16) |
        (chunk[offset + 2] << 8) |
        chunk[offset + 3];
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15];
      const previous2 = words[index - 2];
      const sigma0 =
        rotateRight(previous15, 7) ^
        rotateRight(previous15, 18) ^
        (previous15 >>> 3);
      const sigma1 =
        rotateRight(previous2, 17) ^
        rotateRight(previous2, 19) ^
        (previous2 >>> 10);
      words[index] =
        (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let a = this.#state[0];
    let b = this.#state[1];
    let c = this.#state[2];
    let d = this.#state[3];
    let e = this.#state[4];
    let f = this.#state[5];
    let g = this.#state[6];
    let h = this.#state[7];

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choose + ROUND_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    this.#state[0] = (this.#state[0] + a) >>> 0;
    this.#state[1] = (this.#state[1] + b) >>> 0;
    this.#state[2] = (this.#state[2] + c) >>> 0;
    this.#state[3] = (this.#state[3] + d) >>> 0;
    this.#state[4] = (this.#state[4] + e) >>> 0;
    this.#state[5] = (this.#state[5] + f) >>> 0;
    this.#state[6] = (this.#state[6] + g) >>> 0;
    this.#state[7] = (this.#state[7] + h) >>> 0;
  }
}

export async function sha256Blob(blob: Blob, options: HashBlobOptions = {}) {
  const maxBytes = options.maxBytes ?? MEDIA_INSPECTION_LIMITS.maxHashBytes;
  const chunkBytes = options.chunkBytes ?? MEDIA_INSPECTION_LIMITS.hashChunkBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new MediaInspectionError("invalid-range", "The hash byte limit is invalid.");
  }
  if (
    !Number.isSafeInteger(chunkBytes) ||
    chunkBytes <= 0 ||
    chunkBytes > MEDIA_INSPECTION_LIMITS.maxSliceBytes
  ) {
    throw new MediaInspectionError("invalid-range", "The hash chunk size is invalid.");
  }
  if (!Number.isSafeInteger(blob.size) || blob.size < 0 || blob.size > maxBytes) {
    throw new MediaInspectionError(
      "file-too-large",
      "The selected file exceeds the configured SHA-256 limit.",
    );
  }

  const hash = new IncrementalSha256();
  let offset = 0;
  options.onProgress?.({ processedBytes: 0, totalBytes: blob.size });
  while (offset < blob.size) {
    throwIfAborted(options.signal);
    const length = Math.min(chunkBytes, blob.size - offset);
    let buffer: ArrayBuffer;
    try {
      buffer = await blob.slice(offset, offset + length).arrayBuffer();
    } catch (error) {
      throwIfAborted(options.signal);
      throw new MediaInspectionError(
        "read-failed",
        error instanceof Error && error.message
          ? `The browser could not hash the selected file: ${error.message}`
          : "The browser could not hash the selected file.",
      );
    }
    throwIfAborted(options.signal);
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength !== length) {
      throw new MediaInspectionError(
        "malformed-file",
        "The file changed or ended while its SHA-256 was calculated.",
      );
    }
    hash.update(bytes);
    offset += length;
    options.onProgress?.({ processedBytes: offset, totalBytes: blob.size });
  }
  throwIfAborted(options.signal);
  return hash.digestHex();
}
