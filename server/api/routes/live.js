import * as cfg from '../config.js';
import { setVideoAccessCookie } from '../lib/cookies.js';
import { verifyLiveToken, liveTokenMatchesHlsStream } from '../lib/jwtLive.js';

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
      maxAge: cfg.VIDEO_LIVE_MAX_AGE
    });
    res.json({ ok: true });
  });

  /**
   * Master HLS (ABR): 1080p / 720p / 480p.
   */
  app.get('/api/live/hls-master.m3u8', (req, res) => {
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
    const enc = encodeURIComponent(streamName);
    const body = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-STREAM-INF:BANDWIDTH=${cfg.LIVE_ABR_BANDWIDTH_1080},RESOLUTION=1920x1080,NAME="1080p"`,
      `/hls/live/${enc}_1080/index.m3u8`,
      `#EXT-X-STREAM-INF:BANDWIDTH=${cfg.LIVE_ABR_BANDWIDTH_720},RESOLUTION=1280x720,NAME="720p"`,
      `/hls/live/${enc}_720/index.m3u8`,
      `#EXT-X-STREAM-INF:BANDWIDTH=${cfg.LIVE_ABR_BANDWIDTH_480},RESOLUTION=854x480,NAME="480p"`,
      `/hls/live/${enc}_480/index.m3u8`,
      ''
    ].join('\n');
    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.set('Cache-Control', 'no-store');
    res.send(body);
  });
}
