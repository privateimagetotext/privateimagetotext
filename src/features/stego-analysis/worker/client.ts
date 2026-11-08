import StegoAnalysisWorker from "./stego-analysis.worker?worker";
import type { StegoAnalysisErrorCode } from "../limits";
import type { LsbOptions } from "../lsb";
import type { SixteenBitByte } from "../png";
import type { StegoAnalysisRequest, StegoAnalysisResponse } from "./protocol";

export class StegoAnalysisClientError extends Error {
  readonly code: StegoAnalysisErrorCode | "cancelled";

  constructor(code: StegoAnalysisErrorCode | "cancelled", message: string) {
    super(message);
    this.name = "StegoAnalysisClientError";
    this.code = code;
  }
}

type Final = Exclude<StegoAnalysisResponse, { readonly type: "error" }>;
type Pending = { resolve: (value: Final) => void; reject: (error: StegoAnalysisClientError) => void };
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

export type WorkerFactory = () => Worker;

/** One dedicated worker per loaded file. terminate() drops every pixel and byte it holds. */
export class StegoAnalysisClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly createWorker: WorkerFactory;

  constructor(createWorker: WorkerFactory = () => new StegoAnalysisWorker()) {
    this.createWorker = createWorker;
  }

  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.addEventListener("message", this.handleMessage);
    worker.addEventListener("messageerror", this.handleFailure);
    worker.addEventListener("error", this.handleFailure);
    this.worker = worker;
    return worker;
  }

  private readonly handleMessage = (event: MessageEvent<StegoAnalysisResponse>) => {
    const response = event.data;
    const pending = this.pending.get(response.operationId);
    if (!pending) return;
    this.pending.delete(response.operationId);
    if (response.type === "error") pending.reject(new StegoAnalysisClientError(response.code, response.message));
    else pending.resolve(response);
  };

  private readonly handleFailure = (event: Event) => {
    event.preventDefault();
    this.terminate("worker-failed", "The background analysis stopped unexpectedly. Choose the file again.");
  };

  private send<T extends Final["type"]>(type: T, request: DistributiveOmit<StegoAnalysisRequest, "operationId">, transfer: Transferable[] = []) {
    const worker = this.ensureWorker();
    const operationId = this.nextId;
    this.nextId += 1;
    return new Promise<Extract<Final, { type: T }>>((resolve, reject) => {
      this.pending.set(operationId, {
        resolve: (value) => {
          if (value.type === type) resolve(value as Extract<Final, { type: T }>);
          else reject(new StegoAnalysisClientError("worker-failed", "Unexpected worker response."));
        },
        reject,
      });
      worker.postMessage({ ...request, operationId }, transfer);
    });
  }

  /** Transfers (detaches) the buffer to the worker. */
  load(bytes: ArrayBuffer) {
    return this.send("loaded", { type: "load", bytes }, [bytes]);
  }

  strings(minLength: number) {
    return this.send("strings", { type: "strings", minLength });
  }

  plane(planeId: string) {
    return this.send("plane", { type: "plane", planeId });
  }

  extract(options: LsbOptions) {
    return this.send("extracted", { type: "extract", options });
  }

  redecode(sixteenBitByte: SixteenBitByte) {
    return this.send("redecoded", { type: "redecode", sixteenBitByte });
  }

  trailing() {
    return this.send("trailing", { type: "trailing" });
  }

  get busy() {
    return this.pending.size > 0;
  }

  terminate(code: StegoAnalysisErrorCode | "cancelled" = "cancelled", message = "Cancelled.") {
    for (const pending of this.pending.values()) pending.reject(new StegoAnalysisClientError(code, message));
    this.pending.clear();
    if (!this.worker) return;
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("messageerror", this.handleFailure);
    this.worker.removeEventListener("error", this.handleFailure);
    this.worker.terminate();
    this.worker = null;
  }
}
