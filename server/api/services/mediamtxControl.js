import * as cfg from '../config.js';

const ABR_SUFFIX = /_((1080)|(720)|(480))$/i;

let pathsCache = { data: null, expires: 0 };
let pathsInflight = null;

function isMainLivePath(name) {
  if (!name || typeof name !== 'string') return false;
  if (!name.startsWith('live/')) return false;
  const rest = name.slice('live/'.length);
  if (!rest || rest.includes('/') || rest.includes('..')) return false;
  const base = rest.split('/').pop();
  return !ABR_SUFFIX.test(base);
}

function pathIsOnAir(p) {
  if (p?.online === true) return true;
  if (p?.ready === true && p?.source?.type) return true;
  return false;
}

async function fetchMediaMtxPathsListUncached() {
  const base = cfg.MEDIAMTX_CONTROL_API_URL.replace(/\/$/, '');
  const itemsPerPage = 100;
  const all = [];
  let page = 0;
  let pageCount = 1;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), cfg.MEDIAMTX_HTTP_TIMEOUT_MS);

  try {
    while (page < pageCount) {
      const url = `${base}/v3/paths/list?page=${page}&itemsPerPage=${itemsPerPage}`;
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        const err = new Error(`MediaMTX HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      const data = await res.json();
      const chunk = Array.isArray(data.items) ? data.items : [];
      all.push(...chunk);
      pageCount = Math.max(1, Number(data.pageCount) || 1);
      page += 1;
      if (chunk.length === 0) break;
    }
  } finally {
    clearTimeout(t);
  }

  return all;
}

/**
 * Lista de paths da Control API do MediaMTX, com cache TTL + um único fetch em voo (evita rajada ao expirar).
 */
export async function fetchMediaMtxPathsList() {
  const ttl = cfg.MEDIAMTX_PATHS_CACHE_MS;
  const now = Date.now();
  if (ttl > 0 && pathsCache.data && pathsCache.expires > now) {
    return pathsCache.data;
  }
  if (pathsInflight) return pathsInflight;
  pathsInflight = (async () => {
    try {
      const data = await fetchMediaMtxPathsListUncached();
      if (ttl > 0) {
        pathsCache = { data, expires: Date.now() + ttl };
      } else {
        pathsCache = { data: null, expires: 0 };
      }
      return data;
    } catch (e) {
      pathsCache = { data: null, expires: 0 };
      throw e;
    } finally {
      pathsInflight = null;
    }
  })();
  return pathsInflight;
}

/**
 * True se o path principal `live/<streamName>` (sem sufixo _1080/_720/_480) está no ar no MediaMTX.
 * Usado após live-ended: o OBS pode continuar a publicar enquanto o merge corre em background.
 */
export async function isMainLiveStreamOnline(streamName) {
  if (!streamName || typeof streamName !== 'string') return false;
  const trimmed = streamName.trim();
  if (!trimmed) return false;
  try {
    const paths = await fetchMediaMtxPathsList();
    const want = `live/${trimmed}`;
    const p = paths.find((x) => x?.name === want);
    return !!(p && pathIsOnAir(p));
  } catch {
    return false;
  }
}

export function listActiveMainLiveStreams(paths) {
  const out = [];
  for (const p of paths) {
    const name = p?.name;
    if (!isMainLivePath(name) || !pathIsOnAir(p)) continue;
    const streamName = name.slice('live/'.length);
    out.push({
      path: name,
      streamName,
      online: p.online === true,
      onlineTime: p.onlineTime ?? null,
      sourceType: p.source?.type ?? null,
      hlsMasterUrl: `/api/live/hls-master.m3u8?streamName=${encodeURIComponent(streamName)}`
    });
  }
  out.sort((a, b) => (a.streamName || '').localeCompare(b.streamName || '', 'pt'));
  return out;
}
