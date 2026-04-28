import { Buffer } from 'node:buffer';

import * as cfg from '../config.js';

function internalProbeHeaders() {
  const u = cfg.LIVE_HLS_INTERNAL_BASIC_USER;
  const p = cfg.LIVE_HLS_INTERNAL_BASIC_PASS;
  if (!u || p === '') return {};
  const token = Buffer.from(`${u}:${p}`, 'utf8').toString('base64');
  return { Authorization: `Basic ${token}` };
}

/** streamName -> { ok, expires } */
const readyCache = new Map();

function countExtinfSegments(m3u8Text) {
  if (!m3u8Text || typeof m3u8Text !== 'string') return 0;
  let n = 0;
  for (const line of m3u8Text.split(/\r?\n/)) {
    if (line.startsWith('#EXTINF:')) n += 1;
  }
  return n;
}

/**
 * True quando a playlist de média da variante de sonda tem segmentos >= LIVE_READY_MIN_SEGMENTS.
 * Omissão: 3 — só “disponível” quando já existem 3 segmentos (reprodução segura ~2 atrás da borda).
 */
export async function isLiveHlsReadyForPlayback(streamName) {
  const min = cfg.LIVE_READY_MIN_SEGMENTS;
  if (min <= 0) return true;
  if (!streamName || typeof streamName !== 'string') return false;

  const now = Date.now();
  const ttl = cfg.LIVE_HLS_READY_CACHE_MS;
  const hit = readyCache.get(streamName);
  if (ttl > 0 && hit && hit.expires > now) return hit.ok;

  const base = cfg.LIVE_HLS_INTERNAL_BASE_URL.replace(/\/$/, '');
  const variant = cfg.LIVE_HLS_PROBE_VARIANT;
  const pl = cfg.LIVE_HLS_VARIANT_PLAYLIST;
  const pathPart = `${streamName}_${variant}`;
  const url = `${base}/live/${encodeURIComponent(pathPart)}/${encodeURIComponent(pl)}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), cfg.LIVE_HLS_PROBE_TIMEOUT_MS);
  let ok = false;
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: internalProbeHeaders() });
    if (!res.ok) {
      ok = false;
    } else {
      const text = await res.text();
      ok = countExtinfSegments(text) >= min;
    }
  } catch {
    ok = false;
  } finally {
    clearTimeout(t);
  }

  if (ttl > 0) {
    readyCache.set(streamName, { ok, expires: now + ttl });
  }
  return ok;
}

export async function filterTransmissoesWithHlsReady(items) {
  if (!Array.isArray(items) || items.length === 0) return items;
  if (cfg.LIVE_READY_MIN_SEGMENTS <= 0) return items;
  const checks = await Promise.all(
    items.map(async (it) => ({
      it,
      ok: await isLiveHlsReadyForPlayback(it.streamName)
    }))
  );
  return checks.filter((x) => x.ok).map((x) => x.it);
}
