import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HideMessagePage from "../../src/pages/HideMessagePage";

const rasterMocks = vi.hoisted(() => ({
  inspect: vi.fn(),
  decode: vi.fn(),
  validateOutput: vi.fn(),
  validateJpegOutput: vi.fn(),
}));

const workerMocks = vi.hoisted(() => ({
  start: vi.fn(),
  terminate: vi.fn(),
  request: vi.fn(),
  inspectionKind: "no-message" as
    | "no-message"
    | "plain-ready"
    | "password-required"
    | "damaged",
}));

vi.mock("../../src/features/raster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/features/raster")>();
  return {
    ...actual,
    inspectRasterFile: rasterMocks.inspect,
    decodeRasterWithoutResizing: rasterMocks.decode,
    validateGeneratedPng: rasterMocks.validateOutput,
    validateGeneratedJpeg: rasterMocks.validateJpegOutput,
  };
});

vi.mock("../../src/features/steganography/worker", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/features/steganography/worker")>();
  return {
    ...actual,
    SteganographyWorkerClient: class {
      start = workerMocks.start;
      terminate = workerMocks.terminate;
      request = workerMocks.request;
    },
  };
});

function image(name = "carrier.png", type = "image/png") {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function renderPage() {
  const view = render(
    <MemoryRouter initialEntries={["/hide-message"]}>
      <HideMessagePage />
    </MemoryRouter>,
  );
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Missing file input");
  return { ...view, input };
}

async function addCarrier(user: ReturnType<typeof userEvent.setup>, input: HTMLInputElement) {
  await user.upload(input, image());
  await screen.findByText(/Message size: 0 of 92 bytes used/i);
}

describe("HideMessagePage", () => {
  beforeEach(() => {
    workerMocks.inspectionKind = "no-message";
    rasterMocks.inspect.mockImplementation(async (_file: File, purpose: "hide" | "reveal") => ({
      ok: true,
      kind: purpose === "reveal" ? "png" : "png",
      width: 32,
      height: 16,
    }));
    rasterMocks.decode.mockResolvedValue({
      source: {} as CanvasImageSource,
      width: 32,
      height: 16,
      close: vi.fn(),
    });
    rasterMocks.validateOutput.mockResolvedValue({
      ok: true,
      kind: "png",
      width: 32,
      height: 16,
    });
    rasterMocks.validateJpegOutput.mockResolvedValue({
      ok: true,
      kind: "jpeg",
      width: 32,
      height: 16,
    });
    workerMocks.request.mockImplementation(async (request: { type: string; operationId: number; format?: "png-v1" | "jpeg-v2" }) => {
      if (request.type === "analyse") {
        if (request.format === "jpeg-v2") {
          return {
            type: "capacity",
            operationId: request.operationId,
            capacity: {
              format: "jpeg-v2",
              width: 32,
              height: 16,
              componentCount: 3,
              progressiveInput: false,
              sampling: 420,
              physicalDomainSize: 4_032,
              eligibleCoefficientCount: 2_000,
              reservedHeaderCoefficientCount: 1_568,
              embeddedByteCapacity: 24,
              plainMessageCapacity: 24,
              encryptedMessageCapacity: 8,
              orientation: 1,
            },
          };
        }
        return {
          type: "capacity",
          operationId: request.operationId,
          capacity: {
            format: "png-v1",
            opaquePixelCount: 512,
            eligibleBits: 1536,
            embeddedByteCapacity: 108,
            plainMessageCapacity: 108,
            encryptedMessageCapacity: 92,
          },
        };
      }
      if (request.type === "encode") {
        if (request.format === "jpeg-v2") {
          return {
            type: "encoded",
            operationId: request.operationId,
            format: "jpeg-v2",
            bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
            width: 32,
            height: 16,
          };
        }
        return {
          type: "encoded",
          operationId: request.operationId,
          format: "png-v1",
          pixels: new Uint8ClampedArray(32 * 16 * 4).buffer,
          width: 32,
          height: 16,
        };
      }
      if (request.type === "unlock") {
        return { type: "unlocked", operationId: request.operationId, message: "revealed text" };
      }
      return {
        type: "inspection",
        operationId: request.operationId,
        result:
          workerMocks.inspectionKind === "plain-ready"
            ? { kind: "plain-ready", message: "revealed text" }
            : { kind: workerMocks.inspectionKind },
      };
    });

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn()
        .mockReturnValueOnce("blob:source")
        .mockReturnValue("blob:output"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray(32 * 16 * 4),
        width: 32,
        height: 16,
      })),
      putImageData: vi.fn(),
      clearRect: vi.fn(),
    }) as unknown as CanvasRenderingContext2D);
    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
      configurable: true,
      value: vi.fn((callback: BlobCallback) => callback(new Blob(["png"], { type: "image/png" }))),
    });
    Object.defineProperty(globalThis, "ImageData", {
      configurable: true,
      value: class ImageDataMock {
        constructor(
          readonly data: Uint8ClampedArray,
          readonly width: number,
          readonly height: number,
        ) {}
      },
    });
  });

  it("defaults to independent Hide mode with password protection", () => {
    renderPage();
    expect(screen.getByRole("radio", { name: /Hide a message/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Password protected/i })).toBeChecked();
    expect(screen.getByRole("group", { name: "Choose what you want to do" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Hide a message inside an image." })).toBeVisible();
    expect(screen.queryByText("Keep this exact file.")).not.toBeInTheDocument();
    expect(screen.queryByText(/recognised OCR text/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose image" })).toHaveClass("button", "button--primary");
    expect(screen.getByRole("button", { name: "Paste image" })).toHaveClass("button", "button--quiet");
    expect(screen.getByText("To try it, pick any photo from your device.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /sample/i })).not.toBeInTheDocument();
  });

  it("keeps the native technical disclosure focusable and expandable", async () => {
    const user = userEvent.setup();
    renderPage();
    const summary = screen.getByText("Technical details");
    const details = summary.closest("details");
    expect(details).not.toHaveAttribute("open");
    summary.focus();
    expect(summary).toHaveFocus();
    await user.click(summary);
    expect(details).toHaveAttribute("open");
    expect(screen.getByText(/PNG uses the LTSG v1 pixel format/i)).toBeVisible();
  });

  it("switches workflows, clears state, and restores focus to Choose image", async () => {
    const user = userEvent.setup();
    const { input } = renderPage();
    await addCarrier(user, input);
    await user.type(screen.getByRole("textbox", { name: "Message" }), "private draft");
    await user.click(screen.getByRole("radio", { name: /Reveal a message/i }));
    expect(screen.queryByDisplayValue("private draft")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Choose image" })).toHaveFocus());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:source");
    expect(workerMocks.terminate).toHaveBeenCalled();
  });

  it("calculates live UTF-8 capacity and warns on one-byte overflow", async () => {
    const user = userEvent.setup();
    const { input } = renderPage();
    await addCarrier(user, input);
    const editor = screen.getByRole("textbox", { name: "Message" });
    await user.type(editor, "🙂");
    expect(screen.getByText(/Message size: 4 of 92 bytes used/i)).toBeVisible();
    await user.clear(editor);
    await user.type(editor, "a".repeat(93));
    expect(screen.getByText(/message is now too large/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create PNG with hidden message/i })).toBeDisabled();
  });

  it("shows an unmistakable warning in plain mode", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("radio", { name: /^No password/i }));
    expect(screen.getByText(/No password means no encryption/i)).toBeVisible();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("normalises matching passwords and provides accessible visibility controls", async () => {
    const user = userEvent.setup();
    const { input } = renderPage();
    await addCarrier(user, input);
    await user.type(screen.getByRole("textbox", { name: "Message" }), "message");
    const password = screen.getByLabelText("Password");
    const confirmation = screen.getByLabelText("Confirm password");
    await user.type(password, "pa\u0308ssphrase-012");
    await user.type(confirmation, "pässphrase-012");
    expect(screen.getByRole("button", { name: /Create PNG with hidden message/i })).toBeEnabled();
    await user.click(screen.getByRole("checkbox", { name: "Show passwords" }));
    expect(password).toHaveAttribute("type", "text");
  });

  it("generates a new PNG without automatically downloading it", async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const { input } = renderPage();
    await addCarrier(user, input);
    await user.type(screen.getByRole("textbox", { name: "Message" }), "message");
    await user.type(screen.getByLabelText("Password"), "pässphrase-012");
    await user.type(screen.getByLabelText("Confirm password"), "pässphrase-012");
    await user.click(screen.getByRole("button", { name: /Create PNG with hidden message/i }));
    expect(await screen.findByRole("heading", { name: "Download your hidden-message image" })).toBeVisible();
    expect(screen.getByText("carrier-encoded.png")).toBeVisible();
    expect(click).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    const download = screen.getByRole("button", { name: "Download PNG" });
    expect(download).toHaveClass("button", "button--primary");
    expect(download).toHaveAttribute("aria-describedby", "encoded-download-warning");
    expect(screen.getByText("Keep this exact file.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Start over" })).toHaveClass("button", "button--quiet");
    await user.click(download);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("offers JPEG v2 only for a JPEG carrier and records a JPEG result", async () => {
    const user = userEvent.setup();
    rasterMocks.inspect.mockResolvedValue({
      ok: true,
      kind: "jpeg",
      width: 32,
      height: 16,
    });
    const { input } = renderPage();
    expect(screen.queryByRole("radio", { name: /^JPEG — advanced/i })).not.toBeInTheDocument();

    await user.upload(input, image("carrier.jpg", "image/jpeg"));
    const jpegOption = await screen.findByRole("radio", { name: /^JPEG — advanced/i });
    await user.click(jpegOption);
    await user.click(screen.getByRole("radio", { name: /^No password/i }));
    await screen.findByText(/Message size: 0 of 24 bytes used/i);
    await user.click(screen.getByText("Technical details"));
    expect(screen.getByText(/1,568 are reserved for the v2 header/i)).toBeVisible();

    await user.type(screen.getByRole("textbox", { name: "Message" }), "v2 message");
    await user.click(screen.getByRole("button", { name: "Create JPEG with hidden message" }));

    expect(await screen.findByRole("heading", { name: "Download your hidden-message image" })).toBeVisible();
    expect(screen.getByText("carrier-encoded.jpg")).toBeVisible();
    expect(rasterMocks.validateJpegOutput).toHaveBeenCalled();
    const outputBlob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(outputBlob).toBeInstanceOf(Blob);
    expect((outputBlob as Blob).type).toBe("image/jpeg");
  });

  it("ignores text-only page paste and accepts image paste", async () => {
    renderPage();
    const textPaste = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(textPaste, "clipboardData", {
      value: { items: [], getData: () => "text only" },
    });
    document.dispatchEvent(textPaste);
    expect(await screen.findByText(/Text-only paste was ignored/i)).toBeInTheDocument();

    const imagePaste = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(imagePaste, "clipboardData", {
      value: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => image("pasted.png") }],
        getData: () => "",
      },
    });
    document.dispatchEvent(imagePaste);
    expect(await screen.findByText("pasted-image.png")).toBeVisible();
  });

  it("requests a password only after encrypted header inspection and supports reveal", async () => {
    const user = userEvent.setup();
    workerMocks.inspectionKind = "password-required";
    const { input } = renderPage();
    await user.click(screen.getByRole("radio", { name: /Reveal a message/i }));
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    await user.upload(input, image("encoded.png"));
    const password = await screen.findByLabelText("Password");
    await waitFor(() => expect(password).toHaveFocus());
    await user.type(password, "pässphrase-012");
    await user.click(screen.getByRole("button", { name: "Reveal message" }));
    expect(await screen.findByDisplayValue("revealed text")).toHaveAttribute("readonly");
    expect(screen.getByRole("heading", { name: "Read and copy the revealed message" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy message" })).toBeEnabled();
  });

  it("reports an ordinary PNG as no-message rather than damage", async () => {
    const user = userEvent.setup();
    const { input } = renderPage();
    await user.click(screen.getByRole("radio", { name: /Reveal a message/i }));
    await user.upload(input, image("ordinary.png"));
    expect(await screen.findByRole("heading", { name: "No compatible hidden message found" })).toBeVisible();
    expect(screen.queryByText(/hidden message is damaged/i)).not.toBeInTheDocument();
  });

  it("clears, revokes URLs, terminates work and returns focus", async () => {
    const user = userEvent.setup();
    const { input } = renderPage();
    await addCarrier(user, input);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Choose image" })).toHaveFocus());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:source");
    expect(workerMocks.terminate).toHaveBeenCalled();
  });

  it("fully invalidates transient content on pagehide", async () => {
    const user = userEvent.setup();
    const { input } = renderPage();
    await addCarrier(user, input);
    await user.type(screen.getByRole("textbox", { name: "Message" }), "private draft");
    await user.type(screen.getByLabelText("Password"), "password-value-012");

    fireEvent(window, new Event("pagehide"));

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(""),
    );
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.queryByText("carrier.png")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:source");
    expect(workerMocks.terminate).toHaveBeenCalled();
  });
  it("handles drop input and rejected animation errors accessibly", async () => {
    rasterMocks.inspect.mockResolvedValueOnce({
      ok: false,
      code: "animated-image",
      message: "Animated PNG images are not supported.",
    });
    renderPage();
    const dropzone = screen.getByText(/Paste, drop or choose the picture you want to use/i).closest(".steg-dropzone");
    expect(dropzone).not.toBeNull();
    fireEvent.drop(dropzone!, { dataTransfer: { files: [image("animated.png")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Animated PNG images are not supported.");
  });

  it("renders all steganography guides and honours the reveal-mode guide link", () => {
    render(
      <MemoryRouter initialEntries={["/hide-message?mode=reveal"]}>
        <HideMessagePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("radio", { name: /Reveal a message/i })).toBeChecked();
    expect(screen.getByRole("link", { name: /How to hide a message in an image/i }))
      .toHaveAttribute("href", "/guides/hide-message-in-image");
    expect(screen.getByRole("link", { name: /How to reveal a hidden message/i }))
      .toHaveAttribute("href", "/guides/reveal-hidden-message-from-image");
    expect(screen.getByRole("link", { name: /Share the image without breaking the message/i }))
      .toHaveAttribute("href", "/guides/share-image-with-hidden-message");
  });
});
