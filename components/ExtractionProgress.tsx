"use client";

import { useEffect, useState } from "react";
import type { ProgressUpdate } from "@/lib/progress";

export function ExtractionProgress({ update }: { update: ProgressUpdate | null }) {
  const seconds = useElapsedSeconds();

  const total = update?.totalChunks ?? 0;
  const completed = update?.completedChunks ?? 0;
  const showBar = update?.stage === "extracting" && total > 1;

  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-navy-600 dark:text-navy-300">
          {update?.message ?? "Uploading the file"}
          <span className="inline-block w-6 text-left">{".".repeat(seconds % 4)}</span>
        </span>
        <span className="font-mono tabular-nums text-navy-500 dark:text-navy-400">{seconds}s</span>
      </div>

      {showBar && (
        <div className="h-1 overflow-hidden rounded-full bg-navy-200 dark:bg-navy-800">
          <div
            className="h-full rounded-full bg-navy-600 transition-all duration-500 dark:bg-navy-300"
            style={{ width: `${Math.round((completed / total) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function useElapsedSeconds(): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => clearInterval(timer);
  }, []);

  return seconds;
}
