import type {
  ManifestStore,
  ValidationStatus,
} from "@contentauth/c2pa-web";

export type ProvenanceNetworkPolicy = "embedded-only";

export type ProvenanceValidation =
  | "trusted"
  | "valid"
  | "invalid"
  | "unknown";

export type ProvenanceInspectionErrorCode =
  | "disposed"
  | "file-too-large"
  | "sdk-initialisation-failed"
  | "inspection-failed";

interface ProvenanceInspectionBase {
  /**
   * C2PA may inspect only credentials embedded in the selected asset. Remote
   * manifest and OCSP fetching are disabled, CAWG identity assertions are not
   * decoded (preventing `did:web` resolution), and the SDK host allowlist is
   * empty as defense-in-depth.
   */
  readonly networkPolicy: ProvenanceNetworkPolicy;
  readonly format: string;
}

export interface ProvenanceCredentialsFound
  extends ProvenanceInspectionBase {
  readonly status: "credentials-found";
  readonly validation: ProvenanceValidation;
  readonly activeManifestLabel: string | null;
  readonly claimGenerator: string | null;
  /**
   * Values asserted by the active C2PA manifest. They are provenance claims,
   * not the output of a probabilistic AI detector.
   */
  readonly digitalSourceTypes: readonly string[];
  readonly validationFailures: readonly ValidationStatus[];
  readonly manifestStore: ManifestStore;
}

export interface ProvenanceNotFound extends ProvenanceInspectionBase {
  readonly status: "not-found";
}

export interface ProvenanceUnsupportedFormat
  extends ProvenanceInspectionBase {
  readonly status: "unsupported-format";
}

export interface ProvenanceInspectionError extends ProvenanceInspectionBase {
  readonly status: "error";
  readonly code: ProvenanceInspectionErrorCode;
  readonly message: string;
}

export type ProvenanceInspection =
  | ProvenanceCredentialsFound
  | ProvenanceNotFound
  | ProvenanceUnsupportedFormat
  | ProvenanceInspectionError;

export interface C2paProvenanceInspector {
  inspect(blob: Blob, format?: string): Promise<ProvenanceInspection>;
  dispose(): void;
}
