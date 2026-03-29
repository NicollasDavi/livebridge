/**
 * Executa tarefas com limite de concorrência (preserva ordem dos resultados).
 */
export async function mapPool(items, concurrency, fn) {
  if (!items.length) return [];
  const limit = Math.max(1, concurrency);
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
