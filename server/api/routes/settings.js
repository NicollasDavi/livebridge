import * as cfg from '../config.js';
import * as settings from '../services/settings.js';

function settingsWriteToken() {
  return String(cfg.SETTINGS_TOKEN || cfg.API_ACCESS_TOKEN || '').trim();
}

function requireSettingsAuth(req, res, next) {
  const expected = settingsWriteToken();
  if (!expected) {
    return res.status(503).json({
      error:
        'Defina SETTINGS_TOKEN ou API_ACCESS_TOKEN no .env para alterar settings via API.'
    });
  }
  const got = String(
    req.get('x-access-token') ||
      req.get('authorization')?.replace(/^Bearer\s+/i, '') ||
      req.query.token ||
      ''
  ).trim();
  if (!got || got !== expected) {
    return res.status(401).json({ error: 'Token inválido. Use o SETTINGS_TOKEN / API_ACCESS_TOKEN.' });
  }
  next();
}

function messageFor(s) {
  const parts = [];
  parts.push(s.mergeEnabled ? 'Merge/VOD ligado' : 'Merge/VOD desligado (só live)');
  parts.push(`encode ${s.compressCodec}/${s.compressPreset}`);
  parts.push(`resoluções ${s.mergeResolutions}`);
  parts.push(s.recordLive ? 'gravação .ts ligada' : 'gravação .ts desligada');
  return parts.join(' · ');
}

export function registerSettingsRoutes(app) {
  app.get('/api/settings', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const s = settings.getSettings();
    res.json({
      ok: true,
      ...settings.settingsPublicShape(s),
      writeProtected: !!settingsWriteToken()
    });
  });

  app.put('/api/settings', requireSettingsAuth, async (req, res) => {
    try {
      const saved = await settings.updateSettings(req.body || {});
      const payload = {
        ok: true,
        ...settings.settingsPublicShape(saved),
        message: messageFor(saved)
      };
      if (saved.recordLiveApply) {
        payload.recordLiveApply = saved.recordLiveApply;
        if (!saved.recordLiveApply.ok) {
          payload.warning =
            'Settings gravados, mas MediaMTX não aplicou recordLive: ' +
            (saved.recordLiveApply.error || 'erro');
        }
      }
      res.json(payload);
    } catch (e) {
      const status = e?.status && Number.isInteger(e.status) ? e.status : 500;
      if (status >= 400 && status < 500) {
        return res.status(status).json({ error: e.message });
      }
      console.error('[settings]', e);
      res.status(500).json({ error: e.message });
    }
  });
}
