import { describe, expect, it } from "vitest";
import { MAX_CHUNKS } from "@/lib/config";
import { chunkText } from "@/lib/files/chunk";

/** Builds a CSV-shaped sheet section of roughly `rows` data rows. */
function sheet(name: string, rows: number, prefix = "row") {
  const lines = [`--- Sheet: ${name} ---`, "rank,athleteName,country,points"];
  for (let i = 1; i <= rows; i += 1) {
    lines.push(`${i},${prefix} Athlete ${i},India,${1000 - i}`);
  }
  return lines.join("\n");
}

describe("chunkText", () => {
  it("leaves a small document as one chunk", () => {
    const result = chunkText(sheet("Results", 5));
    expect(result.chunks).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });

  it("splits a document larger than the limit", () => {
    const result = chunkText(sheet("Results", 2000), 2000);
    expect(result.chunks.length).toBeGreaterThan(1);
  });

  it("never splits mid-line", () => {
    const source = sheet("Results", 2000);
    const result = chunkText(source, 2000);

    for (const chunk of result.chunks) {
      for (const line of chunk.text.split("\n")) {
        if (line.startsWith("--- Sheet")) continue;
        if (line === "rank,athleteName,country,points") continue;
        // Every data row must still have its four fields — a mid-line cut would
        // leave a fragment here.
        expect(line.split(",")).toHaveLength(4);
      }
    }
  });

  it("carries the section header and column header into continuation chunks", () => {
    const result = chunkText(sheet("Results", 2000), 2000);

    for (const chunk of result.chunks.slice(1)) {
      expect(chunk.text).toContain("--- Sheet: Results ---");
      expect(chunk.text).toContain("rank,athleteName,country,points");
    }
  });

  it("separates two small sheets, and keeps each one's marker with it", () => {
    const source = `${sheet("Men", 3)}\n\n${sheet("Women", 3, "w")}`;
    const result = chunkText(source, 10_000);

    // Both would fit in one call, and for a while they took one. They now get one
    // each: a request holding two sheets is a request the model can half-answer,
    // and separate calls remove the choice rather than asking it not to.
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0].text).toContain("--- Sheet: Men ---");
    expect(result.chunks[0].text).not.toContain("--- Sheet: Women ---");
    expect(result.chunks[1].text).toContain("--- Sheet: Women ---");
  });

  it("never attributes a continuation header to the wrong sheet", () => {
    // Men is large enough to split; Women follows it. The invariant that matters is
    // that a chunk replaying "Men (continued)" contains no Women rows, and vice versa
    // — a misattributed header would put an athlete under the wrong event entirely.
    // Prefixes chosen so neither is a substring of the other — otherwise the
    // assertions below pass or fail for the wrong reason.
    const source = `${sheet("Men", 400, "Alpha")}\n\n${sheet("Women", 400, "Beta")}`;
    const result = chunkText(source, 2000);

    expect(result.chunks.length).toBeGreaterThan(2);

    for (const chunk of result.chunks) {
      const claimsMen = chunk.text.includes("Sheet: Men");
      const claimsWomen = chunk.text.includes("Sheet: Women");

      // A chunk belongs to exactly one section.
      expect(claimsMen && claimsWomen).toBe(false);

      if (claimsMen) expect(chunk.text).not.toContain("Beta Athlete");
      if (claimsWomen) expect(chunk.text).not.toContain("Alpha Athlete");
    }
  });

  it("preserves every data row across the split", () => {
    const source = sheet("Results", 500);
    const result = chunkText(source, 2000);

    const rejoined = result.chunks.map((chunk) => chunk.text).join("\n");
    for (let i = 1; i <= 500; i += 1) {
      expect(rejoined).toContain(`row Athlete ${i},`);
    }
  });

  it("splits on the line limit even when the text is far under the character limit", () => {
    // The regression this guards: 300 short rows is ~9KB, so a character-only limit
    // saw one chunk, and the model silently returned a third of the rows.
    const source = sheet("Results", 300);
    expect(source.length).toBeLessThan(40_000);

    const result = chunkText(source, 40_000, 80);

    expect(result.chunks.length).toBeGreaterThan(1);
    for (const chunk of result.chunks) {
      expect(chunk.text.split("\n").length).toBeLessThanOrEqual(80);
    }
  });

  it("keeps every row when the line limit does the splitting", () => {
    const result = chunkText(sheet("Results", 300), 40_000, 80);
    const rejoined = result.chunks.map((chunk) => chunk.text).join("\n");

    for (let i = 1; i <= 300; i += 1) {
      expect(rejoined).toContain(`,row Athlete ${i},`);
    }
  });

  it("leaves prose alone — few long lines stay in one chunk", () => {
    // Same byte count as the table above, but as paragraphs. The line limit must not
    // fire here, or every prose document pays for calls it does not need.
    const prose = Array.from({ length: 12 }, (_, i) => `Paragraph ${i}. ${"word ".repeat(120)}`);
    const result = chunkText(prose.join("\n"), 40_000, 80);

    expect(result.chunks).toHaveLength(1);
  });

  it("gives each sheet its own chunk even when they would all fit in one", () => {
    const source = [sheet("Squad", 4), sheet("Coaches", 3), sheet("Reserves", 2)].join("\n");

    const result = chunkText(source, 40_000, 80);

    expect(result.chunks).toHaveLength(3);
    expect(result.chunks[2].text).toContain("--- Sheet: Reserves ---");
  });

  it("keeps a multi-page document in one chunk when it fits", () => {
    // Pages are a seam, not a boundary — splitting them costs calls for nothing.
    const pages = Array.from(
      { length: 6 },
      (_, i) => `--- Page ${i + 1} of 6 ---\nSome continuous prose on page ${i + 1}.`,
    );

    const result = chunkText(pages.join("\n"), 40_000, 80);

    expect(result.chunks).toHaveLength(1);
  });

  it("flags truncation when the chunk ceiling is hit", () => {
    const result = chunkText(sheet("Results", 50_000), 500);
    expect(result.truncated).toBe(true);
    expect(result.chunks.length).toBeLessThanOrEqual(MAX_CHUNKS);
  });

  it("indexes chunks sequentially from zero", () => {
    const result = chunkText(sheet("Results", 2000), 2000);
    expect(result.chunks.map((chunk) => chunk.index)).toEqual(
      result.chunks.map((_, index) => index),
    );
  });
});
