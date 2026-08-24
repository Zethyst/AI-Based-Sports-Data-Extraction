import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ENVELOPE_SCHEMAS, normalizeRecords } from "@/lib/extraction/schemas";
import { EXTRACTION_TYPES, isExtractionType } from "@/lib/extraction/types";

/**
 * The brief's own example payloads, used as the acceptance test for each schema.
 * If one of these stops parsing, the API has stopped honouring the spec it was
 * written against.
 */
const BRIEF_EXAMPLES = {
  ranking: [
    { rank: 1, athleteName: "John Smith", country: "India", points: 1250 },
    { rank: 2, athleteName: "David Lee", country: "Australia", points: 1180 },
  ],
  record: [
    {
      athleteName: "John Smith",
      event: "100m",
      record: "9.91",
      date: "2026-07-15",
      location: "Delhi",
      country: "India",
    },
  ],
  athletes: [
    {
      name: "John Smith",
      country: "India",
      dateOfBirth: "2000-05-12",
      gender: "Male",
      sport: "Athletics",
    },
  ],
  teams: [
    {
      name: "India",
      country: "India",
      sport: "Hockey",
      members: ["Player 1", "Player 2", "Player 3"],
    },
  ],
  events: [
    {
      name: "Men's 100m Final",
      sport: "Athletics",
      date: "2026-07-15",
      venue: "National Stadium",
      participants: ["John Smith", "David Lee"],
    },
  ],
} as const;

describe("schemas accept the brief's examples", () => {
  for (const type of EXTRACTION_TYPES) {
    it(`${type} parses the specified payload`, () => {
      const result = ENVELOPE_SCHEMAS[type].safeParse({ data: BRIEF_EXAMPLES[type] });
      expect(result.success).toBe(true);
    });

    it(`${type} accepts an empty result`, () => {
      // Decision 05: no relevant data is a valid extraction, not a schema violation.
      expect(ENVELOPE_SCHEMAS[type].safeParse({ data: [] }).success).toBe(true);
    });
  }
});

describe("schemas reject the near-misses", () => {
  it("rejects an omitted nullable field", () => {
    // Strict mode forbids omission — a field the source doesn't state must be an
    // explicit null, so the model can't quietly drop it.
    const result = ENVELOPE_SCHEMAS.athletes.safeParse({ data: [{ name: "John Smith" }] });
    expect(result.success).toBe(false);
  });

  it("rejects an invented extra field", () => {
    const result = ENVELOPE_SCHEMAS.athletes.safeParse({
      data: [
        { name: "A", country: null, dateOfBirth: null, gender: null, sport: null, medals: 3 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a null where the schema requires a value", () => {
    const result = ENVELOPE_SCHEMAS.athletes.safeParse({
      data: [{ name: null, country: null, dateOfBirth: null, gender: null, sport: null }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer rank", () => {
    const result = ENVELOPE_SCHEMAS.ranking.safeParse({
      data: [{ rank: 1.5, athleteName: "A", country: null, points: null }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects null members rather than an empty list", () => {
    const result = ENVELOPE_SCHEMAS.teams.safeParse({
      data: [{ name: "India", country: null, sport: null, members: null }],
    });
    expect(result.success).toBe(false);
  });

  it("keeps a record mark as a string", () => {
    // 2:03:15 and 82.14m are valid marks; coercing to number would lose both.
    const result = ENVELOPE_SCHEMAS.record.safeParse({
      data: [
        {
          athleteName: "A",
          event: "Marathon",
          record: "2:03:15",
          date: null,
          location: null,
          country: null,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("JSON Schema derivation is strict-mode compatible", () => {
  for (const type of EXTRACTION_TYPES) {
    it(`${type} derives an all-required, closed schema`, () => {
      const json = z.toJSONSchema(ENVELOPE_SCHEMAS[type], {
        target: "draft-2020-12",
      }) as unknown as {
        properties: {
          data: {
            items: { required: string[]; properties: object; additionalProperties: boolean };
          };
        };
      };
      const item = json.properties.data.items;

      // OpenAI strict mode requires both of these; without them the API rejects
      // the request outright rather than degrading quietly.
      expect(item.additionalProperties).toBe(false);
      expect(item.required.sort()).toEqual(Object.keys(item.properties).sort());
    });
  }
});

describe("normalizeRecords", () => {
  it("converts blank markers to null", () => {
    const [record] = normalizeRecords([
      { name: "  John Smith  ", country: "N/A", sport: "-", gender: "" },
    ]);
    expect(record).toEqual({ name: "John Smith", country: null, sport: null, gender: null });
  });

  it("never fills a field in", () => {
    const [record] = normalizeRecords([{ name: "A", country: null }]);
    expect(record.country).toBeNull();
  });

  it("drops blank list entries without dropping real ones", () => {
    const [record] = normalizeRecords([{ name: "India", members: ["  Player 1 ", "", "-"] }]);
    expect(record.members).toEqual(["Player 1"]);
  });
});

describe("isExtractionType", () => {
  it("accepts the five valid values", () => {
    for (const type of EXTRACTION_TYPES) expect(isExtractionType(type)).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of ["Athletes", "athlete", "", null, undefined, 5, {}]) {
      expect(isExtractionType(bad)).toBe(false);
    }
  });
});
