import * as cfg from '../config.js';
import { setVideoAccessCookie } from '../lib/cookies.js';
import { verifyLiveToken, liveTokenMatchesHlsStream } from '../lib/jwtLive.js';
import { fetchMediaMtxPathsList, listActiveMainLiveStreams } from '../services/mediamtxControl.js';
import { filterTransmissoesWithHlsReady, isLiveHlsReadyForPlayback } from '../services/liveHlsReady.js';

/** Prefixos permitidos (nginx expõe ambos). Override por proxy: cabeçalho X-Live-Hls-Path-Prefix ou query hlsPathPrefix. */
const ALLOWED_HLS_PREFIXES = ['/hls', '/api/hls'];

function resolveLiveHlsPathPrefix(req) {
  const raw =
    (typeof req.get === 'function' && req.get('x-live-hls-path-prefix')) ||
    (req.query && (req.query.hlsPathPrefix || req.query.hlsPrefix));
  const s = raw != null ? String(raw).trim().replace(/\/$/, '') : '';
  if (s && ALLOWED_HLS_PREFIXES.includes(s)) return s;
  return cfg.LIVE_HLS_PATH_PREFIX;
}

/** URLs relativas ao master em `/api/live/hls-master.m3u8` — funcionam no browser mesmo quando LIVE_HLS_PATH_PREFIX não está no .env (Next em `/api/hls`). */
function variantPlaylistUrl(pathPrefix, streamName, abrSuffix, playlistFile) {
  const enc = encodeURIComponent(streamName);
  const tail = `live/${enc}_${abrSuffix}/${playlistFile}`;
  if (pathPrefix === '/api/hls') return `../hls/${tail}`;
  return `../../hls/${tail}`;
}

const accessOkCache = new Map();

function cacheKeyForAccess(req) {
  const stream = req.query.stream;
  if (cfg.VIDEO_ACCESS_SECRET) {
    const token = req.cookies?.[cfg.VIDEO_LIVE_COOKIE] || '';
    return `j:${stream}:${String(token).slice(0, 32)}`;
  }
  const c = req.cookies?.[cfg.VIDEO_ACCESS_COOKIE] || '';
  return `c:${stream}:${String(c).slice(0, 24)}`;
}

function pruneAccessCache() {
  if (accessOkCache.size > 8000) accessOkCache.clear();
}

export function registerLiveRoutes(app) {
  app.get('/api/init', (req, res) => {
    setVideoAccessCookie(res);
    res.json({ ok: true });
  });

  /** Valida acesso a HLS (nginx auth_request). Cache curto para reduzir disco/CPU sob rajada de segmentos. */
  app.get('/api/check-video-access', (req, res) => {
    const stream = req.query.stream;
    const key = cacheKeyForAccess(req);
    const now = Date.now();
    const until = accessOkCache.get(key);
    if (until && until > now) return res.status(200).end();
    if (until !== undefined) accessOkCache.delete(key);

    if (cfg.VIDEO_ACCESS_SECRET) {
      if (!stream || typeof stream !== 'string') return res.status(403).end();
      const token = req.cookies?.[cfg.VIDEO_LIVE_COOKIE];
      const payload = verifyLiveToken(token);
      if (!payload || !liveTokenMatchesHlsStream(payload, stream)) return res.status(403).end();
    } else {
      const cookie = req.cookies?.[cfg.VIDEO_ACCESS_COOKIE];
      if (!cookie || cookie.length < 32) return res.status(403).end();
    }

    accessOkCache.set(key, now + cfg.CHECK_VIDEO_ACCESS_CACHE_MS);
    pruneAccessCache();
    res.status(200).end();
  });

  app.post('/api/init-live', (req, res) => {
    const { streamName, token } = req.body;
    if (!streamName || !token) return res.status(400).json({ error: 'streamName e token obrigatórios' });
    const payload = verifyLiveToken(token);
    if (!payload || payload.streamName !== streamName) {
      return res.status(403).json({ error: 'Token inválido ou expirado' });
    }
    res.cookie(cfg.VIDEO_LIVE_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: cfg.VIDEO_LIVE_MAX_AGE_MS
    });
    res.json({ ok: true });
  });

  /**
   * Transmissões ao vivo no momento (publisher em live/NOME, exclui variantes ABR _1080/_720/_480).
   * Dados: Control API do MediaMTX (rede interna Docker).
   */
  app.get('/api/live/transmissoes', async (req, res) => {
    try {
      const paths = await fetchMediaMtxPathsList();
      const raw = listActiveMainLiveStreams(paths);
      const items = await filterTransmissoesWithHlsReady(raw);
      res.json({ items });
    } catch (e) {
      const aborted = e.name === 'AbortError';
      const httpStatus = e.status;
      const status =
        aborted ? 504 : httpStatus >= 400 && httpStatus < 600 ? httpStatus : 502;
      console.error('[API] GET /api/live/transmissoes', e.message || e);
      res.status(status).json({
        error: aborted
          ? 'MediaMTX não respondeu a tempo'
          : 'Não foi possível consultar o MediaMTX',
        detail: String(e.message || e)
      });
    }
  });

  /**
   * Master HLS (ABR): 1080p / 720p / 480p.
   */
  app.get('/api/live/hls-master.m3u8', async (req, res) => {
    const raw = req.query.streamName;
    if (!raw || typeof raw !== 'string') {
      return res.status(400).type('text/plain').send('streamName obrigatório');
    }
    const streamName = raw.trim();
    if (!streamName || streamName.includes('..') || /[/\\\s]/.test(streamName) || streamName.length > 200) {
      return res.status(400).type('text/plain').send('streamName inválido');
    }
    if (cfg.VIDEO_ACCESS_SECRET) {
      const token = req.cookies?.[cfg.VIDEO_LIVE_COOKIE];
      const payload = verifyLiveToken(token);
      if (!payload || !liveTokenMatchesHlsStream(payload, streamName)) {
        return res.status(403).type('text/plain').send('Forbidden');
      }
    } else {
      const cookie = req.cookies?.[cfg.VIDEO_ACCESS_COOKIE];
      if (!cookie || cookie.length < 32) return res.status(403).type('text/plain').send('Forbidden');
    }
    const hlsReady = await isLiveHlsReadyForPlayback(streamName);
    if (!hlsReady) {
      res.set('Retry-After', '2');
      res.set('Cache-Control', 'no-store');
      return res.status(503).type('text/plain').send('HLS ainda não tem segmentos suficientes\n');
    }
    const hp = resolveLiveHlsPathPrefix(req);
    const pl = cfg.LIVE_HLS_VARIANT_PLAYLIST || 'main_stream.m3u8';
    const body = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-STREAM-INF:BANDWIDTH=${cfg.LIVE_ABR_BANDWIDTH_1080},RESOLUTION=1920x1080,NAME="1080p"`,
      variantPlaylistUrl(hp, streamName, '1080', pl),
      `#EXT-X-STREAM-INF:BANDWIDTH=${cfg.LIVE_ABR_BANDWIDTH_720},RESOLUTION=1280x720,NAME="720p"`,
      variantPlaylistUrl(hp, streamName, '720', pl),
      `#EXT-X-STREAM-INF:BANDWIDTH=${cfg.LIVE_ABR_BANDWIDTH_480},RESOLUTION=854x480,NAME="480p"`,
      variantPlaylistUrl(hp, streamName, '480', pl),
      ''
    ].join('\n');
    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.set('Cache-Control', 'no-store');
    res.send(body);
  });
}
