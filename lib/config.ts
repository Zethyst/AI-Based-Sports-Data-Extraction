// MAX_FILE_BYTES and the accepted-extension list live in lib/upload-constraints.ts,
// which is safe to import from client components.

/**
 * A PDF page yielding fewer than this many characters of extracted text is treated
 * as having no usable text layer. Real text pages run to thousands of characters;
 * a scanned page typically yields a handful of stray ligatures, or nothing.
 */
export const MIN_CHARS_PER_PAGE = 60;

/** Characters of source text per model call. Sized well inside the context window. */
export const CHUNK_CHAR_LIMIT = 40_000;

/** Worst-case model calls for one request. Caps the cost of a pathological upload. */
export const MAX_CHUNKS = 12;

/** Attempts to repair a response that failed schema validation, after the first try. */
export const MAX_REPAIR_ATTEMPTS = 1;

/** Attempts for transport-level failures (timeout, 5xx, rate limit) before giving up. */
export const MAX_TRANSPORT_ATTEMPTS = 3;

/** Per-call timeout for the provider. */
export const PROVIDER_TIMEOUT_MS = 90_000;

/** Requests allowed per IP per window. Internal-tool sizing. */
export const RATE_LIMIT_MAX = 20;
export const RATE_LIMIT_WINDOW_MS = 60_000;

export const DEFAULT_MODEL = "gpt-4o-mini";

export function getModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * When a PDF has no text layer, hand the file to the model to read visually.
 * Disabling this makes scanned PDFs and image uploads fail with NO_TEXT_CONTENT
 * instead, keeping raw files inside our infrastructure.
 */
export function isVisionFallbackEnabled(): boolean {
  return process.env.ENABLE_VISION_FALLBACK !== "false";
}
