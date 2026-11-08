import {
  createInitialSteganographyState,
  type Capacity,
  type GeneratedImageResult,
  type ProtectionMode,
  type RevealedTextResult,
  type SteganographyError,
  type SteganographyProgress,
  type SteganographyFormat,
  type SteganographySourceImage,
  type SteganographyState,
  type SteganographyWorkflow,
} from "./types";

export type SteganographyAction =
  | {
      readonly type: "switchWorkflow";
      readonly workflow: SteganographyWorkflow;
      readonly operationId: number;
    }
  | { readonly type: "sourceSelectionStarted"; readonly operationId: number }
  | {
      readonly type: "setFormat";
      readonly format: SteganographyFormat;
      readonly operationId: number;
    }
  | {
      readonly type: "sourceReady";
      readonly operationId: number;
      readonly source: SteganographySourceImage;
    }
  | {
      readonly type: "sourceFailed";
      readonly operationId: number;
      readonly error: SteganographyError;
    }
  | { readonly type: "capacityAnalysisStarted"; readonly operationId: number }
  | {
      readonly type: "capacityAnalysisProgress";
      readonly operationId: number;
      readonly progress: SteganographyProgress;
    }
  | {
      readonly type: "capacityReady";
      readonly operationId: number;
      readonly capacity: Capacity;
    }
  | {
      readonly type: "capacityFailed";
      readonly operationId: number;
      readonly error: SteganographyError;
    }
  | {
      readonly type: "setProtectionMode";
      readonly operationId: number;
      readonly protection: ProtectionMode;
    }
  | {
      readonly type: "setMessageByteCount";
      readonly operationId: number;
      readonly byteCount: number;
    }
  | {
      readonly type: "passwordConfigurationChanged";
      readonly operationId: number;
    }
  | { readonly type: "generationStarted"; readonly operationId: number }
  | {
      readonly type: "generationProgress";
      readonly operationId: number;
      readonly progress: SteganographyProgress;
    }
  | {
      readonly type: "generationSucceeded";
      readonly operationId: number;
      readonly result: GeneratedImageResult;
    }
  | {
      readonly type: "generationFailed";
      readonly operationId: number;
      readonly error: SteganographyError;
    }
  | { readonly type: "inspectionStarted"; readonly operationId: number }
  | {
      readonly type: "inspectionProgress";
      readonly operationId: number;
      readonly progress: SteganographyProgress;
    }
  | { readonly type: "inspectionNoMessage"; readonly operationId: number }
  | {
      readonly type: "inspectionPlainReady";
      readonly operationId: number;
      readonly result: RevealedTextResult;
    }
  | {
      readonly type: "inspectionPasswordRequired";
      readonly operationId: number;
    }
  | {
      readonly type: "inspectionFailed";
      readonly operationId: number;
      readonly error: SteganographyError;
    }
  | { readonly type: "unlockStarted"; readonly operationId: number }
  | {
      readonly type: "unlockProgress";
      readonly operationId: number;
      readonly progress: SteganographyProgress;
    }
  | {
      readonly type: "unlockSucceeded";
      readonly operationId: number;
      readonly result: RevealedTextResult;
    }
  | {
      readonly type: "unlockFailed";
      readonly operationId: number;
    }
  | { readonly type: "startOver"; readonly operationId: number }
  | { readonly type: "cancel"; readonly operationId: number }
  | { readonly type: "clear"; readonly operationId: number }
  | { readonly type: "dismissError" };

function isValidOperationId(operationId: number) {
  return Number.isSafeInteger(operationId) && operationId >= 0;
}

function beginsNewOperation(
  state: SteganographyState,
  operationId: number,
) {
  return (
    isValidOperationId(operationId) &&
    operationId > state.currentOperationId
  );
}

function isCurrentOperation(
  state: SteganographyState,
  operationId: number,
) {
  return (
    isValidOperationId(operationId) &&
    operationId === state.currentOperationId
  );
}

function continuesOrBeginsOperation(
  state: SteganographyState,
  operationId: number,
) {
  return (
    isValidOperationId(operationId) &&
    operationId >= state.currentOperationId
  );
}

function normaliseProgress(
  progress: SteganographyProgress,
): SteganographyProgress {
  if (
    progress.stage === "deriving-encryption-key" ||
    progress.value === null ||
    !Number.isFinite(progress.value)
  ) {
    return { stage: progress.stage, value: null };
  }

  return {
    stage: progress.stage,
    value: Math.min(1, Math.max(0, progress.value)),
  };
}

function resetForCurrentWorkflow(
  state: SteganographyState,
  operationId: number,
) {
  return createInitialSteganographyState(state.workflow, operationId);
}

function invalidateHideResult(
  state: SteganographyState,
  operationId: number,
): SteganographyState {
  return {
    ...state,
    currentOperationId: operationId,
    generation: { status: "idle" },
    result: null,
    progress: null,
    error: null,
  };
}

function freezeGeneratedResult(
  result: GeneratedImageResult,
): GeneratedImageResult {
  return Object.freeze({ ...result });
}

function freezeRevealedResult(
  result: RevealedTextResult,
): RevealedTextResult {
  return Object.freeze({ ...result });
}

export function steganographyReducer(
  state: SteganographyState,
  action: SteganographyAction,
): SteganographyState {
  switch (action.type) {
    case "switchWorkflow":
      if (!beginsNewOperation(state, action.operationId)) return state;
      return createInitialSteganographyState(
        action.workflow,
        action.operationId,
      );

    case "sourceSelectionStarted":
      if (!beginsNewOperation(state, action.operationId)) return state;
      return {
        ...resetForCurrentWorkflow(state, action.operationId),
        format: state.format,
        source: { status: "loading" },
      };

    case "setFormat":
      if (
        state.workflow !== "hide" ||
        !beginsNewOperation(state, action.operationId) ||
        state.format === action.format
      ) {
        return state;
      }
      return {
        ...invalidateHideResult(state, action.operationId),
        format: action.format,
        capacity:
          state.source.status === "ready"
            ? { status: "analysing" }
            : { status: "idle" },
      };

    case "sourceReady":
      if (!isCurrentOperation(state, action.operationId)) return state;
      return {
        ...state,
        format:
          state.workflow === "hide" && action.source.kind !== "jpeg"
            ? "png-v1"
            : state.format,
        source: { status: "ready", image: action.source },
        error: null,
      };

    case "sourceFailed":
      if (!isCurrentOperation(state, action.operationId)) return state;
      return {
        ...state,
        source: { status: "empty" },
        error: action.error,
      };

    case "capacityAnalysisStarted":
      if (
        state.workflow !== "hide" ||
        state.source.status !== "ready" ||
        !beginsNewOperation(state, action.operationId)
      ) {
        return state;
      }
      return {
        ...state,
        currentOperationId: action.operationId,
        capacity: { status: "analysing" },
        progress: { stage: "analysing-capacity", value: null },
        error: null,
      };

    case "capacityAnalysisProgress":
      if (
        state.workflow !== "hide" ||
        state.capacity.status !== "analysing" ||
        !isCurrentOperation(state, action.operationId)
      ) {
        return state;
      }
      return { ...state, progress: normaliseProgress(action.progress) };

    case "capacityReady":
      if (
        state.workflow !== "hide" ||
        !isCurrentOperation(state, action.operationId)
      ) {
        return state;
      }
      return {
        ...state,
        capacity: { status: "ready", value: action.capacity },
        progress: null,
        error: null,
      };

    case "capacityFailed":
      if (
        state.workflow !== "hide" ||
        !isCurrentOperation(state, action.operationId)
      ) {
        return state;
      }
      return {
        ...state,
        capacity: { status: "unavailable" },
        progress: null,
        error: action.error,
      };

    case "setProtectionMode":
      if (
        state.workflow !== "hide" ||
        !continuesOrBeginsOperation(state, action.operationId)
      ) {
        return state;
      }
      return {
        ...invalidateHideResult(state, action.operationId),
        protection: action.protection,
      };

    case "setMessageByteCount":
      if (
        state.workflow !== "hide" ||
        !continuesOrBeginsOperation(state, action.operationId) ||
        !Number.isSafeInteger(action.byteCount) ||
        action.byteCount < 0
      ) {
        return state;
      }
      return {
        ...invalidateHideResult(state, action.operationId),
        messageByteCount: action.byteCount,
      };

    case "passwordConfigurationChanged":
      if (
        state.workflow !== "hide" ||
        !continuesOrBeginsOperation(state, action.operationId)
      ) {
        return state;
      }
      return invalidateHideResult(state, action.operationId);

    case "generationStarted":
      if (
        state.workflow !== "hide" ||
        state.source.status !== "ready" ||
        state.capacity.status !== "ready" ||
        state.messageByteCount <= 0 ||
        !beginsNewOperation(state, action.operationId)
      ) {
        return state;
      }
      return {
        ...state,
        currentOperationId: action.operationId,
        generation: { status: "generating" },
        result: null,
        progress: {
          stage:
            state.protection === "encrypted"
              ? "deriving-encryption-key"
              : "hashing-message",
          value: null,
        },
        error: null,
      };

    case "generationProgress":
      if (
        state.workflow !== "hide" ||
        state.generation.status !== "generating" ||
        !isCurrentOperation(state, action.operationId)
      ) {
        return state;
      }
      return { ...state, progress: normaliseProgress(action.progress) };

    case "generationSucceeded":
      if (
        state.workflow !== "hide" ||
        state.generation.status !== "generating" ||
        !isCurrentOperation(state, action.operationId)
      ) {
        return state;
      }
      return {
        ...state,
        generation: { status: "succeeded" },
        result: freezeGeneratedResult(action.result),
        progress: null,
        error: null,
      };

    case "generationFailed":
      if (
        state.workflow !== "hide" ||
        !isCurrentOperation(state, action.operationId)
      ) {
        return state;
      }
      return {
        ...state,
        generation: { status: "failed" },
        result: null,
        progress: null,
        error: action.error,
      };

    case "inspectionStarted":
      if (
        state.workflow !== "reveal" ||
        state.source.status !== "ready" ||
        !beginsNewOperation(state, action.operationId)
      ) {
        return state;
      }
      return {
        ...state,
        currentOperationId: action.operationId,
        inspection: { status: "inspecting" },
        passwordRequired: null,
        result: null,
        progress: { stage: "inspecting-header", value: null },
        error: null,
      };

    case "inspectionProgress":
      if (
        state.workflow !== "reveal" ||
        state.inspection.status !== "inspecting" ||
        !isCurrentOperation(state, action.operationId)
      ) {
        return state;
      }
      return { ...state, progress: normaliseProgress(action.progress) };

    case "inspectionNoMessage":
      if (
        state.workflow !== "reveal" ||
        state.inspection.status !== "inspecting" ||
        !isCurrentOperation(state, action.operationId)
      ) {
        return state;
      }
      return {
        ...state,
        inspection: { status: "complete" },
        passwordRequired: null,
        result: Object.freeze({ kind: "no-message" }),
        progress: null,
        error: null,
      };

    case "inspectionPlainReady":
      if (
        state.workflow !== "reveal" ||
        state.inspection.status !== "inspecting" ||
        !isCurrentOperation(state, action.operationId)
      ) {
        return state;
      }
      return {
        ...state,
        inspection: { status: "complete" },
        passwordRequired: null,
        result: freezeRevealedResult(action.result),
        progress: null,
        error: null,
      };

    case "inspectionPasswordRequired":
      if (
        state.workflow !== "reveal" ||
        state.inspection.status !== "inspecting" ||
        !isCurrentOperation(state, action.operationId)
      ) {
        return state;
      }
      return {
        ...state,
        inspection: { status: "password-required" },
        passwordRequired: {
          operationId: action.operationId,
          failedAttempts: 0,
        },
        result: null,
        progress: null,
        error: null,
      };

    case "inspectionFailed":
      if (
        state.workflow !== "reveal" ||
        !isCurrentOperation(state, action.operationId)
      ) {
        return state;
      }
      return {
        ...state,
        inspection: { status: "failed" },
        passwordRequired: null,
        result: null,
        progress: null,
        error: action.error,
      };

    case "unlockStarted":
      if (
        state.workflow !== "reveal" ||
        state.inspection.status !== "password-required" ||
        state.passwordRequired?.operationId !== action.operationId ||
        !isCurrentOperation(state, action.operationId)
      ) {
        return state;
      }
      return {
        ...state,
        inspection: { status: "unlocking" },
        progress: { stage: "deriving-encryption-key", value: null },
        error: null,
      };

    case "unlockProgress":
      if (
        state.workflow !== "reveal" ||
        state.inspection.status !== "unlocking" ||
        !isCurrentOperation(state, action.operationId)
      ) {
        return state;
      }
      return { ...state, progress: normaliseProgress(action.progress) };

    case "unlockSucceeded":
      if (
        state.workflow !== "reveal" ||
        state.inspection.status !== "unlocking" ||
        !isCurrentOperation(state, action.operationId)
      ) {
        return state;
      }
      return {
        ...state,
        inspection: { status: "complete" },
        passwordRequired: null,
        result: freezeRevealedResult(action.result),
        progress: null,
        error: null,
      };

    case "unlockFailed":
      if (
        state.workflow !== "reveal" ||
        state.inspection.status !== "unlocking" ||
        !isCurrentOperation(state, action.operationId) ||
        !state.passwordRequired
      ) {
        return state;
      }
      return {
        ...state,
        inspection: { status: "password-required" },
        passwordRequired: {
          ...state.passwordRequired,
          failedAttempts: state.passwordRequired.failedAttempts + 1,
        },
        progress: null,
        error: { code: "unlock-failed" },
      };

    case "startOver":
    case "cancel":
    case "clear":
      if (!beginsNewOperation(state, action.operationId)) return state;
      return resetForCurrentWorkflow(state, action.operationId);

    case "dismissError":
      return { ...state, error: null };
  }
}
