import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

type Mutation = { physicalIndex: number; before: number; after: number };
type Vector = {
  name: string;
  sourceId: string;
  headerHex: string;
  payloadHex: string;
  traversalStart: number;
  traversalStep: number;
  selectedMutations: Mutation[];
  finalCoefficientStateSha256: string;
};

let document: {
  sources: Array<{ id: string; physicalDomainSize: number; sourceCoefficients: number[] }>;
  vectors: Vector[];
};

function messageBits(bytes: Uint8Array) {
  const bits: number[] = [];
  for (const byte of bytes) {
    for (let shift = 7; shift >= 0; shift -= 1) bits.push((byte >>> shift) & 1);
  }
  while (bits.length % 3 !== 0) bits.push(0);
  return bits;
}

function independentlyEmbed(
  coefficients: number[],
  physicalIndices: number[],
  bytes: Uint8Array,
) {
  const bits = messageBits(bytes);
  const changes: Mutation[] = [];
  for (let group = 0; group < bits.length / 3; group += 1) {
    const indices = physicalIndices.slice(group * 7, group * 7 + 7);
    let syndrome = 0;
    indices.forEach((index, offset) => {
      if ((Math.abs(coefficients[index]) & 1) !== 0) syndrome ^= offset + 1;
    });
    const desired = (bits[group * 3] << 2) | (bits[group * 3 + 1] << 1) | bits[group * 3 + 2];
    const selected = syndrome ^ desired;
    if (selected === 0) continue;
    const physicalIndex = indices[selected - 1];
    const before = coefficients[physicalIndex];
    const magnitude = Math.abs(before);
    const toggled = (magnitude & 1) === 0 ? magnitude + 1 : magnitude - 1;
    const after = before < 0 ? -toggled : toggled;
    coefficients[physicalIndex] = after;
    changes.push({ physicalIndex, before, after });
  }
  return changes;
}

function digest(coefficients: number[]) {
  const bytes = Buffer.alloc(coefficients.length * 2);
  coefficients.forEach((value, index) => bytes.writeInt16BE(value, index * 2));
  return createHash("sha256").update(bytes).digest("hex");
}

beforeAll(async () => {
  document = JSON.parse(
    await readFile(resolve("tests/fixtures/jpeg-v2/coefficient-vectors.json"), "utf8"),
  );
});

describe("independent JPEG v2 coefficient vectors", () => {
  it.each(Array.from({ length: 64 }, (_, value) => [value >>> 3, value & 7]))(
    "matrix embedding maps syndrome %i to desired %i with at most one change",
    (syndrome, desired) => {
      const coefficients = Array.from({ length: 7 }, () => 2);
      if (syndrome !== 0) coefficients[syndrome - 1] = 3;
      let initial = 0;
      coefficients.forEach((value, index) => {
        if ((value & 1) !== 0) initial ^= index + 1;
      });
      const selected = initial ^ desired;
      const changes: Mutation[] = [];
      if (selected !== 0) {
        const physicalIndex = selected - 1;
        const before = coefficients[physicalIndex];
        const after = (before & 1) === 0 ? before + 1 : before - 1;
        coefficients[physicalIndex] = after;
        changes.push({ physicalIndex, before, after });
      }
      expect(initial).toBe(syndrome);
      expect(changes.length).toBe(initial === desired ? 0 : 1);
      let final = 0;
      coefficients.forEach((value, index) => {
        if ((value & 1) !== 0) final ^= index + 1;
      });
      expect(final).toBe(desired);
    },
  );

  it("matches immutable header and payload mutation vectors", () => {
    for (const vector of document.vectors) {
      const source = document.sources.find((candidate) => candidate.id === vector.sourceId);
      expect(source).toBeDefined();
      const coefficients = [...source!.sourceCoefficients];
      const headerIndices = Array.from({ length: 1_568 }, (_, index) => index);
      const reserved = new Set(headerIndices);
      const payloadTraversal: number[] = [];
      let index = vector.traversalStart;
      for (let visits = 0; visits < source!.physicalDomainSize; visits += 1) {
        if (!reserved.has(index) && Math.abs(coefficients[index]) >= 2 && Math.abs(coefficients[index]) <= 1_023) {
          payloadTraversal.push(index);
        }
        index = (index + vector.traversalStep) % source!.physicalDomainSize;
      }
      const changes = [
        ...independentlyEmbed(coefficients, headerIndices, Buffer.from(vector.headerHex, "hex")),
        ...independentlyEmbed(coefficients, payloadTraversal, Buffer.from(vector.payloadHex, "hex")),
      ];
      expect(changes).toEqual(vector.selectedMutations);
      expect(digest(coefficients)).toBe(vector.finalCoefficientStateSha256);
      expect(new Set(changes.map((change) => change.physicalIndex)).size).toBe(changes.length);
      for (const change of changes) {
        expect(Math.sign(change.after)).toBe(Math.sign(change.before));
        expect(Math.abs(Math.abs(change.after) - Math.abs(change.before))).toBe(1);
        expect(Math.abs(change.after)).toBeGreaterThanOrEqual(2);
        expect(Math.abs(change.after)).toBeLessThanOrEqual(1_023);
      }
    }
  });
});
