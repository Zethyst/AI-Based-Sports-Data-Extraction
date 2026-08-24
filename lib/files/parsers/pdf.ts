import { extractText, getDocumentProxy } from "unpdf";
import { MIN_CHARS_PER_PAGE, isVisionFallbackEnabled } from "@/lib/config";
import { ExtractionError } from "@/lib/errors";
import type { SourceDocument } from "@/lib/extraction/types";
import type { ValidatedFile } from "../validate";

export async function parsePdf(file: ValidatedFile): Promise<SourceDocument> {
  const warnings: string[] = [];
  let pageTexts: string[];
  let totalPages: number;

  try {
    // getDocumentProxy consumes the buffer, so hand it a copy — the same bytes are
    // needed again below if we fall through to the vision path.
    const pdf = await getDocumentProxy(new Uint8Array(file.bytes));
    const result = await extractText(pdf, { mergePages: false });
    totalPages = result.totalPages;
    pageTexts = result.text;
  } catch (err) {
    throw new ExtractionError(
      "CORRUPT_FILE",
      "That PDF could not be opened. It may be damaged, encrypted, or incomplete.",
      err instanceof Error ? err.message : String(err),
    );
  }

  if (totalPages === 0) {
    throw new ExtractionError("EMPTY_FILE", "That PDF has no pages in it.");
  }

  const joined = pageTexts.join("\n\n").trim();
  const charsPerPage = joined.length / totalPages;
  const hasTextLayer = charsPerPage >= MIN_CHARS_PER_PAGE;

  if (hasTextLayer) {
    // Label pages so the model can attribute a record to where it came from, and so
    // the chunker has an obvious boundary to split on.
    const labelled = pageTexts
      .map((text, index) => `--- Page ${index + 1} of ${totalPages} ---\n${text.trim()}`)
      .join("\n\n");

    return {
      kind: "text",
      text: labelled,
      meta: { format: "pdf", fileName: file.fileName, pages: totalPages, warnings },
    };
  }

  if (!isVisionFallbackEnabled()) {
    throw new ExtractionError(
      "NO_TEXT_CONTENT",
      "That PDF has no readable text layer — it looks like a scan. Reading scanned files is currently disabled. Please upload a text-based PDF, or a spreadsheet of the same data.",
      `charsPerPage=${charsPerPage.toFixed(1)} pages=${totalPages}`,
    );
  }

  warnings.push(
    `No text layer found (${charsPerPage.toFixed(0)} characters per page). Pages were read visually, which is slower and less exact than text extraction.`,
  );

  return {
    kind: "file",
    base64: Buffer.from(file.bytes).toString("base64"),
    mimeType: "application/pdf",
    meta: { format: "pdf", fileName: file.fileName, pages: totalPages, warnings },
  };
}
