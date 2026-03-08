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

/** Extrai path (ex: live/teste), session (ex: 2025-03-08_12-00-00) e filename de uma key R2 */
function parseKey(key) {
  if (!key.startsWith(R2_PREFIX)) return null;
  const rest = key.slice(R2_PREFIX.length);
  const parts = rest.split('/');
  if (parts.length < 3) return null;
  const session = parts[parts.length - 2];
  const filename = parts[parts.length - 1];
  const path = parts.slice(0, -2).join('/');
  return { path, session, filename, key };
}

/** Lista gravações agrupadas por sessão */
app.get('/api/recordings', requireR2, async (req, res) => {
  try {
    const { Contents = [] } = await s3.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: R2_PREFIX
    }));
    const sessions = {};
    for (const obj of Contents) {
      if (!obj.Key) continue;
      const parsed = parseKey(obj.Key);
      if (!parsed || !parsed.filename || parsed.filename.endsWith('.m3u8')) continue;
      const id = `${parsed.path}|${parsed.session}`;
      if (!sessions[id]) {
        sessions[id] = { path: parsed.path, session: parsed.session, files: [] };
      }
      sessions[id].files.push({ key: obj.Key, name: parsed.filename });
    }
    const list = Object.values(sessions).map(s => ({
      ...s,
      files: s.files.sort((a, b) => a.name.localeCompare(b.name)),
      date: s.session.replace(/_/g, ' '),
      id: `${s.path}|${s.session}`
    })).sort((a, b) => b.session.localeCompare(a.session));
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/** Retorna playlist HLS - usa proxy OU URLs presignadas (env USE_PRESIGNED=1 + CORS no R2) */
const USE_PRESIGNED = process.env.USE_PRESIGNED === '1';

app.get('/api/recordings/playlist', requireR2, async (req, res) => {
  try {
    const { path, session } = req.query;
    if (!path || !session) return res.status(400).send('path e session obrigatórios');
    const prefix = `${R2_PREFIX}${path}/${session}/`;
    const tsFiles = [];
    let continuationToken;
    do {
      const result = await s3.send(new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken
      }));
      const page = (result.Contents || []).filter(o => {
        if (!o.Key || !o.Key.endsWith('.ts')) return false;
        const afterPrefix = o.Key.slice(prefix.length);
        return !afterPrefix.includes('/');
      });
      tsFiles.push(...page);
      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);

    tsFiles.sort((a, b) => {
      const ka = (a.Key || '').split('/').pop() || '';
      const kb = (b.Key || '').split('/').pop() || '';
      const na = parseInt(ka, 10);
      const nb = parseInt(kb, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return ka.localeCompare(kb, undefined, { numeric: true });
    });
    if (tsFiles.length === 0) return res.status(404).send('Nenhum segmento encontrado');

    let m3u8 = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:60\n#EXT-X-MEDIA-SEQUENCE:0\n';

    if (USE_PRESIGNED) {
      const urls = await Promise.all(tsFiles.map(f =>
        getSignedUrl(s3, new GetObjectCommand({ Bucket: R2_BUCKET, Key: f.Key }), { expiresIn: 3600 })
      ));
      for (const url of urls) m3u8 += `#EXTINF:60.0,\n${url}\n`;
    } else {
      const base = `${req.protocol}://${req.get('host')}`;
      for (const f of tsFiles) {
        m3u8 += `#EXTINF:60.0,\n${base}/api/recordings/segment?key=${encodeURIComponent(f.Key)}\n`;
      }
    }
    m3u8 += '#EXT-X-ENDLIST\n';
    res.type('application/vnd.apple.mpegurl').send(m3u8);
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

/** Proxy de segmento (quando USE_PRESIGNED=0) */
app.get('/api/recordings/segment', requireR2, async (req, res) => {
  try {
    const key = req.query.key;
    if (!key) return res.status(400).send('key required');
    const obj = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    res.set('Content-Type', 'video/mp2t');
    if (obj.ContentLength) res.set('Content-Length', String(obj.ContentLength));
    const body = obj.Body;
    if (body && typeof body.pipe === 'function') {
      body.pipe(res);
    } else {
      const buf = Buffer.from(await body.transformToByteArray());
      res.send(buf);
    }
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
  if (!hasR2) console.log('R2 não configurado — aba Gravações desabilitada');
});
