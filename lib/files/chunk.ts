import { CHUNK_CHAR_LIMIT, MAX_CHUNKS } from "@/lib/config";

export interface Chunk {
  text: string;
  index: number;
}

/** Section markers written by the parsers — the natural seams in a document. */
const SECTION_MARKER = /^--- (?:Sheet|Page): ?.*---$|^--- (?:Sheet|Page) .*---$/;

export interface ChunkResult {
  chunks: Chunk[];
  truncated: boolean;
}

export function chunkText(text: string, limit = CHUNK_CHAR_LIMIT): ChunkResult {
  const trimmed = text.trim();

  if (trimmed.length <= limit) {
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

    if (currentLength + line.length + 1 > limit && current.length > 0) {
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
