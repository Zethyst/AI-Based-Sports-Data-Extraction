import * as XLSX from "xlsx";
import { ExtractionError } from "@/lib/errors";
import type { SourceDocument } from "@/lib/extraction/types";
import type { ValidatedFile } from "../validate";

/**
 * Excel and CSV, through one parser — SheetJS reads both, and a CSV is just a
 * workbook with a single sheet as far as everything downstream is concerned.
 *
 * Sheets are rendered as CSV rather than as prose. It is compact, it preserves the
 * column structure that tells the model which number is a rank and which is a score,
 * and it gives the chunker clean row boundaries to split on.
 */
export function parseSpreadsheet(file: ValidatedFile): SourceDocument {
  const warnings: string[] = [];
  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(file.bytes, { type: "array", cellDates: true, cellText: false });
  } catch (err) {
    throw new ExtractionError(
      "CORRUPT_FILE",
      "That spreadsheet could not be opened. It may be damaged, password-protected, or saved in an unusual format.",
      err instanceof Error ? err.message : String(err),
    );
  }

  const sheetNames = workbook.SheetNames ?? [];

  if (sheetNames.length === 0) {
    throw new ExtractionError("EMPTY_FILE", "That workbook has no sheets in it.");
  }

  const sections: string[] = [];
  const populatedSheets: string[] = [];

  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;

    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, dateNF: "yyyy-mm-dd" }).trim();

    if (!csv) {
      warnings.push(`Sheet "${name}" is empty and was skipped.`);
      continue;
    }

    populatedSheets.push(name);
    // The sheet name is often the only place the sport or event is recorded,
    // so it goes in as content, not just as a label.
    sections.push(`--- Sheet: ${name} ---\n${csv}`);
  }

  if (sections.length === 0) {
    throw new ExtractionError(
      "EMPTY_FILE",
      "That spreadsheet has no data in it — every sheet is empty.",
    );
  }

  return {
    kind: "text",
    text: sections.join("\n\n"),
    meta: {
      format: file.format,
      fileName: file.fileName,
      sheets: populatedSheets,
      warnings,
    },
  };
}
