// Visible page copy and structured data share these statements.
export const hideMessageCopy = {
  introduction: "Choose a picture, type a message, and download a new PNG or JPEG containing it. Add a password to encrypt the message. Everything runs in your browser, so this site does not upload the picture, message or password.",
  facts: ["Free", "No account", "PNG and JPEG output", "Password encryption available"],
} as const;

export const mediaInspectorCopy = {
  introduction: "See technical details, privacy-sensitive fields and AI generation clues inside a photo, video or audio file. Inspection happens in this browser.",
  facts: ["Local inspection", "No account", "Source unchanged", "Exportable report"],
} as const;

export const pdfCopy = {
  introduction: "Extract selectable or scanned PDF text locally in your browser. Choose the scan's languages, preview selected pages and review their editable text. Your PDF and extracted text are not uploaded.",
  facts: [],
} as const;

export const stegoAnalysisCopy = {
  introduction: "View every bit plane, pull least significant bits out in the order you choose, and check for bytes hidden after the end of an image. Built for CTF players, students and puzzle makers. Analysis runs in this browser.",
  facts: ["Free", "No account", "No upload", "Exact 8-bit PNG samples"],
} as const;
