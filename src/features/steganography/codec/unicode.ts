import { MAX_MESSAGE_BYTES } from "./constants";
import { CodecError } from "./results";

const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});

export function containsUnpairedSurrogate(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}
export function encodeMessage(value: string) {
  if (!value || containsUnpairedSurrogate(value)) {
    throw new CodecError("invalid-message");
  }
  const bytes = encoder.encode(value);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_MESSAGE_BYTES) {
    throw new CodecError("invalid-message");
  }
  return bytes;
}

export function messageByteLength(value: string) {
  if (containsUnpairedSurrogate(value)) return null;
  return encoder.encode(value).byteLength;
}

export function decodeMessage(bytes: Uint8Array) {
  try {
    return fatalDecoder.decode(bytes);
  } catch {
    throw new CodecError("damaged");
  }
}

export type PreparedPassword = {
  readonly normalised: string;
  readonly codePoints: number;
  readonly bytes: Uint8Array;
};

export function preparePassword(value: string): PreparedPassword {
  if (containsUnpairedSurrogate(value)) {
    throw new CodecError("invalid-password");
  }
  const normalised = value.normalize("NFC");
  const codePoints = Array.from(normalised).length;
  if (codePoints < 12 || codePoints > 256) {
    throw new CodecError("invalid-password");
  }
  return {
    normalised,
    codePoints,
    bytes: encoder.encode(normalised),
  };
}

export function passwordsMatch(left: string, right: string) {
  if (containsUnpairedSurrogate(left) || containsUnpairedSurrogate(right)) {
    return false;
  }
  return left.normalize("NFC") === right.normalize("NFC");
}
