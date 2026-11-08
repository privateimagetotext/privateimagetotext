import type {
  C2paSdk,
  Manifest,
  ManifestStore,
  Reader,
  Settings,
  ValidationStatus,
  VerifySettings,
} from "@contentauth/c2pa-web";

import type {
  C2paProvenanceInspector,
  ProvenanceInspection,
  ProvenanceInspectionErrorCode,
  ProvenanceValidation,
} from "./types";

const C2PA_MAX_ASSET_BYTES = 1_000_000_000;
const C2PA_ACTION_ASSERTION_LABEL = /^c2pa\.actions(?:\.v\d+)?$/u;

/**
 * Exact reader format list exported by @contentauth/c2pa-web 0.13.4. A focused
 * test compares this list with the package export so dependency upgrades fail
 * visibly if support changes.
 */
export const C2PA_READER_SUPPORTED_FORMATS = [
  "jpg",
  "video/mp4",
  "image/heif",
  "video/x-msvideo",
  "pdf",
  "image/png",
  "application/c2pa",
  "video/quicktime",
  "video/avi",
  "image/gif",
  "application/xml",
  "text/xml",
  "application/xhtml+xml",
  "tiff",
  "audio/wave",
  "mp4",
  "image/avif",
  "image/dng",
  "png",
  "dng",
  "image/svg+xml",
  "image/heic",
  "application/mp4",
  "image/x-nikon-nef",
  "video/msvideo",
  "tif",
  "wav",
  "xml",
  "audio/vnd.wave",
  "xhtml",
  "gif",
  "application/x-troff-msvideo",
  "webp",
  "heic",
  "application/pdf",
  "audio/mpeg",
  "application/x-c2pa-manifest-store",
  "jpeg",
  "image/x-adobe-dng",
  "audio/wav",
  "mp3",
  "mov",
  "image/tiff",
  "audio/mp4",
  "application/svg+xml",
  "arw",
  "c2pa",
  "svg",
  "avi",
  "audio/x-wav",
  "m4a",
  "image/x-sony-arw",
  "image/jpeg",
  "avif",
  "image/webp",
  "nef",
  "heif",
  "jxl",
  "image/jxl",
] as const;

const supportedFormats = new Set<string>(C2PA_READER_SUPPORTED_FORMATS);

interface OfflineVerifySettings extends VerifySettings {
  readonly remoteManifestFetch: false;
  readonly ocspFetch: false;
}

interface OfflineCoreSettings {
  readonly decodeIdentityAssertions: false;
  /** Serializes to an empty JSON array at the c2pa-rs settings boundary. */
  readonly allowedNetworkHosts: readonly [];
}

interface OfflineSettings extends Settings {
  readonly core: OfflineCoreSettings;
  readonly verify: OfflineVerifySettings;
}

/**
 * @contentauth/c2pa-web 0.13.4 recursively treats arrays as records while
 * converting settings keys to snake_case, which would turn a literal `[]`
 * into `{}` and make c2pa-rs reject the settings. Its converter preserves
 * callable values, so this frozen compatibility value uses JSON's standard
 * `toJSON` hook to emit the required empty array at the final settings
 * boundary. Keep the focused serializer-contract test when upgrading the SDK.
 */
function c2paSerializableEmptyArray(): readonly [] {
  const value = Object.assign(() => undefined, {
    toJSON: () => [] as const,
  });
  return Object.freeze(value) as unknown as readonly [];
}

const C2PA_DENY_ALL_NETWORK_HOSTS = c2paSerializableEmptyArray();

/**
 * c2pa-web converts these camelCase keys to the c2pa-rs settings names
 * `remote_manifest_fetch`, `ocsp_fetch`, `decode_identity_assertions`, and
 * `allowed_network_hosts` before initialising WASM. The first two prevent
 * remote manifest and certificate-status requests. Identity decoding is also
 * disabled because CAWG `did:web` resolution can perform its own lookup and is
 * not covered reliably by the SDK host allowlist; the empty allowlist remains
 * defense-in-depth for other SDK HTTP paths. These current c2pa-rs settings are
 * not yet all declared by c2pa-web's Settings types, so the narrow extensions
 * above keep the network boundary explicit.
 */
export const C2PA_EMBEDDED_ONLY_SETTINGS: OfflineSettings = Object.freeze({
  core: Object.freeze({
    decodeIdentityAssertions: false,
    allowedNetworkHosts: C2PA_DENY_ALL_NETWORK_HOSTS,
  }),
  verify: Object.freeze({
    verifyAfterReading: true,
    verifyTrust: true,
    remoteManifestFetch: false,
    ocspFetch: false,
  }),
});

interface C2paRuntime {
  create(settings: Settings): Promise<C2paSdk>;
}

export type C2paRuntimeLoader = () => Promise<C2paRuntime>;

export interface CreateC2paProvenanceInspectorOptions {
  /** Dependency seam for deterministic unit tests. */
  readonly loadRuntime?: C2paRuntimeLoader;
}

export function normaliseC2paFormat(format: string) {
  return format.split(";", 1)[0].trim().toLowerCase();
}

export function isC2paReaderFormatSupported(format: string) {
  return supportedFormats.has(normaliseC2paFormat(format));
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Content Credentials could not be inspected in this browser.";
}

function errorResult(
  format: string,
  code: ProvenanceInspectionErrorCode,
  message: string,
): ProvenanceInspection {
  return {
    status: "error",
    code,
    message,
    format,
    networkPolicy: "embedded-only",
  };
}

function disposedResult(format: string) {
  return errorResult(
    format,
    "disposed",
    "This Content Credentials inspector has been disposed.",
  );
}

function activeManifest(
  store: ManifestStore,
  activeManifestLabel: string | null,
): Manifest | null {
  if (!activeManifestLabel || !store.manifests) return null;
  return store.manifests[activeManifestLabel] ?? null;
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractDigitalSourceTypes(manifest: Manifest | null) {
  if (!manifest?.assertions) return [];
  const values = new Set<string>();

  for (const assertion of manifest.assertions) {
    if (!C2PA_ACTION_ASSERTION_LABEL.test(assertion.label)) continue;
    const data = record(assertion.data);
    const actions = data?.actions;
    if (!Array.isArray(actions)) continue;

    for (const action of actions) {
      const actionRecord = record(action);
      const sourceType =
        actionRecord?.digitalSourceType ?? actionRecord?.digital_source_type;
      if (typeof sourceType === "string" && sourceType.trim()) {
        values.add(sourceType.trim());
      }
    }
  }

  return [...values];
}

function validationFailures(store: ManifestStore): ValidationStatus[] {
  const failures = [...(store.validation_results?.activeManifest?.failure ?? [])];
  for (const status of store.validation_status ?? []) {
    if (status.success === false) failures.push(status);
  }
  return failures;
}

function validationLevel(store: ManifestStore): ProvenanceValidation {
  switch (store.validation_state) {
    case "Trusted":
      return "trusted";
    case "Valid":
      return "valid";
    case "Invalid":
      return "invalid";
    default:
      return "unknown";
  }
}

async function loadOfficialRuntime(): Promise<C2paRuntime> {
  const [{ createC2pa }, wasmModule] = await Promise.all([
    import("@contentauth/c2pa-web"),
    import("@contentauth/c2pa-web/resources/c2pa.wasm?url"),
  ]);

  return {
    create: (settings) => createC2pa({ wasmSrc: wasmModule.default, settings }),
  };
}

export function createC2paProvenanceInspector(
  options: CreateC2paProvenanceInspectorOptions = {},
): C2paProvenanceInspector {
  const loadRuntime = options.loadRuntime ?? loadOfficialRuntime;
  let sdkPromise: Promise<C2paSdk> | null = null;
  let disposed = false;

  const getSdk = () => {
    if (!sdkPromise) {
      sdkPromise = loadRuntime()
        .then((runtime) => runtime.create(C2PA_EMBEDDED_ONLY_SETTINGS))
        .catch((error: unknown) => {
          sdkPromise = null;
          throw error;
        });
    }
    return sdkPromise;
  };

  return {
    async inspect(blob, requestedFormat = blob.type) {
      const format = normaliseC2paFormat(requestedFormat);
      if (disposed) {
        return disposedResult(format);
      }
      if (!isC2paReaderFormatSupported(format)) {
        return {
          status: "unsupported-format",
          format,
          networkPolicy: "embedded-only",
        };
      }
      if (blob.size > C2PA_MAX_ASSET_BYTES) {
        return errorResult(
          format,
          "file-too-large",
          "Content Credentials inspection is limited to files under 1 GB by the browser SDK.",
        );
      }

      let sdk: C2paSdk;
      try {
        sdk = await getSdk();
      } catch (error) {
        if (disposed) return disposedResult(format);
        return errorResult(
          format,
          "sdk-initialisation-failed",
          errorMessage(error),
        );
      }

      // dispose() may have been called while lazy SDK initialisation awaited.
      // Do not start a reader operation against a worker that is terminating.
      if (disposed) return disposedResult(format);

      let reader: Reader | null = null;
      try {
        reader = await sdk.reader.fromBlob(
          format,
          blob,
          C2PA_EMBEDDED_ONLY_SETTINGS,
        );
        // This does not claim cancellation of an in-flight SDK call. It only
        // prevents further reader RPC after a late call happens to settle.
        if (disposed) return disposedResult(format);
        if (!reader) {
          return {
            status: "not-found",
            format,
            networkPolicy: "embedded-only",
          };
        }

        const store = await reader.manifestStore();
        const activeManifestLabel = store.active_manifest ?? null;
        const manifest = activeManifest(store, activeManifestLabel);
        return {
          status: "credentials-found",
          format,
          networkPolicy: "embedded-only",
          validation: validationLevel(store),
          activeManifestLabel,
          claimGenerator: manifest?.claim_generator ?? null,
          digitalSourceTypes: extractDigitalSourceTypes(manifest),
          validationFailures: validationFailures(store),
          manifestStore: store,
        };
      } catch (error) {
        if (disposed) return disposedResult(format);
        return errorResult(format, "inspection-failed", errorMessage(error));
      } finally {
        if (reader && !disposed) {
          try {
            await reader.free();
          } catch {
            // The inspection result is still useful if best-effort cleanup fails.
          }
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (sdkPromise) {
        void sdkPromise.then((sdk) => sdk.dispose()).catch(() => undefined);
      }
    },
  };
}
