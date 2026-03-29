import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import * as cfg from '../config.js';
import { R2_VIDEOS_PREFIX, s3, hasR2 } from '../r2.js';

/** Playback no R2: `session.mp4` (legado) ou `session_1080|720|480.mp4` (merge multires). */
export async function getRecordingObjectFromR2(p, session, rangeHeader, variantQuery) {
  if (!hasR2 || !s3) throw new Error('R2 não configurado');
  const base = `${R2_VIDEOS_PREFIX}${p}/${session}`;
  let order = [`${base}.mp4`, `${base}_1080.mp4`, `${base}_720.mp4`, `${base}_480.mp4`];
  if (variantQuery === '1080' || variantQuery === '720' || variantQuery === '480') {
    const pref = `${base}_${variantQuery}.mp4`;
    order = [pref, ...order.filter((k) => k !== pref)];
  }
  let lastErr = null;
  for (const Key of order) {
    const params = { Bucket: cfg.R2_BUCKET, Key };
    if (rangeHeader) params.Range = rangeHeader;
    try {
      const obj = await s3.send(new GetObjectCommand(params));
      return { obj, Key };
    } catch (e) {
      if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('NoSuchKey');
}

export { HeadObjectCommand, s3, hasR2, R2_VIDEOS_PREFIX };
