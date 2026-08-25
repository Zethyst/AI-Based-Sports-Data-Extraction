import { getModel } from "@/lib/config";
import type { ExtractResponse } from "@/lib/api-types";
import { ExtractionError, toExtractionError } from "@/lib/errors";
import { runExtraction } from "@/lib/extraction/pipeline";
import { EXTRACTION_TYPES, isExtractionType } from "@/lib/extraction/types";
import { type Logger, createLogger, newRequestId } from "@/lib/logger";
import type { ProgressUpdate } from "@/lib/progress";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";

export const maxDuration = 120; // 2 minutes

/**
 * HTTP only: form in, response out. Everything that decides anything lives in the
 * pipeline.
 *
 * Two response modes over one implementation. Without `?stream=1` the caller gets the
 * documented single JSON body. With it, the same payload arrives as the last line of an
 * NDJSON stream preceded by progress lines — the model calls take seconds and a caller
 * that can show what is happening during them is worth the second mode. The buffered
 * form stays the default so the documented contract is what an unprepared client gets.
 */
export async function POST(request: Request) {
  const requestId = newRequestId();
  const logger = createLogger(requestId);
  const streaming = new URL(request.url).searchParams.get("stream") === "1";

  if (!streaming) {
    const { status, payload } = await handle(request, requestId, logger, () => {});
    return Response.json(payload, { status });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (line: unknown) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));

      try {
        const { status, payload } = await handle(request, requestId, logger, (update) =>
          write({ event: "progress", ...update }),
        );
        write({ event: "result", status, ...payload });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Progress is worthless if a proxy holds it until the body completes.
      "X-Accel-Buffering": "no",
    },
  });
}

interface Handled {
  status: number;
  payload: ExtractResponse;
}

async function handle(
  request: Request,
  requestId: string,
  logger: Logger,
  onProgress: (update: ProgressUpdate) => void,
): Promise<Handled> {
  let requestedType = "unknown";

  try {
    const limit = checkRateLimit(clientKey(request));
    if (!limit.allowed) {
      throw new ExtractionError(
        "RATE_LIMITED",
        `Too many requests. Please try again in ${limit.retryAfterSeconds} seconds.`,
      );
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch (err) {
      throw new ExtractionError(
        "CORRUPT_FILE",
        "The upload could not be read. It may have been interrupted — please try again.",
        err instanceof Error ? err.message : String(err),
      );
    }

    const rawType = form.get("extractionType");
    requestedType = typeof rawType === "string" ? rawType : "unknown";

    if (!isExtractionType(rawType)) {
      throw new ExtractionError(
        "INVALID_EXTRACTION_TYPE",
        `"${requestedType}" is not a valid extraction type. Choose one of: ${EXTRACTION_TYPES.join(", ")}.`,
      );
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ExtractionError("MISSING_FILE", "No file was uploaded. Please choose a file first.");
    }

    logger.info("extraction_started", { type: rawType, fileName: file.name, bytes: file.size });

    const outcome = await runExtraction(file, rawType, logger, { onProgress });

    logger.info("extraction_succeeded", {
      type: rawType,
      records: outcome.meta.recordCount,
      chunks: outcome.meta.chunks,
      sourcePath: outcome.meta.sourcePath,
      parseMs: outcome.meta.timings.parseMs,
      modelMs: outcome.meta.timings.modelMs,
      durationMs: logger.elapsedMs(),
    });

    return {
      status: 200,
      payload: {
        success: true,
        type: rawType,
        data: outcome.data,
        meta: {
          requestId,
          ...outcome.meta,
          model: getModel(),
          durationMs: logger.elapsedMs(),
        },
      },
    };
  } catch (err) {
    const error = toExtractionError(err);

    // `detail` can carry provider messages and file internals — it belongs in the
    // log, never in the response body.
    logger.error("extraction_failed", {
      code: error.code,
      status: error.status,
      type: requestedType,
      detail: error.detail ?? null,
      durationMs: logger.elapsedMs(),
    });

    return {
      status: error.status,
      payload: {
        success: false,
        type: requestedType,
        data: [],
        error: error.message,
        errorCode: error.code,
        meta: { requestId, durationMs: logger.elapsedMs() },
      },
    };
  }
}
