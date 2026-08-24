import { MAX_TRANSPORT_ATTEMPTS } from "@/lib/config";
import { ExtractionError } from "@/lib/errors";
import type { Logger } from "@/lib/logger";

/** Errors worth trying again. A 400 means our request is wrong; repeating it won't help. */
function isRetryable(err: unknown): boolean {
  if (err instanceof ExtractionError) return false;

  const status = (err as { status?: number })?.status;
  if (typeof status === "number") {
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }

  const code = (err as { code?: string })?.code;
  return code === "ECONNRESET" || code === "ETIMEDOUT" || code === "APIConnectionError";
}

function delayFor(attempt: number): number {
  // 500ms, 1s, 2s — plus jitter, so concurrent requests don't retry in lockstep.
  const base = 500 * 2 ** attempt;
  return base + Math.random() * 250;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withTransportRetry<T>(
  operation: () => Promise<T>,
  logger: Logger,
  label: string,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_TRANSPORT_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;

      if (!isRetryable(err) || attempt === MAX_TRANSPORT_ATTEMPTS - 1) break;

      const wait = delayFor(attempt);
      logger.warn("provider_retry", {
        label,
        attempt: attempt + 1,
        waitMs: Math.round(wait),
        status: (err as { status?: number })?.status ?? null,
      });
      await sleep(wait);
    }
  }

  // An ExtractionError from inside the operation is already the right shape and
  // carries a message we chose — pass it through rather than flattening it.
  if (lastError instanceof ExtractionError) throw lastError;

  throw new ExtractionError(
    "AI_UNAVAILABLE",
    "The extraction service is unavailable right now. Please try again in a moment.",
    lastError instanceof Error ? `${lastError.name}: ${lastError.message}` : String(lastError),
  );
}
