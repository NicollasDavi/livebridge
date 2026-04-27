import crypto from 'crypto';
import * as cfg from '../config.js';

export function setVideoAccessCookie(res) {
  const token = crypto.randomBytes(24).toString('hex');
  res.cookie(cfg.VIDEO_ACCESS_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: cfg.VIDEO_ACCESS_MAX_AGE_MS
  });
}
