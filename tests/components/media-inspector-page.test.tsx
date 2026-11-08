import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MediaInspectionOutcome,
  MediaInspectionResult,
} from "../../src/features/media-inspector/types";
import type {
  CleanCopyOptions,
  CleanCopyOutcome,
  CleanCopyResult,
} from "../../src/features/media-inspector/clean-copy/types";
import { MediaInspectorPage } from "../../src/pages/MediaInspectorPage";

const mediaMocks = vi.hoisted(() => ({
  inspectMediaSafely: vi.fn(),
  cleanCopy: vi.fn(),
  cleanCopyPreflight: vi.fn(),
}));

const provenanceMocks = vi.hoisted(() => ({
  create: vi.fn(),
  inspect: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("../../src/features/media-inspector", () => ({
  CLEAN_COPY_LIMITS: {
    maxSourceBytes: 32 * 1024 * 1024,
    maxPixels: 36_000_000,
    maxDimension: 8_192,
  },
  createCleanShareCopySafely: mediaMocks.cleanCopy,
  getCleanShareCopyPreflight: mediaMocks.cleanCopyPreflight,
  inspectMediaSafely: mediaMocks.inspectMediaSafely,
}));

vi.mock("../../src/features/media-inspector/provenance", () => ({
  createC2paProvenanceInspector: provenanceMocks.create,
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const inspectionResult: MediaInspectionResult = {
  format: {
    kind: "jpeg",
    category: "image",
    label: "JPEG image",
    mimeType: "image/jpeg",
    extensions: [".jpg", ".jpeg"],
    signature: "FF D8 FF",
  },
  file: {
    name: "holiday photo.jpg",
    size: 2_048,
    declaredMimeType: "image/jpeg",
    sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  },
  image: {
    width: 4_032,
    height: 3_024,
    bitDepth: 8,
    orientation: 1,
    animated: false,
  },
  metadata: [
    {
      namespace: "exif",
      key: "GPSLatitude",
      label: "GPS latitude",
      value: "31.9505 S",
      sensitive: true,
    },
    {
      namespace: "exif",
      key: "Make",
      label: "Camera make",
      value: "Example Camera Co.",
    },
    {
      namespace: "png",
      key: "prompt",
      label: "Generation prompt",
      value: "A moonlit city",
      sensitive: true,
    },
    {
      namespace: "xmp",
      key: "ModelName",
      label: "AI model",
      value: "Example diffusion model",
    },
  ],
  privacy: [
    {
      id: "location-gps",
      category: "location",
      severity: "high",
      title: "Location coordinates",
      detail: "This file includes coordinates that may identify where it was created.",
      metadataKeys: ["GPSLatitude"],
    },
    {
      id: "generation-prompt",
      category: "generation-data",
      severity: "medium",
      title: "Generation details",
      detail: "A generation prompt or model setting may be present.",
      metadataKeys: ["prompt", "ModelName"],
    },
  ],
  warnings: [
    {
      code: "declared-type-mismatch",
      message: "The declared file type should be reviewed.",
    },
  ],
  stats: {
    bytesRead: 1_024,
    readOperations: 4,
  },
};

const cleanedInspectionResult: MediaInspectionResult = {
  ...inspectionResult,
  file: {
    name: "holiday-photo-clean.jpg",
    size: 1_536,
    declaredMimeType: "image/jpeg",
    sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  },
  metadata: [
    {
      namespace: "jpeg",
      key: "image.dimensions",
      label: "Image dimensions",
      value: "4032 × 3024",
    },
  ],
  privacy: [],
  warnings: [],
};

function makeCleanCopyResult(): CleanCopyResult {
  return {
    output: new File([new Uint8Array(1_536)], "holiday-photo-clean.jpg", {
      type: "image/jpeg",
    }),
    source: inspectionResult,
    cleaned: cleanedInspectionResult,
    sourceProvenance: {
      status: "not-found",
      networkPolicy: "embedded-only",
      format: "image/jpeg",
    },
    outputProvenance: {
      status: "not-found",
      networkPolicy: "embedded-only",
      format: "image/jpeg",
    },
    verification: {
      profile: "jpeg-safe-structural-v1",
      strategy: "lossless-metadata-rewrite",
      sourceSha256: inspectionResult.file.sha256!,
      outputSha256: cleanedInspectionResult.file.sha256!,
      pixelsPreserved: true,
      orientationPreserved: true,
      colourAppearancePreserved: true,
      contentCredentialsRemoved: true,
      removedMetadata: inspectionResult.metadata,
      remainingMetadata: cleanedInspectionResult.metadata,
      removedPrivacy: inspectionResult.privacy,
      removedCarriers: ["JPEG APP1 Exif", "JPEG APP1 XMP"],
      preservedCarriers: [
        "Canonical zero-thumbnail JFIF colour marker",
        "JPEG coding tables, frame headers, and entropy-coded scans",
      ],
    },
  };
}

function mediaFile(name = "holiday photo.jpg") {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], name, {
    type: "image/jpeg",
  });
}

function renderPage() {
  const view = render(
    <MemoryRouter initialEntries={["/media-inspector"]}>
      <MediaInspectorPage />
    </MemoryRouter>,
  );
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Media Inspector did not render its file input.");
  return { ...view, input };
}

async function inspectFile(
  user: ReturnType<typeof userEvent.setup>,
  input: HTMLInputElement,
  file = mediaFile(),
) {
  await user.upload(input, file);
  await screen.findByText("Inspection complete");
  return file;
}

function readBlobText(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsText(blob);
  });
}

beforeEach(() => {
  mediaMocks.inspectMediaSafely.mockResolvedValue({
    ok: true,
    result: inspectionResult,
  } satisfies MediaInspectionOutcome);
  provenanceMocks.create.mockImplementation(() => ({
    inspect: provenanceMocks.inspect,
    dispose: provenanceMocks.dispose,
  }));
  provenanceMocks.inspect.mockResolvedValue({
    status: "not-found",
    networkPolicy: "embedded-only",
    format: "image/jpeg",
  });
  mediaMocks.cleanCopyPreflight.mockReturnValue({
    eligible: true,
    format: "jpeg",
    strategy: "lossless-metadata-rewrite",
    profile: "jpeg-safe-structural-v1",
    structuralCheckRequired: true,
  });
  mediaMocks.cleanCopy.mockImplementation(
    async (_file: File, options?: CleanCopyOptions): Promise<CleanCopyOutcome> => {
      options?.onProgress?.({ phase: "inspect-source" });
      options?.onProgress?.({ phase: "rewrite", processedBytes: 2_048, totalBytes: 2_048 });
      options?.onProgress?.({ phase: "verify-output-provenance" });
      options?.onProgress?.({ phase: "complete" });
      return { ok: true, result: makeCleanCopyResult() };
    },
  );

  let objectUrlNumber = 0;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => `blob:media-${++objectUrlNumber}`),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

describe("MediaInspectorPage", () => {
  it("starts with an explicit local-only, source-unchanged workspace", () => {
    renderPage();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Inspect photo and video metadata. Nothing uploaded.",
      }),
    ).toBeVisible();
    expect(screen.getByText("Your file is read from this device and is not sent to the site.")).toBeVisible();
    const promises = screen.getByRole("list", { name: "Media Inspector promises" });
    expect(within(promises).getByText("Local inspection")).toBeVisible();
    expect(within(promises).getByText("No account")).toBeVisible();
    expect(within(promises).getByText("Source unchanged")).toBeVisible();
    expect(within(promises).getByText("Exportable report")).toBeVisible();
    expect(screen.getByRole("button", { name: "Choose media file" })).toBeEnabled();
    expect(screen.getByText(/A missing field does not prove a file is human-made/i)).toBeVisible();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(mediaMocks.inspectMediaSafely).not.toHaveBeenCalled();
  });

  it("inspects a selected file locally and renders its overview", async () => {
    const user = userEvent.setup();
    const { input } = renderPage();
    const file = await inspectFile(user, input);

    expect(mediaMocks.inspectMediaSafely).toHaveBeenCalledTimes(1);
    expect(mediaMocks.inspectMediaSafely).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        includeSha256: true,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(screen.getByRole("img", { name: "Local preview of holiday photo.jpg" })).toHaveAttribute(
      "src",
      "blob:media-1",
    );
    expect(screen.getByText("JPEG image")).toBeVisible();
    expect(screen.queryByText(/bounded reads/i)).not.toBeInTheDocument();
    expect(screen.getByText("SHA-256 file fingerprint")).toBeVisible();
    expect(screen.getByText(/A fingerprint of the exact file/i)).toBeVisible();
    expect(screen.getByText(inspectionResult.file.sha256 ?? "")).toBeVisible();
    expect(screen.getByText("The declared file type should be reviewed.")).toBeVisible();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("status", { name: "Media inspection status" })).toHaveTextContent(
      /Inspection complete/i,
    );
  });

  it("does not create or mount a preview before structural inspection succeeds", async () => {
    const user = userEvent.setup();
    const pending = deferred<MediaInspectionOutcome>();
    mediaMocks.inspectMediaSafely.mockReturnValueOnce(pending.promise);
    const { container, input } = renderPage();

    await user.upload(input, mediaFile());

    expect(screen.getByText(/Preview waits until the file signature/i)).toBeVisible();
    expect(container.querySelector("img, video, audio")).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve({ ok: true, result: inspectionResult });
      await pending.promise;
    });

    expect(await screen.findByRole("img", { name: "Local preview of holiday photo.jpg" })).toHaveAttribute(
      "src",
      "blob:media-1",
    );
  });

  it("does not auto-preview an image outside the explicit dimension bounds", async () => {
    const user = userEvent.setup();
    mediaMocks.inspectMediaSafely.mockResolvedValueOnce({
      ok: true,
      result: {
        ...inspectionResult,
        image: { ...inspectionResult.image!, width: 8_193, height: 100 },
      },
    } satisfies MediaInspectionOutcome);
    const { container, input } = renderPage();

    await inspectFile(user, input);

    expect(
      within(screen.getByLabelText("Selected media preview")).getByText(
        /8,192 pixels per side and 36 megapixels/i,
      ),
    ).toBeVisible();
    expect(container.querySelector("img, video, audio")).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("requires an explicit action before starting a video decoder preview", async () => {
    const user = userEvent.setup();
    mediaMocks.inspectMediaSafely.mockResolvedValueOnce({
      ok: true,
      result: {
        ...inspectionResult,
        format: {
          kind: "mp4",
          category: "video",
          label: "MP4 video",
          mimeType: "video/mp4",
          extensions: [".mp4"],
          signature: "ISO BMFF ftyp",
        },
        file: {
          ...inspectionResult.file,
          name: "local clip.mp4",
          declaredMimeType: "video/mp4",
        },
        image: undefined,
      },
    } satisfies MediaInspectionOutcome);
    const { container, input } = renderPage();
    const video = new File([new Uint8Array([0, 0, 0, 0])], "local clip.mp4", {
      type: "video/mp4",
    });

    await inspectFile(user, input, video);

    expect(container.querySelector("video")).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Load local video preview" }));
    expect(container.querySelector("video")).toHaveAttribute("src", "blob:media-1");
    expect(URL.createObjectURL).toHaveBeenCalledWith(video);
  });

  it("presents recognised privacy findings as review prompts", async () => {
    const user = userEvent.setup();
    const { input } = renderPage();
    await inspectFile(user, input);

    await user.click(screen.getByRole("tab", { name: /^Privacy/ }));

    expect(screen.getByRole("heading", { name: "Fields worth reviewing before sharing" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Location coordinates" })).toBeVisible();
    expect(screen.getByText(/coordinates that may identify where it was created/i)).toBeVisible();
    expect(screen.getByText("High attention")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Generation details" })).toBeVisible();
  });

  it("labels AI-related fields as editable evidence rather than an authenticity verdict", async () => {
    const user = userEvent.setup();
    const { input } = renderPage();
    await inspectFile(user, input);

    await user.click(screen.getByRole("tab", { name: "Origin & AI clues" }));

    expect(screen.getByRole("heading", { name: "Possible AI generation details" })).toBeVisible();
    expect(screen.getByText("A moonlit city")).toBeVisible();
    expect(screen.getByText("Example diffusion model")).toBeVisible();
    expect(screen.getByText(/They can be edited or removed and are not proof of origin/i)).toBeVisible();
    expect(screen.getAllByText(/unverified metadata/i)).toHaveLength(2);
    expect(screen.getByText(/signed claims rather than deciding whether the scene itself is true/i)).toBeVisible();
  });

  it("does not classify ordinary camera or lens model fields as AI generation details", async () => {
    const user = userEvent.setup();
    mediaMocks.inspectMediaSafely.mockResolvedValueOnce({
      ok: true,
      result: {
        ...inspectionResult,
        metadata: [
          {
            namespace: "exif",
            key: "exif.model",
            label: "Camera model",
            value: "Example Mirrorless X",
          },
          {
            namespace: "exif",
            key: "exif.lensModel",
            label: "Lens model",
            value: "Example 35mm Prime",
          },
        ],
        privacy: [],
      },
    } satisfies MediaInspectionOutcome);
    const { input } = renderPage();
    await inspectFile(user, input);

    await user.click(screen.getByRole("tab", { name: "Origin & AI clues" }));

    expect(screen.getByRole("heading", { name: "No AI generation metadata found" })).toBeVisible();
    expect(screen.queryByText("Example Mirrorless X")).not.toBeInTheDocument();
    expect(screen.queryByText("Example 35mm Prime")).not.toBeInTheDocument();
  });

  it("describes trusted provenance as a local verifier state without claiming a custom trust list", async () => {
    const user = userEvent.setup();
    provenanceMocks.inspect.mockResolvedValueOnce({
      status: "credentials-found",
      validation: "trusted",
      activeManifestLabel: "example-manifest",
      claimGenerator: "Example signer",
      digitalSourceTypes: [],
      validationFailures: [],
      manifestStore: {},
      networkPolicy: "embedded-only",
      format: "image/jpeg",
    });
    const { input } = renderPage();
    await inspectFile(user, input);

    await user.click(screen.getByRole("tab", { name: "Origin & AI clues" }));

    expect(await screen.findByRole("heading", { name: "Verified Content Credential" })).toBeVisible();
    expect(
      screen.getByText(/does not use a custom trust list to establish the signer's identity/i),
    ).toBeVisible();
    expect(screen.queryByText(/bundled trust policy/i)).not.toBeInTheDocument();
  });

  it("filters raw metadata by field, source, and value", async () => {
    const user = userEvent.setup();
    const { input } = renderPage();
    await inspectFile(user, input);

    await user.click(screen.getByRole("tab", { name: "Raw metadata" }));
    const filter = screen.getByRole("searchbox", { name: "Filter metadata fields" });
    expect(screen.getByText("4 of 4 fields shown")).toBeVisible();

    await user.type(filter, "prompt");
    expect(screen.getByText("1 of 4 fields shown")).toBeVisible();
    const table = screen.getByRole("table", { name: "Raw metadata fields" });
    expect(within(table).getByText("Generation prompt")).toBeVisible();
    expect(within(table).getByText("A moonlit city")).toBeVisible();
    expect(within(table).queryByText("GPS latitude")).not.toBeInTheDocument();

    await user.clear(filter);
    await user.type(filter, "not-present");
    expect(screen.getByRole("heading", { name: "No matching fields" })).toBeVisible();
    expect(screen.queryByRole("table", { name: "Raw metadata fields" })).not.toBeInTheDocument();
  });

  it("downloads a versioned local JSON report with a sanitised filename", async () => {
    const user = userEvent.setup();
    const { input } = renderPage();
    await inspectFile(user, input);
    let downloadedName = "";
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function captureDownload(this: HTMLAnchorElement) {
        downloadedName = this.download;
      });

    const reportButton = screen.getByRole("button", { name: "Download JSON report" });
    await waitFor(() => expect(reportButton).toBeEnabled());
    await user.click(reportButton);

    expect(click).toHaveBeenCalledTimes(1);
    expect(downloadedName).toBe("holiday-photo-inspection.json");
    const createCalls = vi.mocked(URL.createObjectURL).mock.calls;
    const reportBlob = createCalls.at(-1)?.[0];
    expect(reportBlob).toBeInstanceOf(Blob);
    expect((reportBlob as Blob).type).toBe("application/json;charset=utf-8");
    const report = JSON.parse(await readBlobText(reportBlob as Blob)) as {
      reportVersion: number;
      notice: string;
      inspection: MediaInspectionResult;
    };
    expect(report.reportVersion).toBe(1);
    expect(report.notice).toMatch(/Ordinary metadata is editable and is not proof of origin/i);
    expect(report.inspection.file.sha256).toBe(inspectionResult.file.sha256);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media-2");
  });

  it("keeps report download disabled until provenance checking completes", async () => {
    const user = userEvent.setup();
    const pendingProvenance = deferred<{
      status: "not-found";
      networkPolicy: "embedded-only";
      format: string;
    }>();
    provenanceMocks.inspect.mockReturnValueOnce(pendingProvenance.promise);
    const { input } = renderPage();

    await inspectFile(user, input);

    const reportButton = screen.getByRole("button", { name: "Download JSON report" });
    expect(reportButton).toBeDisabled();
    expect(screen.getByText(/Report download becomes available after/i)).toBeVisible();
    expect(screen.getByRole("status", { name: "Media inspection status" })).toHaveTextContent(
      /Checking embedded Content Credentials locally/i,
    );

    await act(async () => {
      pendingProvenance.resolve({
        status: "not-found",
        networkPolicy: "embedded-only",
        format: "image/jpeg",
      });
      await pendingProvenance.promise;
    });

    await waitFor(() => expect(reportButton).toBeEnabled());
    expect(screen.queryByText(/Report download becomes available after/i)).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Media inspection status" })).toHaveTextContent(
      /Content Credentials check complete/i,
    );
  });

  it("offers supported metadata removal only after inspection and the origin check", async () => {
    const user = userEvent.setup();
    const pendingProvenance = deferred<{
      status: "not-found";
      networkPolicy: "embedded-only";
      format: string;
    }>();
    provenanceMocks.inspect.mockReturnValueOnce(pendingProvenance.promise);
    const { input } = renderPage();

    await inspectFile(user, input);

    expect(screen.getByRole("button", { name: "Download JSON report" })).toBeDisabled();
    expect(screen.getByRole("heading", { name: "Waiting for the source origin check" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Create metadata-removed copy" })).not.toBeInTheDocument();
    expect(mediaMocks.cleanCopyPreflight).not.toHaveBeenCalled();

    await act(async () => {
      pendingProvenance.resolve({
        status: "not-found",
        networkPolicy: "embedded-only",
        format: "image/jpeg",
      });
      await pendingProvenance.promise;
    });

    expect(await screen.findByRole("button", { name: "Create metadata-removed copy" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download JSON report" })).toBeEnabled();
    expect(screen.getByText(/Input is limited to/i)).toHaveTextContent(
      /32 MiB, 8,192 pixels per side and 36 megapixels/i,
    );
    expect(screen.getByText(/does not detect malware, remove steganography/i)).toBeVisible();
  });

  it("shows a concise unavailable reason instead of an active action", async () => {
    const user = userEvent.setup();
    mediaMocks.cleanCopyPreflight.mockReturnValue({
      eligible: false,
      code: "colour-profile-unsupported",
      reason: "Metadata removal does not remove an ICC profile because colour appearance could change.",
    });
    const { input } = renderPage();

    await inspectFile(user, input);

    expect(
      await screen.findByRole("heading", { name: "A metadata-removed copy is unavailable for this file" }),
    ).toBeVisible();
    expect(screen.getByText(/does not remove an ICC profile/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Create metadata-removed copy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download metadata-removed copy" })).not.toBeInTheDocument();
  });

  it("states the clean-copy dimension boundary when preflight rejects it", async () => {
    const user = userEvent.setup();
    mediaMocks.cleanCopyPreflight.mockReturnValue({
      eligible: false,
      code: "dimensions-too-large",
      reason: "Metadata removal supports at most 8,192 pixels per side and 36 megapixels.",
    });
    const { input } = renderPage();

    await inspectFile(user, input);

    expect(
      await screen.findByText(
        "Metadata removal supports at most 8,192 pixels per side and 36 megapixels.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Create metadata-removed copy" })).not.toBeInTheDocument();
  });

  it("warns before deliberately removing a source Content Credential", async () => {
    const user = userEvent.setup();
    const credentialProvenance = {
      status: "credentials-found",
      validation: "valid",
      activeManifestLabel: "source-manifest",
      claimGenerator: "Example generator",
      digitalSourceTypes: [],
      validationFailures: [],
      manifestStore: {},
      networkPolicy: "embedded-only",
      format: "image/jpeg",
    } as const;
    provenanceMocks.inspect.mockResolvedValueOnce(credentialProvenance);
    const cleanCopyResult = makeCleanCopyResult();
    mediaMocks.cleanCopy.mockResolvedValueOnce({
      ok: true,
      result: { ...cleanCopyResult, sourceProvenance: credentialProvenance },
    } satisfies CleanCopyOutcome);
    const { input } = renderPage();

    await inspectFile(user, input);

    expect(await screen.findByRole("button", { name: "Create metadata-removed copy" })).toBeEnabled();
    expect(
      screen.getByText(/new file will no longer carry the source credential/i),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Create metadata-removed copy" }));
    expect(
      await screen.findByText(/generated copy no longer carries the source Content Credential/i),
    ).toBeVisible();
  });

  it("creates, verifies, previews and explicitly downloads a separate metadata-removed copy", async () => {
    const user = userEvent.setup();
    const { input } = renderPage();
    const source = await inspectFile(user, input);
    let downloadedName = "";
    let downloadedHref = "";
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function captureDownload(this: HTMLAnchorElement) {
        downloadedName = this.download;
        downloadedHref = this.href;
      });

    await user.click(await screen.findByRole("button", { name: "Create metadata-removed copy" }));

    const result = await screen.findByRole("heading", { name: "Metadata-removed copy is ready" });
    const resultRegion = result.closest<HTMLDivElement>(".clean-copy-result");
    if (!resultRegion) throw new Error("Clean copy result region was not rendered.");
    await waitFor(() => expect(resultRegion).toHaveFocus());
    expect(mediaMocks.cleanCopy).toHaveBeenCalledWith(
      source,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        onProgress: expect.any(Function),
      }),
    );
    expect(mediaMocks.cleanCopy.mock.calls[0]?.[1]).not.toHaveProperty("sourceProvenance");
    expect(within(resultRegion).getByText(inspectionResult.file.sha256!)).toBeVisible();
    expect(within(resultRegion).getByText(cleanedInspectionResult.file.sha256!)).toBeVisible();
    expect(within(resultRegion).getByText("Removed metadata (4)")).toBeVisible();
    expect(within(resultRegion).getByText("Remaining recognised metadata (1)")).toBeVisible();
    expect(within(resultRegion).getByText("Removed structural carriers (2)")).toBeVisible();
    expect(within(resultRegion).getByText("JPEG APP1 Exif")).toBeVisible();
    expect(within(resultRegion).getByText("JPEG APP1 XMP")).toBeVisible();
    expect(within(resultRegion).getByText("Preserved rendering structure (2)")).toBeVisible();
    expect(
      within(resultRegion).getByText("Canonical zero-thumbnail JFIF colour marker"),
    ).toBeVisible();
    expect(within(resultRegion).getByText("2 → 0")).toBeVisible();
    expect(within(resultRegion).getByText("Preserved exactly")).toBeVisible();
    expect(within(resultRegion).getByText(/output credential check returned not found/i)).toBeVisible();
    expect(
      within(resultRegion).getByRole("img", { name: "Local preview of holiday-photo-clean.jpg" }),
    ).toHaveAttribute("src", "blob:media-2");
    expect(click).not.toHaveBeenCalled();

    await user.click(within(resultRegion).getByRole("button", { name: "Download metadata-removed copy" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(downloadedName).toBe("holiday-photo-clean.jpg");
    expect(downloadedHref).toContain("blob:media-2");
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:media-2");
    expect(screen.getByRole("heading", { name: "Metadata-removed copy is ready" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Choose media file" })).toHaveFocus(),
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media-1");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media-2");
  });

  it("cancels stale clean-copy work without exposing a late output and restores focus", async () => {
    const user = userEvent.setup();
    const pending = deferred<CleanCopyOutcome>();
    let signal: AbortSignal | undefined;
    let reportProgress: CleanCopyOptions["onProgress"];
    mediaMocks.cleanCopy.mockImplementationOnce(
      (_file: File, options?: CleanCopyOptions) => {
        signal = options?.signal;
        reportProgress = options?.onProgress;
        return pending.promise;
      },
    );
    const { input } = renderPage();
    await inspectFile(user, input);

    await user.click(await screen.findByRole("button", { name: "Create metadata-removed copy" }));
    act(() => reportProgress?.({ phase: "verify-output-provenance" }));
    expect(screen.getByRole("heading", { name: "Confirming no embedded credential remains" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Download metadata-removed copy" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel metadata removal" }));
    expect(signal?.aborted).toBe(true);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create metadata-removed copy" })).toHaveFocus(),
    );
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ ok: true, result: makeCleanCopyResult() });
      await pending.promise;
    });
    expect(screen.queryByRole("heading", { name: "Metadata-removed copy is ready" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download metadata-removed copy" })).not.toBeInTheDocument();
  });

  it("fails closed when output verification fails", async () => {
    const user = userEvent.setup();
    mediaMocks.cleanCopy.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "output-provenance-present",
        message: "The generated output still contains a Content Credential.",
      },
    } satisfies CleanCopyOutcome);
    const { input } = renderPage();
    await inspectFile(user, input);

    await user.click(await screen.findByRole("button", { name: "Create metadata-removed copy" }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading", { name: "Metadata-removed copy was not created" })).toBeVisible();
    expect(within(alert).getByText(/still contains a Content Credential/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Download metadata-removed copy" })).not.toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("revokes generated output independently on regeneration, replacement and unmount", async () => {
    const user = userEvent.setup();
    const view = renderPage();
    await inspectFile(user, view.input);
    await user.click(await screen.findByRole("button", { name: "Create metadata-removed copy" }));
    await screen.findByRole("heading", { name: "Metadata-removed copy is ready" });

    await user.click(screen.getByRole("button", { name: "Create again" }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media-2"));
    await screen.findByRole("heading", { name: "Metadata-removed copy is ready" });
    expect(screen.getByRole("img", { name: "Local preview of holiday-photo-clean.jpg" })).toHaveAttribute(
      "src",
      "blob:media-3",
    );

    const replacement = screen.getByLabelText<HTMLInputElement>("Choose a replacement media file");
    await user.upload(replacement, mediaFile("replacement.jpg"));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media-3"));
    expect(screen.queryByRole("heading", { name: "Metadata-removed copy is ready" })).not.toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Create metadata-removed copy" }));
    await screen.findByRole("heading", { name: "Metadata-removed copy is ready" });
    const latestOutputUrl = screen
      .getByRole("img", { name: "Local preview of holiday-photo-clean.jpg" })
      .getAttribute("src");
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(latestOutputUrl);
  });

  it("aborts source inspection and suppresses a late result on pagehide", async () => {
    const user = userEvent.setup();
    const pending = deferred<MediaInspectionOutcome>();
    let inspectionSignal: AbortSignal | undefined;
    mediaMocks.inspectMediaSafely.mockImplementationOnce(
      (_file: File, options?: { signal?: AbortSignal }) => {
        inspectionSignal = options?.signal;
        return pending.promise;
      },
    );
    const { input } = renderPage();

    await user.upload(input, mediaFile());
    await screen.findByText("Reading bounded file sections");
    act(() => window.dispatchEvent(new Event("pagehide")));

    expect(inspectionSignal?.aborted).toBe(true);
    expect(screen.getByRole("heading", { name: "Choose one media file" })).toBeVisible();
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve({ ok: true, result: inspectionResult });
      await pending.promise;
    });
    expect(screen.queryByText("Inspection complete")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("disposes the source origin check and suppresses its late result on pagehide", async () => {
    const user = userEvent.setup();
    const pendingProvenance = deferred<{
      status: "not-found";
      networkPolicy: "embedded-only";
      format: string;
    }>();
    provenanceMocks.inspect.mockReturnValueOnce(pendingProvenance.promise);
    const { input } = renderPage();

    await inspectFile(user, input);
    expect(screen.getByRole("heading", { name: "Waiting for the source origin check" })).toBeVisible();
    act(() => window.dispatchEvent(new Event("pagehide")));

    expect(provenanceMocks.dispose).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media-1");
    expect(screen.getByRole("heading", { name: "Choose one media file" })).toBeVisible();

    await act(async () => {
      pendingProvenance.resolve({
        status: "not-found",
        networkPolicy: "embedded-only",
        format: "image/jpeg",
      });
      await pendingProvenance.promise;
    });
    expect(screen.queryByText("Inspection complete")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create metadata-removed copy" })).not.toBeInTheDocument();
  });

  it("aborts clean-copy generation and suppresses its late result on pagehide", async () => {
    const user = userEvent.setup();
    const pending = deferred<CleanCopyOutcome>();
    let cleanCopySignal: AbortSignal | undefined;
    mediaMocks.cleanCopy.mockImplementationOnce(
      (_file: File, options?: CleanCopyOptions) => {
        cleanCopySignal = options?.signal;
        options?.onProgress?.({ phase: "rewrite" });
        return pending.promise;
      },
    );
    const { input } = renderPage();
    await inspectFile(user, input);
    await user.click(await screen.findByRole("button", { name: "Create metadata-removed copy" }));
    expect(screen.getByRole("heading", { name: "Rewriting the allowlisted image structure" })).toBeVisible();

    act(() => window.dispatchEvent(new Event("pagehide")));

    expect(cleanCopySignal?.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media-1");
    expect(screen.getByRole("heading", { name: "Choose one media file" })).toBeVisible();

    await act(async () => {
      pending.resolve({ ok: true, result: makeCleanCopyResult() });
      await pending.promise;
    });
    expect(screen.queryByRole("heading", { name: "Metadata-removed copy is ready" })).not.toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("revokes completed source and clean-copy URLs on pagehide", async () => {
    const user = userEvent.setup();
    const { input } = renderPage();
    await inspectFile(user, input);
    await user.click(await screen.findByRole("button", { name: "Create metadata-removed copy" }));
    await screen.findByRole("heading", { name: "Metadata-removed copy is ready" });

    act(() => window.dispatchEvent(new Event("pagehide")));

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media-1");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media-2");
    expect(screen.getByRole("heading", { name: "Choose one media file" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Download metadata-removed copy" })).not.toBeInTheDocument();
  });

  it("shows a recoverable core inspection error without rendering result tabs", async () => {
    const user = userEvent.setup();
    mediaMocks.inspectMediaSafely.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "unsupported-format",
        message: "The selected bytes are not a supported media format.",
      },
    } satisfies MediaInspectionOutcome);
    const { container, input } = renderPage();

    await user.upload(input, mediaFile("renamed.jpg"));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading", { name: "This file could not be safely inspected" })).toBeVisible();
    expect(within(alert).getByText("The selected bytes are not a supported media format.")).toBeVisible();
    expect(within(alert).getByRole("button", { name: "Choose another file" })).toBeEnabled();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(container.querySelector("img, video, audio")).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("aborts pending work without creating a preview and restores chooser focus", async () => {
    const user = userEvent.setup();
    const pending = deferred<MediaInspectionOutcome>();
    let inspectionSignal: AbortSignal | undefined;
    mediaMocks.inspectMediaSafely.mockImplementationOnce(
      (_file: File, options?: { signal?: AbortSignal }) => {
        inspectionSignal = options?.signal;
        return pending.promise;
      },
    );
    const { input } = renderPage();

    await user.upload(input, mediaFile());
    expect(
      await screen.findByRole("status", { name: "Media inspection status" }),
    ).toHaveTextContent("Reading bounded file sections");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel and clear" }));

    expect(inspectionSignal?.aborted).toBe(true);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Choose one media file" })).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Choose media file" })).toHaveFocus(),
    );
    expect(screen.queryByText("holiday photo.jpg")).not.toBeInTheDocument();
    expect(
      screen.getByLabelText<HTMLInputElement>("Choose a media file to inspect").value,
    ).toBe("");

    await act(async () => {
      pending.resolve({
        ok: false,
        error: { code: "cancelled", message: "Inspection was cancelled." },
      });
      await pending.promise;
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("revokes a validated preview URL and restores chooser focus when cleared", async () => {
    const user = userEvent.setup();
    const { input } = renderPage();
    await inspectFile(user, input);

    expect(screen.getByRole("img", { name: "Local preview of holiday photo.jpg" })).toHaveAttribute(
      "src",
      "blob:media-1",
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media-1");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Choose media file" })).toHaveFocus(),
    );
  });

  it("implements roving tab focus and keyboard activation", async () => {
    const user = userEvent.setup();
    const { input } = renderPage();
    await inspectFile(user, input);
    const overview = screen.getByRole("tab", { name: "Overview" });
    const privacy = screen.getByRole("tab", { name: /^Privacy/ });
    const raw = screen.getByRole("tab", { name: "Raw metadata" });

    expect(screen.getByRole("tablist", { name: "Inspection result views" })).toBeVisible();
    expect(overview).toHaveAttribute("tabindex", "0");
    expect(privacy).toHaveAttribute("tabindex", "-1");

    overview.focus();
    await user.keyboard("{ArrowRight}");
    expect(privacy).toHaveFocus();
    expect(privacy).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName(/^Privacy/);

    await user.keyboard("{End}");
    expect(raw).toHaveFocus();
    expect(raw).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("searchbox", { name: "Filter metadata fields" })).toBeVisible();

    await user.keyboard("{Home}");
    expect(overview).toHaveFocus();
    expect(overview).toHaveAttribute("aria-selected", "true");
  });

  it("renders crawlable Media Inspector guide links before a file is selected", () => {
    renderPage();

    expect(screen.getByRole("link", { name: /How to view photo metadata/i }))
      .toHaveAttribute("href", "/guides/view-photo-metadata");
    expect(screen.getByRole("link", { name: /Remove photo metadata before sharing/i }))
      .toHaveAttribute("href", "/guides/remove-photo-metadata-before-sharing");
    expect(screen.getByRole("link", { name: /Check AI metadata and Content Credentials/i }))
      .toHaveAttribute(
        "href",
        "/guides/check-image-ai-metadata-content-credentials",
      );
    expect(screen.getByRole("link", { name: /Check a photo for location data/i }))
      .toHaveAttribute("href", "/guides/check-photo-location-before-posting");
  });
});
