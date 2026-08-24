import { fileTypeFromBuffer } from "file-type";
import { ExtractionError, formatBytes } from "@/lib/errors";
import type { SourceFormat } from "@/lib/extraction/types";
import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES } from "@/lib/upload-constraints";

/**
 * File validation, in the order that fails cheapest first: size, then extension,
 * then magic bytes.
 *
 * The magic-byte check is the one that matters. An extension is a claim made by
 * whoever uploaded the file; the container's leading bytes are a fact about it. A
 * renamed executable must never reach a parser.
 */

/**
 * Typed as a record over ACCEPTED_EXTENSIONS so the client-facing list in
 * upload-constraints.ts and the server's dispatch table cannot drift: adding an
 * extension to one without the other fails the build.
 */
const EXTENSION_FORMATS: Record<(typeof ACCEPTED_EXTENSIONS)[number], SourceFormat> = {
  pdf: "pdf",
  csv: "csv",
  xlsx: "xlsx",
  xls: "xls",
  docx: "docx",
  txt: "txt",
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
};

/**
 * What each format's magic bytes are allowed to sniff as.
 *
 * `.xlsx` and `.docx` are both ZIP containers, so file-type reports them by their
 * inner content type when it can and as `zip` when it can't — both are acceptable.
 * The plain-text formats have no magic bytes at all, which is why they map to
 * `undefined` rather than to a sniffed value.
 */
const ALLOWED_SNIFFS: Record<SourceFormat, string[] | null> = {
  pdf: ["pdf"],
  xlsx: ["xlsx", "zip", "cfb", "xls"],
  xls: ["xls", "cfb", "zip", "xlsx"],
  docx: ["docx", "zip", "cfb"],
  jpeg: ["jpg"],
  png: ["png"],
  csv: null, // text — nothing to sniff
  txt: null,
};

export interface ValidatedFile {
  bytes: Uint8Array;
  format: SourceFormat;
  fileName: string;
  size: number;
}

export function extensionOf(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "";
}

/** Strip any path components a client may have sent, so logs and echoes stay clean. */
export function safeFileName(fileName: string): string {
  return fileName.split(/[/\\]/).pop()?.slice(0, 200) || "upload";
}

export async function validateFile(file: File): Promise<ValidatedFile> {
  const fileName = safeFileName(file.name);

  if (file.size === 0) {
    throw new ExtractionError("EMPTY_FILE", "That file is empty. Please upload a file with content in it.");
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new ExtractionError(
      "FILE_TOO_LARGE",
      `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)}.`,
    );
  }

  const extension = extensionOf(fileName);
  const format = EXTENSION_FORMATS[extension as (typeof ACCEPTED_EXTENSIONS)[number]];

  if (!format) {
    throw new ExtractionError(
      "UNSUPPORTED_FILE_TYPE",
      `${extension ? `.${extension} files are` : "That file type is"} not supported. Accepted formats: ${ACCEPTED_EXTENSIONS.join(", ")}.`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const allowedSniffs = ALLOWED_SNIFFS[format];

  if (allowedSniffs) {
    const sniffed = await fileTypeFromBuffer(bytes);

    if (!sniffed || !allowedSniffs.includes(sniffed.ext)) {
      throw new ExtractionError(
        "UNSUPPORTED_FILE_TYPE",
        `That file is named .${extension} but its contents are not a valid ${format.toUpperCase()} file.`,
        `sniffed=${sniffed?.ext ?? "none"} expected=${allowedSniffs.join("|")}`,
      );
    }
  }

  return { bytes, format, fileName, size: file.size };
}
