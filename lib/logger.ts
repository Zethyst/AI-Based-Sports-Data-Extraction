type Level = "info" | "warn" | "error";

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export function newRequestId(): string {
  return `ext_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function emit(level: Level, requestId: string, event: string, fields: LogFields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    requestId,
    event,
    ...fields,
  });

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(requestId: string) {
  const startedAt = Date.now();

  return {
    requestId,
    elapsedMs: () => Date.now() - startedAt,
    info: (event: string, fields?: LogFields) => emit("info", requestId, event, fields),
    warn: (event: string, fields?: LogFields) => emit("warn", requestId, event, fields),
    error: (event: string, fields?: LogFields) => emit("error", requestId, event, fields),
  };
}

export type Logger = ReturnType<typeof createLogger>;
