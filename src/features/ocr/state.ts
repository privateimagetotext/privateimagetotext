import {
  defaultTransform,
  initialOcrState,
  type CropRect,
  type EnhancementPreset,
  type ImageSource,
  type OcrContentMode,
  type OcrError,
  type OcrProgress,
  type OcrResult,
  type OcrState,
  type PreparationMetadata,
  type ResultView,
} from "./types";

export type OcrAction =
  | { type: "restoreWorkspace"; state: OcrState; operationId: number }
  | { type: "decodeStart"; operationId: number }
  | { type: "imageReady"; operationId: number; image: ImageSource }
  | { type: "decodeError"; operationId: number; error: OcrError }
  | { type: "editStart" }
  | { type: "editCancel" }
  | { type: "setCrop"; crop: CropRect }
  | { type: "rotate"; direction: "left" | "right" }
  | { type: "setPreset"; preset: EnhancementPreset }
  | { type: "resetImageEdits" }
  | { type: "setContentMode"; mode: OcrContentMode }
  | { type: "applyContentDefaults"; state: OcrState }
  | { type: "preparationReady"; metadata: PreparationMetadata }
  | { type: "ocrStart"; operationId: number }
  | {
      type: "ocrProgress";
      operationId: number;
      progress: OcrProgress;
    }
  | { type: "ocrSuccess"; operationId: number; result: OcrResult }
  | {
      type: "ocrCancelled";
      operationId: number;
      nextOperationId: number;
    }
  | { type: "ocrError"; operationId: number; error: OcrError }
  | { type: "setResultView"; view: ResultView }
  | { type: "editResult"; value: string }
  | { type: "replaceEdited"; value: string; view: ResultView }
  | { type: "clear"; operationId: number }
  | { type: "dismissError" };

function isCurrent(state: OcrState, operationId: number) {
  return state.currentOperationId === operationId;
}

function invalidateResult(
  state: OcrState,
  invalidatePreparation = false,
): OcrState {
  return {
    ...state,
    status: state.image ? "imageReady" : "idle",
    result: null,
    resultView: "cleaned",
    preparation: invalidatePreparation ? null : state.preparation,
    progress: null,
    error: null,
  };
}

export function ocrReducer(state: OcrState, action: OcrAction): OcrState {
  switch (action.type) {
    case "restoreWorkspace":
      return { ...action.state, currentOperationId: action.operationId };
    case "decodeStart":
      return {
        ...state,
        status: "decoding",
        currentOperationId: action.operationId,
        progress: null,
        error: null,
      };
    case "imageReady":
      if (!isCurrent(state, action.operationId)) return state;
      return {
        ...initialOcrState,
        status: "imageReady",
        currentOperationId: action.operationId,
        image: action.image,
      };
    case "decodeError":
      if (!isCurrent(state, action.operationId)) return state;
      return {
        ...state,
        status: state.image ? "imageReady" : "error",
        error: action.error,
      };
    case "editStart":
      return state.image ? { ...state, status: "editingImage" } : state;
    case "editCancel":
      return {
        ...state,
        status: state.result ? "complete" : state.image ? "imageReady" : "idle",
      };
    case "setCrop":
      return invalidateResult({
        ...state,
        transform: { ...state.transform, crop: action.crop },
        status: "imageReady",
      }, true);
    case "rotate": {
      const delta = action.direction === "right" ? 90 : 270;
      const rotation = ((state.transform.rotation + delta) % 360) as
        | 0
        | 90
        | 180
        | 270;
      return invalidateResult({
        ...state,
        transform: {
          ...state.transform,
          rotation,
          crop: defaultTransform.crop,
        },
      }, true);
    }
    case "setPreset":
      return invalidateResult({
        ...state,
        transform: { ...state.transform, preset: action.preset },
      }, true);
    case "resetImageEdits":
      return invalidateResult({ ...state, transform: { ...defaultTransform } }, true);
    case "setContentMode":
      return invalidateResult({ ...state, contentMode: action.mode, suggestedContentMode: null });
    case "applyContentDefaults":
      return { ...state, defaultsApplied: true, contentMode: action.state.contentMode,
        suggestedContentMode: action.state.suggestedContentMode, transform: action.state.transform };
    case "preparationReady":
      return {
        ...state,
        preparation: action.metadata,
      };
    case "ocrStart":
      return {
        ...state,
        status: "loadingOcr",
        currentOperationId: action.operationId,
        progress: { stage: "Loading local OCR assets", value: null },
        result: null,
        error: null,
      };
    case "ocrProgress":
      if (!isCurrent(state, action.operationId)) return state;
      return {
        ...state,
        status:
          action.progress.stage.toLowerCase().includes("recogn")
            ? "recognising"
            : "loadingOcr",
        progress: action.progress,
      };
    case "ocrSuccess":
      if (!isCurrent(state, action.operationId)) return state;
      return {
        ...state,
        status: "complete",
        progress: null,
        result: action.result,
        resultView: "cleaned",
      };
    case "ocrCancelled":
      if (!isCurrent(state, action.operationId)) return state;
      return {
        ...state,
        status: state.image ? "imageReady" : "idle",
        currentOperationId: action.nextOperationId,
        progress: null,
        result: null,
        error: null,
      };
    case "ocrError":
      if (!isCurrent(state, action.operationId)) return state;
      return {
        ...state,
        status: "error",
        progress: null,
        error: action.error,
      };
    case "setResultView":
      return state.result ? { ...state, resultView: action.view } : state;
    case "editResult":
      if (!state.result) return state;
      return {
        ...state,
        resultView: "edited",
        result: { ...state.result, edited: action.value },
      };
    case "replaceEdited":
      if (!state.result) return state;
      return {
        ...state,
        resultView: action.view,
        result: { ...state.result, edited: action.value },
      };
    case "clear":
      if (action.operationId < state.currentOperationId) return state;
      return {
        ...initialOcrState,
        currentOperationId: action.operationId,
      };
    case "dismissError":
      return {
        ...state,
        status: state.image ? "imageReady" : "idle",
        error: null,
      };
  }
}
