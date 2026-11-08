import { MediaInspectionError, throwIfAborted } from "./errors";
import { parseExifTiff } from "./exif";
import {
  boundedTextBytes,
  decodeLatin1,
  decodeUtf8,
  MetadataBudget,
  MetadataCollector,
  normaliseMetadataKey,
  safeMetadataLabel,
} from "./metadata";
import {
  BoundedBlobReader,
  ascii,
  matchesAscii,
  readUint16BigEndian,
  readUint32BigEndian,
  readUint32LittleEndian,
} from "./reader";
import { MEDIA_INSPECTION_LIMITS, type ImageMediaDetails } from "./types";
import { parseXmpPacket } from "./xmp";

export interface ParsedImage {
  readonly image: ImageMediaDetails;
  readonly metadata: ReturnType<typeof metadataOutput>["metadata"];
  readonly warnings: ReturnType<typeof metadataOutput>["warnings"];
}

function metadataOutput(collector: MetadataCollector) {
  return { metadata: collector.entries, warnings: collector.warnings };
}

function isJpegSofMarker(marker: number) {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    ![0xc4, 0xc8, 0xcc].includes(marker)
  );
}

function printableIdentifier(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes.subarray(0, 32)) {
    if (byte === 0) break;
    if (byte < 0x20 || byte > 0x7e) break;
    value += String.fromCharCode(byte);
  }
  return value.trim();
}

function consumeAndRead(
  reader: BoundedBlobReader,
  budget: MetadataBudget,
  offset: number,
  length: number,
) {
  budget.consume(length);
  return reader.read(offset, length);
}

function parseJfif(bytes: Uint8Array, collector: MetadataCollector) {
  if (bytes.byteLength < 12 || !matchesAscii(bytes, 0, "JFIF\0")) return;
  collector.add(
    "jpeg.jfifVersion",
    "JFIF version",
    `${bytes[5]}.${bytes[6].toString().padStart(2, "0")}`,
    "jpeg",
  );
  const densityUnit = bytes[7];
  const xDensity = readUint16BigEndian(bytes, 8);
  const yDensity = readUint16BigEndian(bytes, 10);
  collector.add("jpeg.densityUnit", "JFIF density unit", densityUnit, "jpeg");
  collector.add("jpeg.xDensity", "Horizontal density", xDensity, "jpeg");
  collector.add("jpeg.yDensity", "Vertical density", yDensity, "jpeg");
}

export async function parseJpegMetadata(
  reader: BoundedBlobReader,
  maxMetadataBytes = MEDIA_INSPECTION_LIMITS.maxMetadataBytes,
): Promise<ParsedImage> {
  const collector = new MetadataCollector();
  const budget = new MetadataBudget(maxMetadataBytes);
  const signature = await reader.read(0, Math.min(3, reader.size));
  if (
    signature.byteLength < 3 ||
    signature[0] !== 0xff ||
    signature[1] !== 0xd8 ||
    signature[2] !== 0xff
  ) {
    throw new MediaInspectionError("malformed-file", "The JPEG signature is invalid.");
  }

  let offset = 2;
  let markerCount = 0;
  let width: number | undefined;
  let height: number | undefined;
  let bitDepth: number | undefined;
  let orientation: number | undefined;
  while (offset < reader.size && markerCount < 4_096) {
    throwIfAborted(reader.signal);
    const markerPrefix = await reader.read(offset, Math.min(2, reader.size - offset));
    if (markerPrefix.byteLength < 2 || markerPrefix[0] !== 0xff) {
      throw new MediaInspectionError("malformed-file", "The JPEG marker stream is malformed.");
    }
    if (markerPrefix[1] === 0xff) {
      offset += 1;
      continue;
    }
    const marker = markerPrefix[1];
    offset += 2;
    markerCount += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x00) {
      throw new MediaInspectionError("malformed-file", "The JPEG header contains a stuffed marker byte.");
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    const lengthBytes = await reader.read(offset, Math.min(2, reader.size - offset));
    if (lengthBytes.byteLength !== 2) {
      throw new MediaInspectionError("malformed-file", "A JPEG segment length is truncated.");
    }
    const segmentLength = readUint16BigEndian(lengthBytes, 0);
    if (segmentLength < 2 || segmentLength > reader.size - offset) {
      throw new MediaInspectionError("malformed-file", "A JPEG segment has an invalid length.");
    }
    const payloadOffset = offset + 2;
    const payloadLength = segmentLength - 2;

    if (isJpegSofMarker(marker)) {
      if (payloadLength < 6) {
        throw new MediaInspectionError("malformed-file", "The JPEG frame header is too short.");
      }
      const frame = await reader.read(payloadOffset, 6);
      bitDepth = frame[0];
      height = readUint16BigEndian(frame, 1);
      width = readUint16BigEndian(frame, 3);
      if (width <= 0 || height <= 0) {
        throw new MediaInspectionError("malformed-file", "The JPEG dimensions are invalid.");
      }
    } else if (marker === 0xfe) {
      const comment = await consumeAndRead(reader, budget, payloadOffset, payloadLength);
      collector.add(
        "jpeg.comment",
        "JPEG comment",
        decodeLatin1(boundedTextBytes(comment)),
        "jpeg",
        true,
      );
    } else if (marker >= 0xe0 && marker <= 0xef) {
      const markerNumber = marker - 0xe0;
      const prefixLength = Math.min(payloadLength, 64);
      const prefix = await consumeAndRead(reader, budget, payloadOffset, prefixLength);
      const identifier = printableIdentifier(prefix);
      collector.add(
        `jpeg.app${markerNumber}`,
        `JPEG APP${markerNumber} marker`,
        `${identifier || "Binary data"} (${payloadLength} bytes)`,
        "jpeg",
      );

      if (marker === 0xe0) parseJfif(prefix, collector);
      if (marker === 0xe1 && matchesAscii(prefix, 0, "Exif\0\0")) {
        const remaining = payloadLength - 6;
        const exif =
          prefixLength >= payloadLength
            ? prefix.subarray(6)
            : await consumeAndRead(reader, budget, payloadOffset + 6, remaining);
        try {
          const result = parseExifTiff(exif, collector);
          orientation ??= result.orientation;
        } catch (error) {
          if (
            error instanceof MediaInspectionError &&
            error.code !== "metadata-limit-exceeded"
          ) {
            collector.warn("metadata-truncated", "The JPEG contains malformed Exif metadata.");
          } else {
            throw error;
          }
        }
      } else if (
        marker === 0xe1 &&
        matchesAscii(prefix, 0, "http://ns.adobe.com/xap/1.0/\0")
      ) {
        const headerLength = 29;
        const remaining = payloadLength - headerLength;
        if (remaining >= 0) {
          const xmp =
            prefixLength >= payloadLength
              ? prefix.subarray(headerLength)
              : await consumeAndRead(reader, budget, payloadOffset + headerLength, remaining);
          parseXmpPacket(xmp, collector);
        }
      } else if (
        marker === 0xe1 &&
        matchesAscii(prefix, 0, "http://ns.adobe.com/xmp/extension/\0")
      ) {
        collector.add(
          "jpeg.extendedXmp",
          "Extended XMP marker",
          true,
          "jpeg",
          true,
        );
      } else if (marker === 0xe2 && matchesAscii(prefix, 0, "ICC_PROFILE\0")) {
        collector.add("jpeg.iccProfile", "Embedded ICC colour profile", true, "jpeg");
      } else if (marker === 0xed && matchesAscii(prefix, 0, "Photoshop 3.0\0")) {
        collector.add(
          "jpeg.photoshopResources",
          "Photoshop image resources",
          true,
          "jpeg",
          true,
        );
      } else if (marker === 0xeb && matchesAscii(prefix, 0, "JP")) {
        collector.add(
          "jpeg.jumbf",
          "JUMBF / Content Credentials marker",
          true,
          "jpeg",
        );
      }
    }
    offset += segmentLength;
  }
  if (markerCount >= 4_096) {
    throw new MediaInspectionError(
      "metadata-limit-exceeded",
      "The JPEG marker stream is unreasonably complex.",
    );
  }
  if (!width || !height) {
    throw new MediaInspectionError("malformed-file", "The JPEG has no supported frame header.");
  }
  return {
    image: { width, height, ...(bitDepth ? { bitDepth } : {}), ...(orientation ? { orientation } : {}) },
    ...metadataOutput(collector),
  };
}

async function decompressDeflate(
  bytes: Uint8Array,
  signal?: AbortSignal,
  budget?: MetadataBudget,
) {
  if (typeof DecompressionStream === "undefined") return null;
  const stream = new Blob([bytes.slice().buffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > MEDIA_INSPECTION_LIMITS.maxMetadataValueBytes) {
        throw new MediaInspectionError(
          "metadata-limit-exceeded",
          "A compressed PNG text value expands beyond the safety limit.",
        );
      }
      budget?.consume(item.value.byteLength);
      chunks.push(item.value);
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // Preserve the parsing or cancellation error that triggered cleanup.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function findNull(bytes: Uint8Array, start: number) {
  for (let offset = start; offset < bytes.byteLength; offset += 1) {
    if (bytes[offset] === 0) return offset;
  }
  return -1;
}

const AI_TEXT_KEYS = new Set([
  "parameters",
  "prompt",
  "negative prompt",
  "workflow",
  "comfyui workflow",
  "generation data",
]);

function addPngText(
  collector: MetadataCollector,
  keyword: string,
  value: string,
) {
  const cleanKeyword = safeMetadataLabel(keyword);
  if (!cleanKeyword || !value) return;
  const lowerKeyword = cleanKeyword.toLowerCase();
  const aiRecipe = AI_TEXT_KEYS.has(lowerKeyword);
  const key = `png.text.${normaliseMetadataKey(cleanKeyword)}`;
  collector.add(
    key,
    aiRecipe ? `AI ${cleanKeyword.toLowerCase()}` : `PNG text: ${cleanKeyword}`,
    value,
    "png",
    aiRecipe || /(?:author|comment|description|location|date|software)/i.test(cleanKeyword),
  );
  if (lowerKeyword === "xml:com.adobe.xmp") {
    parseXmpPacket(new TextEncoder().encode(value), collector);
  }
}

async function parsePngTextChunk(
  type: string,
  bytes: Uint8Array,
  collector: MetadataCollector,
  budget: MetadataBudget,
  signal?: AbortSignal,
) {
  const keywordEnd = findNull(bytes, 0);
  if (keywordEnd <= 0 || keywordEnd > 79) {
    collector.warn("metadata-truncated", `The PNG ${type} chunk has an invalid keyword.`);
    return;
  }
  const keyword = decodeLatin1(bytes.subarray(0, keywordEnd));
  if (type === "tEXt") {
    addPngText(collector, keyword, decodeLatin1(bytes.subarray(keywordEnd + 1)));
    return;
  }
  if (type === "zTXt") {
    if (keywordEnd + 2 > bytes.byteLength || bytes[keywordEnd + 1] !== 0) {
      collector.warn("metadata-truncated", "The PNG zTXt chunk is malformed.");
      return;
    }
    const decompressed = await decompressDeflate(
      bytes.subarray(keywordEnd + 2),
      signal,
      budget,
    );
    if (!decompressed) {
      collector.warn("metadata-unsupported", "Compressed PNG text is not supported by this browser.");
      return;
    }
    addPngText(collector, keyword, decodeLatin1(decompressed));
    return;
  }

  if (keywordEnd + 3 > bytes.byteLength) {
    collector.warn("metadata-truncated", "The PNG iTXt chunk is malformed.");
    return;
  }
  const compressed = bytes[keywordEnd + 1];
  const method = bytes[keywordEnd + 2];
  const languageEnd = findNull(bytes, keywordEnd + 3);
  if (languageEnd < 0) {
    collector.warn("metadata-truncated", "The PNG iTXt language field is truncated.");
    return;
  }
  const translatedEnd = findNull(bytes, languageEnd + 1);
  if (translatedEnd < 0 || ![0, 1].includes(compressed) || method !== 0) {
    collector.warn("metadata-truncated", "The PNG iTXt fields are invalid.");
    return;
  }
  const content = bytes.subarray(translatedEnd + 1);
  const decoded =
    compressed === 0
      ? content
      : await decompressDeflate(content, signal, budget);
  if (!decoded) {
    collector.warn("metadata-unsupported", "Compressed PNG text is not supported by this browser.");
    return;
  }
  addPngText(collector, keyword, decodeUtf8(decoded));
}

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < table.length; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
    }
    table[value] = crc >>> 0;
  }
  return table;
})();

function pngCrc32(typeBytes: Uint8Array, data: Uint8Array) {
  let crc = 0xffff_ffff;
  for (const value of [typeBytes, data]) {
    for (const byte of value) {
      crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

async function readValidatedPngChunk(
  reader: BoundedBlobReader,
  typeBytes: Uint8Array,
  type: string,
  dataOffset: number,
  length: number,
  budget?: MetadataBudget,
) {
  if (length > reader.maxSliceBytes - 4) {
    throw new MediaInspectionError(
      "read-limit-exceeded",
      `The PNG ${JSON.stringify(type)} chunk is too large to validate safely.`,
    );
  }
  budget?.consume(length);
  const payload = await reader.read(dataOffset, length + 4);
  const data = payload.subarray(0, length);
  const expected = readUint32BigEndian(payload, length);
  if (pngCrc32(typeBytes, data) !== expected) {
    throw new MediaInspectionError(
      "malformed-file",
      `The PNG ${JSON.stringify(type)} chunk has an invalid CRC.`,
    );
  }
  return data;
}

export async function parsePngMetadata(
  reader: BoundedBlobReader,
  maxMetadataBytes = MEDIA_INSPECTION_LIMITS.maxMetadataBytes,
): Promise<ParsedImage> {
  const collector = new MetadataCollector();
  const budget = new MetadataBudget(maxMetadataBytes);
  const signature = await reader.read(0, Math.min(8, reader.size));
  if (
    signature.byteLength !== 8 ||
    signature[0] !== 0x89 ||
    !matchesAscii(signature, 1, "PNG\r\n\x1a\n")
  ) {
    throw new MediaInspectionError("malformed-file", "The PNG signature is invalid.");
  }

  let offset = 8;
  let chunkCount = 0;
  let image: ImageMediaDetails | undefined;
  let animated = false;
  let sawEnd = false;
  while (offset < reader.size && chunkCount < 4_096) {
    const header = await reader.read(offset, Math.min(8, reader.size - offset));
    if (header.byteLength !== 8) {
      throw new MediaInspectionError("malformed-file", "A PNG chunk header is truncated.");
    }
    const length = readUint32BigEndian(header, 0);
    const type = ascii(header, 4, 4);
    const typeBytes = header.subarray(4, 8);
    if (length > 0x7fff_ffff || length > reader.size - offset - 12) {
      throw new MediaInspectionError("malformed-file", "A PNG chunk has an invalid length.");
    }
    const dataOffset = offset + 8;
    if (type === "IHDR") {
      if (length !== 13 || image) {
        throw new MediaInspectionError("malformed-file", "The PNG IHDR chunk is invalid.");
      }
      const ihdr = await readValidatedPngChunk(
        reader,
        typeBytes,
        type,
        dataOffset,
        length,
      );
      const width = readUint32BigEndian(ihdr, 0);
      const height = readUint32BigEndian(ihdr, 4);
      if (width <= 0 || height <= 0) {
        throw new MediaInspectionError("malformed-file", "The PNG dimensions are invalid.");
      }
      image = { width, height, bitDepth: ihdr[8] };
      collector.add("png.colourType", "PNG colour type", ihdr[9], "png");
    } else if (type === "acTL") {
      if (length !== 8) {
        throw new MediaInspectionError("malformed-file", "The PNG acTL chunk is invalid.");
      }
      await readValidatedPngChunk(
        reader,
        typeBytes,
        type,
        dataOffset,
        length,
      );
      animated = true;
    } else if (["tEXt", "zTXt", "iTXt"].includes(type)) {
      if (length > MEDIA_INSPECTION_LIMITS.maxMetadataValueBytes) {
        collector.warn("metadata-truncated", `A PNG ${type} chunk exceeds the per-value safety limit.`);
      } else {
        const text = await readValidatedPngChunk(
          reader,
          typeBytes,
          type,
          dataOffset,
          length,
          budget,
        );
        await parsePngTextChunk(type, text, collector, budget, reader.signal);
      }
    } else if (type === "eXIf") {
      if (length > MEDIA_INSPECTION_LIMITS.maxMetadataValueBytes) {
        collector.warn("metadata-truncated", "The PNG Exif chunk exceeds the safety limit.");
      } else {
        const exif = await readValidatedPngChunk(
          reader,
          typeBytes,
          type,
          dataOffset,
          length,
          budget,
        );
        try {
          const result = parseExifTiff(exif, collector);
          if (image && result.orientation) image = { ...image, orientation: result.orientation };
        } catch (error) {
          if (
            error instanceof MediaInspectionError &&
            error.code !== "metadata-limit-exceeded"
          ) {
            collector.warn("metadata-truncated", "The PNG contains malformed Exif metadata.");
          } else {
            throw error;
          }
        }
      }
    } else if (type === "iCCP") {
      if (length > MEDIA_INSPECTION_LIMITS.maxMetadataValueBytes) {
        collector.warn("metadata-truncated", "The PNG ICC profile exceeds the safety limit.");
      } else {
        await readValidatedPngChunk(
          reader,
          typeBytes,
          type,
          dataOffset,
          length,
          budget,
        );
        collector.add("png.iccProfile", "Embedded ICC colour profile", true, "png");
      }
    } else if (type === "caBX") {
      if (length > MEDIA_INSPECTION_LIMITS.maxMetadataValueBytes) {
        collector.warn("metadata-truncated", "The PNG Content Credentials chunk exceeds the safety limit.");
      } else {
        await readValidatedPngChunk(
          reader,
          typeBytes,
          type,
          dataOffset,
          length,
          budget,
        );
        collector.add("png.contentCredentials", "Content Credentials chunk", true, "png");
      }
    } else if (type === "IEND") {
      if (length !== 0) {
        throw new MediaInspectionError("malformed-file", "The PNG IEND chunk is invalid.");
      }
      await readValidatedPngChunk(
        reader,
        typeBytes,
        type,
        dataOffset,
        length,
      );
      sawEnd = true;
      break;
    }
    offset += length + 12;
    chunkCount += 1;
  }
  if (chunkCount >= 4_096) {
    throw new MediaInspectionError("metadata-limit-exceeded", "The PNG chunk graph is unreasonably complex.");
  }
  if (!image || !sawEnd) {
    throw new MediaInspectionError("malformed-file", "The PNG is missing a complete header or end marker.");
  }
  return { image: { ...image, animated }, ...metadataOutput(collector) };
}

export async function parseWebpMetadata(
  reader: BoundedBlobReader,
  maxMetadataBytes = MEDIA_INSPECTION_LIMITS.maxMetadataBytes,
): Promise<ParsedImage> {
  const collector = new MetadataCollector();
  const budget = new MetadataBudget(maxMetadataBytes);
  const prefix = await reader.read(0, Math.min(12, reader.size));
  if (
    prefix.byteLength !== 12 ||
    !matchesAscii(prefix, 0, "RIFF") ||
    !matchesAscii(prefix, 8, "WEBP")
  ) {
    throw new MediaInspectionError("malformed-file", "The WebP signature is invalid.");
  }
  const riffEnd = readUint32LittleEndian(prefix, 4) + 8;
  if (riffEnd < 20 || riffEnd > reader.size) {
    throw new MediaInspectionError("malformed-file", "The WebP RIFF length is invalid.");
  }
  let offset = 12;
  let chunkCount = 0;
  let image: ImageMediaDetails | undefined;
  let animated = false;
  while (offset + 8 <= riffEnd && chunkCount < 4_096) {
    const header = await reader.read(offset, 8);
    const type = ascii(header, 0, 4);
    const length = readUint32LittleEndian(header, 4);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    const nextOffset = dataEnd + (length & 1);
    if (
      !Number.isSafeInteger(nextOffset) ||
      dataEnd > riffEnd ||
      nextOffset > riffEnd
    ) {
      throw new MediaInspectionError("malformed-file", "A WebP chunk has an invalid length.");
    }
    if (type === "VP8X") {
      if (length < 10) throw new MediaInspectionError("malformed-file", "The WebP VP8X chunk is too short.");
      const data = await reader.read(dataOffset, 10);
      const width = 1 + data[4] + data[5] * 0x100 + data[6] * 0x1_0000;
      const height = 1 + data[7] + data[8] * 0x100 + data[9] * 0x1_0000;
      animated ||= (data[0] & 0x02) !== 0;
      image = { width, height };
    } else if (type === "VP8 ") {
      if (length >= 10) {
        const data = await reader.read(dataOffset, 10);
        if (data[3] === 0x9d && data[4] === 0x01 && data[5] === 0x2a) {
          image ??= {
            width: data[6] + (data[7] & 0x3f) * 0x100,
            height: data[8] + (data[9] & 0x3f) * 0x100,
          };
        }
      }
    } else if (type === "VP8L") {
      if (length >= 5) {
        const data = await reader.read(dataOffset, 5);
        if (data[0] === 0x2f) {
          image ??= {
            width: 1 + data[1] + ((data[2] & 0x3f) << 8),
            height: 1 + (data[2] >> 6) + (data[3] << 2) + ((data[4] & 0x0f) << 10),
          };
        }
      }
    } else if (type === "ANIM" || type === "ANMF") {
      animated = true;
    } else if (type === "EXIF") {
      if (length <= MEDIA_INSPECTION_LIMITS.maxMetadataValueBytes) {
        const raw = await consumeAndRead(reader, budget, dataOffset, length);
        const exif = matchesAscii(raw, 0, "Exif\0\0") ? raw.subarray(6) : raw;
        try {
          const result = parseExifTiff(exif, collector);
          if (image && result.orientation) image = { ...image, orientation: result.orientation };
        } catch (error) {
          if (
            error instanceof MediaInspectionError &&
            error.code !== "metadata-limit-exceeded"
          ) collector.warn("metadata-truncated", "The WebP contains malformed Exif metadata.");
          else throw error;
        }
      } else collector.warn("metadata-truncated", "The WebP Exif chunk exceeds the safety limit.");
    } else if (type === "XMP ") {
      if (length <= MEDIA_INSPECTION_LIMITS.maxMetadataValueBytes) {
        parseXmpPacket(await consumeAndRead(reader, budget, dataOffset, length), collector);
      } else collector.warn("metadata-truncated", "The WebP XMP chunk exceeds the safety limit.");
    } else if (type === "ICCP") {
      collector.add("webp.iccProfile", "Embedded ICC colour profile", true, "webp");
    }
    offset = nextOffset;
    chunkCount += 1;
  }
  if (chunkCount >= 4_096) {
    throw new MediaInspectionError("metadata-limit-exceeded", "The WebP chunk graph is unreasonably complex.");
  }
  if (!image || image.width <= 0 || image.height <= 0) {
    throw new MediaInspectionError("malformed-file", "The WebP has no supported image header.");
  }
  return { image: { ...image, animated }, ...metadataOutput(collector) };
}

export async function parseGifMetadata(reader: BoundedBlobReader): Promise<ParsedImage> {
  const header = await reader.read(0, Math.min(10, reader.size));
  if (
    header.byteLength !== 10 ||
    (!matchesAscii(header, 0, "GIF87a") && !matchesAscii(header, 0, "GIF89a"))
  ) {
    throw new MediaInspectionError("malformed-file", "The GIF header is invalid.");
  }
  const width = header[6] + header[7] * 0x100;
  const height = header[8] + header[9] * 0x100;
  if (width <= 0 || height <= 0) {
    throw new MediaInspectionError("malformed-file", "The GIF dimensions are invalid.");
  }
  const collector = new MetadataCollector();
  collector.add("gif.version", "GIF version", ascii(header, 0, 6), "file");
  return { image: { width, height }, ...metadataOutput(collector) };
}
