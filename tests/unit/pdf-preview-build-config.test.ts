import { describe, expect, it } from "vitest";
import {
  isPdfOcrPreviewBuild,
  pdfCompileTimeDefinitions,
} from "../../scripts/pdf-preview-build-config";

describe("PDF preview compile-time configuration", () => {
  it("enables the preview only for the exact value true", () => {
    expect(isPdfOcrPreviewBuild({})).toBe(false);
    expect(isPdfOcrPreviewBuild({ VITE_ENABLE_PDF_OCR_PREVIEW: "true" })).toBe(
      true,
    );
    for (const value of ["false", "TRUE", "1", "yes", " true", "true "]) {
      expect(
        isPdfOcrPreviewBuild({ VITE_ENABLE_PDF_OCR_PREVIEW: value }),
        value,
      ).toBe(false);
    }
  });

  it("defines the verified PDF runtime size without bundling its manifest", () => {
    const definitions = pdfCompileTimeDefinitions({});
    expect(JSON.parse(definitions.__PDF_OCR_PREVIEW__)).toBe(false);
    expect(JSON.parse(definitions.__PDF_OCR_PUBLIC__)).toBe(true);
    expect(JSON.parse(definitions.__PDF_RUNTIME_ASSET_BYTES__)).toBe(5_159_165);
  });

  it("defaults to public release, preserves private preview and rejects mixed modes", () => {
    expect(JSON.parse(pdfCompileTimeDefinitions({}).__PDF_OCR_PUBLIC__)).toBe(true);
    const preview = pdfCompileTimeDefinitions({ VITE_ENABLE_PDF_OCR_PREVIEW: "true" });
    expect(JSON.parse(preview.__PDF_OCR_PREVIEW__)).toBe(true);
    expect(JSON.parse(preview.__PDF_OCR_PUBLIC__)).toBe(false);
    const definitions = pdfCompileTimeDefinitions({ VITE_ENABLE_PDF_OCR_PUBLIC: "true" });
    expect(JSON.parse(definitions.__PDF_OCR_PUBLIC__)).toBe(true);
    expect(JSON.parse(definitions.__PDF_OCR_PREVIEW__)).toBe(false);
    for (const value of ["false", "TRUE", "1", "yes", " true", "true "]) {
      expect(JSON.parse(pdfCompileTimeDefinitions({ VITE_ENABLE_PDF_OCR_PUBLIC: value }).__PDF_OCR_PUBLIC__)).toBe(false);
    }
    expect(() => pdfCompileTimeDefinitions({
      VITE_ENABLE_PDF_OCR_PREVIEW: "true",
      VITE_ENABLE_PDF_OCR_PUBLIC: "true",
    })).toThrow();
  });
});
