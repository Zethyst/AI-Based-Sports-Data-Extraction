import { describe, expect, it } from "vitest";
import { readNdjson } from "@/lib/ndjson";

/** Emits the given byte groups as one stream, so chunk boundaries can be placed by hand. */
function streamOf(pieces: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
}

async function collect(pieces: string[]): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const line of readNdjson(streamOf(pieces))) out.push(line);
  return out;
}

describe("readNdjson", () => {
  it("yields one object per line", async () => {
    const lines = await collect(['{"event":"progress","stage":"parsing"}\n{"event":"result"}\n']);

    expect(lines).toEqual([{ event: "progress", stage: "parsing" }, { event: "result" }]);
  });

  it("reassembles a line split across chunk boundaries", async () => {
    // The realistic failure: a network chunk ends mid-token.
    const lines = await collect(['{"event":"pro', 'gress","completedChunks":2}', "\n"]);

    expect(lines).toEqual([{ event: "progress", completedChunks: 2 }]);
  });

  it("yields a trailing line that arrives without a newline", async () => {
    const lines = await collect(['{"a":1}\n{"b":2}']);

    expect(lines).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("ignores blank lines", async () => {
    const lines = await collect(['{"a":1}\n\n\n{"b":2}\n']);

    expect(lines).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("handles multi-byte characters split across chunks", async () => {
    const encoder = new TextEncoder();
    const payload = encoder.encode('{"name":"Ingebrigtsen — Såland"}\n');

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Split inside the em dash's UTF-8 sequence.
        controller.enqueue(payload.slice(0, 22));
        controller.enqueue(payload.slice(22));
        controller.close();
      },
    });

    const out: unknown[] = [];
    for await (const line of readNdjson(stream)) out.push(line);

    expect(out).toEqual([{ name: "Ingebrigtsen — Såland" }]);
  });

  it("yields nothing for an empty stream", async () => {
    expect(await collect([])).toEqual([]);
  });
});
