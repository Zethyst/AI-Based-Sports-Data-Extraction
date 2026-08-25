import { MAX_CHUNKS, getChunkCharLimit, getChunkLineLimit } from "@/lib/config";

export interface Chunk {
  text: string;
  index: number;
}

/** Section markers written by the parsers — the natural seams in a document. */
const SECTION_MARKER = /^--- (?:Sheet|Page): ?.*---$|^--- (?:Sheet|Page) .*---$/;

/**
 * Sheets specifically, as opposed to pages.
 *
 * The two are not the same kind of seam. A page break falls in the middle of a
 * document that reads continuously, and packing pages together is free. Sheets are
 * separate tables that happen to share a file — often with different columns — and a
 * model handed three of them in one request will sometimes answer for two. Observed on
 * `samples/athletes-squad.xlsx`: one run in three silently omitted the short trailing
 * "Reserves" sheet. One sheet per call removes the opportunity, and since chunks run
 * concurrently it costs calls rather than seconds.
 */
const SHEET_MARKER = /^--- Sheet[: ]/;

export interface ChunkResult {
  chunks: Chunk[];
  truncated: boolean;
}

/**
 * Splits source text into chunks small enough for one model call to handle completely.
 *
 * Two ceilings, whichever is reached first. The character limit is about the input: a
 * chunk has to fit in the context window. The line limit is about the *output*, and it
 * is the one that usually binds — a response has a token ceiling too, and a chunk
 * holding 900 table rows produces an answer the model simply stops writing partway
 * through. It does not fail; it returns a short list that looks complete. One line is a
 * good enough proxy for one record in tabular text, and prose — few lines, long ones —
 * is governed by the character limit instead, as it should be.
 */
export function chunkText(
  text: string,
  limit = getChunkCharLimit(),
  lineLimit = getChunkLineLimit(),
): ChunkResult {
  const trimmed = text.trim();

  const oneSheet = countSheets(trimmed) <= 1;

  if (oneSheet && trimmed.length <= limit && countLines(trimmed) <= lineLimit) {
    return { chunks: [{ text: trimmed, index: 0 }], truncated: false };
  }

  const lines = trimmed.split("\n");
  const chunks: string[] = [];

  let current: string[] = [];
  let currentLength = 0;
  // The most recent section marker and the header row that followed it. Both are
  // replayed at the top of any chunk that continues the same section.
  let sectionHeader: string[] = [];

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current.join("\n"));
      current = [];
      currentLength = 0;
    }
  };

  for (const line of lines) {
    if (SECTION_MARKER.test(line.trim())) {
      // A new sheet or page: close the chunk in progress so sections never bleed
      // together, and start tracking this section's header.
      flush();
      sectionHeader = [line];
      current = [line];
      currentLength = line.length + 1;
      continue;
    }

    // The first data line after a section marker is, for a spreadsheet, the column
    // header row. Worth carrying into continuation chunks.
    if (sectionHeader.length === 1 && current.length === 1) {
      sectionHeader.push(line);
    }

    const overCharLimit = currentLength + line.length + 1 > limit;
    const overLineLimit = current.length >= lineLimit;

    if ((overCharLimit || overLineLimit) && current.length > 0) {
      flush();
      // Replay the section context so a continuation chunk is still interpretable.
      if (sectionHeader.length > 0) {
        const continuation = [...sectionHeader];
        continuation[0] = `${sectionHeader[0]} (continued)`;
        current = continuation;
        currentLength = continuation.join("\n").length + 1;
      }
    }

    current.push(line);
    currentLength += line.length + 1;
  }

  flush();

  const truncated = chunks.length > MAX_CHUNKS;

  return {
    chunks: chunks
      .slice(0, MAX_CHUNKS)
      .map((chunkText, index) => ({ text: chunkText, index })),
    truncated,
  };
}

function countSheets(text: string): number {
  let count = 0;
  for (const line of text.split("\n")) {
    if (SHEET_MARKER.test(line.trim())) count += 1;
  }
  return count;
}

function countLines(text: string): number {
  let count = 1;
  for (const character of text) if (character === "\n") count += 1;
  return count;
}
