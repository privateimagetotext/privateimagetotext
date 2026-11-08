import { describe, expect, it, vi } from "vitest";

import {
  SteganographyWorkerClient,
  SteganographyWorkerError,
  workerErrorMessages,
  type SteganographyWorkerRequest,
  type SteganographyWorkerResponse,
} from "../../src/features/steganography/worker";

class FakeWorker extends EventTarget {
  readonly messages: Array<{
    request: SteganographyWorkerRequest;
    transfer: Transferable[];
  }> = [];
  terminated = false;

  postMessage(request: SteganographyWorkerRequest, transfer: Transferable[] = []) {
    this.messages.push({ request, transfer });
  }

  terminate() {
    this.terminated = true;
  }

  respond(response: SteganographyWorkerResponse) {
    this.dispatchEvent(new MessageEvent("message", { data: response }));
  }

  failMessage() {
    this.dispatchEvent(new MessageEvent("messageerror"));
  }

  failWorker() {
    this.dispatchEvent(new ErrorEvent("error"));
  }
}

function clientWithWorker() {
  const worker = new FakeWorker();
  const client = new SteganographyWorkerClient(() => worker as unknown as Worker);
  return { client, worker };
}

describe("steganography worker client", () => {
  it("transfers large buffers and resolves the matching operation", async () => {
    const { client, worker } = clientWithWorker();
    const pixels = new ArrayBuffer(16);
    const pending = client.request(
      { type: "analyse", operationId: 3, format: "png-v1", pixels, width: 2, height: 2 },
      [pixels],
    );
    expect(worker.messages).toHaveLength(1);
    expect(worker.messages[0].transfer).toEqual([pixels]);
    worker.respond({
      type: "capacity",
      operationId: 3,
      capacity: {
        format: "png-v1",
        opaquePixelCount: 4,
        eligibleBits: 12,
        embeddedByteCapacity: 0,
        plainMessageCapacity: 0,
        encryptedMessageCapacity: 0,
      },
    });
    await expect(pending).resolves.toMatchObject({ type: "capacity", operationId: 3 });
  });

  it("emits only fixed content-free progress stages", async () => {
    const { client, worker } = clientWithWorker();
    const progress = vi.fn();
    const pixels = new ArrayBuffer(4);
    const pending = client.request(
      { type: "analyse", operationId: 8, format: "png-v1", pixels, width: 1, height: 1 },
      [pixels],
      progress,
    );
    const event = {
      type: "progress" as const,
      operationId: 8,
      stage: "analysing-capacity" as const,
    };
    worker.respond(event);
    expect(progress).toHaveBeenCalledWith("analysing-capacity");
    expect(Object.keys(event).sort()).toEqual(["operationId", "stage", "type"]);
    worker.respond({
      type: "capacity",
      operationId: 8,
      capacity: {
        format: "png-v1",
        opaquePixelCount: 1,
        eligibleBits: 3,
        embeddedByteCapacity: 0,
        plainMessageCapacity: 0,
        encryptedMessageCapacity: 0,
      },
    });
    await pending;
  });

  it("ignores stale responses from another operation", async () => {
    const { client, worker } = clientWithWorker();
    const pixels = new ArrayBuffer(4);
    const pending = client.request(
      { type: "analyse", operationId: 12, format: "png-v1", pixels, width: 1, height: 1 },
      [pixels],
    );
    const settled = vi.fn();
    void pending.then(settled);
    const staleJpeg = new Uint8Array([1, 2, 3, 4]);
    worker.respond({
      type: "encoded",
      operationId: 11,
      format: "jpeg-v2",
      bytes: staleJpeg.buffer,
      width: 1,
      height: 1,
    });
    expect(staleJpeg).toEqual(new Uint8Array(4));
    worker.respond({ type: "disposed", operationId: 11 });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    worker.respond({ type: "disposed", operationId: 12 });
    await expect(pending).resolves.toEqual({ type: "disposed", operationId: 12 });
  });

  it("maps fixed error codes without exception details or user content", async () => {
    const { client, worker } = clientWithWorker();
    const pixels = new ArrayBuffer(4);
    const pending = client.request(
      { type: "inspect", operationId: 13, format: "png-v1", pixels, width: 1, height: 1 },
      [pixels],
    );
    const event = { type: "error" as const, operationId: 13, code: "damaged" as const };
    worker.respond(event);
    await expect(pending).rejects.toEqual(new SteganographyWorkerError("damaged"));
    expect(Object.keys(event).sort()).toEqual(["code", "operationId", "type"]);
    expect(workerErrorMessages["unlock-failed"]).toBe(
      "The password is incorrect or the hidden message has been damaged.",
    );
  });

  it("terminates the worker and rejects pending operations on cancellation", async () => {
    const { client, worker } = clientWithWorker();
    const pixels = new ArrayBuffer(4);
    const pending = client.request(
      { type: "analyse", operationId: 21, format: "png-v1", pixels, width: 1, height: 1 },
      [pixels],
    );
    client.terminate();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(worker.terminated).toBe(true);
  });

  it.each(["messageerror", "error"] as const)(
    "terminates and rejects with a fixed failure on worker %s",
    async (kind) => {
      const { client, worker } = clientWithWorker();
      const pixels = new ArrayBuffer(4);
      const pending = client.request(
        { type: "analyse", operationId: 31, format: "png-v1", pixels, width: 1, height: 1 },
        [pixels],
      );
      if (kind === "messageerror") worker.failMessage();
      else worker.failWorker();
      await expect(pending).rejects.toMatchObject({ code: "worker-failed" });
      expect(worker.terminated).toBe(true);
    },
  );

  it("starts a fresh worker for a superseding operation", async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const create = vi.fn()
      .mockReturnValueOnce(first as unknown as Worker)
      .mockReturnValueOnce(second as unknown as Worker);
    const client = new SteganographyWorkerClient(create);
    client.start();
    client.start();
    expect(first.terminated).toBe(true);
    expect(second.terminated).toBe(false);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
