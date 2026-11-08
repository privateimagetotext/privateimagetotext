import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AppHeader } from "../../src/components/AppHeader";
import { PdfOfflineStatus } from "../../src/components/pdf/PdfOfflineStatus";
import { offlineReadiness } from "../../src/lib/offline-readiness";
import type { OcrLanguageStatus, PdfAssetStatus, ShellCacheStatus } from "../../src/lib/service-worker";

const { readiness } = vi.hoisted(() => ({ readiness: vi.fn() }));
vi.mock("../../src/hooks/useOfflineReadiness", () => ({ useOfflineReadiness: readiness }));

function workspace({
  route = "/pdf-to-text",
  pdfStatus = "PDF reader not available offline",
  languageStatus = { ready: [], preparing: [], failed: false },
}: {
  readonly route?: string;
  readonly pdfStatus?: PdfAssetStatus;
  readonly languageStatus?: OcrLanguageStatus;
} = {}) {
  return <MemoryRouter initialEntries={[route]}>
    <AppHeader localStatus="local-processing" />
    <main><PdfOfflineStatus pdfStatus={pdfStatus} languageStatus={languageStatus} languages={["eng"]}
      preparing={false} supportSize="support download" onPrepare={vi.fn()} /></main>
  </MemoryRouter>;
}

function setReadiness(shell: ShellCacheStatus, languages: OcrLanguageStatus) {
  readiness.mockReturnValue(offlineReadiness(shell, null, languages));
}

describe("shared offline header scope", () => {
  it("keeps a first visit and prepared image OCR distinct while PDF reader support is still missing", () => {
    setReadiness("ready", { ready: [], preparing: [], failed: false });
    const { container, rerender } = render(workspace());
    const summary = container.querySelector(".header-offline-status summary")!;
    const announcement = container.querySelector('[aria-live="polite"]')!;
    expect(summary).toHaveAccessibleName("Image OCR offline: setup needed");
    expect(announcement).toHaveTextContent("Image OCR offline: setup needed");
    expect(screen.getByText("PDF reader not prepared for offline use", { exact: false })).toBeInTheDocument();

    setReadiness("ready", { ready: ["eng"], preparing: [], failed: false });
    rerender(workspace({ languageStatus: { ready: ["eng"], preparing: [], failed: false } }));
    expect(summary).toHaveAccessibleName("Image OCR offline: ready for English");
    expect(announcement).toHaveTextContent("Image OCR offline: ready for English");
    expect(summary).toHaveAccessibleDescription(/Image OCR only\./);
    expect(summary).toHaveAccessibleDescription(/PDF tools have separate preparation checks\./);
    expect(screen.getByText("PDF reader not prepared for offline use", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare PDF and OCR support" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Offline support prepared" })).not.toBeInTheDocument();

    rerender(workspace({ pdfStatus: "PDF reader available offline", languageStatus: { ready: ["eng"], preparing: [], failed: false } }));
    expect(screen.getByRole("button", { name: "Offline support prepared" })).toBeDisabled();
    expect(summary).toHaveAccessibleName("Image OCR offline: ready for English");
  });

  it("uses the same explicit scope in the mobile menu on another tool route", async () => {
    setReadiness("ready", { ready: ["spa"], preparing: [], failed: false });
    const { container } = render(workspace({ route: "/media-inspector" }));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const dialog = await screen.findByRole("dialog", { name: "Navigation menu" });
    expect(within(dialog).getByText("Image OCR offline: ready for Spanish")).toBeInTheDocument();
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent("Image OCR offline: ready for Spanish");
  });

  it("withdraws image readiness after cache removal and exposes setup failure without affecting PDF status", () => {
    setReadiness("ready", { ready: ["eng"], preparing: [], failed: false });
    const { container, rerender } = render(workspace());
    const summary = container.querySelector(".header-offline-status summary")!;
    const header = container.querySelector(".header-offline-status")!;
    expect(header).toHaveAttribute("data-ready", "true");

    setReadiness("ready", { ready: [], preparing: [], failed: false });
    rerender(workspace());
    expect(header).toHaveAttribute("data-ready", "false");
    expect(summary).toHaveAccessibleName("Image OCR offline: setup needed");

    setReadiness("ready", { ready: [], preparing: [], failed: true });
    rerender(workspace());
    expect(header).toHaveAttribute("data-ready", "false");
    expect(summary).toHaveAccessibleName("Image OCR offline: setup failed");
    expect(screen.getByText("PDF reader not prepared for offline use", { exact: false })).toBeInTheDocument();
  });
});
