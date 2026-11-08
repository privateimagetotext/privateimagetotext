import type { JpegV2WasmModule } from "./generated/jpeg-v2-codec.mjs";
import {
  JPEG_V2_AES_GCM_TAG_BYTES,
  JPEG_V2_HEADER_BYTES,
  JPEG_V2_MAX_MESSAGE_BYTES,
  JPEG_V2_RESERVED_HEADER_COEFFICIENTS,
  JPEG_V2_WASM_PATH,
} from "./constants";
import {
  JpegV2CodecError,
  type JpegV2Capacity,
  type JpegV2CodecErrorCode,
  type JpegV2RawInspection,
} from "./types";

const MAX_OUTPUT_BYTES = 80 * 1024 * 1024;
let modulePromise: Promise<JpegV2WasmModule> | null = null;

const statusCodes: Record<number, JpegV2CodecErrorCode> = {
  1: "malformed-jpeg",
  2: "unsupported-jpeg-profile",
  3: "allocation-failed",
  4: "output-too-large",
  5: "capacity-unavailable",
  6: "no-message",
  7: "unsupported-version",
  8: "unsupported-format",
  9: "damaged",
  10: "jpeg-self-verification-failed",
  11: "invalid-argument",
};

function codecError(status: number): JpegV2CodecError {
  return new JpegV2CodecError(statusCodes[status] ?? "damaged");
}

async function getModule() {
  if (!modulePromise) {
    modulePromise = import("./generated/jpeg-v2-codec.mjs").then(({ default: createJpegV2Module }) => createJpegV2Module({
      locateFile(path) {
        if (!path.endsWith(".wasm")) throw new Error("Unexpected JPEG v2 runtime asset");
        const origin = globalThis.location?.origin;
        return origin && origin !== "null"
          ? new URL(JPEG_V2_WASM_PATH, origin).href
          : JPEG_V2_WASM_PATH;
      },
    })).catch(() => {
      modulePromise = null;
      throw new JpegV2CodecError("jpeg-codec-unavailable");
    });
  }
  return modulePromise;
}

function allocate(module: JpegV2WasmModule, bytes: Uint8Array) {
  const pointer = module._malloc(bytes.byteLength);
  if (pointer === 0) throw new JpegV2CodecError("allocation-failed");
  module.HEAPU8.set(bytes, pointer);
  return pointer;
}

function release(module: JpegV2WasmModule, pointer: number, length: number) {
  if (pointer === 0) return;
  module.HEAPU8.fill(0, pointer, pointer + length);
  module._free(pointer);
}

function copyChecked(
  module: JpegV2WasmModule,
  pointer: number,
  length: number,
  maximum: number,
) {
  const heapLength = module.HEAPU8.byteLength;
  if (
    !Number.isSafeInteger(pointer) ||
    !Number.isSafeInteger(length) ||
    pointer <= 0 ||
    length <= 0 ||
    length > maximum ||
    pointer > heapLength - length
  ) {
    throw new JpegV2CodecError("jpeg-self-verification-failed");
  }
  return module.HEAPU8.slice(pointer, pointer + length);
}

function capacityFromModule(module: JpegV2WasmModule): JpegV2Capacity {
  const values = Array.from({ length: 11 }, (_, index) => module._jpegv2_info_value(index));
  const [width, height, componentCount, progressive, sampling, , , physicalDomainSize, eligibleCoefficientCount, embeddedByteCapacity, orientation] = values;
  if (
    values.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    width < 1 || width > 4096 || height < 1 || height > 4096 ||
    (componentCount !== 1 && componentCount !== 3) ||
    ![400, 420, 422, 444].includes(sampling)
  ) {
    throw new JpegV2CodecError("damaged");
  }
  return {
    format: "jpeg-v2",
    width,
    height,
    componentCount,
    progressiveInput: progressive === 1,
    sampling: sampling as 400 | 420 | 422 | 444,
    physicalDomainSize,
    eligibleCoefficientCount,
    reservedHeaderCoefficientCount: JPEG_V2_RESERVED_HEADER_COEFFICIENTS,
    embeddedByteCapacity,
    plainMessageCapacity: Math.min(JPEG_V2_MAX_MESSAGE_BYTES, embeddedByteCapacity),
    encryptedMessageCapacity: Math.min(
      JPEG_V2_MAX_MESSAGE_BYTES,
      Math.max(0, embeddedByteCapacity - JPEG_V2_AES_GCM_TAG_BYTES),
    ),
    orientation,
  };
}

export async function analyseJpegV2(bytes: Uint8Array) {
  const module = await getModule();
  let sourcePointer = 0;
  try {
    sourcePointer = allocate(module, bytes);
    const status = module._jpegv2_analyze(sourcePointer, bytes.byteLength);
    if (status !== 0) throw codecError(status);
    return capacityFromModule(module);
  } finally {
    release(module, sourcePointer, bytes.byteLength);
    module._jpegv2_reset();
  }
}

export async function encodeJpegV2Bytes(
  source: Uint8Array,
  header: Uint8Array,
  payload: Uint8Array,
) {
  const module = await getModule();
  let sourcePointer = 0;
  let headerPointer = 0;
  let payloadPointer = 0;
  try {
    if (header.byteLength !== JPEG_V2_HEADER_BYTES) {
      throw new JpegV2CodecError("invalid-argument");
    }
    sourcePointer = allocate(module, source);
    headerPointer = allocate(module, header);
    payloadPointer = allocate(module, payload);
    const status = module._jpegv2_encode(
      sourcePointer,
      source.byteLength,
      headerPointer,
      header.byteLength,
      payloadPointer,
      payload.byteLength,
    );
    if (status !== 0) throw codecError(status);
    return copyChecked(
      module,
      module._jpegv2_output_ptr(),
      module._jpegv2_output_length(),
      MAX_OUTPUT_BYTES,
    );
  } finally {
    release(module, sourcePointer, source.byteLength);
    release(module, headerPointer, header.byteLength);
    release(module, payloadPointer, payload.byteLength);
    module._jpegv2_reset();
  }
}

export async function inspectJpegV2Bytes(bytes: Uint8Array): Promise<JpegV2RawInspection> {
  const module = await getModule();
  let sourcePointer = 0;
  try {
    sourcePointer = allocate(module, bytes);
    const status = module._jpegv2_inspect(sourcePointer, bytes.byteLength);
    if (status === 6) return { kind: "no-message" };
    if (status === 7) return { kind: "unsupported-version" };
    if (status === 8) return { kind: "unsupported-format" };
    if (status === 9) return { kind: "damaged" };
    if (status !== 0) throw codecError(status);
    const capacity = capacityFromModule(module);
    const header = copyChecked(
      module,
      module._jpegv2_header_ptr(),
      JPEG_V2_HEADER_BYTES,
      JPEG_V2_HEADER_BYTES,
    );
    const payload = copyChecked(
      module,
      module._jpegv2_payload_ptr(),
      module._jpegv2_payload_length(),
      JPEG_V2_MAX_MESSAGE_BYTES + JPEG_V2_AES_GCM_TAG_BYTES,
    );
    return { kind: "payload", header, payload, capacity };
  } finally {
    release(module, sourcePointer, bytes.byteLength);
    module._jpegv2_reset();
  }
}

export async function disposeJpegV2Codec() {
  if (!modulePromise) return;
  const module = await modulePromise;
  module._jpegv2_reset();
}
