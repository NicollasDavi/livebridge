import express from 'express';

/** IPs típicos da rede Docker / loopback — MediaMTX chama este POST a partir do contentor mediamtx. */
function isDockerInternalIp(ip) {
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
 * Resposta 200 = permitir. Não valida user/pass no corpo: o controlo “externo” continua a ser nginx+JWT no HLS público.
 */
export function registerMediaMtxHttpAuth(app) {
  app.post(
    '/api/internal/mediamtx-auth',
    express.raw({ type: '*/*', limit: '64kb' }),
    (req, res) => {
      if (!isDockerInternalIp(req.socket.remoteAddress)) {
        return res.status(403).end();
      }
      res.status(200).end();
    }
  );
}
