import type {
  OcrContentMode,
  OcrProgress,
  RecognitionResponse,
  ThresholdingMethod,
} from "./types";

export type CanvasRecognitionAdapter = {
  recognise(
    canvas: HTMLCanvasElement,
    request: {
      readonly contentMode: OcrContentMode;
      readonly autoDeskew: boolean;
      readonly thresholdingMethod: ThresholdingMethod;
      readonly includeLines?: boolean;
      readonly includeWords?: boolean;
      readonly languages?: readonly string[];
    },
    onProgress: (progress: OcrProgress) => void,
  ): Promise<RecognitionResponse>;
};

export type CanvasRecognitionOptions = {
  readonly adapter: CanvasRecognitionAdapter;
  readonly canvas: HTMLCanvasElement;
  readonly contentMode: OcrContentMode;
  readonly thresholdingMethod: ThresholdingMethod;
  readonly autoDeskew: boolean;
  readonly includeLines: boolean;
  readonly includeWords?: boolean;
  readonly languages?: readonly string[];
  readonly signal: AbortSignal;
  readonly onProgress: (progress: OcrProgress) => void;
};

export function recognitionAbortError() {
  const error = new Error("The local recognition operation was cancelled.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw recognitionAbortError();
}

/**
 * Recognises an already prepared canvas without assuming how it was decoded,
 * rendered, cropped, tiled or persisted. Resource ownership and active
 * cancellation remain with the caller.
 */
export async function recognisePreparedCanvas(
  options: CanvasRecognitionOptions,
): Promise<RecognitionResponse> {
  throwIfAborted(options.signal);
  const response = await options.adapter.recognise(
    options.canvas,
    {
      contentMode: options.contentMode,
      autoDeskew: options.autoDeskew,
      thresholdingMethod: options.thresholdingMethod,
      includeLines: options.includeLines,
      includeWords: options.includeWords === true,
      ...(options.languages ? { languages: options.languages } : {}),
    },
    (progress) => {
      if (!options.signal.aborted) options.onProgress(progress);
    },
  );
  throwIfAborted(options.signal);
  return response;
}
