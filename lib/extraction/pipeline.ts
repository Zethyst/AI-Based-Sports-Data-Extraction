import { chunkText } from "@/lib/files/chunk";
import { parseToSourceDocument } from "@/lib/files/detect";
import { validateFile } from "@/lib/files/validate";
import type { Logger } from "@/lib/logger";
import { mergeRecords } from "./merge";
import { extractChunk } from "./provider/openai";
import { withTransportRetry } from "./provider/retry";
import type { ExtractedRecord } from "./schemas";
import { type ExtractionType, type SourcePath, sourcePathOf } from "./types";

/**
 * The orchestrator: validate, parse, chunk, extract, merge.

 */

export interface ExtractionMeta {
  recordCount: number;
  fileName: string;
  detectedFormat: string;
  sourcePath: SourcePath;
  chunks: number;
  duplicatesRemoved: number;
  repairAttempts: number;
  model: string;
  durationMs: number;
  warnings: string[];
}

export interface ExtractionOutcome {
  data: ExtractedRecord[];
  meta: Omit<ExtractionMeta, "durationMs" | "model">;
}

export async function runExtraction(
  file: File,
  type: ExtractionType,
  logger: Logger,
): Promise<ExtractionOutcome> {
  const validated = await validateFile(file);

  logger.info("file_validated", {
    format: validated.format,
    bytes: validated.size,
  });

  const doc = await parseToSourceDocument(validated);
  const warnings = [...doc.meta.warnings];

  logger.info("file_parsed", {
    kind: doc.kind,
    sourcePath: sourcePathOf(doc),
    pages: doc.meta.pages ?? null,
    sheets: doc.meta.sheets?.length ?? null,
    textChars: doc.kind === "text" ? doc.text.length : null,
  });

  // Only text can be split. A vision document is one call regardless of page count —
  // the model receives the whole file and reads it as a unit.
  const chunks =
    doc.kind === "text" ? chunkText(doc.text) : { chunks: [{ text: "", index: 0 }], truncated: false };

  if (chunks.truncated) {
    warnings.push(
      "This file was larger than the per-request ceiling and only its first sections were read. Split the file and extract each part separately for complete results.",
    );
    logger.warn("chunk_ceiling_reached", { chunks: chunks.chunks.length });
  }

  const chunkResults: ExtractedRecord[][] = [];
  let repairAttempts = 0;

  // Sequential rather than parallel: chunk count is capped and small, and serialising
  // keeps us clear of provider rate limits without a concurrency budget to tune.
  for (const chunk of chunks.chunks) {
    const result = await withTransportRetry(
      () =>
        extractChunk({
          type,
          doc,
          chunkText: doc.kind === "text" ? chunk.text : undefined,
          chunkIndex: chunk.index,
          chunkCount: chunks.chunks.length,
          logger,
        }),
      logger,
      `chunk_${chunk.index}`,
    );

    chunkResults.push(result.records);
    repairAttempts += result.repairAttempts;

    logger.info("chunk_extracted", {
      chunkIndex: chunk.index,
      records: result.records.length,
      repairs: result.repairAttempts,
    });
  }

  const merged = mergeRecords(type, chunkResults);

  // An empty result is a correct answer, not a failure. It is worth
  // saying so explicitly, because the most common cause is a type/file mismatch and
  // the user is better served by that hint than by silence.
  if (merged.records.length === 0) {
    warnings.push(
      `No ${type} data was found in this file. If the file does contain it, check that the extraction type matches what the document is about.`,
    );
  }

  return {
    data: merged.records,
    meta: {
      recordCount: merged.records.length,
      fileName: validated.fileName,
      detectedFormat: validated.format,
      sourcePath: sourcePathOf(doc),
      chunks: chunks.chunks.length,
      duplicatesRemoved: merged.duplicatesRemoved,
      repairAttempts,
      warnings,
    },
  };
}
