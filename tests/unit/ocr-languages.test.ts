import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OCR_LANGUAGES, selectedOcrLanguages } from "../../src/config/ocr-languages";
import { loadLanguageModels } from "../../src/features/ocr/language-models";
import { cleanOcrTextWithLayout } from "../../src/features/ocr/text";
import { offlineReadiness } from "../../src/lib/offline-readiness";

afterEach(() => vi.unstubAllGlobals());

describe("pinned OCR languages", () => {
  it("rejects unknown, empty, duplicate and excessive selections", () => {
    for (const ids of [[], ["eng", "eng"], ["chi_sim"], ["eng", "spa", "hin", "tha"]]) {
      expect(() => selectedOcrLanguages(ids)).toThrow();
    }
    expect(selectedOcrLanguages().map(model => model.id)).toEqual(["eng"]);
  });

  it("verifies the exact same-origin gzipped bytes passed to the engine", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const model = OCR_LANGUAGES.find(model => model.id === "hin")!;
    const bytes = await readFile(`public${model.path}`);
    const fetch = vi.fn().mockResolvedValue(new Response(bytes));
    vi.stubGlobal("fetch", fetch);
    const models = await loadLanguageModels(["hin"], new AbortController().signal);
    expect(models[0].code).toBe("hin");
    expect(Buffer.from(models[0].data).equals(bytes)).toBe(true);
    expect(String(fetch.mock.calls[0][0])).toBe(new URL(model.path, window.location.origin).href);
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error", credentials: "same-origin" });
    fetch.mockResolvedValue(new Response(gunzipSync(bytes), { headers: { "Content-Encoding": "gzip" } }));
    expect(Buffer.from((await loadLanguageModels(["hin"], new AbortController().signal))[0].data).equals(gunzipSync(bytes))).toBe(true);
    bytes[50] ^= 1;
    fetch.mockResolvedValue(new Response(bytes));
    await expect(loadLanguageModels(["hin"], new AbortController().signal)).rejects.toThrow("integrity check");
  });

  it("rejects HTML fallback and an aborted load", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } })));
    await expect(loadLanguageModels(["tha"], new AbortController().signal)).rejects.toThrow("could not be loaded");
    vi.stubGlobal("crypto", webcrypto);
    const model = OCR_LANGUAGES.find(model => model.id === "tha")!;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(await readFile(`public${model.path}`))));
    const controller = new AbortController(); controller.abort();
    await expect(loadLanguageModels(["tha"], controller.signal)).rejects.toThrow();
  });

  it("preserves non-Latin text in every cleanup mode, including mixed selections", () => {
    const raw = "ภาษาไทย  \n\n\nनमस्ते दुनिया\n";
    for (const mode of ["document", "columns", "code", "screenshot", "sparse", "single-line"] as const) {
      expect(cleanOcrTextWithLayout(raw, mode, undefined, ["eng", "hin"])).toBe(raw);
      expect(cleanOcrTextWithLayout(raw, mode, undefined, ["tha"])).toBe(raw);
    }
  });

  it("reports only verified cached languages, with failures taking precedence", () => {
    expect(offlineReadiness("ready", null, { ready: ["spa", "hin"], preparing: [], failed: false }).label)
      .toBe("Offline: ready for Spanish, Hindi");
    expect(offlineReadiness("ready", null, { ready: ["eng"], preparing: [], failed: true }).label)
      .toBe("Offline: preparation failed");
  });
});
