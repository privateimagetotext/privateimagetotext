import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Link, useLocation } from "react-router";
import { HelpfulGuides } from "../components/HelpfulGuides";
import { ToolDirectory } from "../components/ToolDirectory";
import { ImagePicker } from "../features/steganography/components/ImagePicker";
import { ProtectionFields } from "../features/steganography/components/ProtectionFields";
import {
  EncodedResult,
  RevealedResult,
} from "../features/steganography/components/Results";
import { WorkflowSelector } from "../features/steganography/components/WorkflowSelector";
import {
  encodeMessage,
  messageByteLength,
  passwordsMatch,
  preparePassword,
  zeroBuffer,
} from "../features/steganography/codec";
import {
  decodeRasterWithoutResizing,
  inspectRasterFile,
  safeEncodedJpegFilename,
  safeEncodedPngFilename,
  safeRevealedTextFilename,
  validateGeneratedPng,
  validateGeneratedJpeg,
} from "../features/raster";
import {
  createInitialSteganographyState,
  steganographyReducer,
  type GeneratedImageResult,
  type ProtectionMode,
  type SteganographyErrorCode,
  type SteganographyFormat,
  type SteganographyProgress,
  type SteganographySourceImage,
  type SteganographyWorkflow,
} from "../features/steganography/state";
import {
  SteganographyWorkerClient,
  SteganographyWorkerError,
  workerErrorMessages,
  type CapacityResponse,
  type EncodedResponse,
  type InspectionResponse,
  type UnlockedResponse,
  type WorkerStage,
} from "../features/steganography/worker";
import { ensureOfflineJpegCodecAsset } from "../lib/service-worker";
import "../features/steganography/steganography.css";
import { hideMessageCopy } from "../config/tool-copy";
import { routes } from "../config/routes";

const errorMessages: Record<SteganographyErrorCode, string> = {
  "unsupported-input": "Choose a supported image for this workflow.",
  "file-too-large": "The selected image is larger than this workflow permits.",
  "dimension-limit": "Choose an image no larger than 4,096 × 4,096 pixels. Private Image to Text does not resize source pictures.",
  "animated-image": "Animated PNG and WebP images are not supported.",
  "decode-failed": "The browser could not safely decode this image.",
  "capacity-unavailable": "This picture does not have enough available space for a hidden message.",
  "invalid-message": "Enter a non-empty message with valid Unicode text.",
  "message-too-large": "The message is larger than this picture’s available space or the 1 MiB application limit.",
  "invalid-password": "Use a password between 12 and 256 characters.",
  "password-mismatch": "The two passwords do not match.",
  "unsupported-version": workerErrorMessages["unsupported-version"],
  "unsupported-format": workerErrorMessages["unsupported-format"],
  damaged: workerErrorMessages.damaged,
  "unlock-failed": workerErrorMessages["unlock-failed"],
  "output-too-large": "This picture cannot produce an output within the 80 MiB reopen limit.",
  "png-encode-failed": "The browser could not create a supported PNG output.",
  "malformed-jpeg": workerErrorMessages["malformed-jpeg"],
  "unsupported-jpeg-profile": workerErrorMessages["unsupported-jpeg-profile"],
  "jpeg-codec-unavailable": workerErrorMessages["jpeg-codec-unavailable"],
  "jpeg-output-too-large": workerErrorMessages["jpeg-output-too-large"],
  "jpeg-allocation-failed": workerErrorMessages["jpeg-allocation-failed"],
  "jpeg-self-verification-failed": workerErrorMessages["jpeg-self-verification-failed"],
  "worker-failed": workerErrorMessages["worker-failed"],
  "worker-message-error": workerErrorMessages["worker-failed"],
  "clipboard-failed": "The browser could not access the clipboard.",
  "download-failed": "The browser could not prepare that download.",
};

const progressLabels: Record<SteganographyProgress["stage"], string> = {
  "loading-jpeg-codec": "Loading the optional JPEG codec",
  "parsing-jpeg": "Checking JPEG structure",
  "validating-jpeg-profile": "Checking JPEG compatibility",
  "analysing-capacity": "Checking available message space",
  "hashing-message": "Checking message integrity",
  "deriving-encryption-key": "Preparing password protection",
  "encrypting-message": "Encrypting message",
  "embedding-message": "Embedding message",
  "inspecting-header": "Checking for a hidden message",
  "extracting-payload": "Reading the hidden message",
  "decrypting-message": "Decrypting and authenticating message",
  "encoding-png": "Encoding new PNG",
  "encoding-jpeg": "Creating JPEG",
  "verifying-output": "Reopening and verifying output",
};

function progressFromWorker(stage: WorkerStage): SteganographyProgress {
  const mapped: SteganographyProgress["stage"] =
    stage === "embedding-payload"
      ? "embedding-message"
      : stage === "encoding-jpeg" || stage === "writing-jpeg"
        ? "encoding-jpeg"
        : stage === "verifying-output" || stage === "reopening-jpeg"
          ? "verifying-output"
      : stage === "inspecting-header"
        ? "inspecting-header"
        : stage === "extracting-payload"
          ? "extracting-payload"
          : stage === "decrypting-message"
            ? "decrypting-message"
            : stage === "deriving-encryption-key"
              ? "deriving-encryption-key"
              : stage === "encrypting-message"
                ? "encrypting-message"
              : stage === "hashing-message"
                ? "hashing-message"
                : stage === "loading-jpeg-codec"
                  ? "loading-jpeg-codec"
                  : stage === "parsing-jpeg"
                    ? "parsing-jpeg"
                    : stage === "validating-jpeg-profile"
                      ? "validating-jpeg-profile"
                : "analysing-capacity";
  return { stage: mapped, value: null };
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  context?.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
}

function canvasPixels(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || canvas.width === 0 || canvas.height === 0) {
    throw new Error("canvas-unavailable");
  }
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
}

function transferableCopy(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function pastedImageFilename(type: string) {
  if (type === "image/jpeg" || type === "image/jpg") return "pasted-image.jpg";
  if (type === "image/webp") return "pasted-image.webp";
  if (type === "image/bmp" || type === "image/x-ms-bmp") return "pasted-image.bmp";
  return "pasted-image.png";
}

function triggerDownload(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
}

function stateCodeFromRaster(code: string): SteganographyErrorCode {
  if (code === "file-too-large") return "file-too-large";
  if (code === "dimensions-too-large" || code === "dimension-mismatch") return "dimension-limit";
  if (code === "animated-image") return "animated-image";
  if (code === "decode-failed" || code === "malformed-image") return "decode-failed";
  return "unsupported-input";
}

function stateCodeFromWorker(code: string): SteganographyErrorCode {
  const accepted: SteganographyErrorCode[] = [
    "unsupported-version",
    "unsupported-format",
    "damaged",
    "unlock-failed",
    "capacity-unavailable",
    "invalid-message",
    "invalid-password",
    "malformed-jpeg",
    "unsupported-jpeg-profile",
    "jpeg-codec-unavailable",
    "jpeg-output-too-large",
    "jpeg-allocation-failed",
    "jpeg-self-verification-failed",
    "output-too-large",
    "worker-failed",
  ];
  return accepted.includes(code as SteganographyErrorCode)
    ? (code as SteganographyErrorCode)
    : "worker-failed";
}

export default function HideMessagePage() {
  const location = useLocation();
  const [state, dispatch] = useReducer(
    steganographyReducer,
    undefined,
    () =>
      createInitialSteganographyState(
        new URLSearchParams(location.search).get("mode") === "reveal"
          ? "reveal"
          : "hide",
      ),
  );
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [revealPassword, setRevealPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chooseButtonRef = useRef<HTMLButtonElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const revealPasswordRef = useRef<HTMLInputElement>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);
  const sourceUrlRef = useRef<string | null>(null);
  const outputUrlRef = useRef<string | null>(null);
  const sourceNameRef = useRef("private-image-to-text.png");
  const operationRef = useRef(0);
  const workerRef = useRef(new SteganographyWorkerClient());

  const nextOperation = useCallback(() => {
    operationRef.current += 1;
    return operationRef.current;
  }, []);

  const releaseSourceUrl = useCallback(() => {
    if (!sourceUrlRef.current) return;
    URL.revokeObjectURL(sourceUrlRef.current);
    sourceUrlRef.current = null;
  }, []);

  const releaseOutput = useCallback(() => {
    if (outputUrlRef.current) {
      URL.revokeObjectURL(outputUrlRef.current);
      outputUrlRef.current = null;
    }
    clearCanvas(outputCanvasRef.current);
  }, []);

  const releaseResources = useCallback(() => {
    workerRef.current.terminate();
    releaseSourceUrl();
    releaseOutput();
    clearCanvas(sourceCanvasRef.current);
  }, [releaseOutput, releaseSourceUrl]);

  const focusChooser = useCallback(() => {
    window.requestAnimationFrame(() => chooseButtonRef.current?.focus());
  }, []);

  const resetLocalFields = useCallback(() => {
    setMessage("");
    setPassword("");
    setConfirmation("");
    setRevealPassword("");
    setShowPassword(false);
    setLocalError(null);
    setAnnouncement("");
    sourceNameRef.current = "private-image-to-text.png";
  }, []);

  const fullReset = useCallback(
    (type: "clear" | "cancel" | "startOver", focus = true) => {
      const operationId = nextOperation();
      releaseResources();
      resetLocalFields();
      dispatch({ type, operationId });
      setAnnouncement(type === "cancel" ? "Operation cancelled and workspace cleared." : "Workspace cleared.");
      if (focus) focusChooser();
    },
    [focusChooser, nextOperation, releaseResources, resetLocalFields],
  );

  const switchWorkflow = useCallback(
    (workflow: SteganographyWorkflow) => {
      if (workflow === state.workflow) return;
      const operationId = nextOperation();
      releaseResources();
      resetLocalFields();
      dispatch({ type: "switchWorkflow", workflow, operationId });
      setAnnouncement(`${workflow === "hide" ? "Hide message" : "Reveal message"} workflow ready.`);
      focusChooser();
    },
    [focusChooser, nextOperation, releaseResources, resetLocalFields, state.workflow],
  );

  useEffect(() => {
    if (state.inspection.status !== "password-required") return;
    const frame = window.requestAnimationFrame(() => revealPasswordRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [state.inspection.status]);

  useEffect(() => {
    const handlePageHide = () => {
      const operationId = nextOperation();
      releaseResources();
      resetLocalFields();
      dispatch({ type: "clear", operationId });
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      operationRef.current += 1;
      releaseResources();
    };
  }, [nextOperation, releaseResources, resetLocalFields]);

  const runCapacityAnalysis = useCallback(
    async (
      selectionOperationId: number,
      source: SteganographySourceImage,
      format: SteganographyFormat,
    ) => {
      const canvas = sourceCanvasRef.current;
      if (!canvas || operationRef.current !== selectionOperationId) return;
      const operationId = nextOperation();
      dispatch({ type: "capacityAnalysisStarted", operationId });
      setAnnouncement("Calculating message capacity.");
      try {
        let request: Parameters<SteganographyWorkerClient["request"]>[0];
        let transfer: Transferable[];
        if (format === "jpeg-v2") {
          if (source.kind !== "jpeg" || !source.file) {
            throw new SteganographyWorkerError("unsupported-jpeg-profile");
          }
          dispatch({
            type: "capacityAnalysisProgress",
            operationId,
            progress: { stage: "loading-jpeg-codec", value: null },
          });
          if (!(await ensureOfflineJpegCodecAsset())) {
            throw new SteganographyWorkerError("jpeg-codec-unavailable");
          }
          if (operationRef.current !== operationId) return;
          const bytes = await source.file.arrayBuffer();
          if (operationRef.current !== operationId) {
            new Uint8Array(bytes).fill(0);
            return;
          }
          request = { type: "analyse", operationId, format, bytes };
          transfer = [bytes];
        } else {
          const imageData = canvasPixels(canvas);
          request = {
            type: "analyse",
            operationId,
            format,
            pixels: imageData.data.buffer,
            width: source.width,
            height: source.height,
          };
          transfer = [imageData.data.buffer];
        }
        workerRef.current.start();
        const response = await workerRef.current.request<CapacityResponse>(
          request,
          transfer,
          (stage) => dispatch({
            type: "capacityAnalysisProgress",
            operationId,
            progress: progressFromWorker(stage),
          }),
        );
        if (operationRef.current !== operationId) return;
        dispatch({ type: "capacityReady", operationId, capacity: response.capacity });
        workerRef.current.terminate();
        setAnnouncement("Capacity calculation complete.");
      } catch (error) {
        if (operationRef.current !== operationId) return;
        const code = error instanceof SteganographyWorkerError
          ? stateCodeFromWorker(error.code)
          : "worker-failed";
        dispatch({ type: "capacityFailed", operationId, error: { code } });
        workerRef.current.terminate();
        setAnnouncement("Capacity calculation failed.");
      }
    },
    [nextOperation],
  );

  const releaseRevealRaster = useCallback(
    (operationId: number, source: SteganographySourceImage) => {
      clearCanvas(sourceCanvasRef.current);
      releaseSourceUrl();
      dispatch({
        type: "sourceReady",
        operationId,
        source: {
          ...source,
          file: null,
          objectUrl: "",
        },
      });
    },
    [releaseSourceUrl],
  );

  const runInspection = useCallback(
    async (selectionOperationId: number, source: SteganographySourceImage) => {
      const canvas = sourceCanvasRef.current;
      if (!canvas || operationRef.current !== selectionOperationId) return;
      const operationId = nextOperation();
      dispatch({ type: "inspectionStarted", operationId });
      setAnnouncement("Checking for a compatible hidden message.");
      try {
        let request: Parameters<SteganographyWorkerClient["request"]>[0];
        let transfer: Transferable[];
        if (source.kind === "jpeg") {
          if (!source.file) throw new Error("source-released");
          dispatch({
            type: "inspectionProgress",
            operationId,
            progress: { stage: "loading-jpeg-codec", value: null },
          });
          if (!(await ensureOfflineJpegCodecAsset())) {
            throw new SteganographyWorkerError("jpeg-codec-unavailable");
          }
          if (operationRef.current !== operationId) return;
          const bytes = await source.file.arrayBuffer();
          if (operationRef.current !== operationId) {
            new Uint8Array(bytes).fill(0);
            return;
          }
          request = { type: "inspect", operationId, format: "jpeg-v2", bytes };
          transfer = [bytes];
        } else {
          const imageData = canvasPixels(canvas);
          request = {
            type: "inspect",
            operationId,
            format: "png-v1",
            pixels: imageData.data.buffer,
            width: source.width,
            height: source.height,
          };
          transfer = [imageData.data.buffer];
        }
        workerRef.current.start();
        const pending = workerRef.current.request<InspectionResponse>(
          request,
          transfer,
          (stage) => dispatch({
            type: "inspectionProgress",
            operationId,
            progress: progressFromWorker(stage),
          }),
        );
        releaseRevealRaster(operationId, source);
        const response = await pending;
        if (operationRef.current !== operationId) return;
        if (response.result.kind === "no-message") {
          dispatch({ type: "inspectionNoMessage", operationId });
          workerRef.current.terminate();
          setAnnouncement("No compatible hidden message was found.");
        } else if (response.result.kind === "plain-ready") {
          dispatch({
            type: "inspectionPlainReady",
            operationId,
            result: {
              kind: "revealed-text",
              text: response.result.message,
              filename: safeRevealedTextFilename(source.name),
              protection: "plain",
            },
          });
          workerRef.current.terminate();
          setAnnouncement("Plain message revealed.");
        } else if (response.result.kind === "password-required") {
          dispatch({ type: "inspectionPasswordRequired", operationId });
          setAnnouncement("This message is password protected. Enter the password to continue.");
          window.requestAnimationFrame(() => revealPasswordRef.current?.focus());
        } else {
          const code = stateCodeFromWorker(response.result.kind);
          dispatch({ type: "inspectionFailed", operationId, error: { code } });
          workerRef.current.terminate();
          setAnnouncement("The encoded image could not be revealed.");
        }
      } catch (error) {
        if (operationRef.current !== operationId) return;
        const code = error instanceof SteganographyWorkerError
          ? stateCodeFromWorker(error.code)
          : "worker-failed";
        dispatch({ type: "inspectionFailed", operationId, error: { code } });
        workerRef.current.terminate();
      }
    },
    [nextOperation, releaseRevealRaster],
  );

  const handleFile = useCallback(
    async (file: File) => {
      const operationId = nextOperation();
      releaseResources();
      resetLocalFields();
      dispatch({ type: "sourceSelectionStarted", operationId });
      setAnnouncement("Checking the image locally.");
      sourceNameRef.current = file.name || "private-image-to-text.png";
      try {
        const inspected = await inspectRasterFile(file, state.workflow);
        if (operationRef.current !== operationId) return;
        if (!inspected.ok) {
          const code = stateCodeFromRaster(inspected.code);
          dispatch({ type: "sourceFailed", operationId, error: { code } });
          setLocalError(inspected.message);
          setAnnouncement("The image was rejected.");
          focusChooser();
          return;
        }
        const decoded = await decodeRasterWithoutResizing(file, inspected.kind, inspected);
        if (operationRef.current !== operationId) {
          decoded.close();
          return;
        }
        const canvas = sourceCanvasRef.current;
        const context = canvas?.getContext("2d", { willReadFrequently: true });
        if (!canvas || !context) {
          decoded.close();
          throw new Error("canvas-unavailable");
        }
        canvas.width = decoded.width;
        canvas.height = decoded.height;
        context.drawImage(decoded.source, 0, 0, decoded.width, decoded.height);
        decoded.close();
        if (operationRef.current !== operationId) {
          clearCanvas(canvas);
          return;
        }
        const objectUrl = URL.createObjectURL(file);
        sourceUrlRef.current = objectUrl;
        const source: SteganographySourceImage = {
          file,
          objectUrl,
          name: file.name || "pasted-image",
          mime: file.type,
          size: file.size,
          width: decoded.width,
          height: decoded.height,
          kind: inspected.kind,
        };
        dispatch({ type: "sourceReady", operationId, source });
        const compatibleFormat = inspected.kind === "jpeg" ? state.format : "png-v1";
        setAnnouncement(
          inspected.kind !== "jpeg" && state.format === "jpeg-v2"
            ? "Image decoded without resizing. PNG selected because JPEG output requires a JPEG source."
            : "Image decoded without resizing.",
        );
        if (state.workflow === "hide") {
          await runCapacityAnalysis(operationId, source, compatibleFormat);
        } else {
          await runInspection(operationId, source);
        }
      } catch {
        if (operationRef.current !== operationId) return;
        dispatch({ type: "sourceFailed", operationId, error: { code: "decode-failed" } });
        setAnnouncement("The image could not be decoded safely.");
        focusChooser();
      }
    },
    [
      focusChooser,
      nextOperation,
      releaseResources,
      resetLocalFields,
      runCapacityAnalysis,
      runInspection,
      state.workflow,
      state.format,
    ],
  );

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) return;
      const item = Array.from(event.clipboardData?.items ?? []).find(
        (candidate) => candidate.kind === "file" && candidate.type.startsWith("image/"),
      );
      const blob = item?.getAsFile();
      if (blob) {
        event.preventDefault();
        void handleFile(new File([blob], pastedImageFilename(blob.type), { type: blob.type }));
      } else if (event.clipboardData?.getData("text")) {
        setAnnouncement("Text-only paste was ignored. Paste text into the message field instead.");
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handleFile]);

  const pasteImage = async () => {
    try {
      if (!navigator.clipboard?.read) throw new Error("clipboard-unavailable");
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((candidate) => candidate.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        await handleFile(new File([blob], pastedImageFilename(type), { type }));
        return;
      }
      setAnnouncement("The clipboard does not contain an image.");
    } catch {
      setLocalError(errorMessages["clipboard-failed"]);
      setAnnouncement("Clipboard image access failed.");
    }
  };

  const invalidateResult = useCallback((preserveCapacityWorker = false) => {
    releaseOutput();
    if (!preserveCapacityWorker) workerRef.current.terminate();
    setLocalError(null);
  }, [releaseOutput]);

  const updateFormat = useCallback(
    (format: SteganographyFormat) => {
      if (format === state.format || state.workflow !== "hide") return;
      workerRef.current.terminate();
      releaseOutput();
      setLocalError(null);
      const operationId = nextOperation();
      dispatch({ type: "setFormat", format, operationId });
      setAnnouncement(
        format === "jpeg-v2"
          ? "JPEG output selected. Checking available message space."
          : "PNG output selected. Checking available message space.",
      );
      if (state.source.status === "ready") {
        void runCapacityAnalysis(operationId, state.source.image, format);
      }
    },
    [nextOperation, releaseOutput, runCapacityAnalysis, state.format, state.source, state.workflow],
  );

  const updateMessage = (value: string) => {
    const preserveCapacity = state.capacity.status === "analysing";
    invalidateResult(preserveCapacity);
    setMessage(value);
    const byteCount = messageByteLength(value);
    const wasTooLarge = state.capacity.status === "ready" &&
      state.messageByteCount > (
        state.protection === "encrypted"
          ? state.capacity.value.encryptedMessageCapacity
          : state.capacity.value.plainMessageCapacity
      );
    const operationId = preserveCapacity ? operationRef.current : nextOperation();
    dispatch({ type: "setMessageByteCount", operationId, byteCount: byteCount ?? 0 });
    if (state.capacity.status === "ready" && byteCount !== null) {
      const limit = state.protection === "encrypted"
        ? state.capacity.value.encryptedMessageCapacity
        : state.capacity.value.plainMessageCapacity;
      const nowTooLarge = byteCount > limit;
      if (!wasTooLarge && nowTooLarge) setAnnouncement("The message is now too large for this picture.");
      else if (wasTooLarge && !nowTooLarge) setAnnouncement("The message fits within this picture’s available space again.");
    }
  };

  const updateProtection = (protection: ProtectionMode) => {
    const preserveCapacity = state.capacity.status === "analysing";
    invalidateResult(preserveCapacity);
    setPassword("");
    setConfirmation("");
    const operationId = preserveCapacity ? operationRef.current : nextOperation();
    dispatch({ type: "setProtectionMode", operationId, protection });
  };

  const passwordConfigurationChanged = (field: "password" | "confirmation", value: string) => {
    const preserveCapacity = state.capacity.status === "analysing";
    invalidateResult(preserveCapacity);
    if (field === "password") setPassword(value);
    else setConfirmation(value);
    dispatch({
      type: "passwordConfigurationChanged",
      operationId: preserveCapacity ? operationRef.current : nextOperation(),
    });
  };

  const capacity = state.capacity.status === "ready"
    ? state.protection === "encrypted"
      ? state.capacity.value.encryptedMessageCapacity
      : state.capacity.value.plainMessageCapacity
    : 0;
  const invalidUnicode = messageByteLength(message) === null;
  const overCapacity = state.capacity.status === "ready" && state.messageByteCount > capacity;
  let passwordValid = state.protection === "plain";
  if (state.protection === "encrypted") {
    try {
      preparePassword(password);
      passwordValid = passwordsMatch(password, confirmation);
    } catch {
      passwordValid = false;
    }
  }

  const generateDisabledReason = useMemo(() => {
    if (state.source.status !== "ready" || state.capacity.status !== "ready") return "Choose a picture and wait while its available message space is checked.";
    if (state.format === "jpeg-v2" && state.source.image.kind !== "jpeg") return "JPEG output is available only for a supported JPEG source. Choose PNG for other pictures.";
    if (!message) return "Enter a message.";
    if (invalidUnicode) return "Remove the invalid unpaired Unicode surrogate.";
    if (overCapacity) return "This message is too large for this picture. Shorten the message or choose a picture with more available space.";
    if (state.protection === "encrypted" && !passwordValid) return "Enter matching passwords between 12 and 256 characters.";
    return null;
  }, [invalidUnicode, message, overCapacity, passwordValid, state.capacity.status, state.format, state.protection, state.source]);

  const generate = async () => {
    if (generateDisabledReason || state.source.status !== "ready") return;
    const canvas = sourceCanvasRef.current;
    if (!canvas) return;
    const operationId = nextOperation();
    releaseOutput();
    workerRef.current.start();
    dispatch({ type: "generationStarted", operationId });
    setAnnouncement("Message generation started.");
    setLocalError(null);
    let messageBytes: Uint8Array | null = null;
    let passwordBytes: Uint8Array | null = null;
    try {
      messageBytes = encodeMessage(message);
      if (state.protection === "encrypted") {
        passwordBytes = preparePassword(password).bytes;
      }
      const messageBuffer = transferableCopy(messageBytes);
      const passwordBuffer = passwordBytes
        ? transferableCopy(passwordBytes)
        : undefined;
      let request: Parameters<SteganographyWorkerClient["request"]>[0];
      let transfer: Transferable[];
      if (state.format === "jpeg-v2") {
        if (state.source.image.kind !== "jpeg" || !state.source.image.file) {
          throw new SteganographyWorkerError("unsupported-jpeg-profile");
        }
        dispatch({
          type: "generationProgress",
          operationId,
          progress: { stage: "loading-jpeg-codec", value: null },
        });
        if (!(await ensureOfflineJpegCodecAsset())) {
          throw new SteganographyWorkerError("jpeg-codec-unavailable");
        }
        if (operationRef.current !== operationId) {
          new Uint8Array(messageBuffer).fill(0);
          if (passwordBuffer) new Uint8Array(passwordBuffer).fill(0);
          return;
        }
        const sourceBytes = await state.source.image.file.arrayBuffer();
        if (operationRef.current !== operationId) {
          new Uint8Array(sourceBytes).fill(0);
          new Uint8Array(messageBuffer).fill(0);
          if (passwordBuffer) new Uint8Array(passwordBuffer).fill(0);
          return;
        }
        request = {
          type: "encode",
          operationId,
          format: "jpeg-v2",
          bytes: sourceBytes,
          message: messageBuffer,
          password: passwordBuffer,
        };
        transfer = [sourceBytes, messageBuffer];
      } else {
        const imageData = canvasPixels(canvas);
        request = {
          type: "encode",
          operationId,
          format: "png-v1",
          pixels: imageData.data.buffer,
          width: canvas.width,
          height: canvas.height,
          message: messageBuffer,
          password: passwordBuffer,
        };
        transfer = [imageData.data.buffer, messageBuffer];
      }
      if (passwordBuffer) transfer.push(passwordBuffer);
      const response = await workerRef.current.request<EncodedResponse>(
        request,
        transfer,
        (stage) => dispatch({
          type: "generationProgress",
          operationId,
          progress: progressFromWorker(stage),
        }),
      );
      if (operationRef.current !== operationId) {
        const stale = response.format === "jpeg-v2" ? response.bytes : response.pixels;
        new Uint8Array(stale).fill(0);
        return;
      }
      let blob: Blob | null;
      let mime: "image/png" | "image/jpeg";
      let filename: string;
      if (response.format === "jpeg-v2") {
        const outputBytes = new Uint8Array(response.bytes);
        try {
          dispatch({
            type: "generationProgress",
            operationId,
            progress: { stage: "verifying-output", value: null },
          });
          blob = new Blob([outputBytes], { type: "image/jpeg" });
          const checked = await validateGeneratedJpeg(blob, response);
          if (operationRef.current !== operationId) return;
          if (!checked.ok) {
            const code: SteganographyErrorCode = checked.code === "output-too-large"
              ? "jpeg-output-too-large"
              : "jpeg-self-verification-failed";
            dispatch({ type: "generationFailed", operationId, error: { code } });
            setAnnouncement("JPEG generation failed reopen validation.");
            return;
          }
          const decoded = await decodeRasterWithoutResizing(blob, "jpeg", checked);
          decoded.close();
          if (operationRef.current !== operationId) return;
          mime = "image/jpeg";
          filename = safeEncodedJpegFilename(state.source.image.name);
        } finally {
          zeroBuffer(outputBytes);
        }
      } else {
        const outputCanvas = outputCanvasRef.current;
        const outputContext = outputCanvas?.getContext("2d");
        if (!outputCanvas || !outputContext) throw new Error("canvas-unavailable");
        outputCanvas.width = response.width;
        outputCanvas.height = response.height;
        outputContext.putImageData(
          new ImageData(new Uint8ClampedArray(response.pixels), response.width, response.height),
          0,
          0,
        );
        dispatch({
          type: "generationProgress",
          operationId,
          progress: { stage: "encoding-png", value: null },
        });
        blob = await canvasToPng(outputCanvas);
        if (operationRef.current !== operationId) return;
        const checked = await validateGeneratedPng(blob, response);
        if (operationRef.current !== operationId) return;
        if (!blob || !checked.ok) {
          const code: SteganographyErrorCode = checked.ok || checked.code !== "output-too-large"
            ? "png-encode-failed"
            : "output-too-large";
          dispatch({ type: "generationFailed", operationId, error: { code } });
          clearCanvas(outputCanvas);
          setAnnouncement("PNG generation failed.");
          return;
        }
        mime = "image/png";
        filename = safeEncodedPngFilename(state.source.image.name);
      }
      if (!blob) throw new Error("output-missing");
      if (operationRef.current !== operationId) return;
      const objectUrl = URL.createObjectURL(blob);
      outputUrlRef.current = objectUrl;
      const result: GeneratedImageResult = {
        kind: "generated-image",
        blob,
        format: response.format,
        mime,
        objectUrl,
        filename,
        width: response.width,
        height: response.height,
        byteLength: blob.size,
        protection: state.protection,
        messageByteCount: state.messageByteCount,
      };
      dispatch({ type: "generationSucceeded", operationId, result });
      setPassword("");
      setConfirmation("");
      setMessage("");
      workerRef.current.terminate();
      clearCanvas(outputCanvasRef.current);
      setAnnouncement(`Encoded ${response.format === "jpeg-v2" ? "JPEG" : "PNG"} generated. No download has started.`);
    } catch (error) {
      if (operationRef.current !== operationId) return;
      const code = error instanceof SteganographyWorkerError
        ? stateCodeFromWorker(error.code)
        : "worker-failed";
      dispatch({ type: "generationFailed", operationId, error: { code } });
      workerRef.current.terminate();
      setAnnouncement("Message generation failed.");
    } finally {
      zeroBuffer(messageBytes);
      zeroBuffer(passwordBytes);
    }
  };

  const unlock = async () => {
    if (state.inspection.status !== "password-required") return;
    let prepared: Uint8Array;
    try {
      prepared = preparePassword(revealPassword).bytes;
    } catch {
      setLocalError(errorMessages["invalid-password"]);
      setAnnouncement("Enter a valid password to continue.");
      revealPasswordRef.current?.focus();
      return;
    }
    const operationId = state.currentOperationId;
    dispatch({ type: "unlockStarted", operationId });
    setLocalError(null);
    try {
      const passwordBuffer = transferableCopy(prepared);
      const pending = workerRef.current.request<UnlockedResponse>(
        { type: "unlock", operationId, password: passwordBuffer },
        [passwordBuffer],
        (stage) => dispatch({
          type: "unlockProgress",
          operationId,
          progress: progressFromWorker(stage),
        }),
      );
      setRevealPassword("");
      const response = await pending;
      if (operationRef.current !== operationId) return;
      dispatch({
        type: "unlockSucceeded",
        operationId,
        result: {
          kind: "revealed-text",
          text: response.message,
          filename: safeRevealedTextFilename(sourceNameRef.current),
          protection: "encrypted",
        },
      });
      workerRef.current.terminate();
      setAnnouncement("Password-protected message revealed.");
    } catch (error) {
      if (operationRef.current !== operationId) return;
      if (error instanceof SteganographyWorkerError && error.code === "unlock-failed") {
        dispatch({ type: "unlockFailed", operationId });
        setAnnouncement("Unlock failed. You can retry.");
        window.requestAnimationFrame(() => revealPasswordRef.current?.focus());
      } else {
        const code = error instanceof SteganographyWorkerError
          ? stateCodeFromWorker(error.code)
          : "worker-failed";
        dispatch({ type: "inspectionFailed", operationId, error: { code } });
        workerRef.current.terminate();
      }
    } finally {
      zeroBuffer(prepared);
    }
  };

  const result = state.result;
  const busy =
    state.source.status === "loading" ||
    state.capacity.status === "analysing" ||
    state.generation.status === "generating" ||
    state.inspection.status === "inspecting" ||
    state.inspection.status === "unlocking";
  const displayedError = localError ?? (state.error ? errorMessages[state.error.code] : null);

  const source = state.source.status === "ready" ? state.source.image : null;

  const copyRevealed = async () => {
    if (result?.kind !== "revealed-text") return;
    try {
      await navigator.clipboard.writeText(result.text);
      setAnnouncement("Revealed text copied to the operating-system clipboard.");
    } catch {
      setLocalError(errorMessages["clipboard-failed"]);
    }
  };

  const downloadRevealed = () => {
    if (result?.kind !== "revealed-text") return;
    const blob = new Blob([result.text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, result.filename);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setAnnouncement("Text file download started. Clear cannot delete the downloaded file.");
  };

  return (
    <main id="main-content">
      <section className="product-intro" aria-labelledby="hide-message-title">
        <div>
          <p className="eyebrow">Free private image steganography</p>
          <h1 id="hide-message-title">Hide a message inside an image.</h1>
        </div>
        <div className="product-intro__copy">
          <p>{hideMessageCopy.introduction}</p>
          <Link className="text-link" to="/how-it-works">See how message hiding works</Link>
        </div>
        <ul className="trust-markers" aria-label="Tool facts">
          {hideMessageCopy.facts.map((fact) => <li key={fact}>{fact}</li>)}
        </ul>
      </section>

      <section className="steg-workspace" aria-labelledby="steg-workspace-title">
        <div className="section-heading section-heading--compact">
          <p className="eyebrow">Hide or reveal a message</p>
          <h2 id="steg-workspace-title">Hide or reveal a message in your browser</h2>
        </div>

        <WorkflowSelector workflow={state.workflow} disabled={busy} onChange={switchWorkflow} />

        <div className="steg-grid">
          <div>
            <ImagePicker
              workflow={state.workflow}
              source={source}
              inputRef={fileInputRef}
              chooseButtonRef={chooseButtonRef}
              isDragging={isDragging}
              busy={busy}
              onDraggingChange={setIsDragging}
              onFile={(file) => void handleFile(file)}
              onPaste={() => void pasteImage()}
              onClear={() => fullReset("clear")}
            />
            {source?.objectUrl ? (
              <img className="steg-source-preview" src={source.objectUrl} alt="Selected source preview" />
            ) : null}
            <canvas ref={sourceCanvasRef} className="steg-working-canvas" aria-hidden="true" />
            <canvas ref={outputCanvasRef} className="steg-working-canvas" aria-hidden="true" />
          </div>

          {state.workflow === "hide" && result?.kind !== "generated-image" ? (
            <section className="steg-card" aria-labelledby="steg-message-title">
              <div className="steg-card__heading"><div><span className="step-number">02</span><h2 id="steg-message-title">Write a message and choose password protection</h2></div></div>
              <fieldset className="steg-protection">
                <legend>Output format</legend>
                <label>
                  <input
                    type="radio"
                    name="steg-format"
                    value="png-v1"
                    checked={state.format === "png-v1"}
                    disabled={busy}
                    onChange={() => updateFormat("png-v1")}
                  />
                  <span><strong>PNG — recommended</strong><small>Works with PNG, JPEG, WebP or BMP source pictures. The result is a new PNG.</small></span>
                </label>
                {source?.kind === "jpeg" ? (
                  <label>
                    <input
                      type="radio"
                      name="steg-format"
                      value="jpeg-v2"
                      checked={state.format === "jpeg-v2"}
                      disabled={busy}
                      onChange={() => updateFormat("jpeg-v2")}
                    />
                    <span><strong>JPEG — advanced</strong><small>Available only when the source is a supported JPEG. The result is a new JPEG.</small></span>
                  </label>
                ) : null}
                {state.format === "jpeg-v2" ? (
                  <p className="field-help">JPEG output requires a supported JPEG source. Keep the exact downloaded file because recompression is not supported.</p>
                ) : null}
                <details className="technical-details steg-format-details">
                  <summary>Technical details</summary>
                  <ul>
                    <li>PNG uses the LTSG v1 pixel format.</li>
                    <li>JPEG uses the LTSG v2 coefficient format.</li>
                    <li>JPEG support is limited to the documented grayscale and YCbCr profiles.</li>
                    <li>Both formats require the exact downloaded file for reliable reveal.</li>
                    {state.capacity.status === "ready" && state.capacity.value.format === "jpeg-v2" ? (
                      <li>{state.capacity.value.eligibleCoefficientCount.toLocaleString()} eligible luminance AC coefficients; {state.capacity.value.reservedHeaderCoefficientCount.toLocaleString()} are reserved for the v2 header.</li>
                    ) : null}
                  </ul>
                  <p><Link className="text-link" to="/how-it-works/technical">Read the full technical documentation</Link></p>
                </details>
              </fieldset>
              <label>
                <span>Message</span>
                <textarea
                  className="steg-message"
                  value={message}
                  maxLength={1_048_576}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  aria-describedby="steg-capacity-feedback"
                  onChange={(event) => updateMessage(event.currentTarget.value)}
                />
              </label>
              <p
                id="steg-capacity-feedback"
                className={`steg-capacity${overCapacity || invalidUnicode ? " is-over" : ""}`}
              >
                {invalidUnicode
                  ? "The message contains an unpaired Unicode surrogate."
                  : state.capacity.status === "ready"
                    ? overCapacity
                      ? "This message is too large for this picture. Shorten the message or choose a picture with more available space."
                      : `Message size: ${state.messageByteCount.toLocaleString()} of ${capacity.toLocaleString()} bytes used. Emojis and some symbols use more than one byte.`
                    : state.source.status === "ready"
                      ? "Checking how much text this picture can hold."
                      : "Choose a picture to see how much text it can hold."}
              </p>
              <ProtectionFields
                mode={state.protection}
                password={password}
                confirmation={confirmation}
                showPassword={showPassword}
                disabled={busy}
                passwordRef={passwordRef}
                onModeChange={updateProtection}
                onPasswordChange={(value) => passwordConfigurationChanged("password", value)}
                onConfirmationChange={(value) => passwordConfigurationChanged("confirmation", value)}
                onShowPasswordChange={setShowPassword}
              />
              {generateDisabledReason ? <p className="field-help" id="generate-disabled-reason">{generateDisabledReason}</p> : null}
              <div className="steg-actions">
                <button className="button button--primary" type="button" disabled={Boolean(generateDisabledReason) || busy} aria-describedby={generateDisabledReason ? "generate-disabled-reason" : undefined} onClick={() => void generate()}>
                  Create {state.format === "jpeg-v2" ? "JPEG" : "PNG"} with hidden message
                </button>
                {busy ? <button className="button button--quiet" type="button" onClick={() => fullReset("cancel")}>Cancel</button> : null}
              </div>
            </section>
          ) : null}

          {result?.kind === "generated-image" ? (
            <EncodedResult
              result={result}
              onDownload={() => {
                triggerDownload(result.objectUrl, result.filename);
                setAnnouncement(`Encoded ${result.format === "jpeg-v2" ? "JPEG" : "PNG"} download started. Clear cannot delete the downloaded file.`);
              }}
              onStartOver={() => fullReset("startOver")}
              onClear={() => fullReset("clear")}
            />
          ) : null}

          {state.workflow === "reveal" && state.inspection.status === "password-required" ? (
            <section className="steg-card" aria-labelledby="steg-unlock-title">
              <div className="steg-card__heading"><div><span className="step-number">02</span><h2 id="steg-unlock-title">Enter password</h2></div></div>
              <p>This image contains a password-protected message.</p>
              <label>
                <span>Password</span>
                <input
                  ref={revealPasswordRef}
                  type={showPassword ? "text" : "password"}
                  value={revealPassword}
                  autoComplete="current-password"
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  onChange={(event) => setRevealPassword(event.currentTarget.value)}
                />
              </label>
              <label className="steg-checkbox"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.currentTarget.checked)} />Show password</label>
              <div className="steg-actions">
                <button className="button button--primary" type="button" disabled={!revealPassword} onClick={() => void unlock()}>Reveal message</button>
                <button className="button button--quiet" type="button" onClick={() => fullReset("cancel")}>Cancel</button>
              </div>
            </section>
          ) : null}

          {result?.kind === "revealed-text" ? (
            <RevealedResult result={result} onCopy={() => void copyRevealed()} onDownload={downloadRevealed} onClear={() => fullReset("clear")} />
          ) : null}

          {result?.kind === "no-message" ? (
            <section className="steg-card steg-result" aria-labelledby="no-message-title">
              <h2 id="no-message-title">No compatible hidden message found</h2>
              <p>This image does not appear to contain a message created with this tool or compatible LTSG software.</p>
              <details className="technical-details">
                <summary>Technical details</summary>
                <p>No supported LTSG PNG v1 or JPEG v2 format marker was found. The file is not being reported as damaged.</p>
              </details>
              <button className="button button--primary" type="button" onClick={() => fullReset("clear")}>Choose another image</button>
            </section>
          ) : null}
        </div>

        {state.progress ? (
          <div className="steg-progress" role="status" aria-live="polite">
            <span className="steg-progress__spinner" aria-hidden="true" />
            {progressLabels[state.progress.stage]}
          </div>
        ) : null}
        {displayedError ? <div className="steg-error" role="alert"><strong>We could not complete that step.</strong><p>{displayedError}</p></div> : null}
        <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
      </section>

      <section className="steg-disclosure" aria-labelledby="steg-limitations-title">
        <h2 id="steg-limitations-title">What should you check before sharing a hidden message?</h2>
        <p>
          Image steganography means hiding information inside a picture without
          visibly replacing what the picture shows.
        </p>
        <ul>
          <li>Steganography hides that a message exists. It does not guarantee that expert analysis cannot detect hidden data.</li>
          <li>Password protection encrypts the message. No-password mode does not.</li>
          <li>Keep the exact file you download. Resizing, cropping, editing, screenshots and JPEG recompression can destroy the message.</li>
          <li>Many messaging and social-media services alter images. Send the image as a file attachment or through a service that preserves the original file.</li>
          <li>Lost passwords cannot be recovered.</li>
          <li>Generated files do not preserve most original metadata. JPEG output keeps orientation only where required.</li>
        </ul>
        <p><Link className="text-link" to={routes.verify}>Verify browser-only processing</Link></p>
      </section>

      <HelpfulGuides
        id="steganography-guides-title"
        guideSlugs={[
          "hide-message-in-image",
          "reveal-hidden-message-from-image",
          "share-image-with-hidden-message",
        ]}
        eyebrow="Helpful steganography guides"
        title="How to hide, reveal and share image messages"
        linkLabels={{
          "hide-message-in-image": "How to hide a message in an image",
          "reveal-hidden-message-from-image": "How to reveal a hidden message",
          "share-image-with-hidden-message":
            "Share the image without breaking the message",
        }}
      />

      <ToolDirectory id="other-tools-title" currentPath={routes.hideMessage} newTab />

      <section className="steg-boundaries" aria-labelledby="steg-boundaries-title">
        <h2 id="steg-boundaries-title">What Clear removes</h2>
        <p>Extract text and Hide message are separate tools. They do not share the image or result you are working with.</p>
        <p>Clear removes the selected picture, message and result from this page and shuts down the background process that handled them.</p>
        <p>Clear is not a secure memory wipe. Your browser or operating system may retain temporary copies in memory until they are naturally overwritten.</p>
        <p>Copy places text in your system clipboard, and Download saves a file to your device. Clear cannot undo either action. Browser extensions and other software on your device are outside this site’s control.</p>
      </section>
    </main>
  );
}
