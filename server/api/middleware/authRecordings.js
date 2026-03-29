import * as cfg from '../config.js';
import { verifyVideoToken } from '../lib/jwtLive.js';
import { hasR2 } from '../r2.js';

export function requireR2(req, res, next) {
  if (!hasR2) {
    return res.status(503).json({
      error: 'R2 não configurado. Defina R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY no .env'
    });
  }
  next();
}

export function requireVideoAuth(req, res, next) {
  const { path: p, session, token } = req.query;
  const cookie = req.cookies?.[cfg.VIDEO_ACCESS_COOKIE];

  if (cfg.VIDEO_ACCESS_SECRET) {
    const payload = verifyVideoToken(token);
    if (payload && payload.path === p && payload.session === session) return next();
    if (cookie && cookie.length >= 32) return next();
    return res.status(403).json({ error: 'Token inválido ou expirado. Obtenha novo token na plataforma.' });
  }
  if (!cookie || cookie.length < 32) {
    return res.status(403).json({ error: 'Acesso negado. Acesse a plataforma primeiro.' });
  }
  next();
}
