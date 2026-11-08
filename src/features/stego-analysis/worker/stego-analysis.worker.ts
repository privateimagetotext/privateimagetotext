/// <reference lib="webworker" />

import { analyseFile, decodeImage, fileStrings, type DetectedKind } from "../analyse";
import { hexRows, scanStrings } from "../bytes";
import { STEGO_ANALYSIS_LIMITS, StegoAnalysisError } from "../limits";
import { extractLsb } from "../lsb";
import { planeById, renderPlane } from "../planes";
import type { DecodedImage } from "../png";
import type { StegoAnalysisRequest, StegoAnalysisResponse } from "./protocol";

const context = self as DedicatedWorkerGlobalScope;

type Session = {
  readonly bytes: Uint8Array;
  readonly kind: DetectedKind | null;
  image: DecodedImage | null;
  readonly imageEndOffset: number | null;
};

let session: Session | null = null;
// Requests run strictly in order, so nothing reads the session while a load is decoding.
let queue: Promise<void> = Promise.resolve();

function post(response: StegoAnalysisResponse, transfer: Transferable[] = []) {
  context.postMessage(response, transfer);
}

function requireSession() {
  if (!session) throw new StegoAnalysisError("worker-failed", "No file is loaded.");
  return session;
}

function clearSession() {
  if (!session) return;
  session.bytes.fill(0);
  session.image?.rgba.fill(0);
  session = null;
}

async function handle(request: StegoAnalysisRequest) {
  switch (request.type) {
    case "load": {
      clearSession();
      const bytes = new Uint8Array(request.bytes);
      const file = await analyseFile(bytes);
      let image: DecodedImage | null = null;
      let imageReport = null;
      let imageError: string | null = null;
      try {
        const decoded = await decodeImage(bytes, file.kind);
        image = decoded.image;
        imageReport = decoded.report;
      } catch (error) {
        imageError = error instanceof StegoAnalysisError ? error.message : "The image could not be decoded.";
      }
      session = { bytes, kind: file.kind, image, imageEndOffset: file.imageEndOffset };
      post({ type: "loaded", operationId: request.operationId, file, image: imageReport, imageError });
      return;
    }
    case "strings": {
      post({ type: "strings", operationId: request.operationId, scan: fileStrings(requireSession().bytes, request.minLength) });
      return;
    }
    case "plane": {
      const { image } = requireSession();
      const plane = planeById(request.planeId);
      if (!image) throw new StegoAnalysisError("no-image", "No decoded image is available.");
      if (!plane) throw new StegoAnalysisError("invalid-options", "Unknown view.");
      const pixels = renderPlane(image.rgba, plane.view);
      post({
        type: "plane",
        operationId: request.operationId,
        planeId: plane.id,
        width: image.width,
        height: image.height,
        pixels: pixels.buffer as ArrayBuffer,
      }, [pixels.buffer]);
      return;
    }
    case "extract": {
      const { image } = requireSession();
      if (!image) throw new StegoAnalysisError("no-image", "No decoded image is available.");
      const result = extractLsb(image.rgba, image.width, image.height, request.options);
      const preview = hexRows(result.bytes, STEGO_ANALYSIS_LIMITS.hexPreviewBytes);
      const strings = scanStrings(result.bytes, 4, STEGO_ANALYSIS_LIMITS.extractedStringsListed, 200);
      post({
        type: "extracted",
        operationId: request.operationId,
        bytes: result.bytes.buffer as ArrayBuffer,
        totalBits: result.totalBits,
        truncated: result.truncated,
        preview,
        strings,
      }, [result.bytes.buffer]);
      return;
    }
    case "redecode": {
      const current = requireSession();
      if (request.sixteenBitByte !== "high" && request.sixteenBitByte !== "low") {
        throw new StegoAnalysisError("invalid-options", "Choose the high or low byte.");
      }
      // Decode the new view before releasing the old one, so a failure keeps the old view.
      const decoded = await decodeImage(current.bytes, current.kind, request.sixteenBitByte);
      current.image?.rgba.fill(0);
      current.image = decoded.image;
      post({ type: "redecoded", operationId: request.operationId, image: decoded.report });
      return;
    }
    case "trailing": {
      const { bytes, imageEndOffset } = requireSession();
      if (imageEndOffset === null || imageEndOffset >= bytes.byteLength) {
        throw new StegoAnalysisError("invalid-options", "There are no trailing bytes.");
      }
      const copy = bytes.slice(imageEndOffset);
      post({ type: "trailing", operationId: request.operationId, bytes: copy.buffer }, [copy.buffer]);
      return;
    }
  }
}

context.addEventListener("message", (event: MessageEvent<StegoAnalysisRequest>) => {
  const request = event.data;
  queue = queue.then(() => handle(request)).catch((error: unknown) => {
    const known = error instanceof StegoAnalysisError;
    post({
      type: "error",
      operationId: request.operationId,
      code: known ? error.code : "worker-failed",
      message: known ? error.message : "The analysis stopped unexpectedly.",
    });
  });
});
