import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PdfExtractionRequest,
  PdfSinglePageRequest,
} from "../../src/features/pdf/extraction-runner";
import { PdfError } from "../../src/features/pdf/errors";
import { PDF_LIMITS } from "../../src/features/pdf/validation";
import type {
  PdfDocumentResult,
  PdfDocumentSession,
  PdfExtractionMode,
  PdfPageResult,
  PdfProgress,
  PdfRenderedPage,
} from "../../src/features/pdf/types";
import type {
  OcrLanguageStatus,
  PdfAssetStatus,
} from "../../src/lib/service-worker";
import type { PdfWorkspaceDependencies } from "../../src/hooks/usePdfOcrWorkspace";
import PdfOcrPage from "../../src/pages/PdfOcrPage";

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
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

function pdfFile(name = "sample.pdf") {
  return new File([new TextEncoder().encode("%PDF-1.7\n%%EOF")], name, {
    type: "application/pdf",
  });
}

function pageResult(
  pageNumber: number,
  text = `Generated page ${pageNumber}`,
  method: PdfPageResult["method"] = "embedded-text",
  overrides: Partial<PdfPageResult> = {},
): PdfPageResult {
  return {
    pageNumber,
    pageLabel: `P-${pageNumber}`,
    status: "complete",
    method,
    raw: text,
    cleaned: text,
    edited: text,
    confidence: method === "ocr" ? 93 : null,
    elapsedMs: 12,
    textLayerAssessment: null,
    warnings: [],
    error: null,
    render: null,
    ...overrides,
  };
}

function documentResult(
  documentId: string,
  operationId: string,
  selectedPages: readonly number[],
  pages: readonly PdfPageResult[],
  outcome: PdfDocumentResult["outcome"] = "complete",
): PdfDocumentResult {
  const failedPageCount = pages.filter((page) => page.status === "failed").length;
  const skippedOrUnprocessedPageCount = pages.filter(
    (page) => page.status === "skipped" || page.status === "not-processed",
  ).length;
  return {
    documentId,
    operationId,
    outcome,
    selectedPages,
    pages,
    embeddedTextPageCount: pages.filter(
      (page) => page.status === "complete" && page.method === "embedded-text",
    ).length,
    ocrPageCount: pages.filter(
      (page) => page.status === "complete" && page.method === "ocr",
    ).length,
    emptyPageCount: pages.filter(
      (page) => page.status === "complete" && page.edited.length === 0,
    ).length,
    failedPageCount,
    skippedOrUnprocessedPageCount,
    elapsedMs: 1234,
    totalOutputCharacters: pages.reduce(
      (total, page) => total + (page.status === "complete" ? page.edited.length : 0),
      0,
    ),
    error: null,
  };
}

function previewPage(pageNumber: number): PdfRenderedPage {
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 150;
  return {
    pageNumber, originalWidth: 60, originalHeight: 90, rotation: 0,
    requestedScale: 5 / 3, scale: 5 / 3, effectiveDpi: 120,
    width: 100, height: 150, estimatedRgbaBytes: 60_000,
    downscaled: false, renderDurationMs: 1, canvas,
    release: vi.fn(() => { canvas.width = 0; canvas.height = 0; }),
  };
}

function fakeDocument(pageCount = 3, renderPage: PdfDocumentSession["renderPage"] = vi.fn()): PdfDocumentSession {
  return {
    pageCount,
    pageLabels: Array.from({ length: pageCount }, (_, index) => `P-${index + 1}`),
    extractText: vi.fn(),
    renderPage,
    cancelRender: vi.fn(),
    destroy: vi.fn(async () => undefined),
  };
}

type HarnessOptions = {
  readonly pageCount?: number;
  readonly password?: string;
  readonly pdfStatus?: PdfAssetStatus;
  readonly languageStatus?: OcrLanguageStatus;
  readonly online?: boolean;
  readonly renderPage?: PdfDocumentSession["renderPage"];
};

function createHarness(options: HarnessOptions = {}) {
  const documents: PdfDocumentSession[] = [];
  const adapterDestroy = vi.fn(async () => undefined);
  const sessionCancel = vi.fn(async () => undefined);
  const sessionDispose = vi.fn(async () => undefined);
  const unsubscribePdf = vi.fn();
  const unsubscribeOcr = vi.fn();
  let pdfListener: ((status: PdfAssetStatus) => void) | null = null;
  let languageListener: ((status: OcrLanguageStatus) => void) | null = null;
  let isOcrReady: ((signal: AbortSignal, languages: readonly string[]) => boolean | Promise<boolean>) | null = null;

  const open = vi.fn(async (
    _source: Blob | Uint8Array,
    openOptions?: {
      readonly requestPassword?: (request: {
        readonly reason: "required" | "incorrect";
        readonly attempt: number;
        readonly signal: AbortSignal;
      }) => Promise<string | null>;
    },
  ) => {
    if (options.password) {
      const controller = new AbortController();
      let candidate = await openOptions?.requestPassword?.({
        reason: "required",
        attempt: 1,
        signal: controller.signal,
      });
      if (candidate === null || candidate === undefined) {
        throw new PdfError("PDF_PASSWORD_CANCELLED");
      }
      let attempt = 2;
      while (candidate !== options.password) {
        candidate = await openOptions?.requestPassword?.({
          reason: "incorrect",
          attempt,
          signal: controller.signal,
        });
        if (candidate === null || candidate === undefined) {
          throw new PdfError("PDF_PASSWORD_CANCELLED");
        }
        attempt += 1;
      }
    }
    const document = fakeDocument(options.pageCount ?? 3, options.renderPage);
    documents.push(document);
    return document;
  });

  const run = vi.fn(async (request: PdfExtractionRequest) => {
    const method = request.settings?.mode === "ocr-all" ? "ocr" : "embedded-text";
    const pages = request.selectedPages.map((pageNumber) =>
      pageResult(pageNumber, `Generated page ${pageNumber}`, method,
        method === "ocr" ? { languages: request.settings?.languages ?? ["eng"] } : {}),
    );
    for (const page of pages) {
      request.onPageStatus?.(page.pageNumber, "complete");
      request.onPageResult?.(page);
    }
    return documentResult(
      request.documentId,
      request.operationId,
      request.selectedPages,
      pages,
    );
  });

  const processPage = vi.fn(async (request: PdfSinglePageRequest) =>
    pageResult(
      request.pageNumber,
      `Replacement page ${request.pageNumber}`,
      request.method,
      request.method === "ocr" ? { languages: request.settings?.languages ?? ["eng"] } : {},
    ),
  );

  const preparePdfAssets = vi.fn(async () => true);
  const prepareOcrAssets = vi.fn();
  const checkPdfAssets = vi.fn(async () => false);
  const checkOcrAssets = vi.fn();

  const dependencies: Partial<PdfWorkspaceDependencies> = {
    createPdfAdapter: vi.fn(() => ({ open, destroy: adapterDestroy })),
    createExtractionSession: vi.fn((_document, readiness) => {
      isOcrReady = readiness;
      return { run, processPage, cancel: sessionCancel, dispose: sessionDispose };
    }),
    subscribePdfStatus: (listener) => {
      pdfListener = listener;
      listener(options.pdfStatus ?? "PDF reader not available offline");
      return unsubscribePdf;
    },
    subscribeLanguageStatus: (listener) => {
      languageListener = listener;
      listener(options.languageStatus ?? { ready: [], preparing: [], failed: false });
      return unsubscribeOcr;
    },
    checkPdfAssets,
    checkOcrAssets,
    preparePdfAssets,
    prepareOcrAssets,
    isOnline: () => options.online ?? true,
  };

  return {
    dependencies,
    documents,
    open,
    run,
    processPage,
    adapterDestroy,
    sessionCancel,
    sessionDispose,
    unsubscribePdf,
    unsubscribeOcr,
    preparePdfAssets,
    prepareOcrAssets,
    emitPdfStatus(status: PdfAssetStatus) {
      pdfListener?.(status);
    },
    emitLanguageStatus(status: OcrLanguageStatus) {
      languageListener?.(status);
    },
    isOcrReady(languages: readonly string[]) {
      if (!isOcrReady) throw new Error("Document session is not open.");
      return isOcrReady(new AbortController().signal, languages);
    },
  };
}

function renderPage(harness = createHarness()) {
  const view = render(
    <MemoryRouter><PdfOcrPage workspaceDependencies={harness.dependencies} /></MemoryRouter>,
  );
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("PDF input was not rendered.");
  return { ...view, input, harness };
}

async function openPdf(
  user: ReturnType<typeof userEvent.setup>,
  input: HTMLInputElement,
  file = pdfFile(),
) {
  await user.upload(input, file);
  await screen.findByRole("heading", { name: file.name });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Process selected pages" })).toBeEnabled(),
  );
}

async function processDocument(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Process selected pages" }));
  await screen.findByRole("heading", { name: "Selected pages processed" });
}

const progress: PdfProgress = {
  stage: "Checking text layers",
  phase: "preflight",
  overall: 0.4,
  currentSelectedPageIndex: 1,
  totalSelectedPages: 3,
  pageNumber: 2,
  pageValue: 0.5,
  isPreflighting: true,
  isProducingResults: false,
};

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:pdf-text-download"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

describe("PdfOcrPage", () => {
  it("renders build-appropriate copy, limits, privacy boundary, and initial offline states", () => {
    renderPage();

    expect(screen.getByRole("heading", {
      level: 1,
      name: "Extract text from a PDF. Nothing uploaded.",
    })).toBeInTheDocument();
    const previewNotice = screen.queryByText(/workspace is still being tested and is not enabled on the public site/i);
    if (__PDF_OCR_PUBLIC__) {
      expect(previewNotice).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: /PDF to text guide/i })).toHaveAttribute("href", "/guides/pdf-to-text");
    } else {
      expect(previewNotice).toBeInTheDocument();
    }
    expect(screen.getByText(/Extract selectable or scanned PDF text locally/i)).toBeInTheDocument();
    expect(screen.getByText(/up to 25 pages requiring OCR/i)).toBeInTheDocument();
    expect(screen.getByText("PDF reader not prepared for offline use", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("English OCR not prepared for offline use")).toBeInTheDocument();
    expect(screen.getByText(/selected PDFs and results are not placed in the offline cache/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Processing options" })).not.toBeInTheDocument();
  });

  it("opens one local file and renders the in-memory document summary", async () => {
    const user = userEvent.setup();
    const { input, harness } = renderPage(createHarness({ pageCount: 4 }));

    await openPdf(user, input, pdfFile("quarterly-report.pdf"));

    expect(harness.open).toHaveBeenCalledTimes(1);
    expect(screen.getByText("14 B")).toBeInTheDocument();
    expect(screen.getAllByText("4", { selector: "dd" })).toHaveLength(2);
    expect(screen.getByText("4 of 4 pages selected")).toBeInTheDocument();
    expect(screen.getByText("No password requested")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose PDF" })).not.toBeInTheDocument();
  });

  it("rejects multiple files without silently opening the first", async () => {
    const { input, harness } = renderPage();

    fireEvent.change(input, {
      target: { files: [pdfFile("first.pdf"), pdfFile("second.pdf")] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Choose one PDF at a time.");
    expect(harness.open).not.toHaveBeenCalled();
  });

  it("waits for a cancelled source preview to drain before starting extraction", async () => {
    const user = userEvent.setup();
    const pending = deferred<PdfRenderedPage>();
    const renderSource = vi.fn<PdfDocumentSession["renderPage"]>()
      .mockReturnValueOnce(pending.promise)
      .mockImplementation(async (number) => previewPage(number));
    const harness = createHarness({ renderPage: renderSource });
    const view = renderPage(harness);
    await openPdf(user, view.input);
    await waitFor(() => expect(renderSource).toHaveBeenCalledTimes(1));
    const renderSignal = renderSource.mock.calls[0][1]!.signal!;

    await user.click(screen.getByRole("button", { name: "Process selected pages" }));
    expect(renderSignal.aborted).toBe(true);
    expect(harness.run).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel processing" })).toBeEnabled();
    const obsolete = previewPage(1);
    await act(async () => { pending.resolve(obsolete); await pending.promise; });

    await screen.findByRole("heading", { name: "Selected pages processed" });
    expect(harness.run).toHaveBeenCalledTimes(1);
    expect(obsolete.release).toHaveBeenCalledOnce();
    expect(vi.mocked(obsolete.release).mock.invocationCallOrder[0])
      .toBeLessThan(harness.run.mock.invocationCallOrder[0]);
    expect(obsolete.canvas.isConnected).toBe(false);
    expect(await screen.findByRole("img", { name: "Source PDF page 1" })).not.toBe(obsolete.canvas);
    expect(screen.getByLabelText("Editable text for page 1")).toHaveValue("Generated page 1");
  });

  it("cancels extraction during preview drainage without starting OCR and allows a subsequent run", async () => {
    const user = userEvent.setup();
    const pending = deferred<PdfRenderedPage>();
    const renderSource = vi.fn<PdfDocumentSession["renderPage"]>()
      .mockReturnValueOnce(pending.promise)
      .mockImplementation(async (number) => previewPage(number));
    const harness = createHarness({ renderPage: renderSource });
    const view = renderPage(harness);
    await openPdf(user, view.input);
    await waitFor(() => expect(renderSource).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Process selected pages" }));
    await user.click(screen.getByRole("button", { name: "Cancel processing" }));
    expect(harness.run).not.toHaveBeenCalled();
    expect(harness.sessionCancel).toHaveBeenCalledTimes(1);
    const obsolete = previewPage(1);
    await act(async () => { pending.resolve(obsolete); await pending.promise; });

    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel processing" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Process selected pages" })).toBeEnabled();
    expect(harness.run).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Editable text for page 1")).not.toBeInTheDocument();
    expect(obsolete.release).toHaveBeenCalledOnce();
    await processDocument(user);
    expect(harness.run).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Editable text for page 1")).toHaveValue("Generated page 1");
  });

  it.each(["Clear", "replacement"] as const)(
    "%s during preview drainage prevents both obsolete preview and pending extraction from appearing",
    async (action) => {
      const user = userEvent.setup();
      const pending = deferred<PdfRenderedPage>();
      const renderSource = vi.fn<PdfDocumentSession["renderPage"]>()
        .mockReturnValueOnce(pending.promise)
        .mockImplementation(async (number) => previewPage(number));
      const harness = createHarness({ renderPage: renderSource });
      const view = renderPage(harness);
      await openPdf(user, view.input, pdfFile("old-preview.pdf"));
      await waitFor(() => expect(renderSource).toHaveBeenCalledTimes(1));
      await user.click(screen.getByRole("button", { name: "Process selected pages" }));
      expect(harness.run).not.toHaveBeenCalled();

      if (action === "Clear") {
        await user.click(screen.getByRole("button", { name: "Clear PDF" }));
        const dialog = await screen.findByRole("dialog", { name: "Clear this PDF and its results?" });
        await user.click(within(dialog).getByRole("button", { name: "Clear PDF" }));
      } else {
        const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
        await user.upload(input, pdfFile("replacement-preview.pdf"));
        const dialog = await screen.findByRole("dialog", { name: "Replace the current PDF?" });
        await user.click(within(dialog).getByRole("button", { name: "Replace PDF" }));
      }
      expect(renderSource.mock.calls[0][1]!.signal!.aborted).toBe(true);
      expect(harness.open).toHaveBeenCalledTimes(1);
      const obsolete = previewPage(1);
      await act(async () => { pending.resolve(obsolete); await pending.promise; });

      await waitFor(() => expect(screen.queryByRole("heading", { name: "old-preview.pdf" })).not.toBeInTheDocument());
      expect(obsolete.release).toHaveBeenCalledOnce();
      expect(obsolete.canvas.isConnected).toBe(false);
      expect(harness.run).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("Editable text for page 1")).not.toBeInTheDocument();
      expect(harness.sessionDispose).toHaveBeenCalledTimes(1);
      if (action === "Clear") {
        expect(screen.getByRole("button", { name: "Choose PDF" })).toBeEnabled();
        expect(screen.queryByRole("img", { name: "Source PDF page 1" })).not.toBeInTheDocument();
      } else {
        await screen.findByRole("heading", { name: "replacement-preview.pdf" });
        expect(await screen.findByRole("img", { name: "Source PDF page 1" })).not.toBe(obsolete.canvas);
        await processDocument(user);
        expect(harness.run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ documentId: "pdf-document-2" }));
      }
    },
  );

  it("keeps existing result navigation and page retry aligned when the next-run range excludes that page", async () => {
    const user = userEvent.setup();
    const renderSource = vi.fn<PdfDocumentSession["renderPage"]>()
      .mockImplementation(async (number) => previewPage(number));
    const harness = createHarness({ renderPage: renderSource });
    const view = renderPage(harness);
    await openPdf(user, view.input);
    await processDocument(user);
    fireEvent.change(screen.getByLabelText("Editable text for page 1"), { target: { value: "Keep my page one correction" } });
    await user.click(screen.getByRole("radio", { name: "Page range" }));
    await user.type(screen.getByLabelText(/Pages to process/), "2");
    expect(screen.getByText("1 of 3 pages selected")).toBeInTheDocument();
    const pages = screen.getByRole("navigation", { name: "Selected PDF pages" });
    expect(within(pages).getAllByRole("button")).toHaveLength(3);
    expect(screen.getByLabelText("Editable text for page 1")).toHaveValue("Keep my page one correction");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByRole("img", { name: "Source PDF page 2" })).toBeInTheDocument();
    expect(screen.getByLabelText("Editable text for page 2")).toHaveValue("Generated page 2");
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(await screen.findByRole("img", { name: "Source PDF page 1" })).toBeInTheDocument();
    expect(screen.getByLabelText("Editable text for page 1")).toHaveValue("Keep my page one correction");

    await user.click(screen.getByRole("button", { name: "Force OCR for this page" }));
    await user.click(await screen.findByRole("button", { name: "Reprocess page" }));
    await screen.findByDisplayValue("Replacement page 1");
    expect(harness.processPage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ pageNumber: 1, method: "ocr" }));
    fireEvent.change(screen.getByLabelText("Editable text for page 1"), { target: { value: "Edit after retry still works" } });
    expect(screen.getByLabelText("Editable text for page 1")).toHaveValue("Edit after retry still works");
    await user.selectOptions(screen.getByLabelText("Preview page", { exact: true }), "3");
    expect(await screen.findByRole("img", { name: "Source PDF page 3" })).toBeInTheDocument();
    expect(screen.getByLabelText("Editable text for page 3")).toHaveValue("Generated page 3");
    expect(harness.run).toHaveBeenCalledTimes(1);
  });

  it("shows reviewed validation copy and never exposes a raw adapter error", async () => {
    const user = userEvent.setup();
    const invalid = createHarness();
    invalid.open.mockRejectedValueOnce(new PdfError("PDF_SIGNATURE_INVALID"));
    const first = renderPage(invalid);
    await user.upload(first.input, pdfFile("invalid.pdf"));
    expect(await screen.findByRole("alert")).toHaveTextContent("This file does not have a valid PDF signature.");
    first.unmount();

    const raw = createHarness();
    raw.open.mockRejectedValueOnce(new Error("SECRET PDF.js parser stack"));
    const second = renderPage(raw);
    await user.upload(second.input, pdfFile("broken.pdf"));
    expect(await screen.findByRole("alert")).toHaveTextContent("This PDF could not be opened safely in this browser.");
    expect(screen.queryByText(/SECRET PDF\.js parser stack/)).not.toBeInTheDocument();
  });

  it("keeps password input ephemeral across a wrong attempt and accepts the correct password", async () => {
    const user = userEvent.setup();
    const { input } = renderPage(createHarness({ password: "correct horse" }));

    await user.upload(input, pdfFile("protected.pdf"));
    const field = await screen.findByLabelText("Password");
    await user.type(field, "wrong password");
    await user.click(screen.getByRole("button", { name: "Open PDF" }));

    expect(await screen.findByText("That password was not accepted.")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveValue("");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Open PDF" }));

    await screen.findByRole("heading", { name: "protected.pdf" });
    expect(screen.getByText("Password accepted")).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("cancels password entry and returns to a reusable empty workspace", async () => {
    const user = userEvent.setup();
    const { input, harness } = renderPage(createHarness({ password: "secret" }));

    await user.upload(input, pdfFile("protected.pdf"));
    await screen.findByRole("dialog", { name: "Enter the PDF password" });
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Choose PDF" })).toBeEnabled();
    expect(harness.adapterDestroy).toHaveBeenCalled();
  });

  it("supports all-pages and validated range selection without changing invalid input", async () => {
    const user = userEvent.setup();
    const { input } = renderPage(createHarness({ pageCount: 6 }));
    await openPdf(user, input);

    expect(screen.getByRole("radio", { name: "All pages" })).toBeChecked();
    expect(screen.getByText("6 of 6 pages selected")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Page range" }));
    const range = await screen.findByLabelText(/Pages to process/);
    await user.type(range, "1-2, 5");
    expect(screen.getByText("3 of 6 pages selected")).toBeInTheDocument();

    await user.clear(range);
    await user.type(range, "9-11");
    expect(range).toHaveValue("9-11");
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid PDF page or page range.");
    expect(screen.getByRole("button", { name: "Process selected pages" })).toBeDisabled();
  });

  it.each([
    ["Automatic", "automatic", true],
    ["Existing PDF text only", "embedded-text-only", false],
    ["OCR selected pages", "ocr-all", true],
  ] as const)("maps %s to the engine mode", async (label, mode, showsOcr) => {
    const user = userEvent.setup();
    const { input, harness } = renderPage();
    await openPdf(user, input);

    const choice = screen.getByRole("radio", { name: new RegExp(label, "i") });
    if (mode !== "automatic") await user.click(choice);
    if (showsOcr) {
      expect(screen.getByRole("group", { name: "OCR options" })).toBeInTheDocument();
    } else {
      expect(screen.queryByRole("group", { name: "OCR options" })).not.toBeInTheDocument();
    }

    await processDocument(user);
    expect(harness.run).toHaveBeenCalledWith(expect.objectContaining({
      selectedPages: [1, 2, 3],
      settings: expect.objectContaining({ mode: mode as PdfExtractionMode }),
    }));
  });

  it("uses selected languages for PDF OCR and preserves edits when they change", async () => {
    const user = userEvent.setup();
    const { input, harness } = renderPage();
    await openPdf(user, input);
    await user.click(screen.getByRole("radio", { name: /OCR selected pages/i }));
    await user.click(screen.getByText("Languages: English"));
    await user.click(screen.getByRole("checkbox", { name: /^Spanish/ }));
    await user.click(screen.getByRole("checkbox", { name: /^English/ }));
    await user.click(screen.getByRole("button", { name: "Prepare PDF and OCR support" }));
    expect(harness.prepareOcrAssets).toHaveBeenLastCalledWith(["spa"]);
    await processDocument(user);
    expect(harness.run).toHaveBeenLastCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ languages: ["spa"] }),
    }));
    const editor = screen.getByLabelText("Editable text for page 1");
    await user.clear(editor);
    await user.type(editor, "Human correction stays here.");
    await user.click(screen.getByRole("checkbox", { name: /^French/ }));
    expect(editor).toHaveValue("Human correction stays here.");
    await user.click(screen.getByRole("button", { name: "Re-run OCR for this page" }));
    await user.click(screen.getByRole("button", { name: "Reprocess page" }));
    await waitFor(() => expect(harness.processPage).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ languages: ["spa", "fra"] }),
    })));
  });

  it("checks offline readiness for every selected language", async () => {
    const user = userEvent.setup();
    const harness = createHarness({ online: false, pdfStatus: "PDF reader available offline",
      languageStatus: { ready: ["eng"], preparing: [], failed: false } });
    const { input } = renderPage(harness);
    await openPdf(user, input);
    expect(await harness.isOcrReady(["eng"])).toBe(true);
    expect(await harness.isOcrReady(["eng", "spa"])).toBe(false);
    act(() => harness.emitLanguageStatus({ ready: ["eng", "spa"], preparing: [], failed: false }));
    expect(await harness.isOcrReady(["eng", "spa"])).toBe(true);
  });

  it("renders engine progress, document counts, keyboard page selection, and persistent edits", async () => {
    const user = userEvent.setup();
    const harness = createHarness();
    const pending = deferred<PdfDocumentResult>();
    let request!: PdfExtractionRequest;
    harness.run.mockImplementationOnce((value) => {
      request = value;
      value.onProgress?.(progress);
      return pending.promise;
    });
    const { input } = renderPage(harness);
    await openPdf(user, input);

    await user.click(screen.getByRole("button", { name: "Process selected pages" }));
    expect(await screen.findByRole("heading", { name: /Checking which pages already contain usable text/ })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Document processing progress" })).toHaveValue(0.4);
    expect(screen.getAllByText("40%")).toHaveLength(2);

    const pages = [
      pageResult(1, "Alpha PDF text"),
      pageResult(2, "Bravo OCR text", "ocr"),
      pageResult(3, "", "embedded-text"),
    ];
    await act(async () => {
      pending.resolve(documentResult(request.documentId, request.operationId, request.selectedPages, pages));
      await pending.promise;
    });

    expect(await screen.findByRole("heading", { name: "Selected pages processed" })).toBeInTheDocument();
    expect(screen.getByText(/93% confidence/)).toBeInTheDocument();
    const pageOne = screen.getByRole("button", { name: /Page 1.*PDF text.*Complete/i });
    expect(pageOne).toHaveAttribute("aria-current", "page");
    pageOne.focus();
    fireEvent.keyDown(pageOne, { key: "ArrowDown" });
    const pageTwo = screen.getByRole("button", { name: /Page 2.*OCR.*confidence/i });
    await waitFor(() => expect(pageTwo).toHaveAttribute("aria-current", "page"));
    const pageTwoEditor = screen.getByLabelText(/Editable text for page 2/);
    await user.clear(pageTwoEditor);
    await user.type(pageTwoEditor, "Edited bravo");
    await user.click(pageOne);
    await user.click(screen.getByRole("button", { name: /Page 2.*OCR.*confidence/i }));
    expect(screen.getByLabelText(/Editable text for page 2/)).toHaveValue("Edited bravo");
  });

  it("requires dirty-page confirmation and replaces only the successful page", async () => {
    const user = userEvent.setup();
    const { input, harness } = renderPage();
    await openPdf(user, input);
    await processDocument(user);

    const editor = screen.getByLabelText(/Editable text for page 1/);
    await user.clear(editor);
    await user.type(editor, "My corrected first page");
    await user.click(screen.getByRole("button", { name: "Force OCR for this page" }));

    expect(await screen.findByRole("dialog", { name: "Reprocess page 1?" })).toBeInTheDocument();
    expect(harness.processPage).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).not.toHaveTextContent("My corrected first page");
    await user.click(screen.getByRole("button", { name: "Reprocess page" }));

    await waitFor(() => expect(harness.processPage).toHaveBeenCalledWith(expect.objectContaining({
      pageNumber: 1,
      method: "ocr",
    })));
    expect(await screen.findByDisplayValue("Replacement page 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Page 2.*PDF text.*Complete/i }));
    expect(screen.getByLabelText(/Editable text for page 2/)).toHaveValue("Generated page 2");
  });

  it("shows the symbol warning and clears it after a successful page repair", async () => {
    const user = userEvent.setup();
    const harness = createHarness({ pageCount: 1 });
    harness.run.mockImplementationOnce(async (request) => documentResult(
      request.documentId,
      request.operationId,
      request.selectedPages,
      [pageResult(1, "Value 0 \uF0A3 n", "embedded-text", { warnings: ["UNMAPPED_TEXT_CHARACTERS"] })],
    ));
    harness.processPage.mockResolvedValueOnce(pageResult(1, "Value 0 ≤ n", "ocr"));
    const { input } = renderPage(harness);
    await openPdf(user, input);
    await processDocument(user);

    const warning = "Some extracted characters may not represent the original symbols. Compare symbols with the PDF and correct the text before use.";
    expect(screen.getByText(warning)).toBeInTheDocument();
    expect(screen.getByLabelText("Warning")).toBeInTheDocument();
    expect(screen.getByLabelText(/Editable text for page 1/)).toHaveValue("Value 0 \uF0A3 n");

    await user.click(screen.getByRole("button", { name: "Force OCR for this page" }));
    expect(await screen.findByDisplayValue("Value 0 ≤ n")).toBeInTheDocument();
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Warning")).not.toBeInTheDocument();
  });

  it.each([
    ["failed", new PdfError("PDF_PAGE_OCR_FAILED"), "Text could not be recognised"],
    ["cancelled", new PdfError("PDF_OPERATION_CANCELLED"), "reprocessing was cancelled"],
  ] as const)("preserves dirty text when page reprocessing is %s", async (_kind, error, message) => {
    const user = userEvent.setup();
    const harness = createHarness();
    harness.processPage.mockRejectedValueOnce(error);
    const { input } = renderPage(harness);
    await openPdf(user, input);
    await processDocument(user);

    const editor = screen.getByLabelText(/Editable text for page 1/);
    await user.clear(editor);
    await user.type(editor, "Keep this irreplaceable edit");
    await user.click(screen.getByRole("button", { name: "Force OCR for this page" }));
    await user.click(await screen.findByRole("button", { name: "Reprocess page" }));

    await waitFor(() => expect(harness.processPage).toHaveBeenCalled());
    expect(screen.getByLabelText(/Editable text for page 1/)).toHaveValue("Keep this irreplaceable edit");
    expect(await screen.findAllByText(new RegExp(message, "i"))).not.toHaveLength(0);
  });

  it("copies edited page-marked output and downloads a promptly revoked UTF-8 text file", async () => {
    const user = userEvent.setup();
    const copiedValues: string[] = [];
    const writeText = vi.fn(async (value: string) => {
      copiedValues.push(value);
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const harness = createHarness({ pageCount: 2 });
    const downloads: string[] = [];
    const createdBlobs: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        createdBlobs.push(blob);
        return "blob:pdf-text-download";
      }),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click(this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    const { input } = renderPage(harness);
    await openPdf(user, input, pdfFile("unsafe report.pdf"));
    await processDocument(user);

    const editor = screen.getByLabelText(/Editable text for page 1/);
    await user.clear(editor);
    await user.type(editor, "Corrected local text");
    await user.click(screen.getByRole("button", { name: "Copy all" }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(copiedValues[0]).toContain("--- Page 1 (label: P-1) ---");
    expect(copiedValues[0]).toContain("Corrected local text");
    expect(copiedValues[0]).toContain("--- Page 2 (label: P-2) ---");

    await user.click(screen.getByRole("button", { name: "Download .txt" }));
    expect(downloads).toEqual(["unsafe-report-pdf-text.txt"]);
    const blob = createdBlobs[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(new TextDecoder().decode(await blob.arrayBuffer())).toContain("Corrected local text");
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pdf-text-download"));
  });

  it("removes sensitive clipboard fallback text when the browser copy command throws", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    const previousExecCommand = Object.getOwnPropertyDescriptor(document, "execCommand");
    let fallback: HTMLTextAreaElement | null = null;
    let copiedValue = "";
    let inputAttributes: (string | null)[] = [];
    const execCommand = vi.fn(() => {
      fallback = document.querySelector<HTMLTextAreaElement>(".clipboard-fallback");
      copiedValue = fallback?.value ?? "";
      inputAttributes = ["spellcheck", "autocomplete", "autocorrect", "autocapitalize"]
        .map((name) => fallback?.getAttribute(name) ?? null);
      throw new DOMException("Copy blocked", "SecurityError");
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    try {
      const view = renderPage();
      await openPdf(user, view.input);
      await processDocument(user);
      fireEvent.change(screen.getByLabelText(/Editable text for page 1/), { target: { value: "PRIVATE COPY SENTINEL" } });
      await user.click(screen.getByRole("button", { name: "Copy all" }));
      expect(execCommand).toHaveBeenCalledWith("copy");
      expect(copiedValue).toContain("PRIVATE COPY SENTINEL");
      expect(inputAttributes).toEqual(["false", "off", "off", "off"]);
      expect(screen.getByText("The browser could not copy the page-marked text.")).toBeInTheDocument();
      expect(document.querySelector(".clipboard-fallback")).toBeNull();
      expect(fallback).not.toBeInTheDocument();
      expect(fallback).toHaveValue("");
      view.unmount();
      expect(document.querySelector(".clipboard-fallback")).toBeNull();
    } finally {
      if (previousExecCommand) Object.defineProperty(document, "execCommand", previousExecCommand);
      else Reflect.deleteProperty(document, "execCommand");
    }
  });

  it("confirms Clear and replacement while disposing the old resources", async () => {
    const user = userEvent.setup();
    const firstHarness = createHarness();
    const firstView = renderPage(firstHarness);
    await openPdf(user, firstView.input, pdfFile("first.pdf"));
    await processDocument(user);
    await user.click(screen.getByRole("button", { name: "Clear PDF" }));
    const clearDialog = await screen.findByRole("dialog", { name: "Clear this PDF and its results?" });
    await user.click(within(clearDialog).getByRole("button", { name: "Clear PDF" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "first.pdf" })).not.toBeInTheDocument());
    expect(firstHarness.sessionCancel).toHaveBeenCalled();
    expect(firstHarness.sessionDispose).toHaveBeenCalled();
    expect(firstHarness.adapterDestroy).toHaveBeenCalled();
    firstView.unmount();

    const replacementHarness = createHarness();
    const secondView = renderPage(replacementHarness);
    await openPdf(user, secondView.input, pdfFile("old.pdf"));
    const replacementInput = secondView.container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!replacementInput) throw new Error("Replacement PDF input was not rendered.");
    await user.upload(replacementInput, pdfFile("new.pdf"));
    const replaceDialog = await screen.findByRole("dialog", { name: "Replace the current PDF?" });
    await user.click(within(replaceDialog).getByRole("button", { name: "Replace PDF" }));
    await screen.findByRole("heading", { name: "new.pdf" });
    expect(screen.queryByRole("heading", { name: "old.pdf" })).not.toBeInTheDocument();
    expect(replacementHarness.adapterDestroy).toHaveBeenCalled();
  });

  it("ignores late callbacks from a replaced document", async () => {
    const user = userEvent.setup();
    const harness = createHarness();
    const pending = deferred<PdfDocumentResult>();
    let staleRequest!: PdfExtractionRequest;
    harness.run.mockImplementationOnce((request) => {
      staleRequest = request;
      return pending.promise;
    });
    const { input } = renderPage(harness);
    await openPdf(user, input, pdfFile("old.pdf"));
    await user.click(screen.getByRole("button", { name: "Process selected pages" }));
    const replacementInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!replacementInput) throw new Error("Replacement PDF input was not rendered.");
    await user.upload(replacementInput, pdfFile("new.pdf"));
    const replaceDialog = await screen.findByRole("dialog", { name: "Replace the current PDF?" });
    await user.click(within(replaceDialog).getByRole("button", { name: "Replace PDF" }));
    await screen.findByRole("heading", { name: "new.pdf" });

    const stalePage = pageResult(1, "STALE CALLBACK TEXT");
    await act(async () => {
      staleRequest.onPageResult?.(stalePage);
      pending.resolve(documentResult(
        staleRequest.documentId,
        staleRequest.operationId,
        staleRequest.selectedPages,
        [stalePage],
      ));
      await pending.promise;
    });

    expect(screen.getByRole("heading", { name: "new.pdf" })).toBeInTheDocument();
    expect(screen.queryByText("STALE CALLBACK TEXT")).not.toBeInTheDocument();
  });

  it.each(["Clear", "pagehide", "unmount"] as const)(
    "does not open a delayed replacement after %s interrupts teardown",
    async (interruption) => {
      const user = userEvent.setup();
      const harness = createHarness();
      const view = renderPage(harness);
      await openPdf(user, view.input, pdfFile("old.pdf"));
      const teardown = deferred<undefined>();
      harness.sessionCancel.mockReturnValueOnce(teardown.promise);
      const replacementInput = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
      await user.upload(replacementInput, pdfFile("cancelled-replacement.pdf"));
      const replaceDialog = await screen.findByRole("dialog", { name: "Replace the current PDF?" });
      await user.click(within(replaceDialog).getByRole("button", { name: "Replace PDF" }));
      expect(harness.sessionCancel).toHaveBeenCalledTimes(1);

      if (interruption === "Clear") {
        await user.click(screen.getByRole("button", { name: "Clear PDF" }));
        const clearDialog = await screen.findByRole("dialog", { name: "Clear this PDF and its results?" });
        await user.click(within(clearDialog).getByRole("button", { name: "Clear PDF" }));
      } else if (interruption === "pagehide") {
        act(() => {
          window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
          window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
        });
      } else {
        view.unmount();
      }

      await act(async () => {
        teardown.resolve(undefined);
        await teardown.promise;
      });
      await waitFor(() => expect(harness.adapterDestroy).toHaveBeenCalledTimes(1));
      expect(harness.open).toHaveBeenCalledTimes(1);
      expect(harness.dependencies.createPdfAdapter).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("heading", { name: "cancelled-replacement.pdf" })).not.toBeInTheDocument();
      if (interruption !== "unmount") {
        expect(screen.getByRole("button", { name: "Choose PDF" })).toBeEnabled();
      }
    },
  );

  it("does not let delayed Clear teardown erase a newer document and its edits", async () => {
    const user = userEvent.setup();
    const harness = createHarness();
    const view = renderPage(harness);
    await openPdf(user, view.input, pdfFile("old.pdf"));
    const teardown = deferred<undefined>();
    harness.sessionCancel.mockReturnValueOnce(teardown.promise);
    await user.click(screen.getByRole("button", { name: "Clear PDF" }));
    const clearDialog = await screen.findByRole("dialog", { name: "Clear this PDF and its results?" });
    await user.click(within(clearDialog).getByRole("button", { name: "Clear PDF" }));
    expect(harness.sessionCancel).toHaveBeenCalledTimes(1);

    const replacementInput = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(replacementInput, pdfFile("newer.pdf"));
    const replaceDialog = await screen.findByRole("dialog", { name: "Replace the current PDF?" });
    await user.click(within(replaceDialog).getByRole("button", { name: "Replace PDF" }));
    await screen.findByRole("heading", { name: "newer.pdf" });
    await processDocument(user);
    fireEvent.change(screen.getByLabelText(/Editable text for page 1/), { target: { value: "Keep newer edits" } });

    await act(async () => {
      teardown.resolve(undefined);
      await teardown.promise;
    });
    await waitFor(() => expect(harness.adapterDestroy).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { name: "newer.pdf" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Editable text for page 1/)).toHaveValue("Keep newer edits");
    expect(harness.open).toHaveBeenCalledTimes(2);
  });

  it("disposes sessions, adapters, subscriptions, and download URLs on unmount", async () => {
    const user = userEvent.setup();
    const harness = createHarness();
    const view = renderPage(harness);
    await openPdf(user, view.input);
    await processDocument(user);
    await user.click(screen.getByRole("button", { name: "Download .txt" }));
    view.unmount();

    await waitFor(() => {
      expect(harness.sessionCancel).toHaveBeenCalled();
      expect(harness.sessionDispose).toHaveBeenCalled();
      expect(harness.adapterDestroy).toHaveBeenCalled();
      expect(harness.unsubscribePdf).toHaveBeenCalled();
      expect(harness.unsubscribeOcr).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pdf-text-download");
    });
  });

  it("marks result text as sensitive and rejects an oversized paste while preserving editable output", async () => {
    const user = userEvent.setup();
    const view = renderPage();
    await openPdf(user, view.input);
    await processDocument(user);
    const editor = screen.getByLabelText(/Editable text for page 1/);
    expect(editor).toHaveAttribute("spellcheck", "false");
    expect(editor).toHaveAttribute("autocomplete", "off");
    expect(editor).toHaveAttribute("autocorrect", "off");
    expect(editor).toHaveAttribute("autocapitalize", "off");
    fireEvent.change(editor, { target: { value: "x".repeat(PDF_LIMITS.maxPageTextCharacters + 1) } });
    expect(editor).toHaveValue("Generated page 1");
    expect(screen.getByRole("alert")).toHaveTextContent("more text than the current local limit");
    fireEvent.change(editor, { target: { value: "A valid local edit" } });
    expect(editor).toHaveValue("A valid local edit");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears an opened PDF across persisted pagehide/pageshow and can process it after reselection", async () => {
    const user = userEvent.setup();
    const harness = createHarness();
    const view = renderPage(harness);
    await openPdf(user, view.input, pdfFile("restore.pdf"));
    await processDocument(user);

    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(screen.queryByRole("heading", { name: "restore.pdf" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Editable text for page/)).not.toBeInTheDocument();
    expect(screen.getByText(/previous PDF workspace was cleared when you left this page/i)).toBeInTheDocument();
    await waitFor(() => expect(harness.sessionDispose).toHaveBeenCalled());
    expect(harness.adapterDestroy).toHaveBeenCalled();

    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await openPdf(user, input, pdfFile("restore.pdf"));
    await processDocument(user);
    expect(harness.run).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText(/Editable text for page 1/)).toHaveValue("Generated page 1");
  });

  it("rejects late processing callbacks after a persisted page restoration", async () => {
    const user = userEvent.setup();
    const harness = createHarness();
    const pending = deferred<PdfDocumentResult>();
    let previousRequest!: PdfExtractionRequest;
    harness.run.mockImplementationOnce((request) => {
      previousRequest = request;
      return pending.promise;
    });
    const view = renderPage(harness);
    await openPdf(user, view.input);
    await user.click(screen.getByRole("button", { name: "Process selected pages" }));
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await act(async () => {
      const stale = pageResult(1, "STALE RESTORED RESULT");
      previousRequest.onPageResult?.(stale);
      pending.resolve(documentResult(previousRequest.documentId, previousRequest.operationId, [1], [stale]));
      await pending.promise;
    });
    expect(screen.queryByLabelText(/Editable text for page/)).not.toBeInTheDocument();
    expect(screen.queryByText("STALE RESTORED RESULT")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose PDF" })).toBeEnabled();
  });

  it("updates separate offline readiness, prepares both supports, and fails early when offline", async () => {
    const user = userEvent.setup();
    const harness = createHarness();
    const view = renderPage(harness);
    await user.click(screen.getByRole("button", { name: "Prepare PDF and OCR support" }));
    expect(harness.prepareOcrAssets).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(harness.preparePdfAssets).toHaveBeenCalledTimes(1));

    act(() => {
      harness.emitPdfStatus("PDF reader available offline");
      harness.emitLanguageStatus({ ready: ["eng"], preparing: [], failed: false });
    });
    expect(screen.getByText("PDF reader available offline", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("English OCR available offline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Offline support prepared" })).toBeDisabled();
    view.unmount();

    const offline = createHarness({ online: false });
    const offlineView = renderPage(offline);
    await user.upload(offlineView.input, pdfFile("offline.pdf"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The PDF reader is not available offline. Connect to the internet and prepare it first.",
    );
    expect(offline.open).not.toHaveBeenCalled();
  });
});
