import { ExtractionError } from "@/lib/errors";
import type { SourceDocument } from "@/lib/extraction/types";
import type { ValidatedFile } from "../validate";

/**
 * Plain text. The one format with no container to go wrong — the only real failure
 * is bytes that aren't text at all, which the strict decoder below catches.
 */
export function parseText(file: ValidatedFile): SourceDocument {
  let text: string;

  try {
    // `fatal` makes the decoder throw on invalid sequences rather than silently
    // littering the output with replacement characters, which would reach the model
    // as corrupted athlete names.
    text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
  } catch {
    try {
      // Sports federations still export Latin-1 from legacy systems often enough
      // that it is worth one fallback before giving up.
      text = new TextDecoder("latin1").decode(file.bytes);
    } catch (err) {
      throw new ExtractionError(
        "CORRUPT_FILE",
        "That file could not be read as text. It may be binary, or saved in an unsupported encoding.",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // A UTF-8 BOM survives decoding and shows up as a stray character on the first
  // field of the first record.
  text = text.replace(/^﻿/, "");

  if (!text.trim()) {
    throw new ExtractionError("EMPTY_FILE", "That file contains no text.");
  }

  return {
    kind: "text",
    text,
    meta: { format: file.format, fileName: file.fileName, warnings: [] },
  };
}
