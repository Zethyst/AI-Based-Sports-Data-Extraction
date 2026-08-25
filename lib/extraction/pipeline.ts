import { getChunkConcurrency } from "@/lib/config";
import { mapWithConcurrency } from "@/lib/concurrency";
import { type ChunkResult, chunkText } from "@/lib/files/chunk";
import { parseToSourceDocument } from "@/lib/files/detect";
import { validateFile } from "@/lib/files/validate";
import type { Logger } from "@/lib/logger";
import type { ProgressUpdate } from "@/lib/progress";
import { mergeRecords } from "./merge";
import { extractChunk } from "./provider/openai";
import { withTransportRetry } from "./provider/retry";
import type { ExtractedRecord } from "./schemas";
import { type ExtractionType, type SourceDocument, type SourcePath, sourcePathOf } from "./types";

/**
 * The orchestrator: validate, parse, chunk, extract, merge.
 *
 * Every step here is cheap except the model calls, which are the entire wall clock of
 * a request. That shapes two things below: chunks are extracted concurrently rather
 * than in series, and progress is reported as it happens so a caller can show something
 * during the wait instead of a spinner.
 */

/**
 * Where the time actually went. Reported in `meta` and logged, because "extraction is
 * slow" is not actionable and "the parse took 80ms and the model took 11s" is.
 */
export interface PhaseTimings {
  parseMs: number;
  modelMs: number;
}

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
  timings: PhaseTimings;
  warnings: string[];
}

export interface ExtractionOutcome {
  data: ExtractedRecord[];
  meta: Omit<ExtractionMeta, "durationMs" | "model">;
}

export interface RunExtractionOptions {
  onProgress?: (update: ProgressUpdate) => void;
}

/** A vision document is one call regardless of page count: the model reads the file whole. */
function singleVisionPass(): ChunkResult {
  return { chunks: [{ text: "", index: 0 }], truncated: false };
}

export async function runExtraction(
  file: File,
  type: ExtractionType,
  logger: Logger,
  options: RunExtractionOptions = {},
): Promise<ExtractionOutcome> {
  const report = options.onProgress ?? (() => {});

  const parseStartedAt = Date.now();
  report({ stage: "parsing", message: "Reading the file" });

  const validated = await validateFile(file);

  logger.info("file_validated", {
    format: validated.format,
    bytes: validated.size,
  });

  const doc = await parseToSourceDocument(validated);
  const warnings = [...doc.meta.warnings];
  const parseMs = Date.now() - parseStartedAt;

  logger.info("file_parsed", {
    kind: doc.kind,
    sourcePath: sourcePathOf(doc),
    pages: doc.meta.pages ?? null,
    sheets: doc.meta.sheets?.length ?? null,
    textChars: doc.kind === "text" ? doc.text.length : null,
    parseMs,
  });

  // Only text can be split.
  const plan = doc.kind === "text" ? chunkText(doc.text) : singleVisionPass();

  if (plan.truncated) {
    warnings.push(
      "This file was larger than the per-request ceiling and only its first sections were read. Split the file and extract each part separately for complete results.",
    );
    logger.warn("chunk_ceiling_reached", { chunks: plan.chunks.length });
  }

  const modelStartedAt = Date.now();
  const { chunkResults, repairAttempts } = await extractAllChunks({
    type,
    doc,
    plan,
    logger,
    report,
  });
  const modelMs = Date.now() - modelStartedAt;

  report({ stage: "merging", message: "Merging results" });
  const merged = mergeRecords(type, chunkResults);

  // An empty result is a correct answer, not a failure. It is worth saying so
  // explicitly, because the most common cause is a type/file mismatch and the user is
  // better served by that hint than by silence.
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
      chunks: plan.chunks.length,
      duplicatesRemoved: merged.duplicatesRemoved,
      repairAttempts,
      timings: { parseMs, modelMs },
      warnings,
    },
  };
}

interface ExtractAllArgs {
  type: ExtractionType;
  doc: SourceDocument;
  plan: ChunkResult;
  logger: Logger;
  report: (update: ProgressUpdate) => void;
}

/**
 * Extracts every chunk, a few at a time.
 *
 * Chunks are independent by construction — the splitter never breaks a record across
 * a boundary — so overlapping them costs nothing in accuracy and divides the wait.
 * `mapWithConcurrency` keeps the results in chunk order, which the merge relies on:
 * when two sightings of one record disagree about a field, the earlier chunk wins.
 */
async function extractAllChunks(
  args: ExtractAllArgs,
): Promise<{ chunkResults: ExtractedRecord[][]; repairAttempts: number }> {
  const { type, doc, plan, logger, report } = args;

  const total = plan.chunks.length;
  let completed = 0;
  let repairAttempts = 0;

  // Parts run concurrently, so "part 3 of 4" would be a lie about which one is in
  // flight. Completed-out-of-total is both true and the number a waiting user wants.
  const describe = () => {
    if (total === 1) return `Extracting ${type} data`;
    if (completed === 0) return `Extracting ${type} data from ${total} parts`;
    return `Extracting ${type} data — ${completed} of ${total} parts done`;
  };

  report({ stage: "extracting", message: describe(), completedChunks: 0, totalChunks: total });

  const results = await mapWithConcurrency(plan.chunks, getChunkConcurrency(), async (chunk) => {
    const startedAt = Date.now();

    const result = await withTransportRetry(
      () =>
        extractChunk({
          type,
          doc,
          chunkText: doc.kind === "text" ? chunk.text : undefined,
          chunkIndex: chunk.index,
          chunkCount: total,
          logger,
        }),
      logger,
      `chunk_${chunk.index}`,
    );

    completed += 1;
    repairAttempts += result.repairAttempts;

    logger.info("chunk_extracted", {
      chunkIndex: chunk.index,
      records: result.records.length,
      repairs: result.repairAttempts,
      durationMs: Date.now() - startedAt,
    });

    report({
      stage: "extracting",
      message: describe(),
      completedChunks: completed,
      totalChunks: total,
    });

    return result.records;
  });

  return { chunkResults: results, repairAttempts };
}
