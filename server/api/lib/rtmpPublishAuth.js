import { timingSafeEqual } from 'crypto';

/**
 * Variantes ABR geradas por transcode-abr.sh (publish interno MediaMTX→FFmpeg→RTMP).
 * Não exigem token — só o ingest principal live/<nome> vem do OBS.
 */
export function isAbrVariantPublishPath(path) {
  return typeof path === 'string' && /^live\/[^/]+_(1080|720|480)$/.test(path);
}

/** Ingest principal do OBS: live/<streamName> sem sufixo ABR. */
export function isMainLivePublishPath(path) {
  if (typeof path !== 'string' || !path.startsWith('live/')) return false;
  const rest = path.slice('live/'.length);
  if (!rest || rest.includes('/') || rest.includes('..')) return false;
  return !isAbrVariantPublishPath(path);
}

export function parseMediaMtxAuthBody(raw) {
  if (raw == null || (Buffer.isBuffer(raw) && raw.length === 0)) return {};
  try {
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
    if (!text.trim()) return {};
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function tokenFromQueryString(query) {
  if (!query || typeof query !== 'string') return '';
  const q = query.startsWith('?') ? query.slice(1) : query;
  for (const part of q.split('&')) {
    const [k, v] = part.split('=');
    if (!k || v === undefined) continue;
    const key = decodeURIComponent(k.trim()).toLowerCase();
    if (key === 'token' || key === 'pass' || key === 'password') {
      return decodeURIComponent(v.trim());
    }
  }
  return '';
}

/** Extrai credencial de publish RTMP do payload MediaMTX authHTTP. */
export function extractRtmpPublishCredential(body) {
  if (!body || typeof body !== 'object') return '';
  const direct = String(body.token ?? '').trim();
  if (direct) return direct;
  const password = String(body.password ?? '').trim();
  if (password) return password;
  const user = String(body.user ?? '').trim();
  if (user) return user;
  const fromQuery = tokenFromQueryString(body.query);
  if (fromQuery) return fromQuery;
  const path = String(body.path ?? '');
  if (path.includes('?')) {
    const fromPath = tokenFromQueryString(path.slice(path.indexOf('?')));
    if (fromPath) return fromPath;
  }
  return '';
}

function secretsMatch(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Valida publish RTMP.
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateRtmpPublish(body, { allowedTokens, authRequired }) {
  const action = String(body?.action ?? '').toLowerCase();
  if (action && action !== 'publish') {
    return { ok: false, reason: `ação não permitida: ${action}` };
  }

  const path = String(body?.path ?? '');

  if (isAbrVariantPublishPath(path)) {
    return { ok: true };
  }

  if (!isMainLivePublishPath(path)) {
    return { ok: false, reason: 'path de publish inválido' };
  }

  if (!authRequired) {
    return { ok: true };
  }

  if (!allowedTokens?.length) {
    return { ok: false, reason: 'RTMP_PUBLISH_TOKEN não configurado' };
  }

  const cred = extractRtmpPublishCredential(body);
  if (!cred) {
    return { ok: false, reason: 'token de publish ausente' };
  }

  const matched = allowedTokens.some((t) => secretsMatch(cred, t));
  if (!matched) {
    return { ok: false, reason: 'token de publish inválido' };
  }

  return { ok: true };
}
