import { describe, expect, it } from "vitest";

import {
  createInitialSteganographyState,
  initialSteganographyState,
  steganographyReducer,
  type Capacity,
  type GeneratedImageResult,
  type SteganographyAction,
  type SteganographySourceImage,
  type SteganographyState,
} from "../../src/features/steganography/state";

const source: SteganographySourceImage = {
  file: new File(["carrier"], "carrier.png", { type: "image/png" }),
  objectUrl: "blob:localtext-carrier",
  name: "carrier.png",
  mime: "image/png",
  size: 7,
  width: 640,
  height: 480,
  kind: "png",
};

const jpegSource: SteganographySourceImage = {
  ...source,
  file: new File(["jpeg-carrier"], "carrier.jpg", { type: "image/jpeg" }),
  name: "carrier.jpg",
  mime: "image/jpeg",
  size: 12,
  kind: "jpeg",
};

const capacity: Capacity = {
  format: "png-v1",
  opaquePixelCount: 307_200,
  embeddedByteCapacity: 115_116,
  plainMessageCapacity: 115_116,
  encryptedMessageCapacity: 115_100,
};

const generatedResult: GeneratedImageResult = {
  kind: "generated-image",
  blob: new Blob(["encoded"], { type: "image/png" }),
  format: "png-v1",
  mime: "image/png",
  objectUrl: "blob:localtext-encoded",
  filename: "carrier-encoded.png",
  width: 640,
  height: 480,
  byteLength: 7,
  protection: "encrypted",
  messageByteCount: 14,
};

function readyHideState(): SteganographyState {
  let state = steganographyReducer(initialSteganographyState, {
    type: "sourceSelectionStarted",
    operationId: 1,
  });
  state = steganographyReducer(state, {
    type: "sourceReady",
    operationId: 1,
    source,
  });
  state = steganographyReducer(state, {
    type: "capacityAnalysisStarted",
    operationId: 2,
  });
  state = steganographyReducer(state, {
    type: "capacityReady",
    operationId: 2,
    capacity,
  });
  return steganographyReducer(state, {
    type: "setMessageByteCount",
    operationId: 3,
    byteCount: 14,
  });
}

function generatedHideState(): SteganographyState {
  let state = readyHideState();
  state = steganographyReducer(state, {
    type: "generationStarted",
    operationId: 4,
  });
  return steganographyReducer(state, {
    type: "generationSucceeded",
    operationId: 4,
    result: generatedResult,
  });
}

function readyRevealState(): SteganographyState {
  let state = steganographyReducer(initialSteganographyState, {
    type: "switchWorkflow",
    workflow: "reveal",
    operationId: 1,
  });
  state = steganographyReducer(state, {
    type: "sourceSelectionStarted",
    operationId: 2,
  });
  return steganographyReducer(state, {
    type: "sourceReady",
    operationId: 2,
    source,
  });
}

describe("steganography reducer defaults and operation lifecycle", () => {
  it("starts in an empty password-protected Hide workflow without password data", () => {
    expect(initialSteganographyState).toEqual({
      workflow: "hide",
      format: "png-v1",
      currentOperationId: 0,
      source: { status: "empty" },
      capacity: { status: "idle" },
      protection: "encrypted",
      messageByteCount: 0,
      generation: { status: "idle" },
      inspection: { status: "idle" },
      passwordRequired: null,
      result: null,
      progress: null,
      error: null,
    });
    expect(initialSteganographyState).not.toHaveProperty("password");
    expect(initialSteganographyState).not.toHaveProperty("passwordConfirmation");
  });

  it("advances operation IDs and rejects stale or non-increasing starts", () => {
    const loading = steganographyReducer(initialSteganographyState, {
      type: "sourceSelectionStarted",
      operationId: 7,
    });
    const staleReady = steganographyReducer(loading, {
      type: "sourceReady",
      operationId: 6,
      source,
    });
    const repeatedStart = steganographyReducer(loading, {
      type: "sourceSelectionStarted",
      operationId: 7,
    });

    expect(loading).toMatchObject({
      currentOperationId: 7,
      source: { status: "loading" },
    });
    expect(staleReady).toBe(loading);
    expect(repeatedStart).toBe(loading);
  });

  it("tracks capacity analysis with fixed progress codes", () => {
    let state = steganographyReducer(initialSteganographyState, {
      type: "sourceSelectionStarted",
      operationId: 1,
    });
    state = steganographyReducer(state, {
      type: "sourceReady",
      operationId: 1,
      source,
    });
    state = steganographyReducer(state, {
      type: "capacityAnalysisStarted",
      operationId: 2,
    });

    expect(state).toMatchObject({
      currentOperationId: 2,
      capacity: { status: "analysing" },
      progress: { stage: "analysing-capacity", value: null },
    });

    state = steganographyReducer(state, {
      type: "capacityAnalysisProgress",
      operationId: 2,
      progress: { stage: "analysing-capacity", value: 1.5 },
    });
    expect(state.progress).toEqual({
      stage: "analysing-capacity",
      value: 1,
    });

    state = steganographyReducer(state, {
      type: "capacityReady",
      operationId: 2,
      capacity,
    });
    expect(state).toMatchObject({
      capacity: { status: "ready", value: capacity },
      progress: null,
      error: null,
    });
  });

  it("keeps an in-flight capacity operation current while hide controls change", () => {
    let state = steganographyReducer(initialSteganographyState, {
      type: "sourceSelectionStarted",
      operationId: 1,
    });
    state = steganographyReducer(state, {
      type: "sourceReady",
      operationId: 1,
      source,
    });
    state = steganographyReducer(state, {
      type: "capacityAnalysisStarted",
      operationId: 2,
    });
    state = steganographyReducer(state, {
      type: "setMessageByteCount",
      operationId: 2,
      byteCount: 12,
    });
    state = steganographyReducer(state, {
      type: "setProtectionMode",
      operationId: 2,
      protection: "plain",
    });
    state = steganographyReducer(state, {
      type: "capacityReady",
      operationId: 2,
      capacity,
    });

    expect(state.currentOperationId).toBe(2);
    expect(state.messageByteCount).toBe(12);
    expect(state.protection).toBe("plain");
    expect(state.capacity).toEqual({ status: "ready", value: capacity });
  });

  it("rejects invalid message byte counts without changing state", () => {
    const ready = readyHideState();

    for (const byteCount of [-1, 1.5, Number.NaN]) {
      const next = steganographyReducer(ready, {
        type: "setMessageByteCount",
        operationId: 4,
        byteCount,
      });
      expect(next).toBe(ready);
    }
  });
});

describe("Hide workflow", () => {
  it("switches JPEG formats while preserving the original source and invalidating capacity", () => {
    let state = steganographyReducer(initialSteganographyState, {
      type: "sourceSelectionStarted",
      operationId: 1,
    });
    state = steganographyReducer(state, {
      type: "sourceReady",
      operationId: 1,
      source: jpegSource,
    });
    const switched = steganographyReducer(state, {
      type: "setFormat",
      operationId: 2,
      format: "jpeg-v2",
    });

    expect(switched.format).toBe("jpeg-v2");
    expect(switched.source).toEqual({ status: "ready", image: jpegSource });
    expect(switched.capacity).toEqual({ status: "analysing" });
    expect(switched.result).toBeNull();
  });

  it("returns to PNG v1 when a replacement carrier is not JPEG", () => {
    let state = steganographyReducer(initialSteganographyState, {
      type: "sourceSelectionStarted",
      operationId: 1,
    });
    state = steganographyReducer(state, {
      type: "sourceReady",
      operationId: 1,
      source: jpegSource,
    });
    state = steganographyReducer(state, {
      type: "setFormat",
      operationId: 2,
      format: "jpeg-v2",
    });
    state = steganographyReducer(state, {
      type: "sourceSelectionStarted",
      operationId: 3,
    });
    state = steganographyReducer(state, {
      type: "sourceReady",
      operationId: 3,
      source,
    });

    expect(state.format).toBe("png-v1");
    expect(state.source).toEqual({ status: "ready", image: source });
  });

  it("tracks generation progress and ignores stale responses", () => {
    const ready = readyHideState();
    const generating = steganographyReducer(ready, {
      type: "generationStarted",
      operationId: 4,
    });
    const progressed = steganographyReducer(generating, {
      type: "generationProgress",
      operationId: 4,
      progress: { stage: "embedding-message", value: 0.4 },
    });
    const staleSuccess = steganographyReducer(progressed, {
      type: "generationSucceeded",
      operationId: 3,
      result: generatedResult,
    });

    expect(generating).toMatchObject({
      currentOperationId: 4,
      generation: { status: "generating" },
      progress: { stage: "deriving-encryption-key", value: null },
    });
    expect(progressed.progress).toEqual({
      stage: "embedding-message",
      value: 0.4,
    });
    expect(staleSuccess).toBe(progressed);
  });

  it("never exposes fake percentage progress for key derivation", () => {
    const generating = steganographyReducer(readyHideState(), {
      type: "generationStarted",
      operationId: 4,
    });
    const progressed = steganographyReducer(generating, {
      type: "generationProgress",
      operationId: 4,
      progress: { stage: "deriving-encryption-key", value: 0.75 },
    });

    expect(progressed.progress).toEqual({
      stage: "deriving-encryption-key",
      value: null,
    });
  });

  it("stores a generated result as an immutable operation snapshot", () => {
    const completed = generatedHideState();

    expect(completed).toMatchObject({
      generation: { status: "succeeded" },
      result: generatedResult,
      progress: null,
      error: null,
    });
    expect(Object.isFrozen(completed.result)).toBe(true);

    const dismissed = steganographyReducer(completed, {
      type: "dismissError",
    });
    expect(dismissed.result).toBe(completed.result);
  });

  it.each([
    {
      type: "setProtectionMode",
      operationId: 5,
      protection: "plain",
    },
    {
      type: "setMessageByteCount",
      operationId: 5,
      byteCount: 15,
    },
    {
      type: "passwordConfigurationChanged",
      operationId: 5,
    },
  ] satisfies SteganographyAction[])(
    "invalidates a generated result for a user $type action",
    (action) => {
      const next = steganographyReducer(generatedHideState(), action);

      expect(next.currentOperationId).toBe(5);
      expect(next.result).toBeNull();
      expect(next.generation).toEqual({ status: "idle" });
      expect(next.source.status).toBe("ready");
      expect(next.capacity.status).toBe("ready");
    },
  );

  it("does not model password-control cleanup as state or revoke success", () => {
    const completed = generatedHideState();

    expect(completed).not.toHaveProperty("password");
    expect(completed).not.toHaveProperty("passwordConfirmation");
    expect(completed.result?.kind).toBe("generated-image");
  });

  it("fully invalidates old content when source replacement begins", () => {
    const replacing = steganographyReducer(generatedHideState(), {
      type: "sourceSelectionStarted",
      operationId: 5,
    });

    expect(replacing).toEqual({
      ...createInitialSteganographyState("hide", 5),
      source: { status: "loading" },
    });
  });
});

describe("Reveal workflow", () => {
  it("switches workflows with a complete independent reset", () => {
    const switched = steganographyReducer(generatedHideState(), {
      type: "switchWorkflow",
      workflow: "reveal",
      operationId: 5,
    });

    expect(switched).toEqual(createInitialSteganographyState("reveal", 5));
  });

  it("represents an ordinary PNG as no-message rather than damaged", () => {
    let state = readyRevealState();
    state = steganographyReducer(state, {
      type: "inspectionStarted",
      operationId: 3,
    });
    state = steganographyReducer(state, {
      type: "inspectionNoMessage",
      operationId: 3,
    });

    expect(state).toMatchObject({
      inspection: { status: "complete" },
      result: { kind: "no-message" },
      error: null,
      passwordRequired: null,
    });
  });

  it("completes a plain inspection with an immutable text result", () => {
    let state = readyRevealState();
    state = steganographyReducer(state, {
      type: "inspectionStarted",
      operationId: 3,
    });
    state = steganographyReducer(state, {
      type: "inspectionPlainReady",
      operationId: 3,
      result: {
        kind: "revealed-text",
        text: "Exact text\nwith a new line",
        filename: "carrier-message.txt",
        protection: "plain",
      },
    });

    expect(state.inspection).toEqual({ status: "complete" });
    expect(state.result).toMatchObject({
      kind: "revealed-text",
      protection: "plain",
    });
    expect(Object.isFrozen(state.result)).toBe(true);
  });

  it("retains only a session marker for password retry and clears it on success", () => {
    let state = readyRevealState();
    state = steganographyReducer(state, {
      type: "inspectionStarted",
      operationId: 3,
    });
    state = steganographyReducer(state, {
      type: "inspectionPasswordRequired",
      operationId: 3,
    });

    expect(state).toMatchObject({
      inspection: { status: "password-required" },
      passwordRequired: { operationId: 3, failedAttempts: 0 },
      result: null,
    });
    expect(state.passwordRequired).not.toHaveProperty("password");
    expect(state.passwordRequired).not.toHaveProperty("header");
    expect(state.passwordRequired).not.toHaveProperty("payload");

    state = steganographyReducer(state, {
      type: "unlockStarted",
      operationId: 3,
    });
    state = steganographyReducer(state, {
      type: "unlockFailed",
      operationId: 3,
    });

    expect(state).toMatchObject({
      inspection: { status: "password-required" },
      passwordRequired: { operationId: 3, failedAttempts: 1 },
      error: { code: "unlock-failed" },
    });

    state = steganographyReducer(state, {
      type: "unlockStarted",
      operationId: 3,
    });
    state = steganographyReducer(state, {
      type: "unlockSucceeded",
      operationId: 3,
      result: {
        kind: "revealed-text",
        text: "Recovered text",
        filename: "carrier-message.txt",
        protection: "encrypted",
      },
    });

    expect(state).toMatchObject({
      inspection: { status: "complete" },
      passwordRequired: null,
      result: {
        kind: "revealed-text",
        protection: "encrypted",
      },
      error: null,
    });
  });

  it("rejects stale inspection and unlock responses", () => {
    let state = readyRevealState();
    state = steganographyReducer(state, {
      type: "inspectionStarted",
      operationId: 3,
    });
    const staleInspection = steganographyReducer(state, {
      type: "inspectionNoMessage",
      operationId: 2,
    });
    expect(staleInspection).toBe(state);

    state = steganographyReducer(state, {
      type: "inspectionPasswordRequired",
      operationId: 3,
    });
    state = steganographyReducer(state, {
      type: "unlockStarted",
      operationId: 3,
    });
    const staleUnlock = steganographyReducer(state, {
      type: "unlockFailed",
      operationId: 2,
    });
    expect(staleUnlock).toBe(state);
  });
});

describe("full cleanup actions and typed failures", () => {
  it.each(["startOver", "cancel", "clear"] as const)(
    "%s performs a full current-workflow reset with a new operation ID",
    (type) => {
      const reset = steganographyReducer(generatedHideState(), {
        type,
        operationId: 5,
      });

      expect(reset).toEqual(createInitialSteganographyState("hide", 5));
    },
  );

  it("keeps errors and progress content-free", () => {
    let state = readyHideState();
    state = steganographyReducer(state, {
      type: "generationStarted",
      operationId: 4,
    });
    state = steganographyReducer(state, {
      type: "generationFailed",
      operationId: 4,
      error: { code: "worker-message-error" },
    });

    expect(state.error).toEqual({ code: "worker-message-error" });
    expect(Object.keys(state.error ?? {})).toEqual(["code"]);
    expect(state.progress).toBeNull();
  });

  it("ignores feature actions that do not belong to the active workflow", () => {
    const reveal = readyRevealState();
    const generationAttempt = steganographyReducer(reveal, {
      type: "generationStarted",
      operationId: 3,
    });
    expect(generationAttempt).toBe(reveal);

    const hide = readyHideState();
    const inspectionAttempt = steganographyReducer(hide, {
      type: "inspectionStarted",
      operationId: 4,
    });
    expect(inspectionAttempt).toBe(hide);
  });
});
