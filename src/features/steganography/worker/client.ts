import SteganographyWorker from "./steganography.worker?worker";
import type {
  SteganographyWorkerRequest,
  SteganographyWorkerResponse,
  WorkerErrorCode,
  WorkerStage,
} from "./protocol";

export class SteganographyWorkerError extends Error {
  readonly code: WorkerErrorCode;

  constructor(code: WorkerErrorCode) {
    super(code);
    this.name = "SteganographyWorkerError";
    this.code = code;
  }
}
type FinalResponse = Exclude<
  SteganographyWorkerResponse,
  { readonly type: "progress" | "error" }
>;

type Pending = {
  readonly resolve: (response: FinalResponse) => void;
  readonly reject: (error: SteganographyWorkerError) => void;
  readonly onProgress?: (stage: WorkerStage) => void;
};

type WorkerFactory = () => Worker;

export class SteganographyWorkerClient {
  private worker: Worker | null = null;
  private readonly pending = new Map<number, Pending>();
  private readonly createWorker: WorkerFactory;

  constructor(createWorker: WorkerFactory = () => new SteganographyWorker()) {
    this.createWorker = createWorker;
  }

  start() {
    this.terminate();
    const worker = this.createWorker();
    worker.addEventListener("message", this.handleMessage);
    worker.addEventListener("messageerror", this.handleMessageError);
    worker.addEventListener("error", this.handleWorkerError);
    this.worker = worker;
  }

  private ensureWorker() {
    if (!this.worker) this.start();
    return this.worker as Worker;
  }

  private readonly handleMessage = (
    event: MessageEvent<SteganographyWorkerResponse>,
  ) => {
    const response = event.data;
    const pending = this.pending.get(response.operationId);
    if (!pending) {
      if (response.type === "encoded") {
        const bytes = response.format === "jpeg-v2" ? response.bytes : response.pixels;
        new Uint8Array(bytes).fill(0);
      }
      return;
    }
    if (response.type === "progress") {
      pending.onProgress?.(response.stage);
      return;
    }
    if (response.type === "error") {
      this.pending.delete(response.operationId);
      pending.reject(new SteganographyWorkerError(response.code));
      return;
    }
    this.pending.delete(response.operationId);
    pending.resolve(response);
  };

  private readonly handleMessageError = () => {
    this.rejectAll("worker-failed");
    this.terminateWorkerOnly();
  };

  private readonly handleWorkerError = (event: ErrorEvent) => {
    event.preventDefault();
    this.rejectAll("worker-failed");
    this.terminateWorkerOnly();
  };

  private rejectAll(code: WorkerErrorCode) {
    for (const pending of this.pending.values()) {
      pending.reject(new SteganographyWorkerError(code));
    }
    this.pending.clear();
  }

  private terminateWorkerOnly() {
    if (!this.worker) return;
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("messageerror", this.handleMessageError);
    this.worker.removeEventListener("error", this.handleWorkerError);
    this.worker.terminate();
    this.worker = null;
  }

  request<T extends FinalResponse>(
    request: SteganographyWorkerRequest,
    transfer: Transferable[],
    onProgress?: (stage: WorkerStage) => void,
  ) {
    const worker = this.ensureWorker();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(request.operationId, {
        resolve: (response) => resolve(response as T),
        reject,
        onProgress,
      });
      worker.postMessage(request, transfer);
    });
  }

  terminate() {
    this.rejectAll("cancelled");
    this.terminateWorkerOnly();
  }

  dispose(operationId: number) {
    if (this.worker) {
      this.worker.postMessage({ type: "dispose", operationId });
    }
    this.terminate();
  }
}
