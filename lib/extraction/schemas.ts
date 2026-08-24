import { z } from "zod";
import type { ExtractionType } from "./types";

const rankingItem = z.strictObject({
  rank: z.number().int(),
  athleteName: z.string(),
  country: z.string().nullable(),
  points: z.number().nullable(),
});

const recordItem = z.strictObject({
  athleteName: z.string(),
  event: z.string().nullable(),
  // A mark is a string: "9.91", "2:03:15" and "82.14m" are all valid records,
  // and parsing them into numbers would lose the units and the formatting.
  record: z.string().nullable(),
  date: z.string().nullable(),
  location: z.string().nullable(),
  country: z.string().nullable(),
});

const athleteItem = z.strictObject({
  name: z.string(),
  country: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  gender: z.string().nullable(),
  sport: z.string().nullable(),
});

const teamItem = z.strictObject({
  name: z.string(),
  country: z.string().nullable(),
  sport: z.string().nullable(),
  // A team named without a roster gets [], not null — the field is always a list,
  // it is just sometimes an empty one.
  members: z.array(z.string()),
});

const eventItem = z.strictObject({
  name: z.string(),
  sport: z.string().nullable(),
  date: z.string().nullable(),
  venue: z.string().nullable(),
  participants: z.array(z.string()),
});

export const ITEM_SCHEMAS = {
  ranking: rankingItem,
  record: recordItem,
  athletes: athleteItem,
  teams: teamItem,
  events: eventItem,
} as const satisfies Record<ExtractionType, z.ZodObject>;

/**
 * Structured Outputs requires the root of the schema to be an object, so the array
 * is wrapped. `data` is the only key, which keeps the model's job unambiguous.
 */
export const ENVELOPE_SCHEMAS = {
  ranking: z.object({ data: z.array(rankingItem) }),
  record: z.object({ data: z.array(recordItem) }),
  athletes: z.object({ data: z.array(athleteItem) }),
  teams: z.object({ data: z.array(teamItem) }),
  events: z.object({ data: z.array(eventItem) }),
} as const satisfies Record<ExtractionType, z.ZodObject>;

export type RankingRecord = z.infer<typeof rankingItem>;
export type RecordRecord = z.infer<typeof recordItem>;
export type AthleteRecord = z.infer<typeof athleteItem>;
export type TeamRecord = z.infer<typeof teamItem>;
export type EventRecord = z.infer<typeof eventItem>;

export type ExtractedRecord =
  | RankingRecord
  | RecordRecord
  | AthleteRecord
  | TeamRecord
  | EventRecord;

export function envelopeSchemaFor(type: ExtractionType) {
  return ENVELOPE_SCHEMAS[type];
}

/**
 * Human-readable field list, injected into the prompt. The model receives the JSON
 * Schema too, but the schema says nothing about *meaning* — that a rank is the one
 * printed in the document rather than the row's position, for instance.
 */
export const FIELD_NOTES: Record<ExtractionType, string> = {
  ranking:
    "rank (as printed in the document, not the row position), athleteName, country, points",
  record:
    "athleteName, event, record (the mark exactly as written — keep units, colons and decimals), date, location, country",
  athletes: "name, country, dateOfBirth, gender, sport",
  teams: "name, country, sport, members (the listed squad; empty list if no roster is given)",
  events: "name, sport, date, venue, participants (empty list if none are listed)",
};

/**
 * Post-validation cleanup for the things a JSON Schema can't express.
 *
 * Only ever removes information — blanks a field that carries no content, or trims
 * incidental whitespace. It never fills a field in, and never reformats a value that
 * has content, because a value we rewrite is a value we can no longer promise matches
 * the source document.
 */
export function normalizeRecords<T extends Record<string, unknown>>(records: T[]): T[] {
  return records.map((record) => {
    const cleaned: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "string") {
        const trimmed = value.trim();
        // Models sometimes express "not present" as "", "-", "N/A" or "null"
        // despite being handed a nullable type. Those all mean null.
        cleaned[key] = isBlank(trimmed) ? null : trimmed;
      } else if (Array.isArray(value)) {
        cleaned[key] = value
          .map((entry) => (typeof entry === "string" ? entry.trim() : entry))
          .filter((entry) => !(typeof entry === "string" && isBlank(entry)));
      } else {
        cleaned[key] = value;
      }
    }

    return cleaned as T;
  });
}

const BLANK_MARKERS = new Set(["", "-", "--", "—", "n/a", "na", "null", "none", "unknown", "?"]);

function isBlank(value: string): boolean {
  return BLANK_MARKERS.has(value.toLowerCase());
}
