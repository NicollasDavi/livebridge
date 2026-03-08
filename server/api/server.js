import express from 'express';
import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3Client } from '@aws-sdk/client-s3';
import cors from 'cors';

const app = express();
app.use(cors());

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_BUCKET = process.env.R2_BUCKET || 'livebridge';
const R2_PREFIX = 'recordings/';
const R2_VIDEOS_PREFIX = 'recordings/videos/';

const hasR2 = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY);
const s3 = hasR2 ? new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY }
}) : null;

function requireR2(req, res, next) {
  if (!hasR2) return res.status(503).json({ error: 'R2 não configurado. Defina R2_ACCOUNT_ID, R2_ACCESS_KEY e R2_SECRET_KEY no .env' });
  next();
}

/** Lista gravações (.mp4 em recordings/videos/) */
app.get('/api/recordings', requireR2, async (req, res) => {
  try {
    const list = [];
    let continuationToken;
    do {
      const result = await s3.send(new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: R2_VIDEOS_PREFIX,
        ContinuationToken: continuationToken
      }));
      for (const obj of result.Contents || []) {
        if (!obj.Key || !obj.Key.endsWith('.mp4')) continue;
        const rest = obj.Key.slice(R2_VIDEOS_PREFIX.length);
        const parts = rest.split('/');
        if (parts.length < 2) continue;
        const filename = parts.pop();
        const path = parts.join('/');
        const session = filename.replace('.mp4', '');
        list.push({
          path,
          session,
          key: obj.Key,
          date: session.replace(/_/g, ' '),
          id: `${path}|${session}`
        });
      }
      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);
    list.sort((a, b) => b.session.localeCompare(a.session));
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/** URL do vídeo .mp4 (presignada ou redirect) */
app.get('/api/recordings/video', requireR2, async (req, res) => {
  try {
    const { path, session } = req.query;
    if (!path || !session) return res.status(400).json({ error: 'path e session obrigatórios' });
    const key = `${R2_VIDEOS_PREFIX}${path}/${session}.mp4`;
    if (process.env.USE_PRESIGNED === '1') {
      const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: 3600 });
      return res.redirect(url);
    }
    const obj = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    res.set('Content-Type', 'video/mp4');
    if (obj.ContentLength) res.set('Content-Length', String(obj.ContentLength));
    const body = obj.Body;
    if (body && typeof body.pipe === 'function') {
      body.pipe(res);
    } else {
      res.send(Buffer.from(await body.transformToByteArray()));
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
  if (!hasR2) console.log('R2 não configurado — aba Gravações desabilitada');
});
