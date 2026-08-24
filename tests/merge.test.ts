import { describe, expect, it } from "vitest";
import { mergeRecords } from "@/lib/extraction/merge";
import type { AthleteRecord, EventRecord, RankingRecord, TeamRecord } from "@/lib/extraction/schemas";

const athlete = (over: Partial<AthleteRecord>): AthleteRecord => ({
  name: "John Smith",
  country: null,
  dateOfBirth: null,
  gender: null,
  sport: null,
  ...over,
});

describe("mergeRecords", () => {
  it("collapses the same athlete seen in two chunks", () => {
    const result = mergeRecords("athletes", [
      [athlete({ dateOfBirth: "2000-05-12" })],
      [athlete({ dateOfBirth: "2000-05-12", country: "India" })],
    ]);

    expect(result.records).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it("fills a gap from the duplicate without overwriting a known value", () => {
    const result = mergeRecords("athletes", [
      [athlete({ dateOfBirth: "2000-05-12", country: "India", sport: null })],
      [athlete({ dateOfBirth: "2000-05-12", country: "Australia", sport: "Athletics" })],
    ]);

    // The first sighting's country stands; the empty sport is filled from the second.
    expect(result.records[0].country).toBe("India");
    expect(result.records[0].sport).toBe("Athletics");
  });

  it("keeps same-name athletes with different birth dates apart", () => {
    const result = mergeRecords("athletes", [
      [athlete({ dateOfBirth: "2000-05-12" })],
      [athlete({ dateOfBirth: "1994-11-02" })],
    ]);

    expect(result.records).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it("matches keys case-insensitively", () => {
    const result = mergeRecords("athletes", [
      [athlete({ name: "JOHN SMITH", dateOfBirth: "2000-05-12" })],
      [athlete({ name: "John Smith", dateOfBirth: "2000-05-12" })],
    ]);

    expect(result.records).toHaveLength(1);
  });

  it("unions team members across chunks instead of replacing them", () => {
    const team = (members: string[]): TeamRecord => ({
      name: "India",
      country: "India",
      sport: "Hockey",
      members,
    });

    const result = mergeRecords("teams", [[team(["A", "B"])], [team(["B", "C"])]]);

    expect(result.records).toHaveLength(1);
    expect([...result.records[0].members].sort()).toEqual(["A", "B", "C"]);
  });

  it("unions event participants", () => {
    const event = (participants: string[]): EventRecord => ({
      name: "Men's 100m Final",
      sport: "Athletics",
      date: "2026-07-15",
      venue: null,
      participants,
    });

    const result = mergeRecords("events", [[event(["Smith"])], [event(["Lee"])]]);
    expect([...result.records[0].participants].sort()).toEqual(["Lee", "Smith"]);
  });

  it("treats different ranks as different records", () => {
    const rank = (rank: number): RankingRecord => ({
      rank,
      athleteName: "John Smith",
      country: null,
      points: null,
    });

    const result = mergeRecords("ranking", [[rank(1)], [rank(2)]]);
    expect(result.records).toHaveLength(2);
  });

  it("returns an empty list for empty input", () => {
    expect(mergeRecords("athletes", [[], []]).records).toEqual([]);
  });
});
