import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CropEditor from "../../src/components/CropEditor";
import type { CropRect } from "../../src/features/ocr/types";

const initialCrop: CropRect = {
  x: 0.1,
  y: 0.2,
  width: 0.7,
  height: 0.6,
};

type HarnessProps = {
  onApply?: (crop: CropRect) => void;
  onCancel?: () => void;
};

function CropHarness({
  onApply = () => undefined,
  onCancel = () => undefined,
}: HarnessProps) {
  const [open, setOpen] = useState(true);
  const [returnFocus, setReturnFocus] = useState<HTMLButtonElement | null>(null);

  return (
    <>
      <button ref={setReturnFocus} type="button">
        Open crop editor
      </button>
      {open && returnFocus ? (
        <CropEditor
          imageUrl="blob:test-image"
          initialCrop={initialCrop}
          returnFocus={returnFocus}
          onApply={(crop) => {
            onApply(crop);
            setOpen(false);
          }}
          onCancel={() => {
            onCancel();
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

beforeEach(() => {
  document.body.className = "";
});

describe("CropEditor", () => {
  it("exposes an accessible modal and labelled keyboard-adjustable edges", () => {
    render(
      <CropEditor
        imageUrl="blob:test-image"
        initialCrop={initialCrop}
        returnFocus={null}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", {
      name: "Choose the text area",
      description:
        "Drag the four handles or adjust each edge with the keyboard.",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("img", { name: "Image being cropped" })).toHaveAttribute(
      "src",
      "blob:test-image",
    );
    const mediaFrame = screen.getByTestId("crop-media-frame");
    expect(mediaFrame).toContainElement(
      screen.getByRole("img", { name: "Image being cropped" }),
    );
    expect(mediaFrame.querySelector(".crop-overlay")).toBeInTheDocument();
    expect(
      screen.getByRole("group", {
        name: "Crop edges, as a percentage of the image",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /left edge/i })).toHaveValue("10");
    expect(screen.getByRole("slider", { name: /top edge/i })).toHaveValue("20");
    expect(screen.getByRole("slider", { name: /right edge/i })).toHaveValue("80");
    expect(screen.getByRole("slider", { name: /bottom edge/i })).toHaveValue("80");
    expect(document.body).toHaveClass("scroll-locked");
  });

  it("keeps fractional crop precision in the SVG overlay", () => {
    const preciseCrop: CropRect = {
      x: 0.1234,
      y: 0.2345,
      width: 0.5432,
      height: 0.4321,
    };
    const { container } = render(
      <CropEditor
        imageUrl="blob:test-image"
        initialCrop={preciseCrop}
        returnFocus={null}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const boundary = container.querySelector(".crop-boundary");
    expect(boundary).toHaveAttribute("x", "12.34");
    expect(boundary).toHaveAttribute("y", "23.45");
    expect(boundary).toHaveAttribute("width", "54.32");
    expect(boundary).toHaveAttribute("height", "43.21");

    const topLeft = container.querySelector(
      '[data-crop-handle="top-left"]',
    );
    expect(topLeft).toHaveAttribute("cx", "12.34");
    expect(topLeft).toHaveAttribute("cy", "23.45");
    expect(screen.getByRole("slider", { name: /left edge/i })).toHaveValue("12");
  });

  it("applies keyboard-range changes as a non-destructive crop", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<CropHarness onApply={onApply} />);

    const leftEdge = screen.getByRole("slider", { name: /left edge/i });
    leftEdge.focus();
    fireEvent.change(leftEdge, { target: { value: "20" } });
    expect(leftEdge).toHaveValue("20");

    await user.click(screen.getByRole("button", { name: "Apply crop" }));

    expect(onApply).toHaveBeenCalledOnce();
    const appliedCrop = onApply.mock.calls[0][0];
    expect(appliedCrop.x).toBeCloseTo(0.2);
    expect(appliedCrop.y).toBeCloseTo(0.2);
    expect(appliedCrop.width).toBeCloseTo(0.6);
    expect(appliedCrop.height).toBeCloseTo(0.6);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open crop editor" })).toHaveFocus(),
    );
    expect(document.body).not.toHaveClass("scroll-locked");
  });

  it("resets all edges before applying", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<CropHarness onApply={onApply} />);

    await user.click(screen.getByRole("button", { name: "Reset crop" }));
    expect(screen.getByRole("slider", { name: /left edge/i })).toHaveValue("0");
    expect(screen.getByRole("slider", { name: /top edge/i })).toHaveValue("0");
    expect(screen.getByRole("slider", { name: /right edge/i })).toHaveValue("100");
    expect(screen.getByRole("slider", { name: /bottom edge/i })).toHaveValue(
      "100",
    );

    await user.click(screen.getByRole("button", { name: "Apply crop" }));
    expect(onApply).toHaveBeenCalledWith({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it("cancels with Escape and restores focus to the invoking control", async () => {
    const onCancel = vi.fn();
    render(<CropHarness onCancel={onCancel} />);

    const dialog = screen.getByRole("dialog", { name: "Choose the text area" });
    expect(screen.getByRole("button", { name: "Cancel crop" })).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open crop editor" })).toHaveFocus(),
    );
  });

  it("wraps Tab focus at both ends of the modal", () => {
    render(
      <CropEditor
        imageUrl="blob:test-image"
        initialCrop={initialCrop}
        returnFocus={null}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Choose the text area" });
    const first = screen.getByRole("button", { name: "Cancel crop" });
    const last = screen.getByRole("button", { name: "Apply crop" });

    expect(first).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(first).toHaveFocus();
  });
});
