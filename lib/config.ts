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

/**
 * Lines of source text per model call, and in practice the limit that matters.
 *
 * A response has a token ceiling. Hand the model 900 rows and it does not refuse or
 * error — it writes as much of the answer as it can and stops, and a truncated list is
 * indistinguishable from a complete one. Measured on a 300-row ranking CSV: one 40k
 * chunk returned 100 records in 145s; the same file at four chunks returned all 300 in
 * 25s. One line ≈ one record in tabular text, so capping lines caps the answer size.
 */
export const CHUNK_LINE_LIMIT = 80;

export function getChunkCharLimit(): number {
  const raw = Number(process.env.CHUNK_CHAR_LIMIT);
  if (!Number.isInteger(raw) || raw < 500) return CHUNK_CHAR_LIMIT;
  return raw;
}

export function getChunkLineLimit(): number {
  const raw = Number(process.env.CHUNK_LINE_LIMIT);
  if (!Number.isInteger(raw) || raw < 5) return CHUNK_LINE_LIMIT;
  return raw;
}

/**
 * Worst-case model calls for one request. Caps the cost of a pathological upload.
 *
 * Raised alongside the line limit: chunks are smaller now, so a file needs more of
 * them, and they overlap rather than queueing. At the default concurrency this ceiling
 * is six waves of calls, which stays inside the route's own time budget.
 */
export const MAX_CHUNKS = 24;

/**
 * Chunks extracted at once. Chunk latency dominates a multi-chunk request, so running
 * them in series makes a six-part file take six times as long for no benefit. Kept
 * small deliberately: the point is to overlap the waiting, not to spend the account's
 * whole rate-limit budget on one upload.
 */
export const DEFAULT_CHUNK_CONCURRENCY = 4;

export function getChunkConcurrency(): number {
  const raw = Number(process.env.CHUNK_CONCURRENCY);
  if (!Number.isInteger(raw) || raw < 1) return DEFAULT_CHUNK_CONCURRENCY;
  return Math.min(raw, MAX_CHUNKS);
}

/** Attempts to repair a response that failed schema validation, after the first try. */
export const MAX_REPAIR_ATTEMPTS = 1;

/** Attempts for transport-level failures (timeout, 5xx, rate limit) before giving up. */
export const MAX_TRANSPORT_ATTEMPTS = 3;

/** Per-call timeout for the provider. */
export const PROVIDER_TIMEOUT_MS = 90_000;

/** Requests allowed per IP per window. Internal-tool sizing. */
export const RATE_LIMIT_MAX = 20;
export const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Every timing and accuracy figure in the docs was measured on this model. Overriding
 * it with OPENAI_MODEL is supported and expected — a faster or stronger model is one
 * env var — but the default is the one the numbers describe.
 */
export const DEFAULT_MODEL = "gpt-4.1-mini";

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
