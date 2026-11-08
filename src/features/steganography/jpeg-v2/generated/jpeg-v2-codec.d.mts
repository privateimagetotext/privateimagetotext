export type JpegV2WasmModule = {
  HEAPU8: Uint8Array;
  _malloc(length: number): number;
  _free(pointer: number): void;
  _jpegv2_analyze(pointer: number, length: number): number;
  _jpegv2_encode(sourcePointer: number, sourceLength: number, headerPointer: number, headerLength: number, payloadPointer: number, payloadLength: number): number;
  _jpegv2_inspect(pointer: number, length: number): number;
  _jpegv2_reset(): void;
  _jpegv2_output_ptr(): number;
  _jpegv2_output_length(): number;
  _jpegv2_header_ptr(): number;
  _jpegv2_payload_ptr(): number;
  _jpegv2_payload_length(): number;
  _jpegv2_info_value(field: number): number;
};

export default function createJpegV2Module(options?: {
  locateFile?: (path: string) => string;
  onAbort?: () => void;
}): Promise<JpegV2WasmModule>;
