import type { SourceDocument } from "@/lib/extraction/types";
import { parseDocx } from "./parsers/docx";
import { parseImage } from "./parsers/image";
import { parsePdf } from "./parsers/pdf";
import { parseSpreadsheet } from "./parsers/spreadsheet";
import { parseText } from "./parsers/text";
import type { ValidatedFile } from "./validate";

/**
 * The one place format decides behaviour (Decision 02).
 *
 * Every branch returns the same SourceDocument union, so this is the last function
 * in the request that knows what a .docx is. Adding a format is a parser plus a line
 * here; nothing downstream changes.
 */
export async function parseToSourceDocument(file: ValidatedFile): Promise<SourceDocument> {
  switch (file.format) {
    case "pdf":
      return parsePdf(file);

    case "xlsx":
    case "xls":
    case "csv":
      return parseSpreadsheet(file);

    case "docx":
      return parseDocx(file);

    case "txt":
      return parseText(file);

    case "jpeg":
    case "png":
      return parseImage(file);
  }
}
