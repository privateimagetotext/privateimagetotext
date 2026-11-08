const windowsReserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function sanitiseSourceBase(sourceName: string) {
  const finalPathPart = sourceName.split(/[\\/]/).at(-1) ?? "";
  const withoutExtension = finalPathPart.replace(/\.[^.]*$/, "");
  const cleaned = withoutExtension
    .normalize("NFKC")
    .replace(/\p{Bidi_Control}/gu, "")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\p{Cc}/gu, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[. -]+|[. -]+$/g, "")
    .slice(0, 80)
    .replace(/[. -]+$/g, "");

  return !cleaned || windowsReserved.test(cleaned) ? null : cleaned;
}

export function safeEncodedPngFilename(sourceName: string) {
  const base = sanitiseSourceBase(sourceName);
  return base ? `${base}-encoded.png` : "private-image-to-text-encoded.png";
}

export function safeEncodedJpegFilename(sourceName: string) {
  const base = sanitiseSourceBase(sourceName);
  return base ? `${base}-encoded.jpg` : "private-image-to-text-encoded.jpg";
}

export function safeRevealedTextFilename(sourceName: string) {
  const base = sanitiseSourceBase(sourceName);
  return base ? `${base}-message.txt` : "private-image-to-text-message.txt";
}
