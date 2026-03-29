import { cloneVariants } from './cloneVariants.js';

/**
 * Reduz clones profundos no progresso: só reclona quando fase/% mudam de degrau.
 * `immediate` (falha/concluído) força clone fresco.
 */
export function createVariantSnapshotter() {
  let sig = '';
  let buf = null;
  return function snapVariants(variants, immediate = false) {
    if (immediate) {
      sig = '';
      buf = cloneVariants(variants);
      sig = fingerprint(variants);
      return buf;
    }
    const nextSig = fingerprint(variants);
    if (nextSig !== sig) {
      sig = nextSig;
      buf = cloneVariants(variants);
    }
    return buf;
  };
}

function fingerprint(variants) {
  return variants
    .map(
      (v) =>
        `${v.phase}|${step(v.encodingPercent, 4)}|${step(v.uploadPercent, 5)}|${step(v.bytesUploaded, 65536)}|${v.currentTimeSec ?? ''}`
    )
    .join(';');
}

function step(n, q) {
  if (n == null || !Number.isFinite(n)) return '';
  return Math.floor(n / q) * q;
}
