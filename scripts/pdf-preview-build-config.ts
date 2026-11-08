import pdfAssetManifest from "./pdf-assets.manifest.json";

export const PDF_OCR_PREVIEW_ENVIRONMENT_VARIABLE =
  "VITE_ENABLE_PDF_OCR_PREVIEW";
export const PDF_OCR_PUBLIC_ENVIRONMENT_VARIABLE = "VITE_ENABLE_PDF_OCR_PUBLIC";

const pdfRuntimeAssetBytes = pdfAssetManifest.summary.bytes;

if (!Number.isSafeInteger(pdfRuntimeAssetBytes) || pdfRuntimeAssetBytes <= 0) {
  throw new Error("The verified PDF runtime asset size is invalid.");
}

export function isPdfOcrPreviewBuild(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  return environment[PDF_OCR_PREVIEW_ENVIRONMENT_VARIABLE] === "true";
}

export function pdfCompileTimeDefinitions(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const preview = isPdfOcrPreviewBuild(environment);
  // Public by default. An explicit preview stays noindex; an explicit false
  // keeps the PDF-disabled build isolated.
  const publicSetting = environment[PDF_OCR_PUBLIC_ENVIRONMENT_VARIABLE];
  const publicRelease = publicSetting === undefined
    ? !preview
    : publicSetting === "true";
  if (preview && publicRelease) {
    throw new Error("Choose either the private PDF preview or the public PDF release build.");
  }
  return {
    __PDF_OCR_PREVIEW__: JSON.stringify(preview),
    __PDF_OCR_PUBLIC__: JSON.stringify(publicRelease),
    __PDF_RUNTIME_ASSET_BYTES__: JSON.stringify(pdfRuntimeAssetBytes),
  };
}
