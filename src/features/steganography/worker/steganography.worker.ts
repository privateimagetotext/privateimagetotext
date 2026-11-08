/// <reference lib="webworker" />

import {
  CodecError,
  analyseCapacity,
  encodeCarrier,
  inspectCarrier,
  unlockCarrier,
  zeroBuffer,
} from "../codec";
import {
  JpegV2CodecError,
  analyseJpegV2,
  disposeJpegV2Codec,
  encodeJpegV2Carrier,
  inspectJpegV2Carrier,
  unlockJpegV2Carrier,
} from "../jpeg-v2";
import type {
  AnalyseRequest,
  EncodeRequest,
  InspectRequest,
  SteganographyWorkerRequest,
  SteganographyWorkerResponse,
  WorkerErrorCode,
  WorkerStage,
} from "./protocol";

type RevealSession = {
  readonly operationId: number;
  readonly format: "png-v1" | "jpeg-v2";
  readonly header: Uint8Array;
  readonly payload: Uint8Array;
};

const context = self as DedicatedWorkerGlobalScope;
let revealSession: RevealSession | null = null;

function post(response: SteganographyWorkerResponse, transfer: Transferable[] = []) {
  context.postMessage(response, transfer);
}

function progress(operationId: number, stage: WorkerStage) {
  post({ type: "progress", operationId, stage });
}

function clearRevealSession() {
  if (!revealSession) return;
  zeroBuffer(revealSession.header);
  zeroBuffer(revealSession.payload);
  revealSession = null;
}

function errorCode(error: unknown): WorkerErrorCode {
  if (error instanceof CodecError) return error.code;
  if (error instanceof JpegV2CodecError) {
    if (error.code === "malformed-jpeg") return "malformed-jpeg";
    if (error.code === "unsupported-jpeg-profile") return "unsupported-jpeg-profile";
    if (error.code === "jpeg-codec-unavailable") return "jpeg-codec-unavailable";
    if (error.code === "jpeg-self-verification-failed") return "jpeg-self-verification-failed";
    if (error.code === "output-too-large") return "jpeg-output-too-large";
    if (error.code === "allocation-failed") return "jpeg-allocation-failed";
    if (error.code === "capacity-unavailable") return "capacity-unavailable";
    if (error.code === "unsupported-version") return "unsupported-version";
    if (error.code === "unsupported-format") return "unsupported-format";
    return "damaged";
  }
  return "worker-failed";
}

async function analyse(request: AnalyseRequest) {
  progress(request.operationId, "analysing-capacity");
  if (request.format === "jpeg-v2") {
    const bytes = new Uint8Array(request.bytes);
    try {
      progress(request.operationId, "loading-jpeg-codec");
      progress(request.operationId, "parsing-jpeg");
      const capacity = await analyseJpegV2(bytes);
      post({ type: "capacity", operationId: request.operationId, capacity });
    } finally {
      zeroBuffer(bytes);
    }
    return;
  }
  const pixels = new Uint8ClampedArray(request.pixels);
  try {
    const capacity = analyseCapacity(pixels, request.width, request.height);
    post({ type: "capacity", operationId: request.operationId, capacity });
  } finally {
    zeroBuffer(pixels);
  }
}

async function encode(request: EncodeRequest) {
  const message = new Uint8Array(request.message);
  const password = request.password ? new Uint8Array(request.password) : undefined;
  if (request.format === "jpeg-v2") {
    const source = new Uint8Array(request.bytes);
    let output: Uint8Array | null = null;
    try {
      progress(request.operationId, "loading-jpeg-codec");
      progress(request.operationId, "parsing-jpeg");
      progress(request.operationId, "validating-jpeg-profile");
      const result = await encodeJpegV2Carrier({
        source,
        message,
        password,
        onStage: (stage) => progress(request.operationId, stage),
      });
      output = result.bytes;
      const completedOutput = output;
      const outputBuffer = completedOutput.buffer as ArrayBuffer;
      post(
        {
          type: "encoded",
          operationId: request.operationId,
          format: "jpeg-v2",
          bytes: outputBuffer,
          width: result.capacity.width,
          height: result.capacity.height,
        },
        [outputBuffer],
      );
      output = null;
    } finally {
      zeroBuffer(source);
      zeroBuffer(output ?? undefined);
      zeroBuffer(message);
      zeroBuffer(password);
    }
    return;
  }

  const pixels = new Uint8ClampedArray(request.pixels);
  let transferred = false;
  try {
    progress(request.operationId, password ? "deriving-encryption-key" : "hashing-message");
    await encodeCarrier({ pixels, width: request.width, height: request.height, message, password });
    progress(request.operationId, "embedding-payload");
    post(
      {
        type: "encoded",
        operationId: request.operationId,
        format: "png-v1",
        pixels: pixels.buffer,
        width: request.width,
        height: request.height,
      },
      [pixels.buffer],
    );
    transferred = true;
  } finally {
    zeroBuffer(message);
    zeroBuffer(password);
    if (!transferred) zeroBuffer(pixels);
  }
}

async function inspect(request: InspectRequest) {
  clearRevealSession();
  progress(request.operationId, "inspecting-header");
  if (request.format === "jpeg-v2") {
    const bytes = new Uint8Array(request.bytes);
    try {
      progress(request.operationId, "loading-jpeg-codec");
      progress(request.operationId, "parsing-jpeg");
      const result = await inspectJpegV2Carrier(bytes);
      if (result.kind === "password-required") {
        revealSession = {
          operationId: request.operationId,
          format: "jpeg-v2",
          header: result.header,
          payload: result.payload,
        };
        post({ type: "inspection", operationId: request.operationId, result: { kind: "password-required" } });
        return;
      }
      post({ type: "inspection", operationId: request.operationId, result });
    } finally {
      zeroBuffer(bytes);
    }
    return;
  }

  const pixels = new Uint8ClampedArray(request.pixels);
  try {
    const result = await inspectCarrier(pixels, request.width, request.height);
    if (result.kind === "password-required") {
      revealSession = {
        operationId: request.operationId,
        format: "png-v1",
        header: result.header,
        payload: result.payload,
      };
      post({ type: "inspection", operationId: request.operationId, result: { kind: "password-required" } });
      return;
    }
    post({ type: "inspection", operationId: request.operationId, result });
  } finally {
    zeroBuffer(pixels);
  }
}

async function unlock(request: Extract<SteganographyWorkerRequest, { type: "unlock" }>) {
  const password = new Uint8Array(request.password);
  try {
    if (!revealSession || revealSession.operationId !== request.operationId) {
      throw new CodecError("cancelled");
    }
    progress(request.operationId, "deriving-encryption-key");
    const message = revealSession.format === "jpeg-v2"
      ? await unlockJpegV2Carrier(
          revealSession.header,
          revealSession.payload,
          password,
          crypto,
          () => progress(request.operationId, "decrypting-message"),
        )
      : await unlockCarrier(revealSession.header, revealSession.payload, password);
    if (revealSession.format === "png-v1") progress(request.operationId, "decrypting-message");
    clearRevealSession();
    post({ type: "unlocked", operationId: request.operationId, message });
  } finally {
    zeroBuffer(password);
  }
}

context.addEventListener("message", (event: MessageEvent<SteganographyWorkerRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      if (request.type === "analyse") await analyse(request);
      else if (request.type === "encode") await encode(request);
      else if (request.type === "inspect") await inspect(request);
      else if (request.type === "unlock") await unlock(request);
      else {
        clearRevealSession();
        await disposeJpegV2Codec();
        post({ type: "disposed", operationId: request.operationId });
      }
    } catch (error) {
      post({ type: "error", operationId: request.operationId, code: errorCode(error) });
    }
  })();
});

context.addEventListener("close", () => {
  clearRevealSession();
  void disposeJpegV2Codec();
});
