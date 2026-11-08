import type {
  C2paSdk,
  ManifestStore,
  Reader,
  Settings,
} from "@contentauth/c2pa-web";
import { READER_SUPPORTED_FORMATS } from "@contentauth/c2pa-web";
import { describe, expect, it, vi } from "vitest";

import {
  C2PA_EMBEDDED_ONLY_SETTINGS,
  C2PA_READER_SUPPORTED_FORMATS,
  createC2paProvenanceInspector,
  isC2paReaderFormatSupported,
  normaliseC2paFormat,
  type C2paRuntimeLoader,
} from "../../src/features/media-inspector/provenance";

function runtimeHarness(reader: Reader | null) {
  const fromBlob = vi.fn(
    async (_format: string, _blob: Blob, _settings?: Settings) => reader,
  );
  const dispose = vi.fn();
  const sdk = {
    reader: { fromBlob },
    dispose,
  } as unknown as C2paSdk;
  const create = vi.fn(async (_settings: Settings) => sdk);
  const loadRuntime = vi.fn(async () => ({ create })) satisfies C2paRuntimeLoader;

  return { create, dispose, fromBlob, loadRuntime };
}

function readerHarness(store: ManifestStore) {
  const free = vi.fn(async () => undefined);
  const reader = {
    manifestStore: vi.fn(async () => store),
    free,
  } as unknown as Reader;
  return { free, reader };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

/** Mirrors @contentauth/c2pa-web 0.13.4's settings key converter. */
function serialiseLikePinnedC2paWeb(value: Record<string, unknown>) {
  const convert = (input: Record<string, unknown>): Record<string, unknown> =>
    Object.entries(input).reduce<Record<string, unknown>>(
      (output, [key, item]) => {
        const serialisedKey = key.replace(
          /[A-Z]/gu,
          (character) => `_${character.toLowerCase()}`,
        );
        output[serialisedKey] =
          typeof item === "object" && item !== null
            ? convert(item as Record<string, unknown>)
            : item;
        return output;
      },
      {},
    );

  return JSON.stringify(convert(value));
}

describe("C2PA provenance adapter", () => {
  it("keeps its pinned format list aligned with c2pa-web 0.13.4", () => {
    expect(C2PA_READER_SUPPORTED_FORMATS).toEqual(READER_SUPPORTED_FORMATS);
    expect(normaliseC2paFormat(" IMAGE/JPEG; charset=binary ")).toBe(
      "image/jpeg",
    );
    expect(isC2paReaderFormatSupported("video/mp4")).toBe(true);
    expect(isC2paReaderFormatSupported("video/webm")).toBe(false);
  });

  it("returns unsupported-format without loading WASM", async () => {
    const harness = runtimeHarness(null);
    const inspector = createC2paProvenanceInspector({
      loadRuntime: harness.loadRuntime,
    });

    await expect(
      inspector.inspect(new Blob([], { type: "video/webm" })),
    ).resolves.toEqual({
      status: "unsupported-format",
      format: "video/webm",
      networkPolicy: "embedded-only",
    });
    expect(harness.loadRuntime).not.toHaveBeenCalled();
  });

  it("serialises exact network-deny settings at the SDK and reader seams", async () => {
    const harness = runtimeHarness(null);
    const inspector = createC2paProvenanceInspector({
      loadRuntime: harness.loadRuntime,
    });
    const blob = new Blob(["not-a-real-jpeg"], { type: "image/jpeg" });

    await expect(inspector.inspect(blob)).resolves.toEqual({
      status: "not-found",
      format: "image/jpeg",
      networkPolicy: "embedded-only",
    });
    const expectedSettings = {
      core: {
        decodeIdentityAssertions: false,
        allowedNetworkHosts: [],
      },
      verify: {
        verifyAfterReading: true,
        verifyTrust: true,
        remoteManifestFetch: false,
        ocspFetch: false,
      },
    };
    expect(JSON.stringify(C2PA_EMBEDDED_ONLY_SETTINGS)).toBe(
      JSON.stringify(expectedSettings),
    );
    expect(Object.isFrozen(C2PA_EMBEDDED_ONLY_SETTINGS)).toBe(true);
    expect(Object.isFrozen(C2PA_EMBEDDED_ONLY_SETTINGS.core)).toBe(true);
    expect(
      Object.isFrozen(C2PA_EMBEDDED_ONLY_SETTINGS.core.allowedNetworkHosts),
    ).toBe(true);
    const sdkSettings = harness.create.mock.calls[0]?.[0];
    const readerSettings = harness.fromBlob.mock.calls[0]?.[2];
    expect(sdkSettings).toBe(C2PA_EMBEDDED_ONLY_SETTINGS);
    expect(readerSettings).toBe(C2PA_EMBEDDED_ONLY_SETTINGS);
    expect(JSON.stringify(sdkSettings)).toBe(JSON.stringify(expectedSettings));
    expect(JSON.stringify(readerSettings)).toBe(
      JSON.stringify(expectedSettings),
    );
    const expectedResolvedSettings = JSON.stringify({
      builder: { generate_c2pa_archive: true },
      core: {
        decode_identity_assertions: false,
        allowed_network_hosts: [],
      },
      verify: {
        verify_after_reading: true,
        verify_trust: true,
        remote_manifest_fetch: false,
        ocsp_fetch: false,
      },
    });
    for (const seamSettings of [sdkSettings, readerSettings]) {
      expect(
        serialiseLikePinnedC2paWeb({
          builder: { generateC2paArchive: true },
          ...(seamSettings as unknown as Record<string, unknown>),
        }),
      ).toBe(expectedResolvedSettings);
    }
  });

  it("normalises active-manifest provenance and frees the reader", async () => {
    const store: ManifestStore = {
      active_manifest: "example:claim",
      validation_state: "Valid",
      manifests: {
        "example:claim": {
          claim_generator: "ExampleTool/2.0",
          assertions: [
            {
              label: "c2pa.actions.v2",
              data: {
                actions: [
                  {
                    action: "c2pa.created",
                    digitalSourceType:
                      "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
                  },
                  {
                    action: "c2pa.edited",
                    digital_source_type:
                      "http://cv.iptc.org/newscodes/digitalsourcetype/humanEdits",
                  },
                ],
              },
            },
          ],
        },
      },
      validation_results: {
        activeManifest: {
          success: [],
          informational: [],
          failure: [
            {
              code: "signingCredential.untrusted",
              explanation: "No configured trust anchor matched.",
              success: false,
            },
          ],
        },
      },
    };
    const reader = readerHarness(store);
    const harness = runtimeHarness(reader.reader);
    const inspector = createC2paProvenanceInspector({
      loadRuntime: harness.loadRuntime,
    });

    const result = await inspector.inspect(
      new Blob(["asset"], { type: "image/jpeg" }),
    );

    expect(result).toMatchObject({
      status: "credentials-found",
      validation: "valid",
      activeManifestLabel: "example:claim",
      claimGenerator: "ExampleTool/2.0",
      digitalSourceTypes: [
        "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
        "http://cv.iptc.org/newscodes/digitalsourcetype/humanEdits",
      ],
      validationFailures: [
        expect.objectContaining({ code: "signingCredential.untrusted" }),
      ],
    });
    expect(reader.free).toHaveBeenCalledOnce();
  });

  it("frees the reader when manifest extraction fails", async () => {
    const free = vi.fn(async () => undefined);
    const reader = {
      manifestStore: vi.fn(async () => {
        throw new Error("malformed manifest store");
      }),
      free,
    } as unknown as Reader;
    const harness = runtimeHarness(reader);
    const inspector = createC2paProvenanceInspector({
      loadRuntime: harness.loadRuntime,
    });

    await expect(
      inspector.inspect(new Blob(["asset"], { type: "image/png" })),
    ).resolves.toMatchObject({
      status: "error",
      code: "inspection-failed",
      message: "malformed manifest store",
    });
    expect(free).toHaveBeenCalledOnce();
  });

  it("shares SDK initialisation and disposes the worker once", async () => {
    const harness = runtimeHarness(null);
    const inspector = createC2paProvenanceInspector({
      loadRuntime: harness.loadRuntime,
    });
    const blob = new Blob(["asset"], { type: "image/jpeg" });

    await Promise.all([inspector.inspect(blob), inspector.inspect(blob)]);
    expect(harness.loadRuntime).toHaveBeenCalledOnce();
    expect(harness.create).toHaveBeenCalledOnce();

    inspector.dispose();
    inspector.dispose();
    await Promise.resolve();
    expect(harness.dispose).toHaveBeenCalledOnce();
    await expect(inspector.inspect(blob)).resolves.toMatchObject({
      status: "error",
      code: "disposed",
    });
  });

  it("does not start a reader after disposal during SDK initialisation", async () => {
    const sdkGate = deferred<C2paSdk>();
    const fromBlob = vi.fn(async () => null);
    const dispose = vi.fn();
    const sdk = {
      reader: { fromBlob },
      dispose,
    } as unknown as C2paSdk;
    const create = vi.fn(() => sdkGate.promise);
    const loadRuntime = vi.fn(async () => ({ create })) satisfies C2paRuntimeLoader;
    const inspector = createC2paProvenanceInspector({ loadRuntime });
    const pending = inspector.inspect(
      new Blob(["asset"], { type: "image/jpeg" }),
    );

    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    inspector.dispose();
    sdkGate.resolve(sdk);

    await expect(pending).resolves.toMatchObject({
      status: "error",
      code: "disposed",
    });
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(fromBlob).not.toHaveBeenCalled();
  });

  it("does not issue reader RPC after a late reader settles post-disposal", async () => {
    const readerGate = deferred<Reader | null>();
    const manifestStore = vi.fn(async () => ({}) as ManifestStore);
    const free = vi.fn(async () => undefined);
    const reader = { manifestStore, free } as unknown as Reader;
    const fromBlob = vi.fn(() => readerGate.promise);
    const dispose = vi.fn();
    const sdk = {
      reader: { fromBlob },
      dispose,
    } as unknown as C2paSdk;
    const create = vi.fn(async () => sdk);
    const loadRuntime = vi.fn(async () => ({ create })) satisfies C2paRuntimeLoader;
    const inspector = createC2paProvenanceInspector({ loadRuntime });
    const pending = inspector.inspect(
      new Blob(["asset"], { type: "image/jpeg" }),
    );

    await vi.waitFor(() => expect(fromBlob).toHaveBeenCalledOnce());
    inspector.dispose();
    readerGate.resolve(reader);

    await expect(pending).resolves.toMatchObject({
      status: "error",
      code: "disposed",
    });
    expect(manifestStore).not.toHaveBeenCalled();
    expect(free).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("rejects assets above the SDK limit before initialising WASM", async () => {
    const harness = runtimeHarness(null);
    const inspector = createC2paProvenanceInspector({
      loadRuntime: harness.loadRuntime,
    });
    const oversized = {
      size: 1_000_000_001,
      type: "video/mp4",
    } as Blob;

    await expect(inspector.inspect(oversized)).resolves.toMatchObject({
      status: "error",
      code: "file-too-large",
    });
    expect(harness.loadRuntime).not.toHaveBeenCalled();
  });
});
