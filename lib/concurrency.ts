/**
 * Runs `worker` over `items` with at most `limit` in flight at once.
 *
 * Results keep the input order regardless of the order they finish in, which matters
 * wherever "first seen wins" is a rule rather than an accident. The first rejection
 * propagates; work already in flight is left to settle and its result discarded.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
