import jwt from 'jsonwebtoken';
import * as cfg from '../config.js';

const jwtVerifyOpts = () => ({
  algorithms: ['HS256'],
  clockTolerance: cfg.JWT_CLOCK_TOLERANCE_SECONDS
});

export function verifyVideoToken(token) {
  if (!cfg.VIDEO_ACCESS_SECRET || !token) return null;
  try {
    const payload = jwt.verify(token, cfg.VIDEO_ACCESS_SECRET, jwtVerifyOpts());
    if (!payload.path || !payload.session) return null;
    return payload;
  } catch (e) {
    console.log('[video] JWT verify error:', e.message);
    return null;
  }
}

export function verifyLiveToken(token) {
  if (!cfg.VIDEO_ACCESS_SECRET || !token) return null;
  try {
    const payload = jwt.verify(token, cfg.VIDEO_ACCESS_SECRET, jwtVerifyOpts());
    if (!payload.streamName) return null;
    return payload;
  } catch {
    return null;
  }
}

export function liveStreamBaseName(stream) {
  if (!stream || typeof stream !== 'string') return '';
  return stream.replace(/_(1080|720|480)$/, '');
}

export function liveTokenMatchesHlsStream(payload, requestStream) {
  if (!payload?.streamName || !requestStream) return false;
  if (payload.streamName === requestStream) return true;
  return payload.streamName === liveStreamBaseName(requestStream);
}
