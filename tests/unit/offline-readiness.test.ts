import { describe, expect, it } from "vitest";
import { offlineReadiness } from "../../src/lib/offline-readiness";
import type { OcrModelStatus, ShellCacheStatus } from "../../src/lib/service-worker";

describe("combined offline readiness", () => {
  it("names cached languages in the header, including while another download is running", () => {
    const ready = offlineReadiness("ready", null, { ready: ["eng", "spa"], preparing: [], failed: false });
    expect(ready.headerLabel).toBe("Image OCR offline: ready for English, Spanish");
    expect(ready.description).toContain("Downloaded and cached in this browser: English, Spanish");
    const preparing = offlineReadiness("ready", null, { ready: ["eng"], preparing: ["spa"], failed: false });
    expect(preparing.headerLabel).toBe("Image OCR offline: preparing Spanish…");
    expect(preparing.description).toContain("Downloaded and cached: English.");
    expect(preparing.description).toContain("Downloading and checking Spanish");
  });

  it("does not fall back to a stale English status when the checked language list is empty", () => {
    for (const model of [null, "English OCR available offline"] as const) {
      const status = offlineReadiness("ready", model, { ready: [], preparing: [], failed: false });
      expect(status.headerLabel).toBe("Image OCR offline: setup needed");
      expect(status.label).toBe("Offline: site ready, models not yet cached");
    }
  });

  it("scopes header explanations and announcements to image OCR without changing the guide-only state", () => {
    const ready = offlineReadiness("ready", null, { ready: ["eng"], preparing: [], failed: false });
    expect(ready.headerAnnouncement).toBe("Image OCR offline: ready for English");
    expect(ready.headerDescription).toContain("Image OCR only.");
    expect(ready.headerDescription).toContain("PDF tools have separate preparation checks.");
    expect(ready.headerDescription).toContain("Browser storage may be cleared or evicted.");
    const guide = offlineReadiness("guide-ready", "English OCR available offline");
    expect(guide.headerLabel).toBe("Offline: guide ready");
    expect(guide.headerAnnouncement).toBe("Offline: this guide ready");
    expect(guide.headerDescription).toBe(guide.description);
  });

  it("requires both the site shell and checked image language assets before claiming image readiness", () => {
    const cached = { ready: ["eng"], preparing: [], failed: false };
    for (const shell of ["checking", "preparing", "missing", "failed", "unavailable"] as const) {
      expect(offlineReadiness(shell, "English OCR available offline", cached).headerLabel).not.toContain(": ready");
    }
    expect(offlineReadiness("ready", null, { ...cached, failed: true }).headerLabel).toBe("Image OCR offline: setup failed");
    expect(offlineReadiness("ready", "English OCR not available offline", { ...cached, ready: [] }).headerLabel).toBe("Image OCR offline: setup needed");
  });

  it.each<[ShellCacheStatus, OcrModelStatus | null, string]>([
    ["checking", null, "Offline: preparing…"],
    ["preparing", "English OCR available offline", "Offline: preparing…"],
    ["ready", null, "Offline: preparing…"],
    ["guide-ready", null, "Offline: this guide ready"],
    ["guide-ready", "English OCR available offline", "Offline: this guide ready"],
    ["ready", "Preparing English OCR model", "Offline: preparing…"],
    ["ready", "English OCR not available offline", "Offline: site ready, English model not yet cached"],
    ["ready", "English OCR available offline", "Offline: ready"],
    ["missing", "English OCR available offline", "Offline: site not yet cached"],
    ["failed", "English OCR available offline", "Offline: preparation failed"],
    ["ready", "OCR preparation failed", "Offline: preparation failed"],
    ["unavailable", "English OCR available offline", "Offline: unavailable"],
  ])("reports %s / %s honestly", (shell, model, label) => {
    expect(offlineReadiness(shell, model).label).toBe(label);
  });
});
