/**
 * Reads newline-delimited JSON off a response body, yielding each line as it lands.
 *
 * Split by hand rather than by buffering the whole body: the point of the format here
 * is that the caller sees progress lines while the request is still open, and anything
 * that waits for the end defeats it. A chunk boundary can fall mid-line, so partial
 * text is held back until its newline arrives.
 */
export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) break;

        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line);
      }
    }

    const trailing = buffer.trim();
    if (trailing) yield JSON.parse(trailing);
  } finally {
    reader.releaseLock();
  }
}
