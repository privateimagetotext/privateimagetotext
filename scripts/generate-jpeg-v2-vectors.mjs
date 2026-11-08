import {
  createCipheriv,
  createHash,
  pbkdf2Sync,
} from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const HEADER_BYTES = 84;
const RESERVED = 1_568;
const DOMAIN_SIZE = 32 * 63;
const source = Array.from({ length: DOMAIN_SIZE }, (_, index) => {
  const magnitude = 2 + (index % 1_022);
  return index % 5 === 0 ? -magnitude : magnitude;
});

function uint32(bytes, offset, value) {
  bytes.writeUInt32BE(value, offset);
}

function header({ cryptoSuite, payloadLength, iterations, salt, nonce, digest }) {
  const bytes = Buffer.alloc(HEADER_BYTES);
  bytes.write("LTSG", 0, "ascii");
  bytes[4] = 2;
  bytes[5] = 0;
  bytes[6] = 2;
  bytes[7] = cryptoSuite;
  uint32(bytes, 8, payloadLength);
  uint32(bytes, 12, iterations);
  salt.copy(bytes, 16);
  nonce.copy(bytes, 32);
  digest.copy(bytes, 44);
  uint32(bytes, 76, 0);
  uint32(bytes, 80, 1);
  return bytes;
}

function bits(bytes) {
  const result = [];
  for (const byte of bytes) {
    for (let bit = 7; bit >= 0; bit -= 1) result.push((byte >>> bit) & 1);
  }
  return result;
}

function applyGroups(coefficients, indices, messageBytes) {
  const messageBits = bits(messageBytes);
  const paddedBits = [...messageBits];
  while (paddedBits.length % 3 !== 0) paddedBits.push(0);
  const changes = [];
  for (let group = 0; group < paddedBits.length / 3; group += 1) {
    const groupIndices = indices.slice(group * 7, group * 7 + 7);
    let syndrome = 0;
    for (let position = 1; position <= 7; position += 1) {
      if ((Math.abs(coefficients[groupIndices[position - 1]]) & 1) === 1) syndrome ^= position;
    }
    const desired =
      (paddedBits[group * 3] << 2) |
      (paddedBits[group * 3 + 1] << 1) |
      paddedBits[group * 3 + 2];
    const changeIndex = syndrome ^ desired;
    if (changeIndex === 0) continue;
    const physicalIndex = groupIndices[changeIndex - 1];
    const before = coefficients[physicalIndex];
    const magnitude = Math.abs(before);
    const afterMagnitude = (magnitude & 1) === 0 ? magnitude + 1 : magnitude - 1;
    const after = before < 0 ? -afterMagnitude : afterMagnitude;
    coefficients[physicalIndex] = after;
    changes.push({ physicalIndex, before, after });
  }
  return changes;
}

function coefficientDigest(coefficients) {
  const bytes = Buffer.alloc(coefficients.length * 2);
  coefficients.forEach((value, index) => bytes.writeInt16BE(value, index * 2));
  return createHash("sha256").update(bytes).digest("hex");
}

function vector(name, headerBytes, payload, reveal) {
  const after = [...source];
  const headerIndices = Array.from({ length: RESERVED }, (_, index) => index);
  const payloadIndices = Array.from(
    { length: DOMAIN_SIZE - RESERVED },
    (_, index) => RESERVED + index,
  );
  const headerChanges = applyGroups(after, headerIndices, headerBytes);
  const payloadChanges = applyGroups(after, payloadIndices, payload);
  return {
    name,
    sourceId: "synthetic-y-ac-v1",
    physicalDomainIndices: [0, DOMAIN_SIZE - 1],
    eligibleIndices: [0, DOMAIN_SIZE - 1],
    headerHex: headerBytes.toString("hex"),
    payloadHex: payload.toString("hex"),
    traversalStart: 0,
    traversalStep: 1,
    selectedMutations: [...headerChanges, ...payloadChanges],
    finalCoefficientStateSha256: coefficientDigest(after),
    expectedReveal: reveal,
  };
}

const plainMessage = Buffer.from([0xa5]);
const plainHeader = header({
  cryptoSuite: 0,
  payloadLength: plainMessage.length,
  iterations: 0,
  salt: Buffer.alloc(16),
  nonce: Buffer.alloc(12),
  digest: createHash("sha256").update(plainMessage).digest(),
});

const encryptedMessage = Buffer.from([0x5a]);
const password = Buffer.from("correct horse", "utf8");
const salt = Buffer.from(Array.from({ length: 16 }, (_, index) => index));
const nonce = Buffer.from(Array.from({ length: 12 }, (_, index) => 0xa0 + index));
const encryptedHeader = header({
  cryptoSuite: 1,
  payloadLength: encryptedMessage.length + 16,
  iterations: 600_000,
  salt,
  nonce,
  digest: Buffer.alloc(32),
});
const key = pbkdf2Sync(password, salt, 600_000, 32, "sha256");
const cipher = createCipheriv("aes-256-gcm", key, nonce);
cipher.setAAD(encryptedHeader);
const ciphertext = Buffer.concat([cipher.update(encryptedMessage), cipher.final(), cipher.getAuthTag()]);
key.fill(0);

const document = {
  schema: "localtext-jpeg-v2-coefficient-vectors-1",
  coefficientEncoding: "signed int16 big-endian for final digest",
  sources: [
    {
      id: "synthetic-y-ac-v1",
      profile: {
        frame: "SOF0",
        componentCount: 1,
        componentId: 1,
        sampling: "1x1",
        widthInBlocks: 8,
        heightInBlocks: 4,
      },
      physicalDomainSize: DOMAIN_SIZE,
      sourceCoefficients: source,
    },
  ],
  vectors: [
    vector("plain-one-byte", plainHeader, plainMessage, { kind: "plain-ready", bytesHex: "a5" }),
    {
      ...vector("encrypted-one-byte", encryptedHeader, ciphertext, {
        kind: "password-required",
        decryptedBytesHex: "5a",
      }),
      fixedSaltHex: salt.toString("hex"),
      fixedNonceHex: nonce.toString("hex"),
      fixedPasswordUtf8Hex: password.toString("hex"),
    },
  ],
};

await writeFile(
  resolve("tests/fixtures/jpeg-v2/coefficient-vectors.json"),
  `${JSON.stringify(document, null, 2)}\n`,
  "utf8",
);
