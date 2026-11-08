export type FoundString = { readonly offset: number; readonly text: string };

export type StringScan = {
  readonly strings: readonly FoundString[];
  readonly total: number;
  readonly truncated: boolean;
};

function printable(byte: number) {
  return (byte >= 0x20 && byte < 0x7f) || byte === 0x09;
}

/** Printable ASCII runs (space to tilde, plus tab) of at least `minLength` bytes. */
export function scanStrings(bytes: Uint8Array, minLength: number, limit: number, maxStringLength = 512): StringScan {
  const strings: FoundString[] = [];
  let total = 0;
  let start = -1;
  const flush = (end: number) => {
    if (start >= 0 && end - start >= minLength) {
      total += 1;
      if (strings.length < limit) {
        const stop = Math.min(end, start + maxStringLength);
        let text = "";
        for (let index = start; index < stop; index += 1) text += String.fromCharCode(bytes[index]);
        strings.push({ offset: start, text: stop < end ? `${text}…` : text });
      }
    }
    start = -1;
  };
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (printable(bytes[index])) {
      if (start < 0) start = index;
    } else flush(index);
  }
  flush(bytes.byteLength);
  return { strings, total, truncated: total > strings.length };
}

export type SignatureMatch = { readonly offset: number; readonly name: string };

export const SIGNATURES: readonly { readonly name: string; readonly bytes: readonly number[] }[] = [
  { name: "PNG image", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { name: "JPEG image", bytes: [0xff, 0xd8, 0xff] },
  { name: "GIF image", bytes: [0x47, 0x49, 0x46, 0x38] },
  { name: "ZIP local file header", bytes: [0x50, 0x4b, 0x03, 0x04] },
  { name: "PDF document", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { name: "7-Zip archive", bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { name: "RAR archive", bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07] },
  { name: "gzip data", bytes: [0x1f, 0x8b, 0x08] },
  { name: "bzip2 data", bytes: [0x42, 0x5a, 0x68] },
  { name: "ELF executable", bytes: [0x7f, 0x45, 0x4c, 0x46] },
];

export function identifySignature(bytes: Uint8Array, offset = 0): string | null {
  for (const signature of SIGNATURES) {
    if (offset + signature.bytes.length > bytes.byteLength) continue;
    if (signature.bytes.every((value, index) => bytes[offset + index] === value)) return signature.name;
  }
  return null;
}

/**
 * Lists offsets where known file signatures appear. A match is only a byte
 * pattern; short signatures can occur by chance in compressed data.
 */
export function scanSignatures(bytes: Uint8Array, limit: number, skipOffset = 0): { matches: SignatureMatch[]; total: number } {
  const matches: SignatureMatch[] = [];
  let total = 0;
  const firsts = new Set(SIGNATURES.map((signature) => signature.bytes[0]));
  for (let offset = 0; offset < bytes.byteLength; offset += 1) {
    if (offset === skipOffset || !firsts.has(bytes[offset])) continue;
    const name = identifySignature(bytes, offset);
    if (!name) continue;
    total += 1;
    if (matches.length < limit) matches.push({ offset, name });
  }
  return { matches, total };
}

export type HexRow = { readonly offset: number; readonly hex: string; readonly ascii: string };

export function hexRows(bytes: Uint8Array, maxBytes: number, width = 16): HexRow[] {
  const rows: HexRow[] = [];
  const end = Math.min(bytes.byteLength, maxBytes);
  for (let offset = 0; offset < end; offset += width) {
    let hex = "";
    let ascii = "";
    for (let index = offset; index < Math.min(end, offset + width); index += 1) {
      hex += `${bytes[index].toString(16).padStart(2, "0")} `;
      ascii += bytes[index] >= 0x20 && bytes[index] < 0x7f ? String.fromCharCode(bytes[index]) : ".";
    }
    rows.push({ offset, hex: hex.trimEnd(), ascii });
  }
  return rows;
}

export function formatOffset(offset: number) {
  return `0x${offset.toString(16).padStart(8, "0")}`;
}
