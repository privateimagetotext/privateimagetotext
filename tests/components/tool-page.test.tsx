import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ToolPage from "../../src/pages/ToolPage";
import { ocrSessionOverrides } from "../../src/features/ocr/content-session";

const contentMocks = vi.hoisted(() => ({ suggest: vi.fn() }));
vi.mock("../../src/features/ocr/content-defaults", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/features/ocr/content-defaults")>();
  return { ...actual, suggestContentDefaults: contentMocks.suggest };
});

const imageMocks = vi.hoisted(() => ({
  clearCanvas: vi.fn(),
  decodeImage: vi.fn(),
  readImageDimensions: vi.fn(),
  renderRecognitionTile: vi.fn(),
  renderWorkingImage: vi.fn(),
}));

const adapterMocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  dispose: vi.fn(),
  recognise: vi.fn(),
}));

const serviceWorkerMocks = vi.hoisted(() => ({
  prepareOfflineOcrAssets: vi.fn(),
  checkOfflineOcrAssets: vi.fn(),
  subscribeOfflineOcrStatus: vi.fn(() => () => undefined),
}));

vi.mock("../../src/features/image-editor/image", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/features/image-editor/image")>();
  return {
    ...actual,
    clearCanvas: imageMocks.clearCanvas,
    decodeImage: imageMocks.decodeImage,
    readImageDimensions: imageMocks.readImageDimensions,
    renderRecognitionTile: imageMocks.renderRecognitionTile,
    renderWorkingImage: imageMocks.renderWorkingImage,
  };
});

vi.mock("../../src/features/ocr/tesseract-adapter", () => ({
  LocalTesseractAdapter: class {
    cancel = adapterMocks.cancel;
    dispose = adapterMocks.dispose;
    recognise = adapterMocks.recognise;
  },
}));

vi.mock("../../src/lib/service-worker", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/lib/service-worker")>(),
  prepareOfflineOcrAssets: serviceWorkerMocks.prepareOfflineOcrAssets,
  checkOfflineOcrAssets: serviceWorkerMocks.checkOfflineOcrAssets,
  subscribeOfflineOcrStatus: serviceWorkerMocks.subscribeOfflineOcrStatus,
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function pngFile(name = "receipt.png", width = 800, height = 600) {
  const header = new Uint8Array(24);
  header.set(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d],
    0,
  );
  header.set(new TextEncoder().encode("IHDR"), 12);
  header.set(
    [
      (width >>> 24) & 0xff,
      (width >>> 16) & 0xff,
      (width >>> 8) & 0xff,
      width & 0xff,
      (height >>> 24) & 0xff,
      (height >>> 16) & 0xff,
      (height >>> 8) & 0xff,
      height & 0xff,
    ],
    16,
  );
  return new File(
    [header],
    name,
    { type: "image/png" },
  );
}

function renderTool(strict = false) {
  const tool = <MemoryRouter><ToolPage /></MemoryRouter>;
  const view = render(
    strict ? <StrictMode>{tool}</StrictMode> : tool,
  );
  const fileInput = view.container.querySelector<HTMLInputElement>(
    'input[type="file"]',
  );
  if (!fileInput) {
    throw new Error("The tool did not render its file input.");
  }
  return { ...view, fileInput };
}

async function ingestImage(
  user: ReturnType<typeof userEvent.setup>,
  fileInput: HTMLInputElement,
  name = "receipt.png",
) {
  await user.upload(fileInput, pngFile(name));
  await screen.findByText(name);
  await waitFor(() => expect(imageMocks.renderWorkingImage).toHaveBeenCalled());
  await screen.findByRole("textbox", { name: /Tidied/ });
}

beforeEach(() => {
  delete ocrSessionOverrides.contentMode;
  delete ocrSessionOverrides.preset;
  contentMocks.suggest.mockImplementation((_canvas, clipboard) => ({
    contentMode: clipboard ? "screenshot" : "document", preset: "original",
  }));
  Element.prototype.scrollIntoView = vi.fn();
  imageMocks.decodeImage.mockResolvedValue({
    source: {} as CanvasImageSource,
    width: 800,
    height: 600,
    close: vi.fn(),
  });
  imageMocks.renderRecognitionTile.mockImplementation(
    (
      _decoded: unknown,
      _transform: unknown,
      _crop: unknown,
      inputRect: { width: number; height: number },
      canvas: HTMLCanvasElement,
    ) => {
      canvas.width = inputRect.width;
      canvas.height = inputRect.height;
    },
  );
  imageMocks.readImageDimensions.mockResolvedValue({
    width: 800,
    height: 600,
  });
  imageMocks.renderWorkingImage.mockImplementation(
    async (_file: Blob, transform: { preset: string }) => {
      const enlarged = transform.preset === "adaptive-document";
      const canvas = document.createElement("canvas");
      canvas.width = enlarged ? 1_600 : 800;
      canvas.height = enlarged ? 1_200 : 600;
      return {
        canvas,
        width: canvas.width,
        height: canvas.height,
        metadata: {
          scale: enlarged ? 2 : 1,
          scaleAction: enlarged ? "enlarged" : "original",
          profile: transform.preset,
          thresholdingMethod: enlarged ? 2 : 0,
          polarityInverted: false,
          sourceWidth: 800,
          sourceHeight: 600,
          preparedWidth: canvas.width,
          preparedHeight: canvas.height,
        },
      };
    },
  );
  adapterMocks.cancel.mockResolvedValue(undefined);
  adapterMocks.dispose.mockResolvedValue(undefined);
  adapterMocks.recognise.mockResolvedValue({
    text: "Recognised text",
    confidence: 94,
    rotateRadians: 0,
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:local-image"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

describe("ToolPage", () => {
  it("loads the bundled sample through file admission, applies defaults and auto-runs exactly once", async () => {
    const fetchSample = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, blob: async () => pngFile("sample.png", 900, 400),
    } as unknown as Response);
    contentMocks.suggest.mockReturnValue({ contentMode: "document", preset: "adaptive-document" });
    const user = userEvent.setup();
    const { fileInput } = renderTool(true);
    await user.click(screen.getByRole("button", { name: "Try a sample" }));
    await screen.findByRole("textbox", { name: /Tidied/ });
    expect(fetchSample).toHaveBeenCalledWith("/samples/sample.png");
    expect(screen.getByText("sample.png (bundled with this site)")).toBeVisible();
    expect(imageMocks.readImageDimensions).toHaveBeenCalledWith(expect.objectContaining({ name: "sample.png", type: "image/png" }));
    expect(contentMocks.suggest).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), false);
    expect(imageMocks.renderWorkingImage.mock.calls.map((call) => call[1].preset)).toEqual(["original", "adaptive-document"]);
    expect(adapterMocks.recognise).toHaveBeenCalledTimes(1);
    expect(adapterMocks.recognise).toHaveBeenCalledWith(expect.any(HTMLCanvasElement),
      expect.objectContaining({ contentMode: "document", thresholdingMethod: 2 }), expect.any(Function));

    // A user file with the same name must never inherit bundled provenance.
    await ingestImage(user, fileInput, "sample.png");
    expect(screen.queryByText(/bundled with this site/)).not.toBeInTheDocument();
  });

  it("honours manual session defaults when trying the sample", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, blob: async () => pngFile() } as unknown as Response);
    ocrSessionOverrides.contentMode = "code";
    ocrSessionOverrides.preset = "high-contrast";
    const user = userEvent.setup();
    renderTool();
    await user.click(screen.getByRole("button", { name: "Try a sample" }));
    await screen.findByRole("textbox", { name: /Tidied/ });
    expect(screen.getByLabelText(/Content type/)).toHaveValue("code");
    expect(screen.getByLabelText(/Enhancement/)).toHaveValue("high-contrast");
    expect(adapterMocks.recognise).toHaveBeenCalledTimes(1);
  });

  it.each(["network", "http", "invalid-image"])("allows retry after a %s sample failure", async (failure) => {
    const fetchSample = vi.spyOn(globalThis, "fetch");
    if (failure === "network") fetchSample.mockRejectedValueOnce(new TypeError("Offline"));
    else fetchSample.mockResolvedValueOnce({
      ok: failure !== "http", blob: async () => new Blob(["not an image"], { type: "text/html" }),
    } as Response);
    fetchSample.mockResolvedValue({ ok: true, blob: async () => pngFile() } as unknown as Response);
    const user = userEvent.setup();
    renderTool();
    const sample = screen.getByRole("button", { name: "Try a sample" });
    await user.click(sample);
    await waitFor(() => expect(sample).toBeEnabled());
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(adapterMocks.recognise).not.toHaveBeenCalled();
    await user.click(sample);
    await screen.findByRole("textbox", { name: /Tidied/ });
    expect(adapterMocks.recognise).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores a pending sample response after leaving the page", async () => {
    const response = deferred<Response>();
    vi.spyOn(globalThis, "fetch").mockReturnValue(response.promise);
    const user = userEvent.setup();
    renderTool();
    const sample = screen.getByRole("button", { name: "Try a sample" });
    await user.click(sample);
    expect(sample).toBeDisabled();
    fireEvent(window, new Event("pagehide"));
    await act(async () => response.resolve({ ok: true, blob: async () => pngFile() } as unknown as Response));
    expect(screen.queryByText(/bundled with this site/)).not.toBeInTheDocument();
    expect(imageMocks.readImageDimensions).not.toHaveBeenCalled();
    expect(adapterMocks.recognise).not.toHaveBeenCalled();
    expect(sample).toBeEnabled();
  });

  it("applies a photo suggestion and finishes enhanced preparation before exactly one OCR run", async () => {
    contentMocks.suggest.mockReturnValue({ contentMode: "document", preset: "adaptive-document" });
    const user = userEvent.setup();
    const { fileInput } = renderTool(true);
    await ingestImage(user, fileInput, "phone.jpg.png");
    expect(screen.getByLabelText(/Enhancement/)).toHaveValue("adaptive-document");
    expect(screen.getByRole("option", { name: "Document (suggested)" })).toBeInTheDocument();
    expect(imageMocks.renderWorkingImage.mock.calls.map((call) => call[1].preset)).toEqual(["original", "adaptive-document"]);
    expect(contentMocks.suggest).toHaveBeenCalledTimes(1);
    expect(adapterMocks.recognise).toHaveBeenCalledTimes(1);
    expect(adapterMocks.recognise).toHaveBeenCalledWith(expect.any(HTMLCanvasElement),
      expect.objectContaining({ contentMode: "document", thresholdingMethod: 2 }), expect.any(Function));
  });

  it("keeps manual choices across replacement, Clear and remount without storing them", async () => {
    const localWrite = vi.spyOn(Storage.prototype, "setItem");
    const user = userEvent.setup();
    const view = renderTool();
    await ingestImage(user, view.fileInput);
    await user.selectOptions(screen.getByLabelText(/Content type/), "code");
    await user.selectOptions(screen.getByLabelText(/Enhancement/), "high-contrast");
    expect(screen.queryByRole("option", { name: /suggested/ })).not.toBeInTheDocument();
    fireEvent.paste(document, { clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => pngFile() }] } });
    await screen.findByRole("textbox", { name: /Tidied/ });
    expect(screen.getByLabelText(/Content type/)).toHaveValue("code");
    expect(screen.getByLabelText(/Enhancement/)).toHaveValue("high-contrast");
    await user.click(screen.getAllByRole("button", { name: "Clear" })[0]);
    contentMocks.suggest.mockReturnValue({ contentMode: "document", preset: "adaptive-document" });
    await ingestImage(user, view.fileInput, "new-photo.png");
    expect(screen.getByLabelText(/Content type/)).toHaveValue("code");
    expect(screen.getByLabelText(/Enhancement/)).toHaveValue("high-contrast");
    view.unmount();
    const remount = renderTool();
    await ingestImage(user, remount.fileInput);
    expect(screen.getByLabelText(/Content type/)).toHaveValue("code");
    expect(screen.getByLabelText(/Enhancement/)).toHaveValue("high-contrast");
    expect(localWrite).not.toHaveBeenCalled();
  });

  it("re-suggests for each new image but never on crop, rotation or enhancement rerenders", async () => {
    contentMocks.suggest.mockReturnValueOnce({ contentMode: "screenshot", preset: "original" })
      .mockReturnValue({ contentMode: "document", preset: "adaptive-document" });
    const user = userEvent.setup();
    const { fileInput } = renderTool();
    await ingestImage(user, fileInput);
    expect(screen.getByLabelText(/Content type/)).toHaveValue("screenshot");
    await user.click(screen.getByRole("button", { name: /Rotate right/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Re-run OCR" })).toBeEnabled());
    expect(contentMocks.suggest).toHaveBeenCalledTimes(1);
    await ingestImage(user, fileInput, "next.png");
    expect(screen.getByLabelText(/Content type/)).toHaveValue("document");
    expect(screen.getByLabelText(/Enhancement/)).toHaveValue("adaptive-document");
    expect(contentMocks.suggest).toHaveBeenCalledTimes(2);
  });

  it("retains clipboard provenance through the large-image confirmation", async () => {
    imageMocks.readImageDimensions.mockResolvedValue({ width: 5000, height: 1000 });
    const user = userEvent.setup();
    renderTool();
    fireEvent.paste(document, { clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => pngFile("large.png", 5000, 1000) }] } });
    await user.click(await screen.findByRole("button", { name: "Use reduced preview" }));
    await screen.findByRole("textbox", { name: /Tidied/ });
    expect(screen.getByLabelText(/Content type/)).toHaveValue("screenshot");
    expect(adapterMocks.recognise).toHaveBeenCalledTimes(1);
  });

  it("classifies pending batch images before OCR and retains their suggestions when switching", async () => {
    contentMocks.suggest.mockReturnValueOnce({ contentMode: "screenshot", preset: "original" })
      .mockReturnValue({ contentMode: "document", preset: "adaptive-document" });
    const user = userEvent.setup();
    const { fileInput } = renderTool();
    await user.upload(fileInput, [pngFile("screen.png"), pngFile("photo.png")]);
    await waitFor(() => expect(screen.getByLabelText(/Content type/)).toHaveValue("screenshot"));
    await user.click(screen.getByRole("button", { name: "Process pending images" }));
    await screen.findByText(/Batch finished\. 2 completed/);
    expect(adapterMocks.recognise.mock.calls.map((call) => call[1].contentMode)).toEqual(["screenshot", "document"]);
    expect(adapterMocks.recognise.mock.calls.map((call) => call[1].thresholdingMethod)).toEqual([0, 2]);
    await user.click(screen.getByRole("button", { name: /2\. photo.png/ }));
    expect(screen.getByLabelText(/Enhancement/)).toHaveValue("adaptive-document");
    expect(screen.getByRole("option", { name: "Document (suggested)" })).toBeInTheDocument();
    expect(contentMocks.suggest).toHaveBeenCalledTimes(2);
  });

  it.each(["choose", "drop", "paste"])("auto-runs once per new image through %s, including StrictMode", async (method) => {
    const user = userEvent.setup();
    const { fileInput } = renderTool(true);
    const file = pngFile("first.png");
    if (method === "choose") await user.upload(fileInput, file);
    if (method === "drop") fireEvent.drop(screen.getByText("Add an image").closest(".dropzone")!, { dataTransfer: { files: [file] } });
    if (method === "paste") fireEvent.paste(document, { clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] } });
    await screen.findByRole("textbox", { name: /Tidied/ });
    expect(adapterMocks.recognise).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/Content type/)).toHaveValue(method === "paste" ? "screenshot" : "document");
    await user.click(screen.getByRole("button", { name: "Original OCR" }));
    expect(adapterMocks.recognise).toHaveBeenCalledTimes(1);
    await user.upload(fileInput, pngFile("second.png"));
    await screen.findByRole("textbox", { name: /Tidied/ });
    expect(adapterMocks.recognise).toHaveBeenCalledTimes(2);
  });

  it.each(["crop", "rotate", "enhancement", "content", "reset"])("%s exposes an explicit rerun without starting OCR", async (setting) => {
    const user = userEvent.setup();
    const { fileInput } = renderTool();
    await ingestImage(user, fileInput);
    if (setting === "crop") {
      await user.click(screen.getByRole("button", { name: "Crop" }));
      await user.click(screen.getByRole("button", { name: "Apply crop" }));
    }
    if (setting === "rotate") await user.click(screen.getByRole("button", { name: /Rotate right/ }));
    if (setting === "enhancement") await user.selectOptions(screen.getByLabelText(/Enhancement/), "high-contrast");
    if (setting === "content") await user.selectOptions(screen.getByLabelText(/Content type/), "code");
    if (setting === "reset") await user.click(screen.getByRole("button", { name: "Reset changes" }));
    const rerun = screen.getByRole("button", { name: "Re-run OCR" });
    await waitFor(() => expect(rerun).toBeEnabled());
    expect(adapterMocks.recognise).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Copy text" })).not.toBeInTheDocument();
    await user.click(rerun);
    await screen.findByRole("textbox", { name: /Tidied/ });
    expect(adapterMocks.recognise).toHaveBeenCalledTimes(2);
  });

  it("replacement cancels the initial run and ignores late text and progress", async () => {
    const user = userEvent.setup();
    const first = deferred<{ text: string; confidence: number; rotateRadians: number }>();
    const second = deferred<{ text: string; confidence: number; rotateRadians: number }>();
    let staleProgress!: (progress: { stage: string; value: number }) => void;
    adapterMocks.recognise.mockImplementationOnce((_canvas, _request, progress) => {
      staleProgress = progress;
      return first.promise;
    }).mockReturnValueOnce(second.promise);
    const { fileInput } = renderTool();
    await user.upload(fileInput, pngFile("first.png"));
    await waitFor(() => expect(adapterMocks.recognise).toHaveBeenCalledTimes(1));
    const disposals = adapterMocks.dispose.mock.calls.length;
    expect(screen.getByRole("button", { name: "Replace" })).toBeEnabled();
    await user.upload(fileInput, pngFile("second.png"));
    await waitFor(() => expect(adapterMocks.recognise).toHaveBeenCalledTimes(2));
    expect(adapterMocks.dispose.mock.calls.length).toBeGreaterThan(disposals);
    await act(async () => {
      staleProgress({ stage: "Stale progress", value: 0.9 });
      first.resolve({ text: "Stale text", confidence: 99, rotateRadians: 0 });
    });
    expect(screen.queryByText("Stale progress")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Stale text")).not.toBeInTheDocument();
    await act(async () => { second.resolve({ text: "Replacement text", confidence: 90, rotateRadians: 0 }); });
    expect(await screen.findByRole("textbox", { name: /Tidied/ })).toHaveValue("Replacement text");
    expect(adapterMocks.recognise).toHaveBeenCalledTimes(2);
  });

  it.each(["Clear", "pagehide", "unmount"])("%s prevents an automatic run from restoring private content", async (action) => {
    const user = userEvent.setup();
    const pending = deferred<{ text: string; confidence: number; rotateRadians: number }>();
    adapterMocks.recognise.mockReturnValueOnce(pending.promise);
    const view = renderTool();
    await user.upload(view.fileInput, pngFile());
    await waitFor(() => expect(adapterMocks.recognise).toHaveBeenCalledTimes(1));
    adapterMocks.dispose.mockClear();
    imageMocks.clearCanvas.mockClear();
    if (action === "Clear") await user.click(screen.getByRole("button", { name: "Clear" }));
    if (action === "pagehide") fireEvent(window, new Event("pagehide"));
    if (action === "unmount") view.unmount();
    await act(async () => { pending.resolve({ text: "Late private text", confidence: 90, rotateRadians: 0 }); });
    expect(adapterMocks.dispose).toHaveBeenCalled();
    expect(imageMocks.clearCanvas).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(screen.queryByDisplayValue("Late private text")).not.toBeInTheDocument();
    expect(screen.queryByText("receipt.png")).not.toBeInTheDocument();
    expect(adapterMocks.recognise).toHaveBeenCalledTimes(1);
  });

  it("starts large-image OCR only after the existing confirmation", async () => {
    const user = userEvent.setup();
    imageMocks.readImageDimensions.mockResolvedValue({ width: 5000, height: 3000 });
    const { fileInput } = renderTool();
    await user.upload(fileInput, pngFile("large.png", 5000, 3000));
    const proceed = await screen.findByRole("button", { name: "Use reduced preview" });
    expect(adapterMocks.recognise).not.toHaveBeenCalled();
    await user.click(proceed);
    await screen.findByRole("textbox", { name: /Tidied/ });
    expect(adapterMocks.recognise).toHaveBeenCalledTimes(1);
  });

  it("stops automatic preparation cleanly when the preview fails", async () => {
    const user = userEvent.setup();
    imageMocks.renderWorkingImage.mockRejectedValueOnce(new Error("No canvas"));
    const { fileInput } = renderTool();
    await user.upload(fileInput, pngFile());
    expect(await screen.findByRole("alert")).toHaveTextContent("The local preview could not be rendered");
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(adapterMocks.recognise).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText(/Enhancement/), "high-contrast");
    const rerun = screen.getByRole("button", { name: "Re-run OCR" });
    await waitFor(() => expect(rerun).toBeEnabled());
    expect(adapterMocks.recognise).not.toHaveBeenCalled();
    await user.click(rerun);
    await screen.findByRole("textbox", { name: /Tidied/ });
    expect(adapterMocks.recognise).toHaveBeenCalledTimes(1);
  });

  it("pagehide invalidates a clipboard permission request before it can auto-run", async () => {
    const user = userEvent.setup();
    const pending = deferred<ClipboardItem[]>();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { read: () => pending.promise } });
    renderTool();
    await user.click(screen.getByRole("button", { name: "Paste image" }));
    fireEvent(window, new Event("pagehide"));
    await act(async () => {
      pending.resolve([{ types: ["image/png"], getType: async () => pngFile() } as unknown as ClipboardItem]);
    });
    expect(imageMocks.readImageDimensions).not.toHaveBeenCalled();
    expect(adapterMocks.recognise).not.toHaveBeenCalled();
  });

  it.runIf(__PDF_OCR_PUBLIC__).each(["replacement", "mixed batch"])("hands off a PDF %s without losing the current image or edits", async (selection) => {
    const user = userEvent.setup({ applyAccept: false });
    const { fileInput } = renderTool();
    await ingestImage(user, fileInput, "keep.png");
    await screen.findByRole("textbox", { name: /Tidied/ });
    await user.click(screen.getByRole("button", { name: "Edit this version" }));
    const editor = screen.getByRole("textbox", { name: /Your edits/ });
    await user.clear(editor);
    await user.type(editor, "Keep these corrected image results");
    const decodeCount = imageMocks.readImageDimensions.mock.calls.length;
    const disposeCount = adapterMocks.dispose.mock.calls.length;
    const objectUrlCount = vi.mocked(URL.createObjectURL).mock.calls.length;
    const pdf = new File(["%PDF-1.7"], selection === "replacement" ? "document.pdf" : "document.PDF",
      { type: selection === "replacement" ? "application/pdf" : "" });
    if (selection === "replacement") await user.upload(fileInput, pdf);
    else await user.upload(screen.getByLabelText("Add images to batch"), [pngFile("not-added.png"), pdf]);

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("No files from this selection were added.");
    await waitFor(() => expect(notice).toHaveFocus());
    const link = within(notice).getByRole("link", { name: "Open PDF to text (opens in a new tab)" });
    expect(link).toHaveAttribute("href", "/pdf-to-text");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("keep.png", { exact: true })).toBeVisible();
    expect(editor).toHaveValue("Keep these corrected image results");
    expect(imageMocks.readImageDimensions).toHaveBeenCalledTimes(decodeCount);
    expect(adapterMocks.dispose).toHaveBeenCalledTimes(disposeCount);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(objectUrlCount);
    expect(screen.queryByRole("region", { name: "Image batch" })).not.toBeInTheDocument();
    await user.click(within(notice).getByRole("button", { name: "Dismiss PDF notice" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(editor).toHaveValue("Keep these corrected image results");
  });

  it("clears and removes the clipboard fallback even when copying throws", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    const originalExecCommand = document.execCommand;
    let fallback: HTMLTextAreaElement | null = null;
    document.execCommand = vi.fn(() => {
      fallback = document.body.querySelector<HTMLTextAreaElement>(".clipboard-fallback");
      throw new Error("Clipboard unavailable");
    });
    try {
      const { fileInput } = renderTool();
      await ingestImage(user, fileInput);
      await screen.findByRole("textbox", { name: /Tidied/ });
      await user.click(screen.getByRole("button", { name: "Copy text" }));
      expect(await screen.findByText(/The browser could not copy the text/)).toBeInTheDocument();
      const createdFallback = fallback as HTMLTextAreaElement | null;
      expect(createdFallback).not.toBeNull();
      expect(createdFallback?.value).toBe("");
      expect(createdFallback?.isConnected).toBe(false);
      expect(createdFallback?.spellcheck).toBe(false);
      expect(createdFallback?.autocomplete).toBe("off");
      expect(createdFallback?.getAttribute("autocorrect")).toBe("off");
      expect(createdFallback?.getAttribute("autocapitalize")).toBe("off");
      expect(document.body.querySelector(".clipboard-fallback")).toBeNull();
      expect(screen.getByRole("textbox", { name: /Tidied/ })).toHaveValue("Recognised text");
    } finally {
      document.execCommand = originalExecCommand;
    }
  });

  it("blocks batch intake while a replacement image is still being decoded", async () => {
    const user = userEvent.setup();
    const { fileInput } = renderTool();
    await ingestImage(user, fileInput, "original.png");
    const dimensions = deferred<{ width: number; height: number }>();
    imageMocks.readImageDimensions.mockReturnValueOnce(dimensions.promise);
    await user.upload(fileInput, pngFile("replacement.png"));
    expect(screen.getByRole("button", { name: "Add to batch" })).toBeDisabled();
    expect(screen.getByLabelText("Add images to batch")).toBeDisabled();
    await user.upload(screen.getByLabelText("Add images to batch"), pngFile("not-added.png"));
    await act(async () => { dimensions.resolve({ width: 800, height: 600 }); });
    await screen.findByText("replacement.png", { exact: true });
    expect(screen.queryByRole("region", { name: "Image batch" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to batch" })).toBeEnabled();
  });

  it.each([false, true])("retains edits made during async batch intake (already queued: %s)", async (alreadyQueued) => {
    const user = userEvent.setup();
    const { fileInput } = renderTool();
    if (alreadyQueued) {
      await user.upload(fileInput, [pngFile("first.png"), pngFile("existing.png")]);
      await screen.findByRole("region", { name: "Image batch" });
      await user.click(await screen.findByRole("button", { name: "Re-run OCR" }));
    } else {
      await ingestImage(user, fileInput, "first.png");
    }
    await screen.findByRole("textbox", { name: /Tidied/ });
    await user.click(screen.getByRole("button", { name: "Edit this version" }));
    const editor = screen.getByRole("textbox", { name: /Your edits/ });
    expect(editor).toHaveAttribute("spellcheck", "false");
    expect(editor).toHaveAttribute("autocomplete", "off");
    expect(editor).toHaveAttribute("autocorrect", "off");
    expect(editor).toHaveAttribute("autocapitalize", "off");
    await user.clear(editor);
    await user.type(editor, "Before intake");

    const dimensions = deferred<{ width: number; height: number }>();
    imageMocks.readImageDimensions.mockReturnValueOnce(dimensions.promise);
    const readCount = imageMocks.readImageDimensions.mock.calls.length;
    await user.upload(screen.getByLabelText("Add images to batch"), pngFile("added.png"));
    await waitFor(() => expect(imageMocks.readImageDimensions).toHaveBeenCalledTimes(readCount + 1));
    expect(screen.getByRole("button", { name: "Cancel adding images" })).toBeVisible();
    await user.clear(editor);
    await user.type(editor, "Corrected while validation was pending");
    await act(async () => { dimensions.resolve({ width: 800, height: 600 }); });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel adding images" })).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /1\. first.png Complete/ }));
    expect(screen.getByRole("textbox", { name: /Your edits/ })).toHaveValue("Corrected while validation was pending");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    await user.click(screen.getByRole("button", { name: "Download text for first.png" }));
    const exportedBlob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)?.[0] as Blob;
    expect(await exportedBlob.text()).toBe("Corrected while validation was pending");
    await user.click(screen.getByRole("button", { name: /added.png Ready/ }));
    await user.click(screen.getByRole("button", { name: /1\. first.png Complete/ }));
    expect(screen.getByRole("textbox", { name: /Your edits/ })).toHaveValue("Corrected while validation was pending");
  });

  it("runs a batch sequentially and retains per-image corrections while switching", async () => {
    const user = userEvent.setup();
    const first = deferred<{ text: string; confidence: number; rotateRadians: number }>();
    adapterMocks.recognise.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ text: "Second result", confidence: 90, rotateRadians: 0 });
    const { fileInput } = renderTool();
    await user.upload(fileInput, [pngFile("first.png"), pngFile("second.png")]);
    await screen.findByRole("region", { name: "Image batch" });
    await user.click(screen.getByRole("button", { name: "Process pending images" }));
    await waitFor(() => expect(adapterMocks.recognise).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: /2\. second.png/ })).toBeDisabled();
    await act(async () => { first.resolve({ text: "First result", confidence: 90, rotateRadians: 0 }); });
    await waitFor(() => expect(adapterMocks.recognise).toHaveBeenCalledTimes(2));
    await screen.findByText(/Batch finished\. 2 completed/);
    await user.click(screen.getByRole("button", { name: "Edit this version" }));
    const editor = screen.getByRole("textbox", { name: /Your edits/ });
    await user.clear(editor);
    await user.type(editor, "Corrected first result");
    await user.click(screen.getByRole("button", { name: /2\. second.png/ }));
    expect(await screen.findByRole("textbox", { name: /Tidied/ })).toHaveValue("Second result");
    await user.click(screen.getByRole("button", { name: /1\. first.png/ }));
    expect(await screen.findByRole("textbox", { name: /Your edits/ })).toHaveValue("Corrected first result");
    expect(screen.getByRole("button", { name: "Combined text .txt" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Separate text files .zip" })).toBeEnabled();
  });

  it("cancels a batch without losing a completed result or starting later images", async () => {
    const user = userEvent.setup();
    const second = deferred<{ text: string; confidence: number; rotateRadians: number }>();
    adapterMocks.recognise.mockResolvedValueOnce({ text: "Keep this result", confidence: 90, rotateRadians: 0 }).mockReturnValueOnce(second.promise);
    const { fileInput } = renderTool();
    await user.upload(fileInput, [pngFile("one.png"), pngFile("two.png"), pngFile("three.png")]);
    await screen.findByRole("region", { name: "Image batch" });
    await user.click(screen.getByRole("button", { name: "Process pending images" }));
    await waitFor(() => expect(adapterMocks.recognise).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("textbox", { name: /Tidied/ })).toHaveValue("Keep this result");
    await act(async () => { second.resolve({ text: "Late cancelled result", confidence: 90, rotateRadians: 0 }); });
    expect(adapterMocks.recognise).toHaveBeenCalledTimes(2);
    expect(screen.queryByDisplayValue("Late cancelled result")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2\. two.png Ready/ })).toBeEnabled();
  });

  it("supports queue order/removal and rejects over-limit intake before decoding", async () => {
    const user = userEvent.setup();
    const { fileInput } = renderTool();
    await user.upload(fileInput, Array.from({ length: 11 }, (_, i) => pngFile(`${i}.png`)));
    expect(await screen.findByRole("alert")).toHaveTextContent("up to 10 images");
    expect(imageMocks.readImageDimensions).not.toHaveBeenCalled();
    await user.upload(fileInput, [pngFile("first.png"), pngFile("second.png")]);
    await screen.findByRole("button", { name: /2\. second.png/ });
    await user.click(screen.getByRole("button", { name: "Move second.png up" }));
    expect(screen.getByRole("button", { name: /1\. second.png/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove first.png" }));
    expect(screen.queryByRole("button", { name: /first.png/ })).not.toBeInTheDocument();
    expect(screen.getByText("second.png", { exact: true })).toBeInTheDocument();
  });

  it("records an image failure without stopping later images", async () => {
    const user = userEvent.setup();
    adapterMocks.recognise.mockRejectedValueOnce(new Error("Worker failed"))
      .mockResolvedValueOnce({ text: "Second still succeeded", confidence: 90, rotateRadians: 0 });
    const { fileInput } = renderTool();
    await user.upload(fileInput, [pngFile("failed.png"), pngFile("good.png")]);
    await screen.findByRole("region", { name: "Image batch" });
    await user.click(screen.getByRole("button", { name: "Process pending images" }));
    await screen.findByText(/Batch finished\. 1 completed, 1 failed/);
    expect(screen.getByRole("button", { name: /1\. failed.png Needs attention/ })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /2\. good.png Complete/ }));
    expect(screen.getByRole("textbox", { name: /Tidied/ })).toHaveValue("Second still succeeded");
  });

  it("does not let an old cancelled batch stop a newly started batch", async () => {
    const user = userEvent.setup();
    const stale = deferred<{ text: string; confidence: number; rotateRadians: number }>();
    const fresh = deferred<{ text: string; confidence: number; rotateRadians: number }>();
    adapterMocks.recognise.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
    const { fileInput } = renderTool();
    await user.upload(fileInput, [pngFile("one.png"), pngFile("two.png")]);
    await screen.findByRole("region", { name: "Image batch" });
    await user.click(screen.getByRole("button", { name: "Process pending images" }));
    await waitFor(() => expect(adapterMocks.recognise).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Process pending images" }));
    await waitFor(() => expect(adapterMocks.recognise).toHaveBeenCalledTimes(2));
    await act(async () => { stale.resolve({ text: "discarded", confidence: 90, rotateRadians: 0 }); });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    await act(async () => { fresh.resolve({ text: "fresh result", confidence: 90, rotateRadians: 0 }); });
    await screen.findByText(/Batch finished\. 2 completed/);
    expect(screen.getByRole("textbox", { name: /Tidied/ })).toHaveValue("fresh result");
    expect(adapterMocks.recognise).toHaveBeenCalledTimes(3);
  });

  it("loads an explicit same-origin sample and runs actual recognition flow", async () => {
    contentMocks.suggest.mockReturnValue({ contentMode: "screenshot", preset: "original" });
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, blob: async () => pngFile("sample.png") } as unknown as Response);
    renderTool();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Terminal" }));
    expect(fetchMock).toHaveBeenCalledWith("/samples/code-terminal.png");
    expect(await screen.findByRole("textbox", { name: /Tidied/ })).toHaveValue("Recognised text");
    expect(adapterMocks.recognise).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), expect.objectContaining({ contentMode: "screenshot", includeWords: true }), expect.any(Function));
    expect(adapterMocks.recognise).toHaveBeenCalledTimes(1);
  });

  it("links uncertain words to source geometry and applies region suggestions only on request", async () => {
    const user = userEvent.setup();
    adapterMocks.recognise.mockResolvedValueOnce({ text: "Hella world", confidence: 70, rotateRadians: 0, words: [
      { text: "Hella", confidence: 50, bbox: { x0: 30, y0: 40, x1: 110, y1: 65 }, blockIndex: 0, paragraphIndex: 0, lineIndex: 0, wordIndex: 0 },
      { text: "world", confidence: 95, bbox: { x0: 120, y0: 40, x1: 200, y1: 65 }, blockIndex: 0, paragraphIndex: 0, lineIndex: 0, wordIndex: 1 },
    ] }).mockResolvedValueOnce({ text: "Hello", confidence: 90, rotateRadians: 0 });
    const { fileInput } = renderTool();
    await ingestImage(user, fileInput);
    await screen.findByRole("textbox", { name: /Tidied/ });
    await user.click(screen.getByText(/Review words against the image/));
    await user.click(screen.getByRole("checkbox", { name: "Show uncertain words only" }));
    expect(screen.queryByRole("button", { name: "world" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hella" }));
    expect(screen.getByRole("img", { name: /Original source region/ }).querySelector("rect")).toHaveAttribute("x", "30");
    await user.click(screen.getByRole("button", { name: "Rerun selected region" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: /Correction for/ })).toHaveValue("Hello"));
    expect(screen.getByRole("textbox", { name: /Tidied/ })).toHaveValue("Hella world");
    await user.click(screen.getByRole("button", { name: "Apply correction" }));
    expect(screen.getByRole("textbox", { name: /Your edits/ })).toHaveValue("Hello world");
    await user.click(screen.getByRole("button", { name: "Original OCR" }));
    expect(screen.getByRole("textbox", { name: /Original OCR/ })).toHaveValue("Hella world");
  });
  it("starts with an empty, local-only workspace", () => {
    renderTool();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Extract text from images. Nothing uploaded.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/Turn screenshots, photos and scans into editable text in your browser/i),
    ).toHaveLength(2); // CSS exposes one placement per viewport; covered in browser checks.
    expect(
      screen.getByRole("button", { name: "Paste image" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Choose image" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("heading", {
        name: "Your editable result will appear here",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /re-run ocr/i }),
    ).not.toBeInTheDocument();
  });

  it("rejects a file whose contents are not a supported raster image", async () => {
    const user = userEvent.setup();
    const { fileInput } = renderTool();
    const disguisedText = new File(["not an image"], "fake.png", {
      type: "image/png",
    });

    await user.upload(fileInput, disguisedText);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The file contents are not a supported raster image",
    );
    expect(imageMocks.readImageDimensions).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("rejects oversized encoded dimensions before invoking the browser decoder", async () => {
    const user = userEvent.setup();
    const { fileInput } = renderTool();

    await user.upload(fileInput, pngFile("oversized.png", 6_001, 6_000));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "exceeds the 36-megapixel safety limit",
    );
    expect(imageMocks.readImageDimensions).not.toHaveBeenCalled();
  });

  it("ingests an image, applies controls, and clears all workspace state", async () => {
    const user = userEvent.setup();
    const { fileInput } = renderTool();

    await ingestImage(user, fileInput);
    expect(screen.getByText("800 × 600px")).toBeInTheDocument();
    expect(
      screen.getByText("800 × 600px · original scale"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crop" })).toBeEnabled();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /enhancement/i }),
      "high-contrast",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: /content type/i }),
      "columns",
    );
    await user.click(screen.getByRole("button", { name: /rotate right/i }));

    await waitFor(() =>
      expect(imageMocks.renderWorkingImage).toHaveBeenLastCalledWith(
        expect.any(File),
        expect.objectContaining({
          preset: "high-contrast",
          rotation: 90,
        }),
      ),
    );
    expect(
      screen.getByText(/Read down each column before moving to the next one/i),
    ).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Clear" })[0]);

    const pasteButton = await screen.findByRole("button", {
      name: "Paste image",
    });
    await waitFor(() => expect(pasteButton).toHaveFocus());
    expect(screen.queryByText("receipt.png")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-image");
    expect(adapterMocks.dispose).toHaveBeenCalled();
  });

  it("can ingest an image through the clipboard button", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: vi.fn().mockResolvedValue([
          {
            types: ["image/png"],
            getType: vi.fn().mockResolvedValue(pngFile()),
          },
        ]),
      },
    });
    renderTool();

    await user.click(screen.getByRole("button", { name: "Paste image" }));

    expect(await screen.findByText("pasted-image")).toBeInTheDocument();
    expect(imageMocks.readImageDimensions).toHaveBeenCalled();
    await screen.findByRole("textbox", { name: /Tidied/ });
    expect(screen.getByLabelText(/Content type/)).toHaveValue("screenshot");
    expect(screen.getByRole("option", { name: "Screenshot / app (suggested)" })).toBeInTheDocument();
  });

  it("shows clipboard failures as a dismissible alert", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: vi.fn().mockRejectedValue(new Error("Permission denied")),
      },
    });
    renderTool();

    await user.click(screen.getByRole("button", { name: "Paste image" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The browser could not read an image from the clipboard",
    );
  });

  it("keeps the large-image safeguard keyboard-modal and restores focus", async () => {
    const user = userEvent.setup();
    imageMocks.readImageDimensions.mockResolvedValue({
      width: 5000,
      height: 3000,
    });
    const { fileInput } = renderTool();
    fileInput.focus();

    await user.upload(fileInput, pngFile("large-page.png", 5_000, 3_000));

    const dialog = await screen.findByRole("dialog", {
      name: "Prepare a reduced preview?",
    });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const proceed = screen.getByRole("button", {
      name: "Use reduced preview",
    });
    await waitFor(() => expect(cancel).toHaveFocus());
    expect(document.body).toHaveStyle({ overflow: "hidden" });

    await user.tab({ shift: true });
    expect(proceed).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(dialog).not.toBeInTheDocument();
    await waitFor(() => expect(fileInput).toHaveFocus());
    expect(document.body).not.toHaveStyle({ overflow: "hidden" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The large image was not added",
    );
  });

  it("reports worker progress and presents editable OCR results", async () => {
    const user = userEvent.setup();
    const recognition = deferred<{
      text: string;
      confidence: number;
      rotateRadians: number;
    }>();
    adapterMocks.recognise.mockImplementation(
      async (
        _canvas: HTMLCanvasElement,
        _mode: string,
        onProgress: (progress: { stage: string; value: number | null }) => void,
      ) => {
        onProgress({ stage: "Recognising local text", value: 0.6 });
        return recognition.promise;
      },
    );
    const { fileInput } = renderTool();
    await user.upload(fileInput, pngFile("terminal.png"));

    const progressbar = await screen.findByRole("progressbar", {
        name: "Recognising local text",
      });
    expect(progressbar).toHaveAttribute("value", "0.6");
    expect(progressbar).toHaveAttribute(
      "aria-valuetext",
      "Recognising local text",
    );
    expect(progressbar.closest(".ocr-progress")).not.toHaveAttribute(
      "aria-live",
    );
    expect(screen.getByText("Recognising local text")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    for (const status of screen.getAllByText("Offline: preparing…")) {
      expect(status).toHaveAttribute("aria-live", "polite");
    }

    await act(async () => {
      recognition.resolve({
        text: "const answer = 42;\n",
        confidence: 91.6,
        rotateRadians: 0,
      });
      await recognition.promise;
    });

    const result = await screen.findByRole("textbox", {
      name: /tidied/i,
    });
    expect(result).toHaveValue("const answer = 42;");
    expect(result).toHaveAttribute("readonly");
    expect(
      screen.getByText(
        "Engine confidence 92% · Estimate only, not a guarantee",
      ),
    ).toBeInTheDocument();
    expect(adapterMocks.recognise).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      {
        contentMode: "document",
        languages: ["eng"],
        autoDeskew: false,
        thresholdingMethod: 0,
        includeWords: true,
        includeLines: true,
      },
      expect.any(Function),
    );
    expect(serviceWorkerMocks.prepareOfflineOcrAssets).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Edit this version" }));
    const editor = screen.getByRole("textbox", {
      name: /your edits/i,
    });
    await user.clear(editor);
    await user.type(editor, "Corrected text");
    expect(editor).toHaveValue("Corrected text");
  });

  it("cancels active OCR, clears progress, and ignores a late result without removing the image", async () => {
    const user = userEvent.setup();
    const recognition = deferred<{
      text: string;
      confidence: number;
      rotateRadians: number;
    }>();
    adapterMocks.recognise.mockImplementation(
      async (
        _canvas: HTMLCanvasElement,
        _request: unknown,
        onProgress: (progress: { stage: string; value: number | null }) => void,
      ) => {
        onProgress({ stage: "Recognising local text", value: 0.4 });
        return recognition.promise;
      },
    );
    const { fileInput } = renderTool();
    await user.upload(fileInput, pngFile());
    expect(
      await screen.findByRole("progressbar", {
        name: "Recognising local text",
      }),
    ).toHaveAttribute("value", "0.4");

    const disposeCallsBeforeCancel = adapterMocks.dispose.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(adapterMocks.dispose).toHaveBeenCalledTimes(
        disposeCallsBeforeCancel + 1,
      ),
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Your editable result will appear here",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("receipt.png")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /re-run ocr/i }),
    ).toBeEnabled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /re-run ocr/i })).toHaveFocus(),
    );

    await act(async () => {
      recognition.resolve({
        text: "This stale result must stay hidden.",
        confidence: 99,
        rotateRadians: 0,
      });
      await recognition.promise;
    });

    expect(
      screen.queryByDisplayValue("This stale result must stay hidden."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("receipt.png")).toBeInTheDocument();
  });

  it("Clear disposes the adapter and releases prepared image references", async () => {
    const user = userEvent.setup();
    const preparedCanvas = document.createElement("canvas");
    preparedCanvas.width = 800;
    preparedCanvas.height = 600;
    imageMocks.renderWorkingImage.mockResolvedValueOnce({
      canvas: preparedCanvas,
      width: 800,
      height: 600,
      metadata: {
        scale: 1,
        scaleAction: "original",
        profile: "original",
        thresholdingMethod: 0,
        polarityInverted: false,
        sourceWidth: 800,
        sourceHeight: 600,
        preparedWidth: 800,
        preparedHeight: 600,
      },
    });
    const view = renderTool();
    await ingestImage(user, view.fileInput);
    const previewCanvas = screen.getByLabelText(
      "Locally prepared image preview",
    );
    adapterMocks.dispose.mockClear();
    adapterMocks.dispose.mockRejectedValueOnce(new Error("termination failed"));
    imageMocks.clearCanvas.mockClear();

    await user.click(screen.getAllByRole("button", { name: "Clear" })[0]);

    await waitFor(() => expect(adapterMocks.dispose).toHaveBeenCalledTimes(1));
    expect(imageMocks.clearCanvas).toHaveBeenCalledWith(previewCanvas);
    expect(imageMocks.clearCanvas).toHaveBeenCalledWith(preparedCanvas);
    expect(screen.queryByText("receipt.png")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Your editable result will appear here",
      }),
    ).toBeInTheDocument();

    const preparedReleaseCount = imageMocks.clearCanvas.mock.calls.filter(
      ([canvas]) => canvas === preparedCanvas,
    ).length;
    view.unmount();
    expect(
      imageMocks.clearCanvas.mock.calls.filter(
        ([canvas]) => canvas === preparedCanvas,
      ),
    ).toHaveLength(preparedReleaseCount);
  });

  it("pagehide invalidates OCR state and releases route-owned resources", async () => {
    const user = userEvent.setup();
    const view = renderTool();
    await ingestImage(user, view.fileInput);
    adapterMocks.dispose.mockClear();
    imageMocks.clearCanvas.mockClear();
    const revokeObjectUrl = vi.mocked(URL.revokeObjectURL);
    revokeObjectUrl.mockClear();

    fireEvent(window, new Event("pagehide"));

    await waitFor(() =>
      expect(screen.queryByText("receipt.png")).not.toBeInTheDocument(),
    );
    expect(adapterMocks.dispose).toHaveBeenCalled();
    expect(imageMocks.clearCanvas).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:local-image");
    expect(screen.getByRole("button", { name: "Paste image" })).toBeVisible();
  });

  it("labels adaptive enlargement and reports material deskew as an estimate", async () => {
    const user = userEvent.setup();
    adapterMocks.recognise.mockResolvedValue({
      text: "Adaptive result",
      confidence: 90,
      rotateRadians: 0.02,
    });
    const { fileInput } = renderTool();
    await ingestImage(user, fileInput);

    await user.selectOptions(
      screen.getByRole("combobox", { name: /enhancement/i }),
      "adaptive-document",
    );

    expect(
      await screen.findByText(/1600 × 1200px · enlarged locally for OCR/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /re-run ocr/i }));
    await screen.findByRole("textbox", { name: /tidied/i });

    expect(
      screen.getByText(/Fine deskew about 1\.1° · engine estimate/i),
    ).toBeInTheDocument();
    expect(adapterMocks.recognise).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      expect.objectContaining({
        autoDeskew: true,
        thresholdingMethod: 2,
      }),
      expect.any(Function),
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: /content type/i }),
      "single-line",
    );
    await user.click(screen.getByRole("button", { name: /re-run ocr/i }));
    await waitFor(() => expect(adapterMocks.recognise).toHaveBeenCalledTimes(3));
    expect(adapterMocks.recognise).toHaveBeenLastCalledWith(
      expect.any(HTMLCanvasElement),
      expect.objectContaining({
        contentMode: "single-line",
        autoDeskew: false,
      }),
      expect.any(Function),
    );
  });

  it("recognises an eligible long Adaptive document in sequential source-detail sections", async () => {
    const user = userEvent.setup();
    imageMocks.readImageDimensions.mockResolvedValue({ width: 900, height: 8_000 });
    const close = vi.fn();
    imageMocks.decodeImage.mockResolvedValue({
      source: {} as CanvasImageSource,
      width: 900,
      height: 8_000,
      close,
    });
    imageMocks.renderWorkingImage.mockImplementation(
      async (_file: Blob, transform: { preset: string }) => {
        const canvas = document.createElement("canvas");
        canvas.width = 461;
        canvas.height = 4_096;
        return {
          canvas,
          width: canvas.width,
          height: canvas.height,
          metadata: {
            scale: 0.512,
            scaleX: 461 / 900,
            scaleY: 4_096 / 8_000,
            scaleAction: "reduced" as const,
            profile: transform.preset,
            thresholdingMethod: transform.preset === "adaptive-document" ? 2 : 0,
            polarityInverted: false,
            sourceWidth: 900,
            sourceHeight: 8_000,
            preparedWidth: 461,
            preparedHeight: 4_096,
            adaptivePlan:
              transform.preset === "adaptive-document"
                ? {
                    low: 20,
                    high: 240,
                    stretchApplied: true,
                    polarityInverted: false,
                  }
                : undefined,
          },
        };
      },
    );
    const line = (text: string, y: number) => ({
      text,
      confidence: 90,
      bbox: { x0: 20, y0: y - 10, x1: 400, y1: y + 10 },
      blockIndex: 0,
      paragraphIndex: 0,
      lineIndex: 0,
    });
    adapterMocks.recognise
      .mockResolvedValueOnce({ text: "Initial whole-page result", confidence: 90, rotateRadians: 0 })
      .mockResolvedValueOnce({
        text: "TOP-1001",
        confidence: 90,
        rotateRadians: 0,
        lines: [line("TOP-1001", 100)],
      })
      .mockResolvedValueOnce({
        text: "MID-5050",
        confidence: 90,
        rotateRadians: 0,
        lines: [line("MID-5050", 1_400)],
      })
      .mockResolvedValueOnce({
        text: "BOTTOM-9009",
        confidence: 90,
        rotateRadians: 0,
        lines: [line("BOTTOM-9009", 2_600)],
      });
    const { fileInput } = renderTool();
    await user.upload(fileInput, pngFile("long.png", 900, 8_000));
    await user.click(
      await screen.findByRole("button", { name: "Use reduced preview" }),
    );
    await screen.findByRole("textbox", { name: /Tidied/ });
    await user.selectOptions(
      screen.getByRole("combobox", { name: /enhancement/i }),
      "adaptive-document",
    );

    expect(
      await screen.findByText("3 local sections at source detail"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /re-run ocr/i }));

    expect(
      await screen.findByText("3 sections combined locally"),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /tidied/i })).toHaveValue(
      "TOP-1001 MID-5050 BOTTOM-9009",
    );
    expect(imageMocks.decodeImage).toHaveBeenCalledTimes(1);
    expect(imageMocks.renderRecognitionTile).toHaveBeenCalledTimes(3);
    expect(adapterMocks.recognise).toHaveBeenCalledTimes(4);
    expect(adapterMocks.recognise).toHaveBeenNthCalledWith(
      2,
      expect.any(HTMLCanvasElement),
      expect.objectContaining({
        pageSegmentation: "single-block",
        includeLines: true,
      }),
      expect.any(Function),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("discards a stale prepared canvas after a newer render completes", async () => {
    const user = userEvent.setup();
    const staleRender = deferred<{
      canvas: HTMLCanvasElement;
      width: number;
      height: number;
      metadata: {
        scale: number;
        scaleAction: "original";
        profile: "original";
        thresholdingMethod: 0;
        polarityInverted: false;
        sourceWidth: number;
        sourceHeight: number;
        preparedWidth: number;
        preparedHeight: number;
      };
    }>();
    const currentImplementation = imageMocks.renderWorkingImage.getMockImplementation();
    imageMocks.renderWorkingImage
      .mockReturnValueOnce(staleRender.promise)
      .mockImplementation(currentImplementation!);
    const { fileInput } = renderTool();

    await user.upload(fileInput, pngFile());
    await screen.findByText("receipt.png");
    await user.upload(fileInput, pngFile("replacement.png"));
    await screen.findByRole("textbox", { name: /Tidied/ });
    await user.selectOptions(
      screen.getByRole("combobox", { name: /enhancement/i }),
      "adaptive-document",
    );
    expect(
      await screen.findByText(/1600 × 1200px · enlarged locally for OCR/i),
    ).toBeInTheDocument();

    const staleCanvas = document.createElement("canvas");
    staleCanvas.width = 800;
    staleCanvas.height = 600;
    await act(async () => {
      staleRender.resolve({
        canvas: staleCanvas,
        width: 800,
        height: 600,
        metadata: {
          scale: 1,
          scaleAction: "original",
          profile: "original",
          thresholdingMethod: 0,
          polarityInverted: false,
          sourceWidth: 800,
          sourceHeight: 600,
          preparedWidth: 800,
          preparedHeight: 600,
        },
      });
      await staleRender.promise;
    });

    expect(
      screen.getByText(/1600 × 1200px · enlarged locally for OCR/i),
    ).toBeInTheDocument();
    expect(imageMocks.clearCanvas).toHaveBeenCalledWith(staleCanvas);
  });

  it("copies and downloads Markdown from the same run and supports editing it independently", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { fileInput } = renderTool();
    const raw = "NOTES\nFirst line\ncontinues here.";
    const markdown = "## NOTES\n\nFirst line continues here.";
    adapterMocks.recognise.mockResolvedValueOnce({ text: raw, confidence: 90, rotateRadians: 0,
      lines: ["NOTES", "First line", "continues here."].map((text, index) => ({ text,
        confidence: 90, bbox: { x0: 20, y0: index * 26, x1: 240, y1: index * 26 + 20 },
        blockIndex: 0, paragraphIndex: 0, lineIndex: index })) });
    let filename = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      filename = this.download;
    });
    const lastBlob = () => vi.mocked(URL.createObjectURL).mock.calls.at(-1)![0] as Blob;
    await ingestImage(user, fileInput, "invoice\u202Etxt.exe");
    const cleaned = (screen.getByRole("textbox", { name: "Tidied" }) as HTMLTextAreaElement).value;
    // Download .md selects the generated format even when Tidied is visible.
    await user.click(screen.getByRole("button", { name: "Download .md" }));
    expect(filename).toBe("invoicetxt-ocr.md");
    expect(lastBlob().type).toBe("text/markdown;charset=utf-8");
    expect(await lastBlob().text()).toBe(markdown);
    await user.click(screen.getByRole("button", { name: "Markdown" }));
    expect(screen.getByRole("textbox", { name: "Markdown" })).toHaveValue(markdown);
    expect(screen.getByRole("textbox", { name: "Markdown" })).toHaveAttribute("readonly");
    await user.click(screen.getByRole("button", { name: "Copy text" }));
    expect(writeText).toHaveBeenCalledWith(markdown);
    await user.click(screen.getByRole("button", { name: "Edit this version" }));
    await user.clear(screen.getByRole("textbox", { name: "Your edits" }));
    await user.type(screen.getByRole("textbox", { name: "Your edits" }), "## Corrected notes");
    await user.click(screen.getByRole("button", { name: "Download .md" }));
    expect(await lastBlob().text()).toBe("## Corrected notes");
    await user.click(screen.getByRole("button", { name: "Markdown" }));
    expect(screen.getByRole("textbox", { name: "Markdown" })).toHaveValue(markdown);
    await user.click(screen.getByRole("button", { name: "Original OCR" }));
    expect(screen.getByRole("textbox", { name: "Original OCR" })).toHaveValue(raw);
    await user.click(screen.getByRole("button", { name: "Tidied" }));
    expect(screen.getByRole("textbox", { name: "Tidied" })).toHaveValue(cleaned);
    await user.click(screen.getByRole("button", { name: "Download .txt" }));
    expect(filename).toBe("invoicetxt-ocr.txt");
    expect(await lastBlob().text()).toBe(cleaned);
    expect(adapterMocks.recognise).toHaveBeenCalledTimes(1);
    await user.click(screen.getAllByRole("button", { name: "Clear" })[0]);
    expect(screen.queryByRole("button", { name: "Markdown" })).not.toBeInTheDocument();
  });

  it("removes bidi controls from the actual downloaded text filename", async () => {
    const user = userEvent.setup();
    const { fileInput } = renderTool();
    let downloadedName = "";
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function captureDownloadName(this: HTMLAnchorElement) {
        downloadedName = this.download;
      });

    try {
      await ingestImage(user, fileInput, "invoice\u202Etxt.exe");
      await screen.findByRole("textbox", { name: /tidied/i });
      await user.click(screen.getByRole("button", { name: "Download .txt" }));

      expect(downloadedName).toBe("invoicetxt-ocr.txt");
      expect(downloadedName).not.toMatch(/\p{Bidi_Control}/u);
    } finally {
      anchorClick.mockRestore();
    }
  });

  it("keeps the image available when recognition fails", async () => {
    const user = userEvent.setup();
    adapterMocks.recognise.mockRejectedValue(new Error("Worker stopped"));
    const { fileInput } = renderTool();
    await user.upload(fileInput, pngFile());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Text extraction stopped before it could finish",
    );
    expect(screen.getByText("receipt.png")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /re-run ocr/i }),
    ).toBeEnabled();
    expect(adapterMocks.dispose).toHaveBeenCalled();
  });

  it("ingests a normal paste event while ignoring text-only clipboard data", async () => {
    renderTool();
    const image = pngFile("clipboard.png");
    const imagePaste = new Event("paste", {
      bubbles: true,
      cancelable: true,
    }) as ClipboardEvent;
    Object.defineProperty(imagePaste, "clipboardData", {
      value: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => image,
          },
        ],
        getData: () => "",
      },
    });

    fireEvent(document, imagePaste);

    expect(await screen.findByText("pasted-image")).toBeInTheDocument();
  });

  it("renders crawlable OCR guide links without mixing in other tool categories", () => {
    renderTool();

    expect(screen.getAllByRole("link", { name: /Improve OCR accuracy/i }).length)
      .toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Convert a photo or scan to text/i }).length)
      .toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Extract text from a receipt/i }).length)
      .toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /hide a message in an image/i }))
      .not.toBeInTheDocument();
  });
});
