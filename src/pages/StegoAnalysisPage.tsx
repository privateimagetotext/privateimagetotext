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
import { stegoAnalysisCopy } from "../config/tool-copy";
import {
  CHANNEL_LABELS,
  CHANNEL_ORDERS,
  CHANNELS,
  KIND_LABELS,
  PLANE_DEFINITIONS,
  STEGO_ANALYSIS_LIMITS,
  StegoAnalysisClient,
  StegoAnalysisClientError,
  formatOffset,
  type BitPacking,
  type ChannelKey,
  type ChannelOrder,
  type FileReport,
  type HexRow,
  type ImageReport,
  type StringScan,
  type Traversal,
} from "../features/stego-analysis";
import type { SixteenBitByte } from "../features/stego-analysis/png";
import { sanitiseSourceBase } from "../features/raster/filenames";
import "../features/stego-analysis/stego-analysis.css";

type Phase = "idle" | "loading" | "ready" | "error";

type Extraction = {
  readonly bytes: Uint8Array;
  readonly totalBits: number;
  readonly truncated: boolean;
  readonly preview: readonly HexRow[];
  readonly strings: StringScan;
  readonly description: string;
};

const TRAVERSAL_LABELS: Record<Traversal, string> = {
  rows: "rows",
  "rows-bottom-up": "rows bottom to top",
  columns: "columns",
};

const MIN_STRING_LENGTHS = [4, 6, 8, 12, 16] as const;
const BIT_POSITIONS = [7, 6, 5, 4, 3, 2, 1, 0] as const;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes.toLocaleString("en-AU")} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("en-AU", { maximumFractionDigits: 1 })} KiB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("en-AU", { maximumFractionDigits: 1 })} MiB`;
}

function downloadBytes(bytes: Uint8Array | Blob, filename: string, type = "application/octet-stream") {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
}

// A worker that runs out of memory may stop without an error event.
const LOAD_TIMEOUT_MS = 120_000;

function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new StegoAnalysisClientError(
      "worker-failed",
      "The analysis did not finish. The file may be too large for this device's memory; try a smaller image.",
    )), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

function errorMessage(error: unknown) {
  if (error instanceof StegoAnalysisClientError) return error.message;
  return "The analysis could not be completed.";
}

function extensionOf(name: string) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name);
  return match ? match[1].toLowerCase() : null;
}

const EXTENSIONS: Record<string, readonly string[]> = {
  png: ["png"],
  jpeg: ["jpg", "jpeg", "jfif", "jpe"],
  webp: ["webp"],
  bmp: ["bmp", "dib"],
  gif: ["gif"],
};

function HexView({ rows, label }: { readonly rows: readonly HexRow[]; readonly label: string }) {
  return (
    <div className="stego-hex" role="region" aria-label={label} tabIndex={0}>
      <pre>
        {rows.map((row) => `${formatOffset(row.offset)}  ${row.hex.padEnd(47)}  ${row.ascii}`).join("\n")}
      </pre>
    </div>
  );
}

function StringList({ scan, filter, label }: { readonly scan: StringScan; readonly filter?: string; readonly label: string }) {
  const needle = filter?.trim().toLowerCase() ?? "";
  const visible = needle ? scan.strings.filter((item) => item.text.toLowerCase().includes(needle)) : scan.strings;
  if (scan.total === 0) return <p className="stego-muted">No printable strings of that length were found.</p>;
  return (
    <>
      <p className="stego-muted" aria-live="polite">
        {needle
          ? `${visible.length.toLocaleString("en-AU")} of ${scan.strings.length.toLocaleString("en-AU")} listed strings match.`
          : scan.truncated
            ? `Showing the first ${scan.strings.length.toLocaleString("en-AU")} of ${scan.total.toLocaleString("en-AU")} strings.`
            : `${scan.total.toLocaleString("en-AU")} strings found.`}
      </p>
      <div className="stego-strings" role="region" aria-label={label} tabIndex={0}>
        <ol>
          {visible.map((item) => (
            <li key={item.offset}>
              <span className="stego-strings__offset">{formatOffset(item.offset)}</span>
              <span className="stego-strings__text">{item.text}</span>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

export default function StegoAnalysisPage() {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [fileReport, setFileReport] = useState<FileReport | null>(null);
  const [imageReport, setImageReport] = useState<ImageReport | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [planeIndex, setPlaneIndex] = useState(0);
  const [planeError, setPlaneError] = useState("");
  const [channels, setChannels] = useState<readonly ChannelKey[]>(["r", "g", "b"]);
  const [channelOrder, setChannelOrder] = useState<ChannelOrder>("rgba");
  const [sixteenBitByte, setSixteenBitByte] = useState<SixteenBitByte>("high");
  const [bits, setBits] = useState<readonly number[]>([0]);
  const [traversal, setTraversal] = useState<Traversal>("rows");
  const [packing, setPacking] = useState<BitPacking>("msb-first");
  const [extracting, setExtracting] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [bytesError, setBytesError] = useState("");
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [extractError, setExtractError] = useState("");
  const [minStringLength, setMinStringLength] = useState<number>(6);
  const [strings, setStrings] = useState<StringScan | null>(null);
  const [stringFilter, setStringFilter] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState("");

  const clientRef = useRef<StegoAnalysisClient | null>(null);
  const generationRef = useRef(0);
  const renderedPlaneRef = useRef<string | null>(null);
  const wantedPlaneRef = useRef<string | null>(null);
  const planeInFlightRef = useRef<StegoAnalysisClient | null>(null);
  const extractHeadingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chooserRef = useRef<HTMLButtonElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const restoreChooserFocusRef = useRef(false);

  const plane = PLANE_DEFINITIONS[planeIndex];

  const dispose = useCallback(() => {
    generationRef.current += 1;
    clientRef.current?.terminate();
    clientRef.current = null;
    renderedPlaneRef.current = null;
    wantedPlaneRef.current = null;
    planeInFlightRef.current = null;
    clearCanvas(canvasRef.current);
  }, []);

  const resetState = useCallback(() => {
    setFile(null);
    setPhase("idle");
    setError("");
    setFileReport(null);
    setImageReport(null);
    setImageError(null);
    setPlaneIndex(0);
    setPlaneError("");
    setExtracting(false);
    setReloading(false);
    setBytesError("");
    setExtraction((previous) => {
      previous?.bytes.fill(0);
      return null;
    });
    setExtractError("");
    setMinStringLength(6);
    setSixteenBitByte("high");
    setStrings(null);
    setStringFilter("");
    setIsDragging(false);
  }, []);

  const clear = useCallback(() => {
    dispose();
    resetState();
    restoreChooserFocusRef.current = true;
    setStatus("Cleared. The file and every result were removed from this page.");
    if (inputRef.current) inputRef.current.value = "";
  }, [dispose, resetState]);

  useEffect(() => {
    const handlePageHide = () => {
      dispose();
      resetState();
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      dispose();
    };
  }, [dispose, resetState]);

  useEffect(() => {
    if (!file && restoreChooserFocusRef.current) {
      restoreChooserFocusRef.current = false;
      chooserRef.current?.focus();
    }
  }, [file]);

  const loadIntoWorker = useCallback(async (selected: File, generation: number) => {
    const bytes = await selected.arrayBuffer();
    if (generation !== generationRef.current) return null;
    const client = new StegoAnalysisClient();
    // Post the load before anything else can reach this worker; the worker
    // runs requests in order, so later plane or string requests wait for it.
    const loading = client.load(bytes);
    clientRef.current = client;
    const loaded = await loading;
    if (generation !== generationRef.current) return null;
    return loaded;
  }, []);

  const startAnalysis = useCallback(async (selected: File) => {
    dispose();
    resetState();
    setStatus("");
    const generation = generationRef.current;
    if (selected.size === 0) {
      setFile(selected);
      setPhase("error");
      setError("The file is empty.");
      return;
    }
    if (selected.size > STEGO_ANALYSIS_LIMITS.maxFileBytes) {
      setFile(selected);
      setPhase("error");
      setError(`Choose a file no larger than ${STEGO_ANALYSIS_LIMITS.maxFileLabel}.`);
      return;
    }
    setFile(selected);
    setPhase("loading");
    try {
      const loaded = await withTimeout(loadIntoWorker(selected, generation), LOAD_TIMEOUT_MS);
      if (!loaded) return;
      const scan = await clientRef.current!.strings(6);
      if (generation !== generationRef.current) return;
      setFileReport(loaded.file);
      setImageReport(loaded.image);
      setImageError(loaded.imageError);
      setStrings(scan.scan);
      setPhase("ready");
      setStatus(`Analysis ready for ${selected.name}.`);
      window.setTimeout(() => resultsHeadingRef.current?.focus(), 0);
    } catch (caught) {
      if (generation !== generationRef.current) return;
      clientRef.current?.terminate();
      clientRef.current = null;
      setPhase("error");
      setError(errorMessage(caught));
    }
  }, [dispose, loadIntoWorker, resetState]);

  const cancelLoading = useCallback(() => {
    dispose();
    resetState();
    restoreChooserFocusRef.current = true;
    setStatus("Analysis cancelled.");
  }, [dispose, resetState]);

  // Render the newest wanted plane. Only one render is in flight per worker;
  // rapid key presses coalesce to the latest view instead of queueing renders.
  const pumpPlane = useCallback((client: StegoAnalysisClient) => {
    const wanted = wantedPlaneRef.current;
    if (!wanted || planeInFlightRef.current === client) return;
    planeInFlightRef.current = client;
    client.plane(wanted).then((response) => {
      if (client !== clientRef.current || response.planeId !== wantedPlaneRef.current) return;
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      canvas.width = response.width;
      canvas.height = response.height;
      context.putImageData(new ImageData(new Uint8ClampedArray(response.pixels), response.width, response.height), 0, 0);
      renderedPlaneRef.current = response.planeId;
      setPlaneError("");
    }).catch((caught: unknown) => {
      if (client !== clientRef.current) return;
      if (caught instanceof StegoAnalysisClientError && caught.code === "cancelled") return;
      setPlaneError(errorMessage(caught));
    }).finally(() => {
      if (planeInFlightRef.current === client) planeInFlightRef.current = null;
      if (client === clientRef.current && wantedPlaneRef.current !== renderedPlaneRef.current && wantedPlaneRef.current !== wanted) {
        pumpPlane(client);
      }
    });
  }, []);

  useEffect(() => {
    if (phase !== "ready" || !imageReport || !clientRef.current) return;
    wantedPlaneRef.current = plane.id;
    pumpPlane(clientRef.current);
  }, [imageReport, phase, plane.id, pumpPlane]);

  const handleFiles = (files: FileList | null) => {
    const selected = files?.[0];
    if (selected) void startAnalysis(selected);
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    handleFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    handleFiles(event.dataTransfer.files);
  };

  const openPicker = () => inputRef.current?.click();

  const movePlane = (delta: number) => {
    setPlaneIndex((index) => (index + delta + PLANE_DEFINITIONS.length) % PLANE_DEFINITIONS.length);
  };

  const handleViewerKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => movePlane(1),
      ArrowDown: () => movePlane(1),
      "]": () => movePlane(1),
      ArrowLeft: () => movePlane(-1),
      ArrowUp: () => movePlane(-1),
      "[": () => movePlane(-1),
      Home: () => setPlaneIndex(0),
      End: () => setPlaneIndex(PLANE_DEFINITIONS.length - 1),
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const downloadPlane = () => {
    const canvas = canvasRef.current;
    if (!canvas || !file || canvas.width === 0) return;
    const planeId = renderedPlaneRef.current;
    if (!planeId) return;
    const base = sanitiseSourceBase(file.name) ?? "image";
    const generation = generationRef.current;
    canvas.toBlob((blob) => {
      if (blob && generation === generationRef.current) downloadBytes(blob, `${base}-${planeId}.png`);
    }, "image/png");
  };

  const toggle = <T,>(list: readonly T[], value: T) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const runExtraction = async () => {
    const client = clientRef.current;
    if (!client || !file || reloading) return;
    const generation = generationRef.current;
    setExtracting(true);
    setExtractError("");
    setExtraction((previous) => {
      previous?.bytes.fill(0);
      return null;
    });
    const orderedChannels = CHANNEL_ORDERS[channelOrder].filter((channel) => channels.includes(channel));
    const orderedBits = BIT_POSITIONS.filter((bit) => bits.includes(bit));
    try {
      const result = await client.extract({ channels: orderedChannels, channelOrder, bits: orderedBits, traversal, packing });
      if (generation !== generationRef.current) return;
      setExtraction({
        bytes: new Uint8Array(result.bytes),
        totalBits: result.totalBits,
        truncated: result.truncated,
        preview: result.preview,
        strings: result.strings,
        description: `${orderedChannels.map((channel) => channel.toUpperCase()).join("")} bit${orderedBits.length > 1 ? "s" : ""} ${orderedBits.join(",")}, ${TRAVERSAL_LABELS[traversal]}, ${packing === "msb-first" ? "MSB-first" : "LSB-first"}`,
      });
      setStatus("Extraction complete.");
    } catch (caught) {
      if (generation !== generationRef.current) return;
      if (caught instanceof StegoAnalysisClientError && caught.code === "cancelled") return;
      setExtractError(errorMessage(caught));
    } finally {
      if (generation === generationRef.current) setExtracting(false);
    }
  };

  const cancelExtraction = async () => {
    // Stopping a running worker loses its decoded pixels, so reload the same file.
    if (!file) return;
    generationRef.current += 1;
    const generation = generationRef.current;
    clientRef.current?.terminate();
    clientRef.current = null;
    setExtracting(false);
    setReloading(true);
    window.setTimeout(() => extractHeadingRef.current?.focus(), 0);
    setStatus("Extraction cancelled. Reopening the file in this browser.");
    try {
      // The new worker queues later requests until this load finishes.
      const loaded = await loadIntoWorker(file, generation);
      if (!loaded) return;
      setReloading(false);
      if (!loaded.image) throw new StegoAnalysisClientError("decode-failed", "The image could not be decoded again.");
      setImageReport({ ...loaded.image });
    } catch (caught) {
      if (generation !== generationRef.current) return;
      setPhase("error");
      setError(errorMessage(caught));
    }
  };

  const changeSixteenBitByte = async (byte: SixteenBitByte) => {
    const client = clientRef.current;
    if (!client || reloading) return;
    const generation = generationRef.current;
    const previousByte = sixteenBitByte;
    setSixteenBitByte(byte);
    setExtraction((previous) => {
      previous?.bytes.fill(0);
      return null;
    });
    try {
      const response = await client.redecode(byte);
      if (generation !== generationRef.current) return;
      setImageReport(response.image);
      setStatus(byte === "low" ? "Showing the low byte of each 16-bit sample." : "Showing the high byte of each 16-bit sample.");
    } catch (caught) {
      if (generation === generationRef.current && !(caught instanceof StegoAnalysisClientError && caught.code === "cancelled")) {
        setSixteenBitByte(previousByte);
        setPlaneError(errorMessage(caught));
      }
    }
  };

  const changeMinStringLength = async (value: number) => {
    setMinStringLength(value);
    const client = clientRef.current;
    if (!client) return;
    const generation = generationRef.current;
    try {
      const scan = await client.strings(value);
      if (generation === generationRef.current) {
        setStrings(scan.scan);
        setBytesError("");
      }
    } catch (caught) {
      if (generation === generationRef.current && !(caught instanceof StegoAnalysisClientError && caught.code === "cancelled")) {
        setBytesError(errorMessage(caught));
      }
    }
  };

  const downloadTrailing = async () => {
    const client = clientRef.current;
    if (!client || !file) return;
    const generation = generationRef.current;
    try {
      const response = await client.trailing();
      const bytes = new Uint8Array(response.bytes);
      if (generation === generationRef.current) {
        downloadBytes(bytes, `${sanitiseSourceBase(file.name) ?? "image"}-trailing-data.bin`);
        setBytesError("");
      }
      bytes.fill(0);
    } catch (caught) {
      if (generation === generationRef.current && !(caught instanceof StegoAnalysisClientError && caught.code === "cancelled")) {
        setBytesError(errorMessage(caught));
      }
    }
  };

  const extensionMatches = useMemo(() => {
    if (!file || !fileReport?.kind) return null;
    const extension = extensionOf(file.name);
    return extension ? EXTENSIONS[fileReport.kind].includes(extension) : null;
  }, [file, fileReport]);

  const ready = phase === "ready" && fileReport;

  return (
    <main id="main-content" className="stego-analysis-page">
      <section className="stego-hero" aria-labelledby="stego-analysis-title">
        <div>
          <p className="eyebrow">Steganography analysis</p>
          <h1 id="stego-analysis-title">Analyse an image for hidden data. Nothing uploaded.</h1>
        </div>
        <div className="stego-hero__copy">
          <p>{stegoAnalysisCopy.introduction}</p>
          <ul className="trust-markers" aria-label="Steganography analysis promises">
            {stegoAnalysisCopy.facts.map((fact) => <li key={fact}>{fact}</li>)}
          </ul>
        </div>
      </section>

      <div className="sr-only" role="status" aria-live="polite">{status}</div>

      <section className="stego-workspace" aria-labelledby="stego-choose-title">
        {!file ? (
          <div
            className={isDragging ? "stego-dropzone is-dragging" : "stego-dropzone"}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
            }}
            onDrop={handleDrop}
          >
            <p className="section-index">Local file selection</p>
            <h2 id="stego-choose-title">Choose an image or file to analyse</h2>
            <p>
              Bit planes and LSB extraction work with PNG, JPEG, WebP, BMP and GIF images up to{" "}
              {STEGO_ANALYSIS_LIMITS.maxWidth.toLocaleString("en-AU")} × {STEGO_ANALYSIS_LIMITS.maxHeight.toLocaleString("en-AU")} pixels.
              Strings, signatures and trailing-byte checks work with any file up to {STEGO_ANALYSIS_LIMITS.maxFileLabel}.
            </p>
            <button ref={chooserRef} className="button button--primary" type="button" onClick={openPicker}>
              Choose file
            </button>
            <input
              ref={inputRef}
              className="visually-hidden-input"
              type="file"
              onChange={handleInput}
              aria-label="Choose a file to analyse"
            />
            <small>The file is read on this device and is not sent to the site.</small>
          </div>
        ) : (
          <div className="stego-results">
            <header className="stego-results__header">
              <div>
                <p className="section-index">Selected locally</p>
                <h2 id="stego-choose-title" ref={resultsHeadingRef} tabIndex={-1}>{file.name}</h2>
                <p>
                  {formatBytes(file.size)}
                  {fileReport ? ` · ${fileReport.kind ? KIND_LABELS[fileReport.kind] : "Not a supported image"}` : ""}
                  {imageReport ? ` · ${imageReport.width} × ${imageReport.height} pixels` : ""}
                </p>
              </div>
              <div className="stego-results__actions">
                {phase === "loading" ? (
                  <button className="button button--quiet" type="button" onClick={cancelLoading}>Cancel</button>
                ) : (
                  <button className="button button--quiet" type="button" onClick={openPicker}>Choose another file</button>
                )}
                <button className="text-button text-button--danger" type="button" onClick={clear}>Clear</button>
                <input
                  ref={inputRef}
                  className="visually-hidden-input"
                  type="file"
                  onChange={handleInput}
                  aria-label="Choose another file to analyse"
                />
              </div>
            </header>

            {phase === "loading" ? <p className="stego-progress" role="status">Analysing the file in this browser…</p> : null}
            {phase === "error" || (ready && error) ? <p className="stego-error" role="alert">{error}</p> : null}

            {ready ? (
              <>
                <nav className="stego-jump" aria-label="Analysis sections">
                  <a href="#stego-planes">Bit planes</a>
                  <a href="#stego-extract">Extract bits</a>
                  <a href="#stego-bytes">File bytes</a>
                  <a href="#stego-facts">File facts</a>
                </nav>

                <section className="stego-panel" id="stego-planes" aria-labelledby="stego-planes-title">
                  <h3 id="stego-planes-title">Bit planes</h3>
                  {imageReport ? (
                    <>
                      <p className="stego-muted">
                        {imageReport.decoder === "exact-png"
                          ? "Pixels were read from the PNG data by this tool, without browser colour or transparency adjustments."
                          : ""}{" "}
                        {imageReport.notes.join(" ")}
                        {!imageReport.hasTransparency ? " The image is fully opaque, so alpha planes are blank." : ""}
                      </p>
                      {imageReport.sixteenBitByte ? (
                        <fieldset className="stego-sixteen">
                          <legend>16-bit samples</legend>
                          <label className="stego-check">
                            <input type="radio" name="stego-sixteen" disabled={reloading} checked={sixteenBitByte === "high"} onChange={() => void changeSixteenBitByte("high")} />
                            High byte (how the image looks)
                          </label>
                          <label className="stego-check">
                            <input type="radio" name="stego-sixteen" disabled={reloading} checked={sixteenBitByte === "low"} onChange={() => void changeSixteenBitByte("low")} />
                            Low byte (where least significant bits are stored)
                          </label>
                        </fieldset>
                      ) : null}
                      <div className="stego-plane-controls">
                        <button className="button button--quiet" type="button" onClick={() => movePlane(-1)} aria-label="Previous view">←</button>
                        <div className="stego-field">
                          <label htmlFor="stego-plane-select">View</label>
                          <select id="stego-plane-select" value={plane.id} onChange={(event) => setPlaneIndex(PLANE_DEFINITIONS.findIndex((item) => item.id === event.currentTarget.value))}>
                            {PLANE_DEFINITIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                          </select>
                        </div>
                        <button className="button button--quiet" type="button" onClick={() => movePlane(1)} aria-label="Next view">→</button>
                        <button className="button button--quiet" type="button" onClick={downloadPlane}>Download view as PNG</button>
                      </div>
                      <div
                        className="stego-viewer"
                        tabIndex={0}
                        role="group"
                        aria-roledescription="bit-plane viewer"
                        aria-label={`${plane.label}, view ${planeIndex + 1} of ${PLANE_DEFINITIONS.length}. Use the arrow keys to change view.`}
                        aria-describedby="stego-viewer-help"
                        onKeyDown={handleViewerKey}
                      >
                        <canvas ref={canvasRef} aria-hidden="true" />
                      </div>
                      <p className="stego-muted" id="stego-viewer-help">
                        <strong>{plane.label}</strong> · view {planeIndex + 1} of {PLANE_DEFINITIONS.length}. Focus the image and use ← → (or [ ]) to step through views, Home and End to jump.
                        White means the bit is 1. Patterns or text in a low plane can suggest hidden data; noise is normal and proves nothing either way.
                      </p>
                      {planeError ? <p className="stego-error" role="alert">{planeError}</p> : null}
                    </>
                  ) : (
                    <p className="stego-muted">{imageError ?? "This file is not a supported image."} The byte checks below still apply.</p>
                  )}
                </section>

                <section className="stego-panel" id="stego-extract" aria-labelledby="stego-extract-title">
                  <h3 id="stego-extract-title" ref={extractHeadingRef} tabIndex={-1}>Extract bits (LSB)</h3>
                  {imageReport ? (
                    <>
                      <p className="stego-muted">
                        Reads the chosen bits from every pixel and packs them into bytes. Selected channels are read in the chosen channel order, and bits from highest to lowest within each channel.
                        In zsteg terms, the defaults (R, G, B, bit 0, rows, MSB-first) match <code>b1,rgb,lsb,xy</code>; Columns matches <code>yx</code> and Rows from the bottom matches <code>xY</code>.
                        {imageReport.sixteenBitByte ? " For this 16-bit PNG, zsteg reads the low byte, so choose Low byte under Bit planes to match it." : ""}
                      </p>
                      <div className="stego-options">
                        <fieldset>
                          <legend>Channels</legend>
                          {CHANNELS.map((channel) => (
                            <label key={channel} className="stego-check">
                              <input type="checkbox" checked={channels.includes(channel)} onChange={() => setChannels((list) => toggle(list, channel))} />
                              {CHANNEL_LABELS[channel]}
                            </label>
                          ))}
                        </fieldset>
                        <fieldset>
                          <legend>Channel order</legend>
                          <label className="stego-check">
                            <input type="radio" name="stego-channel-order" checked={channelOrder === "rgba"} onChange={() => setChannelOrder("rgba")} />
                            R, G, B, A (most common)
                          </label>
                          <label className="stego-check">
                            <input type="radio" name="stego-channel-order" checked={channelOrder === "bgra"} onChange={() => setChannelOrder("bgra")} />
                            B, G, R, A
                          </label>
                          <label className="stego-check">
                            <input type="radio" name="stego-channel-order" checked={channelOrder === "abgr"} onChange={() => setChannelOrder("abgr")} />
                            A, B, G, R
                          </label>
                        </fieldset>
                        <fieldset>
                          <legend>Bits</legend>
                          {BIT_POSITIONS.map((bit) => (
                            <label key={bit} className="stego-check">
                              <input type="checkbox" checked={bits.includes(bit)} onChange={() => setBits((list) => toggle(list, bit))} />
                              {bit}
                            </label>
                          ))}
                        </fieldset>
                        <fieldset>
                          <legend>Pixel order</legend>
                          <label className="stego-check">
                            <input type="radio" name="stego-traversal" checked={traversal === "rows"} onChange={() => setTraversal("rows")} />
                            Rows (left to right, top to bottom)
                          </label>
                          <label className="stego-check">
                            <input type="radio" name="stego-traversal" checked={traversal === "columns"} onChange={() => setTraversal("columns")} />
                            Columns (top to bottom, left to right)
                          </label>
                          <label className="stego-check">
                            <input type="radio" name="stego-traversal" checked={traversal === "rows-bottom-up"} onChange={() => setTraversal("rows-bottom-up")} />
                            Rows from the bottom (BMP file order)
                          </label>
                        </fieldset>
                        <fieldset>
                          <legend>Bit packing</legend>
                          <label className="stego-check">
                            <input type="radio" name="stego-packing" checked={packing === "msb-first"} onChange={() => setPacking("msb-first")} />
                            MSB-first (most common)
                          </label>
                          <label className="stego-check">
                            <input type="radio" name="stego-packing" checked={packing === "lsb-first"} onChange={() => setPacking("lsb-first")} />
                            LSB-first
                          </label>
                        </fieldset>
                      </div>
                      <div className="stego-actions">
                        <button
                          className="button button--primary"
                          type="button"
                          onClick={() => void runExtraction()}
                          disabled={extracting || reloading || channels.length === 0 || bits.length === 0}
                        >
                          {extracting ? "Extracting…" : "Extract bits"}
                        </button>
                        {extracting ? <button className="button button--quiet" type="button" onClick={() => void cancelExtraction()}>Cancel</button> : null}
                        {reloading ? <span className="stego-muted" role="status">Reopening the file after cancelling…</span> : null}
                        {channels.length === 0 || bits.length === 0 ? <span className="stego-muted">Choose at least one channel and one bit.</span> : null}
                      </div>
                      {extractError ? <p className="stego-error" role="alert">{extractError}</p> : null}
                      {extraction ? (
                        <div className="stego-extraction" aria-labelledby="stego-extraction-title">
                          <h4 id="stego-extraction-title">Extracted bytes</h4>
                          <p className="stego-muted">
                            {extraction.description}: {extraction.bytes.byteLength.toLocaleString("en-AU")} bytes from {extraction.totalBits.toLocaleString("en-AU")} bits.
                            {extraction.truncated ? ` Output is limited to the first ${STEGO_ANALYSIS_LIMITS.maxExtractLabel}.` : ""}
                            {extraction.bytes.byteLength > STEGO_ANALYSIS_LIMITS.hexPreviewBytes ? ` The hex view shows the first ${formatBytes(STEGO_ANALYSIS_LIMITS.hexPreviewBytes)}.` : ""}
                          </p>
                          <div className="stego-actions">
                            <button
                              className="button button--quiet"
                              type="button"
                              onClick={() => downloadBytes(extraction.bytes, `${sanitiseSourceBase(file.name) ?? "image"}-lsb.bin`)}
                              disabled={extraction.bytes.byteLength === 0}
                            >
                              Download .bin
                            </button>
                          </div>
                          <HexView rows={extraction.preview} label="Extracted bytes as hex" />
                          <h5>Printable strings in the extracted bytes</h5>
                          <StringList scan={extraction.strings} label="Strings in extracted bytes" />
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="stego-muted">LSB extraction needs a decoded image.</p>
                  )}
                </section>

                <section className="stego-panel" id="stego-bytes" aria-labelledby="stego-bytes-title">
                  <h3 id="stego-bytes-title">File bytes</h3>
                  <h4>Data after the end of the image</h4>
                  {fileReport.trailing ? (
                    <div className="stego-callout" data-tone="warning">
                      <p>
                        <strong>{fileReport.trailing.length.toLocaleString("en-AU")} bytes</strong> follow the {fileReport.kind === "png" ? "PNG IEND chunk" : "JPEG EOI marker"} at offset {formatOffset(fileReport.trailing.offset)}.
                        {fileReport.trailing.signature ? ` They start with a ${fileReport.trailing.signature} signature.` : " They do not start with a recognised file signature."}
                        {" "}Image viewers ignore these bytes. Some software adds them legitimately.
                      </p>
                      <button className="button button--quiet" type="button" onClick={() => void downloadTrailing()}>Download trailing bytes</button>
                      <HexView rows={fileReport.trailing.preview} label="First trailing bytes as hex" />
                    </div>
                  ) : (
                    <p className="stego-muted">
                      {fileReport.kind === "png" || fileReport.kind === "jpeg"
                        ? fileReport.imageEndOffset === null
                          ? "The end of the image could not be found, so trailing data could not be checked. See the structure problems under File facts."
                          : `No bytes follow the ${fileReport.kind === "png" ? "IEND chunk" : "EOI marker"}.`
                        : "Trailing-data checks support PNG and JPEG files."}
                    </p>
                  )}

                  <h4>Embedded file signatures</h4>
                  {fileReport.signatures.total === 0 ? (
                    <p className="stego-muted">No known file signatures were found.</p>
                  ) : (
                    <>
                      <p className="stego-muted">
                        Byte patterns that match the start of a known file type. Short patterns can match by chance, especially inside compressed image data.
                        {fileReport.signatures.total > fileReport.signatures.matches.length ? ` Showing ${fileReport.signatures.matches.length} of ${fileReport.signatures.total}.` : ""}
                      </p>
                      <ul className="stego-list">
                        {fileReport.signatures.matches.map((match) => (
                          <li key={`${match.offset}-${match.name}`}><code>{formatOffset(match.offset)}</code> {match.name}</li>
                        ))}
                      </ul>
                    </>
                  )}

                  {bytesError ? <p className="stego-error" role="alert">{bytesError}</p> : null}
                  <h4>Printable strings in the file</h4>
                  <div className="stego-options stego-options--inline">
                    <div className="stego-field">
                      <label htmlFor="stego-min-length">Minimum length</label>
                      <select id="stego-min-length" disabled={reloading} value={minStringLength} onChange={(event) => void changeMinStringLength(Number(event.currentTarget.value))}>
                        {MIN_STRING_LENGTHS.map((length) => <option key={length} value={length}>{length} characters</option>)}
                      </select>
                    </div>
                    <div className="stego-field">
                      <label htmlFor="stego-string-filter">Filter listed strings</label>
                      <input id="stego-string-filter" type="search" value={stringFilter} onChange={(event) => setStringFilter(event.currentTarget.value)} placeholder="for example flag" />
                    </div>
                  </div>
                  {strings ? <StringList scan={strings} filter={stringFilter} label="Strings in the file" /> : null}
                </section>

                <section className="stego-panel" id="stego-facts" aria-labelledby="stego-facts-title">
                  <h3 id="stego-facts-title">File facts</h3>
                  <dl className="stego-facts">
                    <div><dt>Size</dt><dd>{fileReport.size.toLocaleString("en-AU")} bytes</dd></div>
                    <div><dt>Detected from contents</dt><dd>{fileReport.kind ? KIND_LABELS[fileReport.kind] : "Not a supported image signature"}</dd></div>
                    <div><dt>Type reported by the browser</dt><dd>{file.type || "None"}</dd></div>
                    <div>
                      <dt>Extension matches contents</dt>
                      <dd>{extensionMatches === null ? "Not applicable" : extensionMatches ? "Yes" : "No"}</dd>
                    </div>
                    {imageReport ? <div><dt>Pixel decoder</dt><dd>{imageReport.decoder === "exact-png" ? "Exact PNG decoder" : "Browser decoder"}</dd></div> : null}
                    {fileReport.png?.header ? (
                      <div>
                        <dt>PNG header</dt>
                        <dd>
                          {fileReport.png.header.width} × {fileReport.png.header.height}, colour type {fileReport.png.header.colourType}, {fileReport.png.header.bitDepth}-bit, {fileReport.png.header.interlace ? "Adam7 interlaced" : "not interlaced"}
                        </dd>
                      </div>
                    ) : null}
                    <div className="stego-facts__wide"><dt>SHA-256</dt><dd><code>{fileReport.sha256}</code></dd></div>
                  </dl>
                  {fileReport.png ? (
                    <details className="stego-details">
                      <summary>
                        PNG chunks ({fileReport.png.chunkCount.toLocaleString("en-AU")}
                        {fileReport.png.crcMismatches ? `, ${fileReport.png.crcMismatches} CRC mismatch${fileReport.png.crcMismatches === 1 ? "" : "es"}` : ""})
                      </summary>
                      <div className="stego-table-wrap" tabIndex={0} role="region" aria-label="PNG chunks">
                        <table>
                          <thead><tr><th scope="col">Offset</th><th scope="col">Type</th><th scope="col">Length</th><th scope="col">CRC</th></tr></thead>
                          <tbody>
                            {fileReport.png.chunks.map((chunk) => (
                              <tr key={chunk.offset}>
                                <td><code>{formatOffset(chunk.offset)}</code></td>
                                <td><code>{chunk.type}</code></td>
                                <td>{chunk.length.toLocaleString("en-AU")}</td>
                                <td>{chunk.crcOk ? "OK" : "Mismatch"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  ) : null}
                  {fileReport.jpeg ? (
                    <details className="stego-details">
                      <summary>JPEG markers ({fileReport.jpeg.markerCount.toLocaleString("en-AU")})</summary>
                      <div className="stego-table-wrap" tabIndex={0} role="region" aria-label="JPEG markers">
                        <table>
                          <thead><tr><th scope="col">Offset</th><th scope="col">Marker</th><th scope="col">Name</th><th scope="col">Length</th></tr></thead>
                          <tbody>
                            {fileReport.jpeg.markers.map((marker) => (
                              <tr key={marker.offset}>
                                <td><code>{formatOffset(marker.offset)}</code></td>
                                <td><code>{marker.marker}</code></td>
                                <td>{marker.name}</td>
                                <td>{marker.length ? marker.length.toLocaleString("en-AU") : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  ) : null}
                  {[...(fileReport.png?.problems ?? []), ...(fileReport.jpeg?.problems ?? [])].length ? (
                    <ul className="stego-list" aria-label="Structure problems">
                      {[...(fileReport.png?.problems ?? []), ...(fileReport.jpeg?.problems ?? [])].map((problem) => <li key={problem}>{problem}</li>)}
                    </ul>
                  ) : null}
                </section>
              </>
            ) : null}
          </div>
        )}
      </section>

      <section className="stego-explainer" aria-labelledby="stego-limits-title">
        <div className="section-heading">
          <p className="eyebrow">Read the results carefully</p>
          <h2 id="stego-limits-title">What this tool can and cannot tell you</h2>
        </div>
        <div className="stego-explainer__grid">
          <article>
            <h3>It shows patterns and extracts bits</h3>
            <p>
              Bit planes, LSB extraction and byte scans reveal common CTF and puzzle techniques. They cannot prove that an image does or does not contain hidden data,
              and they do not break encryption or decode tools such as steghide that use passwords.
            </p>
          </article>
          <article>
            <h3>8-bit PNG samples are exact; other formats depend on the browser</h3>
            <p>
              This tool reads PNG data itself, so 8-bit greyscale, RGB and RGBA samples are exactly as stored. 16-bit samples use the high or low byte you choose,
              low-bit-depth greyscale is scaled, and palette images show palette colours rather than index bits. JPEG, WebP, BMP and GIF pixels
              come from the browser&apos;s decoder, and JPEG is lossy, so low bits there rarely carry data.
            </p>
          </article>
          <article>
            <h3>Made with Hide message?</h3>
            <p>
              Messages created by this site&apos;s <Link to={routes.hideMessage}>Hide message</Link> tool use a binary header, a scattered bit order
              and optional password encryption, so raw LSB extraction will not show their text. Use its Reveal option to read them.
            </p>
          </article>
        </div>
      </section>

      <HelpfulGuides
        id="stego-guides"
        guideSlugs={["analyse-image-for-hidden-data", "reveal-hidden-message-from-image", "hide-message-in-image"]}
      />
      <ToolDirectory id="other-tools-title" currentPath={routes.stegoAnalysis} newTab />
    </main>
  );
}
