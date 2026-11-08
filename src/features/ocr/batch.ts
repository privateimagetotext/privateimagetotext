import type { OcrState } from "./types";
import { safeTextFilename } from "./validation";

import { OCR_BATCH_LIMITS } from "../../config/ocr-batch-limits";
export { OCR_BATCH_LIMITS } from "../../config/ocr-batch-limits";

export type OcrBatchItem = {
  id: number;
  name: string;
  size: number;
  state: OcrState;
};

export function batchAdmissionError(
  existing: readonly Pick<OcrBatchItem, "size">[],
  incoming: readonly Pick<File, "size">[],
) {
  if (existing.length + incoming.length > OCR_BATCH_LIMITS.files) {
    return "A batch can contain up to 10 images. Remove an image before adding more.";
  }
  const bytes = [...existing, ...incoming].reduce((total, file) => total + file.size, 0);
  if (bytes > OCR_BATCH_LIMITS.bytes) {
    return "A batch can contain up to 100 MiB of source files. Add fewer or smaller images.";
  }
  return null;
}

export function batchResultText(item: OcrBatchItem) {
  const result = item.state.result;
  if (!result) return null;
  // Batch exports preserve corrections even when the Original OCR tab is open.
  return result.edited;
}

export function combinedBatchText(items: readonly OcrBatchItem[]) {
  return items
    .filter((item) => item.state.result)
    .map((item) => `--- ${item.name} ---\n\n${batchResultText(item) ?? ""}`)
    .join("\n\n");
}

const encoder = new TextEncoder();
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A bounded, store-only ZIP: local UTF-8 text files, no remote library or history. */
export function separateBatchTextZip(items: readonly OcrBatchItem[]): Blob {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  let count = 0;
  for (const item of items) {
    const text = batchResultText(item);
    if (text === null) continue;
    count += 1;
    const name = encoder.encode(`${String(count).padStart(2, "0")}-${safeTextFilename(item.name)}`);
    const data = encoder.encode(text);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(12, 0x0021, true); // DOS epoch, no file metadata retained.
    view.setUint32(14, checksum, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    const directory = new Uint8Array(46 + name.length);
    const entry = new DataView(directory.buffer);
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(14, 0x0021, true);
    entry.setUint32(16, checksum, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    directory.set(name, 46);
    parts.push(local, data);
    central.push(directory);
    offset += local.length + data.length;
  }
  const directorySize = central.reduce((total, entry) => total + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, count, true);
  endView.setUint16(10, count, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
