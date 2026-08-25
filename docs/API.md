# Extraction API

One endpoint. Upload a file, name a data type, get validated JSON.

## `POST /api/extract`

**Content-Type:** `multipart/form-data`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file` | File | yes | One of the supported formats, 15 MB max |
| `extractionType` | string | yes | `ranking` \| `record` \| `athletes` \| `teams` \| `events` — lowercase |

```bash
curl -F "file=@samples/ranking-world-tour.csv" \
     -F "extractionType=ranking" \
     http://localhost:3000/api/extract
```

### Supported formats

`.pdf` `.csv` `.xlsx` `.xls` `.docx` `.txt` `.jpg` `.jpeg` `.png`

The extension is checked against the file's magic bytes. A `.csv` renamed to `.pdf`
is rejected, not parsed.

---

## Success — `200`

```jsonc
{
  "success": true,
  "type": "athletes",
  "data": [
    {
      "name": "Neeraj Chopra",
      "country": "India",
      "dateOfBirth": "1997-12-24",
      "gender": "Male",
      "sport": "Athletics"
    }
  ],
  "meta": {
    "requestId": "ext_23950ebd1bfc",
    "recordCount": 1,
    "fileName": "athletes-squad.xlsx",
    "detectedFormat": "xlsx",
    "sourcePath": "text-layer",
    "chunks": 1,
    "duplicatesRemoved": 0,
    "repairAttempts": 0,
    "model": "gpt-4.1-mini",
    "durationMs": 4820,
    "timings": { "parseMs": 1, "modelMs": 4748 },
    "warnings": []
  }
}
```

**`data` may be an empty array on a `200`.** A readable file that contains none of the
requested data type is a successful extraction of zero records — not an error. Uploading
an athlete roster and asking for `teams` returns `success: true, data: []` with a warning
saying so, rather than inventing teams.

### `meta`

Additive and safe to ignore. `success`, `type` and `data` are the contract.

| Field | Meaning |
| --- | --- |
| `requestId` | Correlates with the server logs. Quote it in bug reports. |
| `recordCount` | `data.length`. |
| `sourcePath` | `text-layer` (text extracted locally) or `vision` (the model read the file). |
| `chunks` | Model calls made. More than 1 means the file was split — into parts and, for spreadsheets, one per sheet. |
| `duplicatesRemoved` | Records collapsed during the merge. |
| `repairAttempts` | Times a response failed validation and was re-requested. Non-zero is worth investigating. |
| `timings` | `parseMs` (local file handling) and `modelMs` (all model calls). Parsing is single-digit milliseconds; the model is the request. |
| `warnings` | Human-readable notes: skipped sheets, vision fallback, truncation, empty results. |

---

## Streaming — `POST /api/extract?stream=1`

Same request, same final payload, delivered as the last line of a newline-delimited
JSON stream instead of the only one. Model calls take seconds, and a caller that can
show what is happening during them should not have to wait for the whole body.

```bash
curl -N -F "file=@samples/athletes-squad.xlsx" \
        -F "extractionType=athletes" \
        "http://localhost:3000/api/extract?stream=1"
```

```jsonc
{"event":"progress","stage":"parsing","message":"Reading the file"}
{"event":"progress","stage":"extracting","message":"Extracting athletes data from 3 parts","completedChunks":0,"totalChunks":3}
{"event":"progress","stage":"extracting","message":"Extracting athletes data — 1 of 3 parts done","completedChunks":1,"totalChunks":3}
{"event":"progress","stage":"merging","message":"Merging results"}
{"event":"result","status":200,"success":true,"type":"athletes","data":[...],"meta":{...}}
```

- **The stream always returns HTTP 200**, including for failures — the status is
  already sent before the pipeline can fail. The `result` line carries a `status`
  field with the code the buffered form would have returned, and `success: false`
  with the usual `error` / `errorCode`.
- **`progress` lines are advisory.** Their wording is not a contract; ignore any
  `event` you do not recognise. Only the `result` line matters.
- Parts run concurrently, so `completedChunks` counts finished parts rather than
  identifying which one is in flight.

Without `?stream=1` the endpoint behaves exactly as documented above — one buffered
JSON body, real HTTP status codes. That remains the default and the contract.

---

## Failure — `4xx` / `5xx`

```jsonc
{
  "success": false,
  "type": "athletes",
  "data": [],
  "error": "That PDF could not be opened. It may be damaged, encrypted, or incomplete.",
  "errorCode": "CORRUPT_FILE",
  "meta": { "requestId": "ext_d9501941f7a4", "durationMs": 59 }
}
```

`error` is safe to show a user. Diagnostic detail (provider messages, file internals)
goes to the server log against `requestId`, never into the response.

| `errorCode` | HTTP | Cause |
| --- | --- | --- |
| `MISSING_FILE` | 400 | No `file` field in the form |
| `INVALID_EXTRACTION_TYPE` | 400 | `extractionType` missing or not one of the five |
| `EMPTY_FILE` | 400 | Zero bytes, or no rows/pages after parsing |
| `FILE_TOO_LARGE` | 413 | Over 15 MB |
| `UNSUPPORTED_FILE_TYPE` | 415 | Extension not accepted, or magic bytes disagree with it |
| `CORRUPT_FILE` | 422 | Parser could not open the container |
| `NO_TEXT_CONTENT` | 422 | Scan or image, and `ENABLE_VISION_FALLBACK=false` |
| `RATE_LIMITED` | 429 | Over 20 requests/minute from one IP |
| `AI_INVALID_RESPONSE` | 502 | Model output failed validation twice, or was refused |
| `AI_UNAVAILABLE` | 503 | Provider timeout or 5xx after 3 attempts |
| `AI_NOT_CONFIGURED` | 500 | `OPENAI_API_KEY` not set |
| `INTERNAL_ERROR` | 500 | Anything unanticipated |

---

## Schemas

Every optional field is **nullable, never absent**. A field the source document does not
state comes back as an explicit `null`. Values are copied as printed — names keep their
diacritics, marks keep their units and precision.

### `ranking`

| Field | Type |
| --- | --- |
| `rank` | integer — as printed, not the row position |
| `athleteName` | string |
| `country` | string \| null |
| `points` | number \| null |

### `record`

| Field | Type |
| --- | --- |
| `athleteName` | string |
| `event` | string \| null |
| `record` | string \| null — `"9.91"`, `"2:03:15"` and `"82.14m"` are all valid |
| `date` | string \| null |
| `location` | string \| null |
| `country` | string \| null |

### `athletes`

| Field | Type |
| --- | --- |
| `name` | string |
| `country` | string \| null |
| `dateOfBirth` | string \| null |
| `gender` | string \| null |
| `sport` | string \| null |

### `teams`

| Field | Type |
| --- | --- |
| `name` | string |
| `country` | string \| null |
| `sport` | string \| null |
| `members` | string[] — `[]` when no roster is listed, never null |

### `events`

| Field | Type |
| --- | --- |
| `name` | string |
| `sport` | string \| null |
| `date` | string \| null |
| `venue` | string \| null |
| `participants` | string[] — `[]` when none are listed, never null |

### Dates

Converted to `YYYY-MM-DD` only when the source is unambiguous about day, month and
century. `15/07/26` is copied as printed rather than guessed into ISO — consumers should
expect a string, not a parseable date.

---

## Rate limiting

20 requests per minute per IP, in-memory, resets on restart. Sized for an internal
tool. Exposing this endpoint publicly needs API keys and a shared store instead.
