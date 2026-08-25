# Sports Data Extractor

Upload a results sheet, record book, start list, or ranking table in any common format.
Choose what to pull out of it. Get back structured JSON a backend can consume without a
human retyping anything.

Supports **PDF, Excel, CSV, Word, images and plain text**, and extracts **rankings,
records, athletes, teams and events**.

## Setup

```bash
npm install
cp .env.example .env.local     # add your OpenAI API key
npm run dev
```

Open http://localhost:3000.

### Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | yes | — | https://platform.openai.com/api-keys |
| `OPENAI_MODEL` | no | `gpt-4.1-mini` | Must support Structured Outputs **and** vision |
| `ENABLE_VISION_FALLBACK` | no | `true` | `false` keeps uploaded files inside your infrastructure |
| `CHUNK_CONCURRENCY` | no | `4` | Model calls in flight at once. Lower it if you hit provider rate limits |
| `CHUNK_LINE_LIMIT` | no | `80` | Source lines per call. Raise for prose, lower if long tables come back short |
| `CHUNK_CHAR_LIMIT` | no | `40000` | Source characters per call. Rarely the binding limit |

With `ENABLE_VISION_FALLBACK=false`, no file is ever sent to OpenAI as a file — only text
extracted locally. Scanned PDFs and image uploads then fail with `NO_TEXT_CONTENT`
instead of being read visually.

## Try it

```bash
node scripts/make-samples.mjs   # writes fixtures into samples/

curl -F "file=@samples/ranking-world-tour.csv" \
     -F "extractionType=ranking" \
     http://localhost:3000/api/extract
```

The fixtures cover the awkward cases as well as the clean ones:

| File | What it exercises |
| --- | --- |
| `ranking-world-tour.csv` | Clean ranking table, every field present |
| `records-national.csv` | Rows with blank venue and country — must return `null`, not a guess |
| `athletes-squad.xlsx` | Three sheets, one with different columns, one with no athletes |
| `teams-hockey.txt` | Rosters written as prose; one squad listed with no members |
| `events-schedule.csv` | Schedule with one venue missing |
| `entry-list.docx` | A Word table |
| `results-100m-final.pdf` | PDF with a text layer |
| `scanned-record-board.pdf` | PDF with **no** text layer — takes the vision path |
| `scanned-record-board.png` | Photograph of a results board |
| `duplicates-mixed.csv` | Same athlete twice, each row missing a different field |
| `mismatch-athletes-only.txt` | Athlete file — select **Teams** to see `data: []` |
| `edge-empty.txt` | `EMPTY_FILE` |
| `edge-corrupt.pdf` | Valid PDF magic bytes, invalid body — `CORRUPT_FILE` |
| `edge-irrelevant.txt` | Readable file about nothing relevant — `data: []` |

## Commands

```bash
npm run dev      # dev server
npm run build    # production build
npm run lint     # eslint
npm test         # vitest
```

## How it works

```
upload → validate → parse → chunk → prompt → model → validate → merge → JSON
```

Six decisions shape the design. Each is written up where it lives in the code.

**Schemas constrain the model, they don't just ask it.** Every call sends a JSON Schema
derived from the same Zod definition that validates the reply
([`lib/extraction/schemas.ts`](lib/extraction/schemas.ts)). Malformed JSON and invented
field names aren't handled — they're prevented. Strict mode requires every property, so a
field the source doesn't state must come back as an explicit `null`: omission isn't
available, and `null` is the cheap answer.

**One document shape, many parsers.** Every parser in
[`lib/files/parsers/`](lib/files/parsers/) returns the same `SourceDocument` union, so
nothing downstream knows what a `.docx` is. Adding a format is one file; swapping
providers is one file in [`lib/extraction/provider/`](lib/extraction/provider/).

**PDFs try the cheap path first.** Text layer via `unpdf` when there is one — exact,
chunkable, a fraction of the token cost. Below 60 characters per page it's treated as a
scan and the file goes to the model to be read visually. `meta.sourcePath` tells you which
happened.

**The validator is the only thing trusted.** Every response is parsed by Zod before it
becomes an API response, on every path. One repair retry carrying the actual validation
error; then a structured failure, never a coerced payload.

**Empty is a success.** A readable file with none of the requested data returns
`success: true, data: []`. Treating that as an error is how extraction systems learn to
hallucinate.

**Large files are chunked, not truncated.** Text splits on row and page boundaries, never
mid-record, with section headers replayed into continuation chunks. Results merge on a
per-type natural key, filling gaps between partial sightings without overwriting known
values. Chunks are sized by *lines*, not bytes, and run concurrently — see below.

## Speed

The model is the request. Everything else — validating, parsing, chunking, merging — is
single-digit milliseconds, and `meta.timings` reports the split so this stays a
measurement rather than an assumption.

```
{ "parseMs": 1, "modelMs": 4748 }
```

Three things follow from that, and they are the difference between the current numbers
and the ones this started with:

**Chunks are sized by lines, not characters.** The binding constraint is the size of the
*answer*, not the size of the input. A response has a token ceiling, and a model handed
900 table rows does not fail — it writes as much as it can and stops, returning a short
list indistinguishable from a complete one. Measured on a 300-row ranking CSV:

| Chunking | Records returned | Time |
| --- | --- | --- |
| One 40,000-character chunk | **100 of 300** | 145s |
| Four 80-line chunks | **300 of 300** | 42s |

**Chunks run concurrently.** Four at a time by default, so a file split five ways costs
roughly the slowest part rather than the sum of all of them. This is what makes smaller
chunks affordable: more calls, less waiting.

**Each spreadsheet sheet gets its own call.** A request holding three sheets is one the
model can half-answer — `samples/athletes-squad.xlsx` silently dropped its short
trailing "Reserves" sheet in one run out of three. Separate calls removed it: 6 of 6 on
five consecutive runs, and *faster* than the single call was, because the parts overlap.
Pages are not treated this way — a page break falls inside a document that reads
continuously, and splitting there would buy nothing.

The frontend uses the streaming form of the endpoint (`?stream=1`) so the wait is
narrated rather than silent. That makes nothing faster; it makes the difference between
waiting and wondering. See [docs/API.md](docs/API.md#streaming--postapiextractstream1).

### Not inventing data

The rule the whole thing is built around: a field the document doesn't state is `null`.

`samples/records-national.csv` has a javelin row with a blank venue and country. Every
other row says India, and the athlete is famously Indian. The correct output is:

```json
{ "athleteName": "Neeraj Chopra", "event": "Javelin Throw", "record": "89.94",
  "date": "2022-06-30", "location": null, "country": null }
```

That's enforced three ways: nullable-not-optional schema types, an explicit prompt rule
with a concrete example, and `meta.warnings` surfacing when a result looks thin.

## Layout

```
app/
  page.tsx                    the extractor screen
  api/extract/route.ts        HTTP only — form in, response out
lib/
  config.ts                   thresholds, ceilings, model selection
  errors.ts                   error codes and their HTTP status
  extraction/
    schemas.ts                the five Zod schemas — source of truth
    prompt.ts                 one template, type injected
    pipeline.ts               validate → parse → chunk → extract → merge
    merge.ts                  dedupe keys and chunk merging
    provider/openai.ts        the only file that names a vendor
  files/
    validate.ts               size, extension, magic bytes
    detect.ts                 format → parser
    chunk.ts                  boundary-aware splitting, sized by lines
    parsers/                  pdf, spreadsheet, docx, text, image
  concurrency.ts              bounded parallelism for the chunk calls
  progress.ts                 the progress event shape, shared with the client
  ndjson.ts                   reads the streaming response line by line
tests/                        schemas, merge, chunking, concurrency, ndjson
samples/                      fixtures, including the awkward ones
docs/API.md                   endpoint reference
```

## Limits

- **15 MB** per file, **24 chunks** per request — roughly 1,900 rows of tabular data.
  Larger files are read up to the ceiling and flagged in `meta.warnings`; split them and
  extract each part.
- **Synchronous.** One request, one response. Files needing more than ~120s of processing
  need a job queue instead; the pipeline is structured so one can go in front of it
  without a rewrite.
- **Internal tool.** IP rate limiting, no auth, no persistence, nothing written to disk.
  Public exposure needs API keys and per-key quotas — an unauthenticated endpoint that
  spends money per request is a liability.
- **Image accuracy.** Data read visually is less exact than text extraction, and
  `meta.warnings` says so when it happens. Check marks and spellings against the original.
