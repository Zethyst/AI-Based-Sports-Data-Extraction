/**
 * Every parser in lib/files/parsers returns a SourceDocument. Nothing downstream
 * of a parser knows what a .docx is — the provider adapter only ever sees one of
 * three shapes, and adding a format means adding a parser, not editing the route.
 */

export const EXTRACTION_TYPES = ["ranking", "record", "athletes", "teams", "events"] as const;

export type ExtractionType = (typeof EXTRACTION_TYPES)[number];

export function isExtractionType(value: unknown): value is ExtractionType {
  return typeof value === "string" && (EXTRACTION_TYPES as readonly string[]).includes(value);
}

/** Formats we accept. Detected from magic bytes where the container allows it. */
export const SOURCE_FORMATS = ["pdf", "csv", "xlsx", "xls", "docx", "txt", "jpeg", "png"] as const;

export type SourceFormat = (typeof SOURCE_FORMATS)[number];

/** How the document's content reached us — surfaced in meta.sourcePath for diagnosis. */
export type SourcePath = "text-layer" | "vision";

export interface SourceMeta {
  format: SourceFormat;
  fileName: string;
  /** PDF page count, where known. */
  pages?: number;
  /** Worksheet names, for spreadsheets. */
  sheets?: string[];
  /** Anything the parser wants the caller to know, surfaced in meta.warnings. */
  warnings: string[];
}

/**
 * Text we extracted ourselves. The cheap, exact, chunkable path — preferred
 * whenever the file actually contains a text layer.
 */
export interface TextDocument {
  kind: "text";
  text: string;
  meta: SourceMeta;
}

/** Uploaded images, sent to the model as data URLs. */
export interface ImageDocument {
  kind: "images";
  images: Array<{ dataUrl: string; label: string }>;
  meta: SourceMeta;
}

/**
 * The file itself, handed to the model to render and read. Used for PDFs with no
 * usable text layer (Decision 03).
 */
export interface FileDocument {
  kind: "file";
  base64: string;
  mimeType: string;
  meta: SourceMeta;
}

export type SourceDocument = TextDocument | ImageDocument | FileDocument;

export function sourcePathOf(doc: SourceDocument): SourcePath {
  return doc.kind === "text" ? "text-layer" : "vision";
}
