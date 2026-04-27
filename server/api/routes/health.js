import * as cfg from '../config.js';

const READY_TIMEOUT_MS = Math.min(5000, cfg.MEDIAMTX_HTTP_TIMEOUT_MS);

/**
 * Liveness (processo a responder).
 * Readiness: Control API do MediaMTX acessível.
 */
export function registerHealthRoutes(app) {
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, service: 'livebridge-api' });
  });

  app.get('/api/ready', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const base = cfg.MEDIAMTX_CONTROL_API_URL.replace(/\/$/, '');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), READY_TIMEOUT_MS);
    try {
      const url = `${base}/v3/paths/list?page=0&itemsPerPage=1`;
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) {
        return res.status(503).json({
          ok: false,
          reason: 'mediamtx_control',
          status: r.status
        });
      }
      res.json({ ok: true, mediamtx: true });
    } catch (e) {
      const reason = e?.name === 'AbortError' ? 'timeout' : e?.message || 'error';
      res.status(503).json({ ok: false, reason: 'mediamtx_control', detail: reason });
    } finally {
      clearTimeout(t);
    }
  });
}
