export const ERROR_CODES = [
  "UNSUPPORTED_FILE_TYPE",
  "FILE_TOO_LARGE",
  "EMPTY_FILE",
  "CORRUPT_FILE",
  "NO_TEXT_CONTENT",
  "INVALID_EXTRACTION_TYPE",
  "MISSING_FILE",
  "AI_INVALID_RESPONSE",
  "AI_UNAVAILABLE",
  "AI_NOT_CONFIGURED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const HTTP_STATUS: Record<ErrorCode, number> = {
  UNSUPPORTED_FILE_TYPE: 415,
  FILE_TOO_LARGE: 413,
  EMPTY_FILE: 400,
  CORRUPT_FILE: 422,
  NO_TEXT_CONTENT: 422,
  INVALID_EXTRACTION_TYPE: 400,
  MISSING_FILE: 400,
  AI_INVALID_RESPONSE: 502,
  AI_UNAVAILABLE: 503,
  AI_NOT_CONFIGURED: 500,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export class ExtractionError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail?: string;

  constructor(code: ErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "ExtractionError";
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.detail = detail;
  }
}

/** Narrow an unknown thrown value into an ExtractionError, preserving anything useful. */
export function toExtractionError(err: unknown): ExtractionError {
  if (err instanceof ExtractionError) return err;

  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return new ExtractionError(
    "INTERNAL_ERROR",
    "Something went wrong while processing the file. Please try again.",
    detail,
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
