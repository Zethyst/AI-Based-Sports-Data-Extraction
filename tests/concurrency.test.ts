import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "@/lib/concurrency";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mapWithConcurrency", () => {
  it("keeps results in input order however they finish", async () => {
    const items = [40, 5, 30, 1, 20];

    const results = await mapWithConcurrency(items, 3, async (ms) => {
      await tick(ms);
      return ms;
    });

    expect(results).toEqual(items);
  });

  it("never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick(5);
      inFlight -= 1;
      return null;
    });

    expect(peak).toBe(4);
  });

  it("runs every item exactly once", async () => {
    const seen: number[] = [];

    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 5, async (item) => {
      await tick(Math.random() * 5);
      seen.push(item);
      return item;
    });

    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it("handles an empty list without hanging", async () => {
    await expect(mapWithConcurrency([], 4, async () => null)).resolves.toEqual([]);
  });

  it("propagates the first rejection", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error("chunk 2 failed");
        await tick(20);
        return item;
      }),
    ).rejects.toThrow("chunk 2 failed");
  });
});
