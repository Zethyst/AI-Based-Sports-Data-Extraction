import mammoth from "mammoth";
import { ExtractionError } from "@/lib/errors";
import type { SourceDocument } from "@/lib/extraction/types";
import type { ValidatedFile } from "../validate";

/**
 * Word documents, via mammoth's HTML conversion.
 *
 * HTML rather than raw text because sports documents put their data in tables, and
 * mammoth's plain-text extraction flattens a table into a run of cell values with no
 * indication of where a row ended. The HTML is converted to pipe-delimited rows below,
 * which keeps the column structure the model needs to tell a rank from a score.
 */
export async function parseDocx(file: ValidatedFile): Promise<SourceDocument> {
  const warnings: string[] = [];
  let html: string;

  try {
    const result = await mammoth.convertToHtml({ buffer: Buffer.from(file.bytes) });
    html = result.value;

    for (const message of result.messages) {
      if (message.type === "error") warnings.push(`Document conversion: ${message.message}`);
    }
  } catch (err) {
    throw new ExtractionError(
      "CORRUPT_FILE",
      "That Word document could not be opened. It may be damaged, or saved in the older .doc format — try re-saving it as .docx.",
      err instanceof Error ? err.message : String(err),
    );
  }

  const text = htmlToStructuredText(html);

  if (!text.trim()) {
    throw new ExtractionError("EMPTY_FILE", "That document has no text in it.");
  }

  return {
    kind: "text",
    text,
    meta: { format: "docx", fileName: file.fileName, warnings },
  };
}

/**
 * Flattens mammoth's HTML into text that keeps table structure.
 *
 * Deliberately small: mammoth emits a narrow, predictable subset of HTML (no scripts,
 * no attributes worth reading, no nesting beyond tables and lists), so a full HTML
 * parser would be weight without benefit here.
 */
function htmlToStructuredText(html: string): string {
  return html
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, " | ") // cell boundaries within a row
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|div)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<table[^>]*>/gi, "\n")
    .replace(/<\/table>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}
