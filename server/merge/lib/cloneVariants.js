/** Clona array de variantes para JSON de progresso (sem JSON.parse/stringify quando possível). */
export function cloneVariants(variants) {
  if (typeof structuredClone === 'function') return structuredClone(variants);
  return JSON.parse(JSON.stringify(variants));
}
