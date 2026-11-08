// Shared product facts must not import OCR validation or processing modules.
export const OCR_BATCH_LIMITS = { files: 10, bytes: 100 * 1024 * 1024 } as const;
