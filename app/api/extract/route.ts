import { getModel } from "@/lib/config";
import { toExtractionError } from "@/lib/errors";
import { runExtraction } from "@/lib/extraction/pipeline";
import { isExtractionType, EXTRACTION_TYPES } from "@/lib/extraction/types";
import { createLogger, newRequestId } from "@/lib/logger";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { ExtractionError } from "@/lib/errors";

export const maxDuration = 120; // 2 minutes

export async function POST(request: Request) {
  const requestId = newRequestId();
  const logger = createLogger(requestId);

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

    const outcome = await runExtraction(file, rawType, logger);

    logger.info("extraction_succeeded", {
      type: rawType,
      records: outcome.meta.recordCount,
      chunks: outcome.meta.chunks,
      sourcePath: outcome.meta.sourcePath,
      durationMs: logger.elapsedMs(),
    });

    return Response.json({
      success: true,
      type: rawType,
      data: outcome.data,
      meta: {
        requestId,
        ...outcome.meta,
        model: getModel(),
        durationMs: logger.elapsedMs(),
      },
    });
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

    return Response.json(
      {
        success: false,
        type: requestedType,
        data: [],
        error: error.message,
        errorCode: error.code,
        meta: { requestId, durationMs: logger.elapsedMs() },
      },
      { status: error.status },
    );
  }
}
