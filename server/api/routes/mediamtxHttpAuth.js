import express from 'express';
import * as cfg from '../config.js';
import { parseMediaMtxAuthBody, validateRtmpPublish } from '../lib/rtmpPublishAuth.js';

/** IPs típicos da rede Docker / loopback — MediaMTX chama este POST a partir do contentor mediamtx. */
export function isDockerInternalIp(ip) {
  if (!ip) return false;
  const s = String(ip).replace(/^::ffff:/, '');
  if (s === '127.0.0.1' || s === '::1') return true;
  if (s.startsWith('10.')) return true;
  const m = /^172\.(\d+)\./.exec(s);
  if (m) {
    const n = parseInt(m[1], 10);
    return n >= 16 && n <= 31;
  }
  return false;
}

/**
 * authMethod: http no MediaMTX — só **publish** (ex.: RTMP) dispara isto; read/playback/api estão em authHTTPExclude.
 * Resposta 200 = permitir. Ingest principal exige RTMP_PUBLISH_TOKEN; variantes ABR internas (_720/_480) são liberadas.
 */
export function registerMediaMtxHttpAuth(app) {
  app.post(
    '/api/internal/mediamtx-auth',
    express.raw({ type: '*/*', limit: '64kb' }),
    (req, res) => {
      if (!isDockerInternalIp(req.socket.remoteAddress)) {
        return res.status(403).end();
      }

      const body = parseMediaMtxAuthBody(req.body);
      const result = validateRtmpPublish(body, {
        allowedTokens: cfg.RTMP_PUBLISH_TOKENS,
        authRequired: cfg.RTMP_PUBLISH_AUTH_REQUIRED
      });

      if (!result.ok) {
        if (cfg.RTMP_PUBLISH_AUTH_REQUIRED) {
          console.warn(
            `[API] mediamtx-auth negado path=${body.path || '?'} reason=${result.reason || 'unknown'}`
          );
        }
        return res.status(403).end();
      }

      res.status(200).end();
    }
  );
}
