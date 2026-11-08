import { CodecError } from "./results";

export function greatestCommonDivisor(left: number, right: number) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}
export function validatePermutation(
  start: number,
  step: number,
  domainSize: number,
) {
  return (
    Number.isSafeInteger(domainSize) &&
    domainSize > 1 &&
    Number.isSafeInteger(start) &&
    start >= 0 &&
    start < domainSize &&
    Number.isSafeInteger(step) &&
    step >= 1 &&
    step < domainSize &&
    greatestCommonDivisor(step, domainSize) === 1
  );
}

export type RandomSource = (values: Uint32Array) => Uint32Array;

function defaultRandomSource(values: Uint32Array) {
  return crypto.getRandomValues(values);
}

export function randomBounded(
  upperExclusive: number,
  randomSource: RandomSource = defaultRandomSource,
) {
  if (
    !Number.isSafeInteger(upperExclusive) ||
    upperExclusive <= 0 ||
    upperExclusive > 0x1_0000_0000
  ) {
    throw new CodecError("damaged");
  }
  const range = 0x1_0000_0000;
  const acceptanceLimit = Math.floor(range / upperExclusive) * upperExclusive;
  const sample = new Uint32Array(1);
  do {
    randomSource(sample);
  } while (sample[0] >= acceptanceLimit);
  return sample[0] % upperExclusive;
}

export function generatePermutation(
  domainSize: number,
  randomSource: RandomSource = defaultRandomSource,
) {
  if (!Number.isSafeInteger(domainSize) || domainSize <= 1) {
    throw new CodecError("capacity-unavailable");
  }
  const start = randomBounded(domainSize, randomSource);
  let step = 0;
  do {
    step = randomBounded(domainSize - 1, randomSource) + 1;
  } while (greatestCommonDivisor(step, domainSize) !== 1);
  return { start, step };
}
