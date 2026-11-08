// WebP quality for guide figures, shared by capture and re-encoding.
// Measured on the published figures (6 Nov 2026): UI screenshots at 0.75 keep
// mean SSIM >= 0.995 against the 0.86 originals; figures containing photographs
// degrade faster, so they use 0.80 (SSIM >= 0.987).
export const UI_FIGURE_QUALITY = 0.75;
export const PHOTO_FIGURE_QUALITY = 0.8;

export const PHOTO_FIGURES = new Set([
  "/guides/hide-message-in-image/created.webp",
  "/guides/remove-photo-metadata-before-sharing/verified-copy.webp",
  "/guides/share-image-with-hidden-message/cover.webp",
  "/guides/share-image-with-hidden-message/generated.webp",
]);

export function guideFigureQuality(src) {
  return PHOTO_FIGURES.has(src) ? PHOTO_FIGURE_QUALITY : UI_FIGURE_QUALITY;
}
