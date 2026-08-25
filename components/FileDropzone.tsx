"use client";

import { useCallback, useRef, useState } from "react";

/** Small files are common here — a 300-byte CSV reading "0 KB" looks like a failed read. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  file: File | null;
  onSelect: (file: File | null) => void;
  accept: string;
  maxBytes: number;
  disabled: boolean;
}

/**
 * Drop target that doubles as a file picker.
 *
 * Client-side size and extension checks here exist to give instant feedback; the
 * server re-runs both, and that is the check that counts.
 */
export function FileDropzone({ file, onSelect, accept, maxBytes, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const accepted = accept.split(",");

  const validate = useCallback(
    (candidate: File): string | null => {
      const extension = `.${candidate.name.split(".").pop()?.toLowerCase() ?? ""}`;
      if (!accepted.includes(extension)) {
        return `${extension} files aren't supported. Accepted: ${accepted.join(", ")}`;
      }
      if (candidate.size > maxBytes) {
        return `That file is ${(candidate.size / 1024 / 1024).toFixed(1)} MB. The limit is ${maxBytes / 1024 / 1024} MB.`;
      }
      if (candidate.size === 0) return "That file is empty.";
      return null;
    },
    [accepted, maxBytes],
  );

  const handle = useCallback(
    (candidate: File | undefined) => {
      if (!candidate) return;
      const problem = validate(candidate);
      setLocalError(problem);
      onSelect(problem ? null : candidate);
    },
    [onSelect, validate],
  );

  return (
    <div>
      {/*
        A real <button>, not a div with role="button": it gets keyboard activation,
        focus handling and the disabled semantics for free, and those are exactly the
        things a hand-rolled version gets subtly wrong.
      */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) handle(event.dataTransfer.files[0]);
        }}
        className={[
          "w-full rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600",
          disabled ? "opacity-60" : "cursor-pointer",
          dragging
            ? "border-navy-500 bg-navy-100 dark:bg-navy-800/60"
            : file
              ? "border-navy-600 bg-navy-100/80 dark:border-navy-400/70 dark:bg-navy-800/40"
              : "border-navy-300 hover:border-navy-400 dark:border-navy-700 dark:hover:border-navy-500",
        ].join(" ")}
        aria-label={
          file ? `${file.name} selected. Choose a different file.` : "Choose a file to extract from"
        }
      >
        {file ? (
          <div className="flex flex-col gap-1">
            <span className="font-medium break-all text-navy-950 dark:text-navy-50">
              {file.name}
            </span>
            <span className="text-sm text-navy-500 dark:text-navy-400">
              {formatSize(file.size)} · click to choose a different file
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="font-medium text-navy-950 dark:text-navy-50">
              Drop a file here, or click to browse
            </span>
            <span className="text-sm text-navy-500 dark:text-navy-400">
              PDF, Excel, CSV, Word, images, or text — up to {maxBytes / 1024 / 1024} MB
            </span>
          </div>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          handle(event.target.files?.[0]);
          // Reset so re-picking the same file after an error still fires onChange.
          event.target.value = "";
        }}
      />

      {localError && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
          {localError}
        </p>
      )}
    </div>
  );
}
