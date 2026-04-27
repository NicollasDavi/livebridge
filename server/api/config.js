import { join } from 'path';

const trim = (s, d) => String(s ?? d ?? '').trim();

export const VIDEO_LIVE_COOKIE = 'vid_live';
/** Segundos (alinhado ao `exp` do JWT live no Java, ex. 14400 = 4h). */
export const VIDEO_LIVE_MAX_AGE = 14400;
/** Express `res.cookie({ maxAge })` exige milissegundos — nunca passar `VIDEO_LIVE_MAX_AGE` cru. */
export const VIDEO_LIVE_MAX_AGE_MS = VIDEO_LIVE_MAX_AGE * 1000;
export const VIDEO_ACCESS_COOKIE = 'vid_ctx';
/** Segundos (cookie `vid_ctx`). */
export const VIDEO_ACCESS_MAX_AGE = 86400;
export const VIDEO_ACCESS_MAX_AGE_MS = VIDEO_ACCESS_MAX_AGE * 1000;

export const LIVE_ABR_BANDWIDTH_1080 = 4628000;
export const LIVE_ABR_BANDWIDTH_720 = 2928000;
export const LIVE_ABR_BANDWIDTH_480 = 1328000;

/**
 * Path absoluto (prefixo) das variantes no master HLS (`GET /api/live/hls-master.m3u8`).
 * Padrão `/hls` → URLs `/hls/live/<stream>_1080/...` (nginx do LiveBridge).
 * Se o browser só alcança HLS via proxy (ex. Next em `:3000` com `/api/hls/*` → Java → LB), use `LIVE_HLS_PATH_PREFIX=/api/hls`.
 */
export const LIVE_HLS_PATH_PREFIX = String(process.env.LIVE_HLS_PATH_PREFIX || '/hls').replace(/\/$/, '');

/**
 * Ficheiro de entrada por variante no master ABR (`GET /api/live/hls-master.m3u8`).
 * Padrão `main_stream.m3u8` — playlist de média com `#EXT-X-TARGETDURATION` e segmentos (hls.js, Safari).
 * O `index.m3u8` do MediaMTX costuma ser um *segundo* master (só `#EXT-X-STREAM-INF` → main_stream), o que
 * faz o hls.js falhar com "Missing Target Duration" se o master ABR apontar para `index.m3u8`.
 * Override: `LIVE_HLS_VARIANT_PLAYLIST=index.m3u8` se precisares do comportamento antigo.
 */
const _liveVariantPl = String(process.env.LIVE_HLS_VARIANT_PLAYLIST || 'main_stream.m3u8')
  .trim()
  .replace(/^.*[/\\]/, '');
export const LIVE_HLS_VARIANT_PLAYLIST = _liveVariantPl || 'main_stream.m3u8';

/**
 * Base interna (só API → MediaMTX) para contar segmentos HLS antes de expor a live.
 * Docker: http://mediamtx:8888 — sem passar pelo nginx/JWT.
 */
export const LIVE_HLS_INTERNAL_BASE_URL = trim(process.env.LIVE_HLS_INTERNAL_BASE_URL, 'http://mediamtx:8888');
/** Sufixo ABR usado na sonda (ex.: 480 → live/nome_480/main_stream.m3u8). */
export const LIVE_HLS_PROBE_VARIANT = String(process.env.LIVE_HLS_PROBE_VARIANT || '480').trim() || '480';
/** Mínimo de `#EXTINF` na playlist para considerar a live “pronta” (3 = só após o 3.º segmento). 0 = desliga o critério. */
export const LIVE_READY_MIN_SEGMENTS = Math.max(
  0,
  parseInt(process.env.LIVE_READY_MIN_SEGMENTS || '3', 10) || 0
);
export const LIVE_HLS_PROBE_TIMEOUT_MS = Math.min(
  30000,
  Math.max(500, parseInt(process.env.LIVE_HLS_PROBE_TIMEOUT_MS || '4000', 10) || 4000)
);
/** Cache do resultado ready por stream (ms). Reduz pedidos ao MediaMTX em polls. */
export const LIVE_HLS_READY_CACHE_MS = Math.max(
  0,
  parseInt(process.env.LIVE_HLS_READY_CACHE_MS || '1000', 10) || 1000
);

export const VIDEO_ACCESS_SECRET = process.env.VIDEO_ACCESS_SECRET;
/** Segundos de tolerância no `jwt.verify` (relógios desalinhados). Não substitui `exp` curto no token emitido pela plataforma. */
export const JWT_CLOCK_TOLERANCE_SECONDS = Math.max(
  0,
  parseInt(process.env.JWT_CLOCK_TOLERANCE_SECONDS || '0', 10) || 0
);
export const R2_BUCKET = process.env.R2_BUCKET || 'livebridge';

export const LESSONS_API_URL = process.env.LESSONS_API_URL || 'https://api.posihub.com.br';
export const LESSONS_API_TOKEN = process.env.LESSONS_API_TOKEN || process.env.API_ACCESS_TOKEN;
export const RECORDINGS_DIR = trim(process.env.RECORDINGS_DIR, '/recordings');
export const MERGE_INTERNAL_URL = process.env.MERGE_INTERNAL_URL || 'http://merge:8080';
/** 0 = sem timeout no fetch para POST /merge. Em ms se >0 (ex.: 604800000 = 7d) — proxies que cortam ligações longas. */
export const MERGE_POST_TIMEOUT_MS = Math.max(0, parseInt(process.env.MERGE_POST_TIMEOUT_MS || '0', 10) || 0);
/** Base URL da Control API do MediaMTX (Docker: http://mediamtx:9997). */
export const MEDIAMTX_CONTROL_API_URL = trim(process.env.MEDIAMTX_CONTROL_API_URL, 'http://mediamtx:9997');
export const MEDIAMTX_HTTP_TIMEOUT_MS = Math.min(
  120000,
  Math.max(2000, parseInt(process.env.MEDIAMTX_HTTP_TIMEOUT_MS || '15000', 10) || 15000)
);
/** Cache em memória da lista de paths do MediaMTX (GET /v3/paths/list). Reduz carga quando muitos clientes pedem /api/live/transmissoes ou rotas que consultam o mesmo. */
export const MEDIAMTX_PATHS_CACHE_MS = Math.max(
  0,
  parseInt(process.env.MEDIAMTX_PATHS_CACHE_MS || '3000', 10) || 3000
);
export const VIDEOS_API_URL = process.env.VIDEOS_API_URL || process.env.LESSONS_API_URL || 'https://api.posihub.com.br';
export const VIDEOS_API_TOKEN = process.env.VIDEOS_API_TOKEN || process.env.LESSONS_API_TOKEN || process.env.API_ACCESS_TOKEN;

export const LESSONS_TIMEOUT_MS = parseInt(process.env.LESSONS_TIMEOUT_MS || '2000', 10);
export const LESSONS_CACHE_MS = parseInt(process.env.LESSONS_CACHE_MS || '30000', 10);
/** TTL do cache para `GET /api/check-video-access` (auth por pedido HLS). Com segmentos de 10s, ~25s cobre 2+ segmentos e reduz CPU JWT/nginx. */
export const CHECK_VIDEO_ACCESS_CACHE_MS = parseInt(process.env.CHECK_VIDEO_ACCESS_CACHE_MS || '25000', 10);

/** 1 = logar todas as requisições; 0 = omitir rotas ruidosas (ex.: check-video-access). */
export const API_LOG_ALL_REQUESTS = process.env.API_LOG_ALL_REQUESTS === '1' || process.env.API_LOG_ALL_REQUESTS === 'true';

/** Paginação R2: tamanho máximo por página (1–1000). */
export const RECORDINGS_PAGE_MAX_KEYS = Math.min(
  1000,
  Math.max(1, parseInt(process.env.RECORDINGS_PAGE_MAX_KEYS || '500', 10) || 500)
);

/** Leituras em paralelo ao montar /api/recordings/pending. */
export const PENDING_READ_CONCURRENCY = Math.min(
  32,
  Math.max(1, parseInt(process.env.PENDING_READ_CONCURRENCY || '8', 10) || 8)
);

/**
 * Após POST /api/recordings/lesson-boundary: atrasar o arranque do merge (FFmpeg no contentor merge).
 * O merge disputa CPU/disco com o MediaMTX; arranque imediato pode degradar o HLS da live (404, "reader is too slow").
 * 0 = arranque imediato (comportamento legado).
 */
export const LESSON_BOUNDARY_MERGE_DELAY_MS = Math.max(
  0,
  parseInt(process.env.LESSON_BOUNDARY_MERGE_DELAY_MS || '8000', 10) || 8000
);

/** Paralelismo ao criar hardlinks/cópias na lesson-boundary. Valores muito altos picam I/O no mesmo disco das gravações. */
export const LESSON_BOUNDARY_LINK_CONCURRENCY = Math.min(
  64,
  Math.max(1, parseInt(process.env.LESSON_BOUNDARY_LINK_CONCURRENCY || '12', 10) || 12)
);

export const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,https://api.posihub.com.br,http://localhost:8081')
  .split(',')
  .map((s) => s.trim());

export const corsOriginSet = new Set(corsOrigins);

export const skipLessonsInList = process.env.SKIP_LESSONS_API !== '0' && process.env.SKIP_LESSONS_API !== 'false';
export const hasLessonsApi = !!(LESSONS_API_URL && LESSONS_API_TOKEN);

export const LIVE_ENDED_DIR = join(RECORDINGS_DIR, 'live-ended');
export const MERGE_PROGRESS_DIR = join(RECORDINGS_DIR, 'merge-progress');
export const BOUNDARIES_DIR = join(RECORDINGS_DIR, 'boundaries');

/**
 * Base pública do API onde o **browser** resolve `/api/recordings/...` (ex.: BFF Java em `http://localhost:8080`).
 * Se vazio, os JSON devolvem paths relativos (adequado quando o cliente fala direto com o LiveBridge).
 * Quando o JSON é devolvido via proxy (Java → LiveBridge), usa `API_PUBLIC_BASE_URL`, ou headers no pedido ao
 * LiveBridge: `X-API-Public-Base-Url`, ou `X-Forwarded-Host` + `X-Forwarded-Proto` (como um reverse proxy)
 * para o browser pedir `master.m3u8` ao BFF (ex. :8080) e não só ao LiveBridge (:8081).
 */
export const API_PUBLIC_BASE_URL = String(process.env.API_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');

function forwardedPublicBase(req) {
  if (!req || typeof req.get !== 'function') return '';
  const host = req.get('x-forwarded-host')?.trim();
  if (!host) return '';
  const rawProto = (req.get('x-forwarded-proto') || 'http').split(',')[0].trim();
  const proto = rawProto === 'https' ? 'https' : 'http';
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch (_) {
    return '';
  }
}

export function resolvePublicApiBase(req) {
  if (req && typeof req.get === 'function') {
    const explicit = req.get('x-api-public-base-url')?.trim();
    if (explicit) {
      try {
        const u = new URL(explicit);
        if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
      } catch (_) {}
    }
    const fromFwd = forwardedPublicBase(req);
    if (fromFwd) return fromFwd;
  }
  return API_PUBLIC_BASE_URL || '';
}

/** Prefixa path relativo (`/api/...`) com a base pública quando configurada. */
export function publicApiUrl(req, relativePath) {
  const base = resolvePublicApiBase(req);
  if (!base) return relativePath;
  const p = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  return `${base}${p}`;
}
