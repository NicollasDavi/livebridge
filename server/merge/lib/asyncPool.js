/**
 * Executa itens em lotes de até batchSize promises em paralelo (ordem preservada nos resultados).
 */
export async function runBatchedAll(items, batchSize, fn) {
  if (batchSize < 1) batchSize = 1;
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const slice = items.slice(i, i + batchSize);
    const part = await Promise.all(slice.map((item, k) => fn(item, i + k)));
    results.push(...part);
  }
  return results;
}
