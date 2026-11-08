import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PdfPagePreview, type PdfPreviewRender } from "../../src/components/pdf/PdfPagePreview";
import type { PdfRenderedPage } from "../../src/features/pdf/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function page(pageNumber: number): PdfRenderedPage {
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

describe("PDF page preview", () => {
  it("navigates only selected pages with keyboard controls and matching accessible source labels", async () => {
    const user = userEvent.setup();
    const rendered = [page(1), page(3), page(7), page(1)];
    const renderPage = vi.fn<PdfPreviewRender>()
      .mockResolvedValueOnce(rendered[0]).mockResolvedValueOnce(rendered[1])
      .mockResolvedValueOnce(rendered[2]).mockResolvedValueOnce(rendered[3]);
    function Harness() {
      const [active, setActive] = useState(1);
      return <PdfPagePreview pages={[1, 3, 7]} pageNumber={active} onSelectPage={setActive} renderPage={renderPage} busy={false} />;
    }
    const view = render(<Harness />);
    await screen.findByRole("img", { name: "Source PDF page 1" });
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    screen.getByRole("button", { name: "Next page" }).focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("img", { name: "Source PDF page 3" });
    expect(screen.getByRole("heading", { name: "Source page 3" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Source PDF page 1" })).not.toBeInTheDocument();
    expect(rendered[0].release).toHaveBeenCalledOnce();
    await user.selectOptions(screen.getByLabelText("Preview page", { exact: true }), "7");
    await screen.findByRole("img", { name: "Source PDF page 7" });
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Preview page", { exact: true }), "1");
    await screen.findByRole("img", { name: "Source PDF page 1" });
    expect(renderPage.mock.calls.map(([number]) => number)).toEqual([1, 3, 7, 1]);
    view.unmount();
    expect(rendered.every((item) => vi.mocked(item.release).mock.calls.length === 1)).toBe(true);
  });

  it("enlarges the existing canvas without new rendering and restores fit width", async () => {
    const user = userEvent.setup();
    const rendered = page(1);
    const renderPage = vi.fn<PdfPreviewRender>().mockResolvedValue(rendered);
    render(<PdfPagePreview pages={[1]} pageNumber={1} onSelectPage={vi.fn()} renderPage={renderPage} busy={false} />);
    const image = await screen.findByRole("img", { name: "Source PDF page 1" });
    await user.selectOptions(screen.getByLabelText("Preview zoom"), "200");
    expect(image.parentElement).toHaveStyle({ width: "200%" });
    await user.selectOptions(screen.getByLabelText("Preview zoom"), "100");
    expect(image.parentElement).toHaveStyle({ width: "100%" });
    expect(renderPage).toHaveBeenCalledTimes(1);
    expect(rendered.release).not.toHaveBeenCalled();
  });

  it("rejects a late old-page preview after navigation and releases the current canvas on Clear/unmount", async () => {
    const old = deferred<PdfRenderedPage>();
    const current = page(2);
    const obsolete = page(1);
    const renderPage = vi.fn<PdfPreviewRender>().mockReturnValueOnce(old.promise).mockResolvedValueOnce(current);
    const props = { pages: [1, 2], onSelectPage: vi.fn(), renderPage, busy: false };
    const view = render(<PdfPagePreview {...props} pageNumber={1} />);
    const firstSignal = renderPage.mock.calls[0][1];
    view.rerender(<PdfPagePreview {...props} pageNumber={2} />);
    expect(firstSignal.aborted).toBe(true);
    await screen.findByRole("img", { name: "Source PDF page 2" });
    await act(async () => { old.resolve(obsolete); await old.promise; });
    expect(obsolete.release).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Source page 2 ready.");
    view.unmount();
    expect(current.release).toHaveBeenCalledOnce();
    expect(current.canvas.width).toBe(0);
    expect(current.canvas.isConnected).toBe(false);
  });

  it("pauses and releases the preview during extraction, then renders the same page afresh", async () => {
    const before = page(1);
    const after = page(1);
    const renderPage = vi.fn<PdfPreviewRender>().mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const props = { pages: [1, 2], pageNumber: 1, onSelectPage: vi.fn(), renderPage };
    const view = render(<PdfPagePreview {...props} busy={false} />);
    await screen.findByRole("img", { name: "Source PDF page 1" });
    view.rerender(<PdfPagePreview {...props} busy />);
    expect(before.release).toHaveBeenCalledOnce();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByLabelText("Preview page", { exact: true })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Preview paused");
    expect(renderPage).toHaveBeenCalledTimes(1);
    view.rerender(<PdfPagePreview {...props} busy={false} />);
    await screen.findByRole("img", { name: "Source PDF page 1" });
    expect(renderPage).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(after.release).toHaveBeenCalledOnce();
  });

  it("reports a preview failure without blocking extraction and allows an explicit retry", async () => {
    const user = userEvent.setup();
    const renderPage = vi.fn<PdfPreviewRender>()
      .mockRejectedValueOnce(new Error("synthetic render failure")).mockResolvedValueOnce(page(4));
    render(<PdfPagePreview pages={[4]} pageNumber={4} onSelectPage={vi.fn()} renderPage={renderPage} busy={false} />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Text extraction is still available"));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry preview" }));
    await screen.findByRole("img", { name: "Source PDF page 4" });
    expect(renderPage).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Retry preview" })).not.toBeInTheDocument();
  });

  it("does not render for an invalid or empty page range", () => {
    const renderPage = vi.fn<PdfPreviewRender>();
    render(<PdfPagePreview pages={[]} pageNumber={null} onSelectPage={vi.fn()} renderPage={renderPage} busy={false} />);
    expect(renderPage).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Preview page", { exact: true })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Choose a valid page range");
  });
});
