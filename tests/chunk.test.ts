import { describe, expect, it } from "vitest";
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

  it("keeps two small sheets together rather than paying for a second call", () => {
    const source = `${sheet("Men", 3)}\n\n${sheet("Women", 3, "w")}`;
    const result = chunkText(source, 10_000);

    // Both sheets fit comfortably, so one call is correct. Their markers survive,
    // which is what lets the model tell the two apart.
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toContain("--- Sheet: Men ---");
    expect(result.chunks[0].text).toContain("--- Sheet: Women ---");
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

  it("flags truncation when the chunk ceiling is hit", () => {
    const result = chunkText(sheet("Results", 50_000), 500);
    expect(result.truncated).toBe(true);
    expect(result.chunks.length).toBeLessThanOrEqual(12);
  });

  it("indexes chunks sequentially from zero", () => {
    const result = chunkText(sheet("Results", 2000), 2000);
    expect(result.chunks.map((chunk) => chunk.index)).toEqual(
      result.chunks.map((_, index) => index),
    );
  });
});
