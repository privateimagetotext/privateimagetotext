import { mediaInspectorCopy } from "../config/tool-copy";
import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import { HelpfulGuides } from "../components/HelpfulGuides";
import { ToolDirectory } from "../components/ToolDirectory";
import { routes } from "../config/product";
import {
  CLEAN_COPY_LIMITS,
  createCleanShareCopySafely,
  getCleanShareCopyPreflight,
  inspectMediaSafely,
  type CleanCopyProgress,
  type CleanCopyProgressPhase,
  type CleanCopyResult,
  type MediaInspectionResult,
  type MetadataEntry,
  type PrivacyFinding,
} from "../features/media-inspector";
import {
  createC2paProvenanceInspector,
  type C2paProvenanceInspector,
  type ProvenanceCredentialsFound,
  type ProvenanceInspection,
} from "../features/media-inspector/provenance";
import { sanitiseSourceBase } from "../features/raster/filenames";

const ACCEPTED_MEDIA = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/mpeg",
  "audio/mp4",
  "audio/flac",
  "audio/wav",
  "audio/ogg",
  ".m4a",
  ".mkv",
  ".aac",
  ".aif",
  ".aiff",
].join(",");

const MAX_MEDIA_BYTES = 512 * 1024 * 1024;
const MAX_AUTO_PREVIEW_SIDE = 8_192;
const MAX_AUTO_PREVIEW_PIXELS = 36_000_000;

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "privacy", label: "Privacy" },
  { id: "provenance", label: "Origin & AI clues" },
  { id: "raw", label: "Raw metadata" },
] as const;

type ResultTab = (typeof tabs)[number]["id"];
type InspectionPhase = "idle" | "inspecting" | "complete" | "error";
type ProvenancePhase = "idle" | "checking" | "complete";
type CleanCopyPhase = "idle" | "creating" | "complete" | "error";

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown";
  const units = ["bytes", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

function formatDuration(seconds: number | undefined) {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return "Not reported";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  const parts = hours > 0 ? [hours, minutes, Math.floor(remaining)] : [minutes, remaining];
  return parts
    .map((part, index) =>
      index === parts.length - 1 && hours === 0
        ? part.toFixed(remaining % 1 === 0 ? 0 : 2).padStart(2, "0")
        : String(Math.floor(part)).padStart(2, "0"),
    )
    .join(":");
}

function displayValue(value: MetadataEntry["value"]) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function titleCase(value: string) {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function metadataLooksAiRelated(entry: MetadataEntry) {
  const identifier = `${entry.namespace}.${entry.key}`
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (
    /(?:aiprompt|aisystem|digitalsourcetype|trainedalgorithm|negativeprompt|prompt|workflow|generationdata|sampler|cfgscale|loramodel|seed)/.test(
      identifier,
    )
  ) {
    return true;
  }

  const descriptiveText = `${entry.label} ${displayValue(entry.value)}`;
  return /(?:\bai (?:generation|generated|model|system|tool)\b|\b(?:negative\s+)?prompt\b|\bworkflow\b|\bsampler\b|\bcfg\s*scale\b|\blora\b|\bcomfyui\b|stable\s*diffusion|automatic\s*1111|\ba1111\b|\binvokeai\b|\bmidjourney\b|\bdall[-\s]?e\b|adobe\s+firefly|\bfooocus\b|\bnovelai\b|diffusion\s+model|generative\s+fill|trained\s+algorithm|text[-\s]to[-\s]image|image[-\s]to[-\s]image)/i.test(
    descriptiveText,
  );
}

function imageCanBeAutoPreviewed(result: MediaInspectionResult) {
  if (result.format.category !== "image" || !result.image) return false;
  const { width, height } = result.image;
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_AUTO_PREVIEW_SIDE &&
    height <= MAX_AUTO_PREVIEW_SIDE &&
    width <= Math.floor(MAX_AUTO_PREVIEW_PIXELS / height)
  );
}

function cleanCopyProgressLabel(phase: CleanCopyProgressPhase) {
  if (phase === "inspect-source") return "Rechecking the source structure";
  if (phase === "verify-source-provenance") return "Confirming source Content Credentials";
  if (phase === "rewrite") return "Rewriting the allowlisted image structure";
  if (phase === "inspect-output") return "Reinspecting the generated file";
  if (phase === "verify-output-provenance") return "Confirming no embedded credential remains";
  return "Metadata-removal verification complete";
}

function cleanCopyProfileLabel(result: CleanCopyResult) {
  return result.verification.profile === "jpeg-safe-structural-v1"
    ? "JPEG safe structural v1"
    : "PNG safe structural v1";
}

function SummaryItem({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "media-summary__item media-summary__item--wide" : "media-summary__item"}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PrivacyCard({ finding }: { finding: PrivacyFinding }) {
  return (
    <article className="privacy-finding" data-severity={finding.severity}>
      <div className="privacy-finding__heading">
        <span>{titleCase(finding.severity)} attention</span>
        <span>{titleCase(finding.category)}</span>
      </div>
      <h3>{finding.title}</h3>
      <p>{finding.detail}</p>
    </article>
  );
}

function provenanceHeading(provenance: ProvenanceInspection) {
  if (provenance.status === "not-found") return "No embedded Content Credential found";
  if (provenance.status === "unsupported-format") return "Credential check unavailable for this format";
  if (provenance.status === "error") return "Content Credentials could not be checked";
  if (provenance.validation === "trusted") return "Verified Content Credential";
  if (provenance.validation === "valid") return "Credential valid; signer trust not established";
  if (provenance.validation === "invalid") return "Credential invalid or altered";
  return "Credential found; validation status unknown";
}

function provenanceExplanation(provenance: ProvenanceInspection) {
  if (provenance.status === "not-found") {
    return "No supported credential was embedded in this file. That does not mean the media is human-made or authentic.";
  }
  if (provenance.status === "unsupported-format") {
    return "The local credential verifier does not currently read this file format. Ordinary metadata can still be inspected.";
  }
  if (provenance.status === "error") return provenance.message;
  if (provenance.validation === "trusted") {
    return "The credential is bound to this file and the local verifier reported a trusted validation state. This tool does not use a custom trust list to establish the signer's identity. It validates signed origin and edit claims, not the truth of the depicted event.";
  }
  if (provenance.validation === "valid") {
    return "The local verifier reported the credential as cryptographically valid. This tool does not use a custom trust list to establish the signer's identity. Review the recorded claims carefully.";
  }
  if (provenance.validation === "invalid") {
    return "Validation failed. Editing, transcoding, metadata damage, unsupported credential features or deliberate alteration can all cause this result.";
  }
  return "The verifier found a credential but could not assign a stronger validation state.";
}

function provenanceForReport(provenance: ProvenanceInspection | null) {
  if (!provenance) return { status: "not-checked" } as const;
  if (provenance.status !== "credentials-found") return provenance;
  return {
    status: provenance.status,
    validation: provenance.validation,
    activeManifestLabel: provenance.activeManifestLabel,
    claimGenerator: provenance.claimGenerator,
    digitalSourceTypes: provenance.digitalSourceTypes,
    validationFailures: provenance.validationFailures,
    networkPolicy: provenance.networkPolicy,
    format: provenance.format,
  };
}

function CredentialsDetails({ provenance }: { provenance: ProvenanceCredentialsFound }) {
  return (
    <dl className="credential-details">
      <div><dt>Validation</dt><dd>{titleCase(provenance.validation)}</dd></div>
      <div><dt>Claim generator</dt><dd>{provenance.claimGenerator ?? "Not declared"}</dd></div>
      <div><dt>Active manifest</dt><dd>{provenance.activeManifestLabel ?? "Not declared"}</dd></div>
      <div><dt>Validation issues</dt><dd>{String(provenance.validationFailures.length)}</dd></div>
      <div className="credential-details__wide">
        <dt>Declared digital sources</dt>
        <dd>{provenance.digitalSourceTypes.length > 0 ? provenance.digitalSourceTypes.join(", ") : "None declared in supported action assertions"}</dd>
      </div>
    </dl>
  );
}

export function MediaInspectorPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const chooserButtonRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const provenanceInspectorRef = useRef<C2paProvenanceInspector | null>(null);
  const provenanceRunRef = useRef(0);
  const objectUrlRef = useRef<string | null>(null);
  const cleanCopyAbortRef = useRef<AbortController | null>(null);
  const cleanCopyRunRef = useRef(0);
  const cleanCopyObjectUrlRef = useRef<string | null>(null);
  const cleanCopyActionRef = useRef<HTMLButtonElement>(null);
  const cleanCopyResultRef = useRef<HTMLDivElement>(null);
  const cleanCopyErrorRef = useRef<HTMLDivElement>(null);
  const restoreChooserFocusRef = useRef(false);
  const restoreCleanCopyActionFocusRef = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [inspection, setInspection] = useState<MediaInspectionResult | null>(null);
  const [phase, setPhase] = useState<InspectionPhase>("idle");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<ResultTab>("overview");
  const [rawFilter, setRawFilter] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [provenance, setProvenance] = useState<ProvenanceInspection | null>(null);
  const [provenancePhase, setProvenancePhase] = useState<ProvenancePhase>("idle");
  const [cleanCopyPhase, setCleanCopyPhase] = useState<CleanCopyPhase>("idle");
  const [cleanCopyProgress, setCleanCopyProgress] = useState<CleanCopyProgress | null>(null);
  const [cleanCopyResult, setCleanCopyResult] = useState<CleanCopyResult | null>(null);
  const [cleanCopyError, setCleanCopyError] = useState("");
  const [cleanCopyObjectUrl, setCleanCopyObjectUrl] = useState<string | null>(null);
  const [cleanCopyAnnouncement, setCleanCopyAnnouncement] = useState("");

  const disposeActiveWork = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    provenanceRunRef.current += 1;
    provenanceInspectorRef.current?.dispose();
    provenanceInspectorRef.current = null;
    cleanCopyAbortRef.current?.abort();
    cleanCopyAbortRef.current = null;
    cleanCopyRunRef.current += 1;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (cleanCopyObjectUrlRef.current) {
      URL.revokeObjectURL(cleanCopyObjectUrlRef.current);
      cleanCopyObjectUrlRef.current = null;
    }
  }, []);

  const releaseObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setObjectUrl(null);
  }, []);

  const releaseCleanCopyObjectUrl = useCallback(() => {
    if (cleanCopyObjectUrlRef.current) {
      URL.revokeObjectURL(cleanCopyObjectUrlRef.current);
      cleanCopyObjectUrlRef.current = null;
    }
    setCleanCopyObjectUrl(null);
  }, []);

  const resetCleanCopy = useCallback(() => {
    cleanCopyAbortRef.current?.abort();
    cleanCopyAbortRef.current = null;
    cleanCopyRunRef.current += 1;
    releaseCleanCopyObjectUrl();
    setCleanCopyPhase("idle");
    setCleanCopyProgress(null);
    setCleanCopyResult(null);
    setCleanCopyError("");
    setCleanCopyAnnouncement("");
    restoreCleanCopyActionFocusRef.current = false;
  }, [releaseCleanCopyObjectUrl]);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    provenanceRunRef.current += 1;
    provenanceInspectorRef.current?.dispose();
    provenanceInspectorRef.current = null;
    releaseObjectUrl();
    resetCleanCopy();
    setFile(null);
    setInspection(null);
    setPhase("idle");
    setError("");
    setActiveTab("overview");
    setRawFilter("");
    setCopyStatus("");
    setProvenance(null);
    setProvenancePhase("idle");
    if (inputRef.current) inputRef.current.value = "";
    restoreChooserFocusRef.current = true;
  }, [releaseObjectUrl, resetCleanCopy]);

  useEffect(() => {
    if (!file && restoreChooserFocusRef.current) {
      restoreChooserFocusRef.current = false;
      chooserButtonRef.current?.focus();
    }
  }, [file]);

  useEffect(() => {
    if (cleanCopyPhase === "complete") cleanCopyResultRef.current?.focus();
    if (cleanCopyPhase === "error") cleanCopyErrorRef.current?.focus();
    if (cleanCopyPhase === "idle" && restoreCleanCopyActionFocusRef.current) {
      restoreCleanCopyActionFocusRef.current = false;
      cleanCopyActionRef.current?.focus();
    }
  }, [cleanCopyPhase]);

  useEffect(() => {
    const handlePageHide = () => {
      disposeActiveWork();
      setFile(null);
      setObjectUrl(null);
      setInspection(null);
      setPhase("idle");
      setError("");
      setActiveTab("overview");
      setRawFilter("");
      setIsDragging(false);
      setCopyStatus("");
      setProvenance(null);
      setProvenancePhase("idle");
      setCleanCopyPhase("idle");
      setCleanCopyProgress(null);
      setCleanCopyResult(null);
      setCleanCopyError("");
      setCleanCopyObjectUrl(null);
      setCleanCopyAnnouncement("");
      restoreChooserFocusRef.current = false;
      restoreCleanCopyActionFocusRef.current = false;
      if (inputRef.current) inputRef.current.value = "";
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      disposeActiveWork();
    };
  }, [disposeActiveWork]);

  const openPicker = () => {
    if (!inputRef.current) return;
    inputRef.current.value = "";
    inputRef.current.click();
  };

  const inspectSelectedFile = useCallback(
    async (selectedFile: File) => {
      abortRef.current?.abort();
      provenanceRunRef.current += 1;
      provenanceInspectorRef.current?.dispose();
      provenanceInspectorRef.current = null;
      releaseObjectUrl();
      resetCleanCopy();
      setFile(selectedFile);
      setInspection(null);
      setError("");
      setCopyStatus("");
      setProvenance(null);
      setProvenancePhase("idle");
      setActiveTab("overview");

      if (selectedFile.size <= 0) {
        setError("Choose a file that is not empty.");
        setPhase("error");
        return;
      }
      if (selectedFile.size > MAX_MEDIA_BYTES) {
        setError("Choose a file no larger than 512 MB for this first version.");
        setPhase("error");
        return;
      }

      setPhase("inspecting");

      const controller = new AbortController();
      abortRef.current = controller;
      const outcome = await inspectMediaSafely(selectedFile, {
        signal: controller.signal,
        includeSha256: true,
      });
      if (abortRef.current !== controller) return;
      abortRef.current = null;

      if (!outcome.ok) {
        if (outcome.error.code === "cancelled") return;
        setError(outcome.error.message);
        setPhase("error");
        return;
      }
      setInspection(outcome.result);
      setPhase("complete");

      if (imageCanBeAutoPreviewed(outcome.result)) {
        const nextObjectUrl = URL.createObjectURL(selectedFile);
        objectUrlRef.current = nextObjectUrl;
        setObjectUrl(nextObjectUrl);
      }

      const provenanceRun = provenanceRunRef.current + 1;
      provenanceRunRef.current = provenanceRun;
      const provenanceInspector = createC2paProvenanceInspector();
      provenanceInspectorRef.current = provenanceInspector;
      setProvenancePhase("checking");
      const provenanceResult = await provenanceInspector.inspect(
        selectedFile,
        outcome.result.format.mimeType || selectedFile.type,
      );
      provenanceInspector.dispose();
      if (provenanceInspectorRef.current === provenanceInspector) {
        provenanceInspectorRef.current = null;
      }
      if (provenanceRunRef.current !== provenanceRun) return;
      setProvenance(provenanceResult);
      setProvenancePhase("complete");
    },
    [releaseObjectUrl, resetCleanCopy],
  );

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) void inspectSelectedFile(selectedFile);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const selectedFile = event.dataTransfer.files?.[0];
    if (selectedFile) void inspectSelectedFile(selectedFile);
  };

  const aiMetadata = useMemo(
    () => inspection?.metadata.filter(metadataLooksAiRelated) ?? [],
    [inspection],
  );

  const visibleMetadata = useMemo(() => {
    const entries = inspection?.metadata ?? [];
    const query = rawFilter.trim().toLocaleLowerCase();
    if (!query) return entries;
    return entries.filter((entry) =>
      `${entry.namespace} ${entry.key} ${entry.label} ${displayValue(entry.value)}`
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [inspection, rawFilter]);

  const cleanCopyPreflight = useMemo(
    () =>
      inspection && provenancePhase === "complete" && provenance
        ? getCleanShareCopyPreflight(inspection, provenance)
        : null,
    [inspection, provenance, provenancePhase],
  );

  const activateTabByKeyboard = (event: KeyboardEvent<HTMLButtonElement>, tab: ResultTab) => {
    const currentIndex = tabs.findIndex((candidate) => candidate.id === tab);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    const next = tabs[nextIndex];
    setActiveTab(next.id);
    document.getElementById(`media-tab-${next.id}`)?.focus();
  };

  const loadDecoderPreview = () => {
    if (!file || !inspection || objectUrl) return;
    if (inspection.format.category !== "video" && inspection.format.category !== "audio") return;
    const nextObjectUrl = URL.createObjectURL(file);
    objectUrlRef.current = nextObjectUrl;
    setObjectUrl(nextObjectUrl);
  };

  const createCleanCopy = async () => {
    if (
      !file ||
      !inspection ||
      !provenance ||
      provenancePhase !== "complete" ||
      !cleanCopyPreflight?.eligible
    ) {
      return;
    }

    cleanCopyAbortRef.current?.abort();
    const run = cleanCopyRunRef.current + 1;
    cleanCopyRunRef.current = run;
    releaseCleanCopyObjectUrl();
    setCleanCopyResult(null);
    setCleanCopyError("");
    const initialProgress: CleanCopyProgress = { phase: "inspect-source" };
    setCleanCopyProgress(initialProgress);
    setCleanCopyPhase("creating");
    setCleanCopyAnnouncement(cleanCopyProgressLabel(initialProgress.phase));

    const controller = new AbortController();
    cleanCopyAbortRef.current = controller;
    const outcome = await createCleanShareCopySafely(file, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (cleanCopyRunRef.current !== run) return;
        setCleanCopyProgress(progress);
        setCleanCopyAnnouncement(cleanCopyProgressLabel(progress.phase));
      },
    });

    if (cleanCopyRunRef.current !== run) return;
    if (cleanCopyAbortRef.current === controller) cleanCopyAbortRef.current = null;

    if (!outcome.ok) {
      if (outcome.error.code === "cancelled") {
        setCleanCopyProgress(null);
        setCleanCopyPhase("idle");
        setCleanCopyAnnouncement("Metadata-removed copy creation cancelled.");
        restoreCleanCopyActionFocusRef.current = true;
        return;
      }
      setCleanCopyProgress(null);
      setCleanCopyError(outcome.error.message);
      setCleanCopyPhase("error");
      setCleanCopyAnnouncement(
        `Metadata-removed copy failed. ${outcome.error.message}`,
      );
      return;
    }

    const outputUrl = URL.createObjectURL(outcome.result.output);
    cleanCopyObjectUrlRef.current = outputUrl;
    setCleanCopyObjectUrl(outputUrl);
    setCleanCopyResult(outcome.result);
    setCleanCopyProgress({ phase: "complete" });
    setCleanCopyPhase("complete");
    setCleanCopyAnnouncement(
      "Metadata-removed copy verified. Preview and Download are now available.",
    );
  };

  const cancelCleanCopy = () => {
    cleanCopyAbortRef.current?.abort();
    cleanCopyAbortRef.current = null;
    cleanCopyRunRef.current += 1;
    releaseCleanCopyObjectUrl();
    setCleanCopyResult(null);
    setCleanCopyProgress(null);
    setCleanCopyError("");
    setCleanCopyPhase("idle");
    setCleanCopyAnnouncement("Metadata-removed copy creation cancelled.");
    restoreCleanCopyActionFocusRef.current = true;
  };

  const downloadCleanCopy = () => {
    if (cleanCopyPhase !== "complete" || !cleanCopyResult || !cleanCopyObjectUrl) return;
    const anchor = document.createElement("a");
    anchor.href = cleanCopyObjectUrl;
    anchor.download = cleanCopyResult.output.name;
    anchor.click();
  };

  const downloadReport = () => {
    if (!inspection || !file || provenancePhase !== "complete") return;
    const report = {
      reportVersion: 1,
      generatedAt: new Date().toISOString(),
      notice: "This report describes locally parsed file data. Ordinary metadata is editable and is not proof of origin.",
      inspection,
      provenance: provenanceForReport(provenance),
    };
    const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], {
      type: "application/json;charset=utf-8",
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${sanitiseSourceBase(file.name) ?? "media"}-inspection.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const copyChecksum = async () => {
    if (!inspection?.file.sha256) return;
    try {
      await navigator.clipboard.writeText(inspection.file.sha256);
      setCopyStatus("File fingerprint copied");
    } catch {
      setCopyStatus("Copy was blocked by the browser");
    }
  };

  const reportReady = phase === "complete" && provenancePhase === "complete";
  const cleanCopyPreviewReady =
    cleanCopyPhase === "complete" &&
    cleanCopyResult !== null &&
    cleanCopyObjectUrl !== null &&
    imageCanBeAutoPreviewed(cleanCopyResult.cleaned);
  const cleanCopyBadge =
    cleanCopyPhase === "creating"
      ? "Verifying locally"
      : cleanCopyPhase === "complete"
        ? "Verified copy"
        : cleanCopyPhase === "error"
          ? "Not created"
          : provenancePhase !== "complete"
            ? "Waiting for origin check"
            : cleanCopyPreflight?.eligible
              ? "Eligible still image"
              : "Inspection only";
  const assistiveStatus = (() => {
    if (phase === "inspecting") return "Reading bounded file sections locally.";
    if (phase !== "complete" || !inspection) return "";
    if (provenancePhase === "checking") {
      return "Inspection complete. Checking embedded Content Credentials locally.";
    }
    if (provenancePhase === "complete" && provenance) {
      return `Inspection complete. Content Credentials check complete. ${provenanceHeading(provenance)}.`;
    }
    return "Inspection complete.";
  })();

  return (
    <main id="main-content" className="media-inspector-page">
      <section className="media-inspector-hero" aria-labelledby="media-inspector-title">
        <div>
          <p className="eyebrow">Media Inspector</p>
          <h1 id="media-inspector-title">Inspect photo and video metadata. Nothing uploaded.</h1>
        </div>
        <div className="media-inspector-hero__copy">
          <p>{mediaInspectorCopy.introduction}</p>
          <ul className="trust-markers" aria-label="Media Inspector promises">
            {mediaInspectorCopy.facts.map((fact) => <li key={fact}>{fact}</li>)}
          </ul>
        </div>
      </section>

      <section className="media-inspector-workspace" aria-labelledby="choose-media-title">
        {!file ? (
          <div
            className={isDragging ? "media-dropzone is-dragging" : "media-dropzone"}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setIsDragging(false);
              }
            }}
            onDrop={handleDrop}
          >
            <span className="media-dropzone__signal" aria-hidden="true"><span /></span>
            <p className="section-index">Local file selection</p>
            <h2 id="choose-media-title">Choose one media file</h2>
            <p>
              JPEG, PNG, WebP, GIF, MP4, MOV, WebM and common audio containers up to 512 MB.
              Support depends on what the file actually contains, not only its extension.
            </p>
            <button
              ref={chooserButtonRef}
              className="button button--primary"
              type="button"
              onClick={openPicker}
            >
              Choose media file
            </button>
            <input
              ref={inputRef}
              className="visually-hidden-input"
              type="file"
              accept={ACCEPTED_MEDIA}
              onChange={handleInput}
              aria-label="Choose a media file to inspect"
            />
            <small>Your file is read from this device and is not sent to the site.</small>
          </div>
        ) : (
          <div className="media-inspector-results">
            <header className="media-results-header">
              <div>
                <p className="section-index">Selected locally</p>
                <h2 id="choose-media-title">{file.name}</h2>
                <p>{formatBytes(file.size)} · {inspection?.format.label ?? "Inspecting file structure"}</p>
              </div>
              <div className="media-results-header__actions">
                <button className="button button--quiet" type="button" onClick={openPicker}>
                  Replace
                </button>
                <button className="text-button text-button--danger" type="button" onClick={clear}>
                  Clear
                </button>
                <input
                  ref={inputRef}
                  className="visually-hidden-input"
                  type="file"
                  accept={ACCEPTED_MEDIA}
                  onChange={handleInput}
                  aria-label="Choose a replacement media file"
                />
              </div>
            </header>

            <div className="media-result-grid">
              <section className="media-preview-panel" aria-label="Selected media preview">
                <div className="media-preview">
                  {objectUrl && inspection?.format.category === "image" ? (
                    <img src={objectUrl} alt={`Local preview of ${file.name}`} />
                  ) : null}
                  {objectUrl && inspection?.format.category === "video" ? (
                    <video
                      src={objectUrl}
                      controls
                      preload="metadata"
                      aria-label={`Local video preview of ${file.name}`}
                    >
                      Video preview is unavailable.
                    </video>
                  ) : null}
                  {objectUrl && inspection?.format.category === "audio" ? (
                    <div className="media-preview__audio">
                      <span aria-hidden="true">WAVE</span>
                      <audio
                        src={objectUrl}
                        controls
                        preload="metadata"
                        aria-label={`Local audio preview of ${file.name}`}
                      >
                        Audio preview is unavailable.
                      </audio>
                    </div>
                  ) : null}
                  {phase === "inspecting" ? (
                    <div className="media-preview__unknown">
                      <span aria-hidden="true">CHECKING</span>
                      <p>Preview waits until the file signature and bounded structure checks succeed.</p>
                    </div>
                  ) : null}
                  {phase === "error" ? (
                    <div className="media-preview__unknown">
                      <span aria-hidden="true">NO PREVIEW</span>
                      <p>No browser media decoder was started for this rejected file.</p>
                    </div>
                  ) : null}
                  {phase === "complete" && inspection?.format.category === "image" && !objectUrl ? (
                    <div className="media-preview__unknown">
                      <span aria-hidden="true">PREVIEW LIMITED</span>
                      <p>
                        Structural results are available, but automatic image preview is limited to
                        {` ${MAX_AUTO_PREVIEW_SIDE.toLocaleString("en-AU")} pixels per side and 36 megapixels`}.
                      </p>
                    </div>
                  ) : null}
                  {phase === "complete" &&
                  !objectUrl &&
                  (inspection?.format.category === "video" || inspection?.format.category === "audio") ? (
                    <div className="media-preview__unknown">
                      <span aria-hidden="true">{inspection.format.category.toUpperCase()}</span>
                      <p>
                        Structural inspection is complete. Starting the browser decoder is a separate local action.
                      </p>
                      <button className="button button--quiet" type="button" onClick={loadDecoderPreview}>
                        Load local {inspection.format.category} preview
                      </button>
                    </div>
                  ) : null}
                </div>
                <p className="media-preview-panel__note">
                  When loaded, preview uses a temporary local browser URL. Clear revokes it from this page.
                </p>
              </section>

              <section className="media-details-panel" aria-label="Media inspection results">
                {phase === "inspecting" ? (
                  <div className="media-inspecting">
                    <span className="media-inspecting__bar" aria-hidden="true"><span /></span>
                    <h3>Reading bounded file sections</h3>
                    <p>Inspecting structure, metadata and an exact-file fingerprint locally.</p>
                    <button className="button button--quiet" type="button" onClick={clear}>Cancel and clear</button>
                  </div>
                ) : null}

                {phase === "error" ? (
                  <div className="media-error" role="alert">
                    <p className="section-index">Inspection stopped</p>
                    <h3>This file could not be safely inspected</h3>
                    <p>{error}</p>
                    <button className="button button--quiet" type="button" onClick={openPicker}>
                      Choose another file
                    </button>
                  </div>
                ) : null}

                {phase === "complete" && inspection ? (
                  <>
                    <div className="media-result-actions">
                      <div>
                        <strong>Inspection complete</strong>
                        <span>{inspection.metadata.length} metadata fields · {inspection.privacy.length} privacy findings</span>
                      </div>
                      <button
                        className="button button--quiet"
                        type="button"
                        onClick={downloadReport}
                        disabled={!reportReady}
                        aria-describedby={!reportReady ? "media-report-readiness" : undefined}
                      >
                        Download JSON report
                      </button>
                    </div>
                    {!reportReady ? (
                      <p id="media-report-readiness" className="media-report-readiness">
                        Report download becomes available after the local Content Credentials check finishes.
                      </p>
                    ) : null}

                    <div className="media-tabs" role="tablist" aria-label="Inspection result views">
                      {tabs.map((tab) => (
                        <button
                          key={tab.id}
                          id={`media-tab-${tab.id}`}
                          type="button"
                          role="tab"
                          aria-selected={activeTab === tab.id}
                          aria-controls={`media-panel-${tab.id}`}
                          tabIndex={activeTab === tab.id ? 0 : -1}
                          onClick={() => setActiveTab(tab.id)}
                          onKeyDown={(event) => activateTabByKeyboard(event, tab.id)}
                        >
                          {tab.label}
                          {tab.id === "privacy" && inspection.privacy.length > 0 ? (
                            <span>{inspection.privacy.length}</span>
                          ) : null}
                        </button>
                      ))}
                    </div>

                    <div
                      id={`media-panel-${activeTab}`}
                      className="media-tab-panel"
                      role="tabpanel"
                      aria-labelledby={`media-tab-${activeTab}`}
                      tabIndex={0}
                    >
                      {activeTab === "overview" ? (
                        <div className="media-overview">
                          <dl className="media-summary">
                            <SummaryItem label="Actual format" value={inspection.format.label} />
                            <SummaryItem label="Media category" value={titleCase(inspection.format.category)} />
                            <SummaryItem label="File size" value={formatBytes(inspection.file.size)} />
                            <SummaryItem label="Declared type" value={inspection.file.declaredMimeType || "Not declared"} />
                            {inspection.image ? (
                              <SummaryItem label="Dimensions" value={`${inspection.image.width} × ${inspection.image.height} px`} />
                            ) : null}
                            {inspection.container?.durationSeconds !== undefined ? (
                              <SummaryItem label="Duration" value={formatDuration(inspection.container.durationSeconds)} />
                            ) : null}
                            {inspection.container ? (
                              <SummaryItem label="Tracks" value={String(inspection.container.tracks.length)} />
                            ) : null}
                            <SummaryItem label="SHA-256 file fingerprint" value={inspection.file.sha256 ?? "Not calculated"} wide />
                          </dl>
                          {inspection.file.sha256 ? (
                            <div className="checksum-action">
                              <button className="text-button" type="button" onClick={() => void copyChecksum()}>
                                Copy file fingerprint
                              </button>
                              <span role="status">{copyStatus}</span>
                              <p>
                                A fingerprint of the exact file. Identical files produce the same
                                value. It is not a malware or authenticity check.
                              </p>
                            </div>
                          ) : null}
                          {inspection.warnings.length > 0 ? (
                            <div className="inspection-warnings">
                              <h3>Inspection notes</h3>
                              <ul>{inspection.warnings.map((warning) => <li key={`${warning.code}-${warning.message}`}>{warning.message}</li>)}</ul>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {activeTab === "privacy" ? (
                        <div className="media-privacy-results">
                          {inspection.privacy.length > 0 ? (
                            <>
                              <div className="media-tab-intro">
                                <h3>Fields worth reviewing before sharing</h3>
                                <p>These findings describe recognised metadata. Decide whether each item is appropriate for your intended recipient.</p>
                              </div>
                              <div className="privacy-findings">
                                {inspection.privacy.map((finding) => <PrivacyCard key={finding.id} finding={finding} />)}
                              </div>
                            </>
                          ) : (
                            <div className="media-empty-state">
                              <span aria-hidden="true">CHECKED</span>
                              <h3>No recognised privacy fields were found</h3>
                              <p>This is not proof that the file contains no private information. Unsupported, encrypted or visual content may still matter.</p>
                            </div>
                          )}
                        </div>
                      ) : null}

                      {activeTab === "provenance" ? (
                        <div className="media-provenance-results">
                          <div className="media-tab-intro">
                            <h3>Content Credentials</h3>
                            <p>
                              A signed record that some cameras and editing tools attach to a file
                              to describe how it was created or changed. It can provide origin and
                              edit clues, but it does not prove that the depicted event is true.
                            </p>
                          </div>
                          {provenancePhase === "checking" ? (
                            <div className="provenance-status" data-validation="checking">
                              <span>Checking locally</span>
                              <div>
                                <h3>Validating embedded Content Credentials</h3>
                                <p>The verifier is checking this file without fetching remote manifests or certificate status.</p>
                              </div>
                            </div>
                          ) : null}
                          {provenancePhase === "complete" && provenance ? (
                            <div className="provenance-result">
                              <div className="provenance-status" data-validation={provenance.status === "credentials-found" ? provenance.validation : provenance.status}>
                                <span>{provenance.status === "credentials-found" ? titleCase(provenance.validation) : "Embedded evidence"}</span>
                                <div>
                                  <h3>{provenanceHeading(provenance)}</h3>
                                  <p>{provenanceExplanation(provenance)}</p>
                                  <small>Network policy: embedded credentials only</small>
                                </div>
                              </div>
                              {provenance.status === "credentials-found" ? <CredentialsDetails provenance={provenance} /> : null}
                            </div>
                          ) : null}
                          {aiMetadata.length > 0 ? (
                            <div className="ai-metadata-list">
                              <div className="media-tab-intro">
                                <h3>Possible AI generation details</h3>
                                <p>These fields may include prompts, workflows, models or settings. They can be edited or removed and are not proof of origin.</p>
                              </div>
                              <dl>
                                {aiMetadata.map((entry) => (
                                  <div key={`${entry.namespace}-${entry.key}`}>
                                    <dt>{entry.label}</dt>
                                    <dd>{displayValue(entry.value)}</dd>
                                    <small>{entry.namespace} · unverified metadata</small>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          ) : (
                            <div className="media-empty-state">
                              <span aria-hidden="true">UNKNOWN</span>
                              <h3>No AI generation metadata found</h3>
                              <p>That does not mean the file is human-made. Generation metadata can be absent, removed or stored in an unsupported form.</p>
                            </div>
                          )}
                        </div>
                      ) : null}

                      {activeTab === "raw" ? (
                        <div className="raw-metadata">
                          <label>
                            <span>Filter metadata fields</span>
                            <input
                              type="search"
                              value={rawFilter}
                              placeholder="Try GPS, prompt, date or codec"
                              onChange={(event) => setRawFilter(event.target.value)}
                            />
                          </label>
                          <p>{visibleMetadata.length} of {inspection.metadata.length} fields shown</p>
                          {visibleMetadata.length > 0 ? (
                            <div className="raw-metadata__table" role="table" aria-label="Raw metadata fields">
                              <div className="raw-metadata__header" role="row">
                                <span role="columnheader">Field</span>
                                <span role="columnheader">Value</span>
                                <span role="columnheader">Source</span>
                              </div>
                              {visibleMetadata.map((entry) => (
                                <div role="row" key={`${entry.namespace}-${entry.key}`}>
                                  <span role="cell"><strong>{entry.label}</strong><small>{entry.key}</small></span>
                                  <span role="cell">{displayValue(entry.value)}</span>
                                  <span role="cell">{entry.namespace}{entry.sensitive ? " · review" : ""}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="media-empty-state media-empty-state--compact">
                              <h3>No matching fields</h3>
                              <p>Change or clear the filter to see other parsed metadata.</p>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>

                    <section className="clean-copy-workspace" aria-labelledby="clean-copy-title">
                      <header className="clean-copy-workspace__heading">
                        <div>
                          <p className="section-index">Optional verified copy</p>
                          <h3 id="clean-copy-title">Remove supported metadata</h3>
                        </div>
                        <span className="clean-copy-badge">{cleanCopyBadge}</span>
                      </header>

                      <p className="clean-copy-workspace__intro">
                        For an eligible still JPEG or PNG, create a separate copy with supported
                        file-level metadata removed. The source is never overwritten, and the
                        result is verified before Download becomes available. Input is limited to
                        {` ${CLEAN_COPY_LIMITS.maxSourceBytes / (1024 * 1024)} MiB`},
                        {` ${CLEAN_COPY_LIMITS.maxDimension.toLocaleString("en-AU")} pixels per side`}
                        {` and ${CLEAN_COPY_LIMITS.maxPixels / 1_000_000} megapixels`}; generated
                        output has its own 32 MiB limit.
                      </p>
                      <p className="clean-copy-limitations">
                        Metadata removal does not mean visible content was redacted. This action does not detect
                        malware, remove steganography, watermarks or visual fingerprints, provide
                        anonymity, securely delete the source, or remove operating-system and
                        downloaded copies.
                      </p>

                      {provenancePhase !== "complete" ? (
                        <div className="clean-copy-unavailable">
                          <h4>Waiting for the source origin check</h4>
                          <p>
                            Availability is decided only after the embedded-only Content
                            Credentials check finishes.
                          </p>
                        </div>
                      ) : null}

                      {provenancePhase === "complete" &&
                      cleanCopyPreflight &&
                      !cleanCopyPreflight.eligible ? (
                        <div className="clean-copy-unavailable">
                          <h4>A metadata-removed copy is unavailable for this file</h4>
                          <p>{cleanCopyPreflight.reason}</p>
                          <p>
                            The original file remains unchanged and its inspection results are still
                            available above.
                          </p>
                        </div>
                      ) : null}

                      {provenancePhase === "complete" &&
                      cleanCopyPreflight?.eligible &&
                      provenance?.status === "credentials-found" &&
                      cleanCopyPhase !== "complete" ? (
                        <p className="clean-copy-limitations">
                          This source has an embedded Content Credential. The metadata-removed copy will
                          deliberately remove that record, so the new file will no longer carry the
                          source credential. Output verification must confirm its absence.
                        </p>
                      ) : null}

                      {provenancePhase === "complete" &&
                      cleanCopyPreflight?.eligible &&
                      cleanCopyPhase === "idle" ? (
                        <div className="clean-copy-action-row">
                          <button
                            ref={cleanCopyActionRef}
                            className="button button--primary"
                            type="button"
                            onClick={() => void createCleanCopy()}
                          >
                            Create metadata-removed copy
                          </button>
                          <small>
                            The generated file stays transiently in this page. Clear releases it;
                            Download saves a separate operating-system copy.
                          </small>
                        </div>
                      ) : null}

                      {provenancePhase === "complete" &&
                      cleanCopyPreflight?.eligible &&
                      cleanCopyPhase === "creating" ? (
                        <div className="clean-copy-progress">
                          <span className="clean-copy-progress__bar" aria-hidden="true"><span /></span>
                          <h4>{cleanCopyProgress ? cleanCopyProgressLabel(cleanCopyProgress.phase) : "Creating metadata-removed copy"}</h4>
                          <p>
                            {cleanCopyProgress?.processedBytes !== undefined &&
                            cleanCopyProgress.totalBytes !== undefined
                              ? `${formatBytes(cleanCopyProgress.processedBytes)} of ${formatBytes(cleanCopyProgress.totalBytes)}`
                              : "The source and generated output are being checked locally."}
                          </p>
                          <button className="button button--quiet" type="button" onClick={cancelCleanCopy}>
                            Cancel metadata removal
                          </button>
                        </div>
                      ) : null}

                      {provenancePhase === "complete" &&
                      cleanCopyPreflight?.eligible &&
                      cleanCopyPhase === "error" ? (
                        <div
                          ref={cleanCopyErrorRef}
                          className="clean-copy-error"
                          role="alert"
                          tabIndex={-1}
                        >
                          <h4>Metadata-removed copy was not created</h4>
                          <p>{cleanCopyError}</p>
                          <button
                            className="button button--quiet"
                            type="button"
                            onClick={() => void createCleanCopy()}
                          >
                            Try again
                          </button>
                        </div>
                      ) : null}

                      {provenancePhase === "complete" &&
                      cleanCopyPreflight?.eligible &&
                      cleanCopyPhase === "complete" &&
                      cleanCopyResult &&
                      cleanCopyObjectUrl ? (
                        <div
                          ref={cleanCopyResultRef}
                          className="clean-copy-result"
                          tabIndex={-1}
                          aria-labelledby="clean-copy-result-title"
                        >
                          <header className="clean-copy-result__heading">
                            <div>
                              <p className="section-index">Verified clean copy</p>
                              <h4 id="clean-copy-result-title">Metadata-removed copy is ready</h4>
                              <p>{cleanCopyResult.output.name}</p>
                            </div>
                            <div className="clean-copy-result__actions">
                              <button
                                className="button button--primary"
                                type="button"
                                onClick={downloadCleanCopy}
                              >
                                Download metadata-removed copy
                              </button>
                              <button
                                className="button button--quiet"
                                type="button"
                                onClick={() => void createCleanCopy()}
                              >
                                Create again
                              </button>
                            </div>
                          </header>

                          <div className="clean-copy-result-grid">
                            <div className="clean-copy-preview" aria-label="Generated metadata-removed copy preview">
                              {cleanCopyPreviewReady ? (
                                <img
                                  src={cleanCopyObjectUrl}
                                  alt={`Local preview of ${cleanCopyResult.output.name}`}
                                />
                              ) : (
                                <p>
                                  Preview is withheld because the generated image is outside the
                                  current 8,192-pixel-side or 36-megapixel preview limit. Download
                                  remains available because structural verification succeeded.
                                </p>
                              )}
                            </div>

                            <div className="clean-copy-verification">
                              <dl className="clean-copy-summary">
                                <div><dt>Source format</dt><dd>{cleanCopyResult.source.format.label}</dd></div>
                                <div><dt>Output format</dt><dd>{cleanCopyResult.cleaned.format.label}</dd></div>
                                <div><dt>Source size</dt><dd>{formatBytes(cleanCopyResult.source.file.size)}</dd></div>
                                <div><dt>Output size</dt><dd>{formatBytes(cleanCopyResult.output.size)}</dd></div>
                                <div>
                                  <dt>Dimensions</dt>
                                  <dd>
                                    {cleanCopyResult.source.image && cleanCopyResult.cleaned.image
                                      ? `${cleanCopyResult.source.image.width} × ${cleanCopyResult.source.image.height} px → ${cleanCopyResult.cleaned.image.width} × ${cleanCopyResult.cleaned.image.height} px`
                                      : "Verified unchanged"}
                                  </dd>
                                </div>
                                <div><dt>Pixel payload</dt><dd>Preserved exactly</dd></div>
                                <div><dt>Orientation</dt><dd>Preserved; no rotation introduced</dd></div>
                                <div><dt>Colour appearance</dt><dd>Preserved under the accepted profile</dd></div>
                                <div><dt>Source file fingerprint (SHA-256)</dt><dd>{cleanCopyResult.verification.sourceSha256}</dd></div>
                                <div><dt>Output file fingerprint (SHA-256)</dt><dd>{cleanCopyResult.verification.outputSha256}</dd></div>
                                <div><dt>Profile</dt><dd>{cleanCopyProfileLabel(cleanCopyResult)}</dd></div>
                                <div><dt>Rewrite</dt><dd>Lossless metadata structure</dd></div>
                                <div>
                                  <dt>Recognised privacy findings</dt>
                                  <dd>
                                    {cleanCopyResult.source.privacy.length} → {cleanCopyResult.cleaned.privacy.length}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Structural carriers</dt>
                                  <dd>
                                    {cleanCopyResult.verification.removedCarriers.length} removed;
                                    {` ${cleanCopyResult.verification.preservedCarriers.length} preserved`}
                                  </dd>
                                </div>
                              </dl>

                              <div className="clean-copy-metadata-grid">
                                <section aria-labelledby="clean-copy-removed-title">
                                  <h5 id="clean-copy-removed-title">
                                    Removed metadata ({cleanCopyResult.verification.removedMetadata.length})
                                  </h5>
                                  {cleanCopyResult.verification.removedMetadata.length > 0 ? (
                                    <ul>
                                      {cleanCopyResult.verification.removedMetadata.map((entry, index) => (
                                        <li key={`removed-${entry.namespace}-${entry.key}-${index}`}>
                                          {entry.label} ({entry.namespace})
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p>No recognised metadata fields required removal.</p>
                                  )}
                                </section>
                                <section aria-labelledby="clean-copy-remaining-title">
                                  <h5 id="clean-copy-remaining-title">
                                    Remaining recognised metadata ({cleanCopyResult.verification.remainingMetadata.length})
                                  </h5>
                                  {cleanCopyResult.verification.remainingMetadata.length > 0 ? (
                                    <ul>
                                      {cleanCopyResult.verification.remainingMetadata.map((entry, index) => (
                                        <li key={`remaining-${entry.namespace}-${entry.key}-${index}`}>
                                          {entry.label} ({entry.namespace})
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p>No recognised metadata fields remain.</p>
                                  )}
                                </section>
                              </div>

                              <div className="clean-copy-carrier-grid">
                                <section
                                  className="clean-copy-carriers"
                                  aria-labelledby="clean-copy-carriers-title"
                                >
                                  <h5 id="clean-copy-carriers-title">
                                    Removed structural carriers ({cleanCopyResult.verification.removedCarriers.length})
                                  </h5>
                                  {cleanCopyResult.verification.removedCarriers.length > 0 ? (
                                    <ul>
                                      {cleanCopyResult.verification.removedCarriers.map((carrier, index) => (
                                        <li key={`removed-carrier-${carrier}-${index}`}>{carrier}</li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p>No recognised metadata carriers required removal.</p>
                                  )}
                                </section>
                                <section
                                  className="clean-copy-carriers"
                                  aria-labelledby="clean-copy-preserved-carriers-title"
                                >
                                  <h5 id="clean-copy-preserved-carriers-title">
                                    Preserved rendering structure ({cleanCopyResult.verification.preservedCarriers.length})
                                  </h5>
                                  {cleanCopyResult.verification.preservedCarriers.length > 0 ? (
                                    <ul>
                                      {cleanCopyResult.verification.preservedCarriers.map((carrier, index) => (
                                        <li key={`preserved-carrier-${carrier}-${index}`}>{carrier}</li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p>No additional allowlisted rendering carriers were present.</p>
                                  )}
                                </section>
                              </div>

                              <p className="clean-copy-verification-note">
                                Output reinspection removed
                                {` ${cleanCopyResult.verification.removedPrivacy.length} recognised privacy findings and ${cleanCopyResult.verification.removedCarriers.length} metadata carriers`}.
                                {cleanCopyResult.sourceProvenance.status === "credentials-found"
                                  ? " The generated copy no longer carries the source Content Credential."
                                  : " No embedded Content Credential was carried into the generated copy."}
                                {" "}The output credential check returned not found before Preview and Download were enabled.
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </section>
                  </>
                ) : null}
              </section>
            </div>
          </div>
        )}
      </section>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" aria-label="Media inspection status">
        {assistiveStatus}
      </p>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" aria-label="Metadata-removed copy status">
        {cleanCopyAnnouncement}
      </p>

      <section className="media-inspector-explainer" aria-labelledby="evidence-title">
        <div>
          <p className="section-index">Evidence, not a verdict</p>
          <h2 id="evidence-title">What can metadata tell you about a file’s origin?</h2>
        </div>
        <div>
          <p>
            Camera details, software names and AI prompts are ordinary metadata that can be changed or removed.
            A missing field does not prove a file is human-made.
          </p>
          <p>
            Content Credentials can provide cryptographically bound origin and edit information when present and
            valid, but they describe signed claims rather than deciding whether the scene itself is true.
          </p>
          <Link className="text-link" to={routes.privacy}>Read the privacy boundary</Link>
        </div>
      </section>

      <HelpfulGuides
        id="media-inspector-guides-title"
        guideSlugs={[
          "view-photo-metadata",
          "remove-photo-metadata-before-sharing",
          "check-image-ai-metadata-content-credentials",
          "check-photo-location-before-posting",
        ]}
        eyebrow="Helpful Media Inspector guides"
        title="How to view, remove and interpret photo metadata"
        linkLabels={{
          "view-photo-metadata": "How to view photo metadata",
          "remove-photo-metadata-before-sharing":
            "Remove photo metadata before sharing",
          "check-image-ai-metadata-content-credentials":
            "Check AI metadata and Content Credentials",
          "check-photo-location-before-posting":
            "Check a photo for location data",
        }}
      />

      <ToolDirectory id="other-tools-title" currentPath={routes.mediaInspector} newTab />
    </main>
  );
}

export default MediaInspectorPage;
import "../features/media-inspector/media-inspector.css";
