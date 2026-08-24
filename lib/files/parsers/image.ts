import { isVisionFallbackEnabled } from "@/lib/config";
import { ExtractionError } from "@/lib/errors";
import type { SourceDocument } from "@/lib/extraction/types";
import type { ValidatedFile } from "../validate";

/**
 * Photographs and screenshots — a results board, a printed start list, a page from
 * a record book. There is no text to extract locally, so these always take the
 * vision path.
 */
export function parseImage(file: ValidatedFile): SourceDocument {
  if (!isVisionFallbackEnabled()) {
    throw new ExtractionError(
      "NO_TEXT_CONTENT",
      "Reading images is currently disabled. Please upload a PDF, spreadsheet, or document containing the data as text.",
    );
  }

  const mimeType = file.format === "png" ? "image/png" : "image/jpeg";
  const base64 = Buffer.from(file.bytes).toString("base64");

  return {
    kind: "images",
    images: [{ dataUrl: `data:${mimeType};base64,${base64}`, label: file.fileName }],
    meta: {
      format: file.format,
      fileName: file.fileName,
      warnings: [
        "Data was read from an image. Check names and numbers against the original before relying on them.",
      ],
    },
  };
}
