import type { FileReport, ImageReport } from "../analyse";
import type { HexRow, StringScan } from "../bytes";
import type { StegoAnalysisErrorCode } from "../limits";
import type { LsbOptions } from "../lsb";
import type { SixteenBitByte } from "../png";

export type StegoAnalysisRequest =
  | { readonly type: "load"; readonly operationId: number; readonly bytes: ArrayBuffer }
  | { readonly type: "strings"; readonly operationId: number; readonly minLength: number }
  | { readonly type: "plane"; readonly operationId: number; readonly planeId: string }
  | { readonly type: "extract"; readonly operationId: number; readonly options: LsbOptions }
  | { readonly type: "trailing"; readonly operationId: number }
  | { readonly type: "redecode"; readonly operationId: number; readonly sixteenBitByte: SixteenBitByte };

export type StegoAnalysisResponse =
  | {
      readonly type: "loaded";
      readonly operationId: number;
      readonly file: FileReport;
      readonly image: ImageReport | null;
      readonly imageError: string | null;
    }
  | { readonly type: "strings"; readonly operationId: number; readonly scan: StringScan }
  | {
      readonly type: "plane";
      readonly operationId: number;
      readonly planeId: string;
      readonly width: number;
      readonly height: number;
      readonly pixels: ArrayBuffer;
    }
  | {
      readonly type: "extracted";
      readonly operationId: number;
      readonly bytes: ArrayBuffer;
      readonly totalBits: number;
      readonly truncated: boolean;
      readonly preview: readonly HexRow[];
      readonly strings: StringScan;
    }
  | { readonly type: "trailing"; readonly operationId: number; readonly bytes: ArrayBuffer }
  | { readonly type: "redecoded"; readonly operationId: number; readonly image: ImageReport }
  | {
      readonly type: "error";
      readonly operationId: number;
      readonly code: StegoAnalysisErrorCode;
      readonly message: string;
    };
