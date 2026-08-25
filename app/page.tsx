"use client";

import { useState } from "react";
import { ExtractionProgress } from "@/components/ExtractionProgress";
import { FileDropzone } from "@/components/FileDropzone";
import { ResultPanel } from "@/components/ResultPanel";
import type { ExtractResponse, ExtractSuccess } from "@/lib/api-types";
import { readNdjson } from "@/lib/ndjson";
import type { ProgressUpdate } from "@/lib/progress";
import { ACCEPT_ATTRIBUTE, MAX_FILE_BYTES } from "@/lib/upload-constraints";
import { EXTRACTION_TYPES, type ExtractionType } from "@/lib/extraction/types";

const TYPE_LABELS: Record<ExtractionType, string> = {
  ranking: "Ranking",
  record: "Record",
  athletes: "Athletes",
  teams: "Teams",
  events: "Events",
};

type Status = "idle" | "working" | "done" | "failed";

/** One line of the NDJSON stream. `status` mirrors the HTTP status the buffered form would carry. */
type StreamLine =
  | ({ event: "progress" } & ProgressUpdate)
  | ({ event: "result"; status: number } & ExtractResponse);

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<ExtractionType>("athletes");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<ExtractSuccess | null>(null);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);

  const working = status === "working";

  function settle(payload: ExtractResponse) {
    if (payload.success) {
      setResult(payload);
      setStatus("done");
    } else {
      setError({ message: payload.error, code: payload.errorCode });
      setStatus("failed");
    }
  }

  async function extract() {
    if (!file) return;

    setStatus("working");
    setResult(null);
    setError(null);
    setProgress(null);

    const body = new FormData();
    body.append("file", file);
    body.append("extractionType", type);

    try {
      // The streaming variant of the same endpoint. Identical final payload, delivered
      // as the last line rather than the only one, so the wait can be narrated.
      const response = await fetch("/api/extract?stream=1", { method: "POST", body });

      if (!response.body?.getReader) {
        settle((await response.json()) as ExtractResponse);
        return;
      }

      let settled = false;

      for await (const line of readNdjson(response.body)) {
        const message = line as StreamLine;

        if (message.event === "progress") {
          setProgress({
            stage: message.stage,
            message: message.message,
            completedChunks: message.completedChunks,
            totalChunks: message.totalChunks,
          });
        } else if (message.event === "result") {
          settle(message);
          settled = true;
        }
      }

      // A stream that ends without a result line means the connection died mid-request.
      // Without this the button stays disabled and the page waits forever.
      if (!settled) {
        throw new Error("stream ended before a result was sent");
      }
    } catch {
      setError({
        message: "Could not reach the extraction service. Check your connection and try again.",
        code: "NETWORK_ERROR",
      });
      setStatus("failed");
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12 sm:py-16">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">Sports Data Extractor</h1>
        <p className="mt-2 max-w-xl text-navy-600 dark:text-navy-300">
          Upload a results sheet, record book, start list, or ranking table. Choose what to pull out
          of it, and get structured JSON back.
        </p>
      </header>

      <div className="flex flex-col gap-6 rounded-lg border border-navy-200 bg-navy-50 p-6 dark:border-navy-800 dark:bg-navy-900">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Upload file</label>
          <FileDropzone
            file={file}
            onSelect={setFile}
            accept={ACCEPT_ATTRIBUTE}
            maxBytes={MAX_FILE_BYTES}
            disabled={working}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="extraction-type" className="text-sm font-medium">
            Extract from this file
          </label>
          <select
            id="extraction-type"
            value={type}
            disabled={working}
            onChange={(event) => setType(event.target.value as ExtractionType)}
            className="w-full rounded-md border border-navy-300 bg-navy-50 px-3 py-2 text-navy-950 disabled:opacity-60 dark:border-navy-700 dark:bg-navy-950 dark:text-navy-50"
          >
            {EXTRACTION_TYPES.map((option) => (
              <option key={option} value={option}>
                {TYPE_LABELS[option]}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={extract}
          disabled={!file || working}
          className="rounded-md bg-navy-900 px-4 py-2.5 font-medium text-navy-50 transition-colors hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-navy-100 dark:text-navy-950 dark:hover:bg-navy-50"
        >
          {working ? "Extracting…" : "Extract Data"}
        </button>

        {working && <ExtractionProgress update={progress} />}
      </div>

      {status === "failed" && error && (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-red-200 bg-red-50 px-5 py-4 dark:border-red-900/50 dark:bg-red-950/30"
        >
          <p className="font-medium text-red-900 dark:text-red-200">{error.message}</p>
          <p className="mt-1 font-mono text-xs text-red-700/70 dark:text-red-300/60">
            {error.code}
          </p>
        </div>
      )}

      {status === "done" && result && (
        <div className="mt-6">
          <ResultPanel result={result} />
        </div>
      )}
    </main>
  );
}
