"use client";

import { useMemo, useState } from "react";
import type { ExtractSuccess } from "@/lib/api-types";

export function ResultPanel({ result }: { result: ExtractSuccess }) {
  const [tab, setTab] = useState<"table" | "json">("table");
  const [copied, setCopied] = useState(false);

  const json = useMemo(
    () => JSON.stringify({ success: true, type: result.type, data: result.data }, null, 2),
    [result],
  );

  const columns = useMemo(() => {
    const seen = new Set<string>();
    for (const row of result.data) {
      for (const key of Object.keys(row)) seen.add(key);
    }
    return [...seen];
  }, [result.data]);

  const copy = async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const download = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${result.meta.fileName.replace(/\.[^.]+$/, "")}-${result.type}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-lg border border-navy-200 bg-navy-50 dark:border-navy-800 dark:bg-navy-900">
      <header className="flex flex-wrap items-center gap-3 border-b border-navy-200 px-5 py-3 dark:border-navy-800">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">{result.meta.recordCount}</span>
          <span className="text-sm text-navy-500 dark:text-navy-400">
            {result.meta.recordCount === 1 ? "record" : "records"} extracted
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1 rounded-md bg-navy-100 p-0.5 dark:bg-navy-950">
          {(["table", "json"] as const).map((name) => (
            <button
              key={name}
              onClick={() => setTab(name)}
              className={[
                "rounded px-3 py-1 text-sm capitalize transition-colors",
                tab === name
                  ? "bg-navy-50 shadow-sm dark:bg-navy-800"
                  : "text-navy-500 hover:text-navy-950 dark:hover:text-navy-100",
              ].join(" ")}
            >
              {name}
            </button>
          ))}
        </div>

        <button
          onClick={copy}
          className="rounded-md border border-navy-300 px-3 py-1 text-sm hover:bg-navy-100 dark:border-navy-700 dark:hover:bg-navy-800"
        >
          {copied ? "Copied" : "Copy JSON"}
        </button>
        <button
          onClick={download}
          className="rounded-md border border-navy-300 px-3 py-1 text-sm hover:bg-navy-100 dark:border-navy-700 dark:hover:bg-navy-800"
        >
          Download
        </button>
      </header>

      {result.meta.warnings.length > 0 && (
        <ul className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {result.meta.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {result.data.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-navy-500 dark:text-navy-400">
          No {result.type} records were found in this file.
        </p>
      ) : tab === "table" ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-200 dark:border-navy-800">
                {columns.map((column) => (
                  <th
                    key={column}
                    className="px-4 py-2 text-left font-medium whitespace-nowrap text-navy-500 dark:text-navy-400"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.data.map((row, index) => (
                <tr
                  key={index}
                  className="border-b border-navy-100 last:border-0 dark:border-navy-800/60"
                >
                  {columns.map((column) => (
                    <td key={column} className="px-4 py-2 align-top tabular-nums">
                      {renderCell((row as Record<string, unknown>)[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="overflow-x-auto px-5 py-4 font-mono text-xs leading-relaxed">{json}</pre>
      )}

      <footer className="flex flex-wrap gap-x-5 gap-y-1 border-t border-navy-200 px-5 py-2.5 font-mono text-xs text-navy-500 dark:border-navy-800 dark:text-navy-400">
        <span>{result.meta.detectedFormat}</span>
        <span>{result.meta.sourcePath}</span>
        <span>
          {result.meta.chunks} {result.meta.chunks === 1 ? "pass" : "passes"}
        </span>
        {result.meta.duplicatesRemoved > 0 && (
          <span>{result.meta.duplicatesRemoved} duplicates merged</span>
        )}
        {result.meta.repairAttempts > 0 && <span>{result.meta.repairAttempts} repairs</span>}
        <span>{(result.meta.durationMs / 1000).toFixed(1)}s</span>
        <span>{result.meta.model}</span>
      </footer>
    </section>
  );
}

function renderCell(value: unknown) {
  if (value === null || value === undefined) {
    return (
      <span className="text-navy-400 dark:text-navy-600" title="Not stated in the source file">
        —
      </span>
    );
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? (
      <span className="text-navy-400 dark:text-navy-600">—</span>
    ) : (
      value.join(", ")
    );
  }
  return String(value);
}
