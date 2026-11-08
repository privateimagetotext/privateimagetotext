import { STEGO_ANALYSIS_LIMITS } from "./limits";

export type JpegMarkerSummary = {
  readonly marker: string;
  readonly name: string;
  readonly offset: number;
  /** Segment length including the two length bytes; 0 for standalone markers. */
  readonly length: number;
};

export type JpegStructure = {
  readonly markers: readonly JpegMarkerSummary[];
  readonly markerCount: number;
  /** Offset just after the EOI marker, or null if EOI was not reached. */
  readonly endOffset: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly problems: readonly string[];
};

const NAMES: Record<number, string> = {
  0xd8: "SOI", 0xd9: "EOI", 0xda: "SOS", 0xdb: "DQT", 0xc4: "DHT", 0xdd: "DRI",
  0xc0: "SOF0 baseline", 0xc1: "SOF1 extended", 0xc2: "SOF2 progressive", 0xc3: "SOF3 lossless",
  0xfe: "COM comment", 0xe0: "APP0", 0xe1: "APP1", 0xe2: "APP2", 0xed: "APP13", 0xee: "APP14",
};

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function markerName(marker: number) {
  if (NAMES[marker]) return NAMES[marker];
  if (marker >= 0xe0 && marker <= 0xef) return `APP${marker - 0xe0}`;
  if (marker >= 0xd0 && marker <= 0xd7) return `RST${marker - 0xd0}`;
  if (SOF.has(marker)) return "SOF";
  return "Marker";
}

export function hasJpegSignature(bytes: Uint8Array) {
  return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Walks JPEG segments by their declared lengths, skipping entropy-coded data
 * after each SOS. Embedded thumbnails inside APP segments are skipped with the
 * segment, so their own EOI is not mistaken for the end of the image.
 */
export function parseJpegStructure(bytes: Uint8Array): JpegStructure {
  const markers: JpegMarkerSummary[] = [];
  const problems: string[] = [];
  let markerCount = 0;
  let width: number | null = null;
  let height: number | null = null;
  const record = (marker: number, offset: number, length: number) => {
    markerCount += 1;
    if (markers.length < STEGO_ANALYSIS_LIMITS.maxListedStructures) {
      markers.push({ marker: `FF${marker.toString(16).toUpperCase().padStart(2, "0")}`, name: markerName(marker), offset, length });
    }
  };
  if (!hasJpegSignature(bytes)) {
    return { markers, markerCount, endOffset: null, width, height, problems: ["The file does not start with a JPEG SOI marker."] };
  }
  record(0xd8, 0, 0);
  let offset = 2;
  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      problems.push(`Expected a marker at offset ${offset}.`);
      return { markers, markerCount, endOffset: null, width, height, problems };
    }
    const markerOffset = offset;
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) {
      record(marker, markerOffset, 0);
      return { markers, markerCount, endOffset: offset, width, height, problems };
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      record(marker, markerOffset, 0);
      continue;
    }
    if (offset + 2 > bytes.byteLength) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.byteLength) {
      problems.push(`Segment ${markerName(marker)} at offset ${markerOffset} claims more bytes than the file contains.`);
      return { markers, markerCount, endOffset: null, width, height, problems };
    }
    record(marker, markerOffset, length);
    if (SOF.has(marker) && length >= 7 && width === null) {
      height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      width = (bytes[offset + 5] << 8) | bytes[offset + 6];
    }
    offset += length;
    if (marker === 0xda) {
      // Entropy-coded data: FF00 is a stuffed byte, FFD0–FFD7 are restarts.
      while (offset < bytes.byteLength) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const next = bytes[offset + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7) || next === 0xff) {
          offset += next === 0xff ? 1 : 2;
          continue;
        }
        break;
      }
    }
  }
  problems.push("No EOI marker was found.");
  return { markers, markerCount, endOffset: null, width, height, problems };
}
