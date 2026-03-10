import express from 'express';
import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3Client } from '@aws-sdk/client-s3';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_BUCKET = process.env.R2_BUCKET || 'livebridge';
const R2_VIDEOS_PREFIX = 'recordings/videos/';

const LESSONS_API_URL = process.env.LESSONS_API_URL || 'https://api.posihub.com.br';
const LESSONS_API_TOKEN = process.env.LESSONS_API_TOKEN || process.env.API_ACCESS_TOKEN;

const hasR2 = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY);
const skipLessonsInList = process.env.SKIP_LESSONS_API !== '0' && process.env.SKIP_LESSONS_API !== 'false';
const hasLessonsApi = !!(LESSONS_API_URL && LESSONS_API_TOKEN);

const s3 = hasR2 ? new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY }
}) : null;

const lessonsHeaders = {
  'X-Access-Token': LESSONS_API_TOKEN,
  'Content-Type': 'application/json'
};

function requireR2(req, res, next) {
  if (!hasR2) return res.status(503).json({ error: 'R2 não configurado. Defina R2_ACCOUNT_ID, R2_ACCESS_KEY e R2_SECRET_KEY no .env' });
  next();
}

const LESSONS_TIMEOUT_MS = parseInt(process.env.LESSONS_TIMEOUT_MS || '2000', 10);
const LESSONS_CACHE_MS = parseInt(process.env.LESSONS_CACHE_MS || '30000', 10); // 30s cache

let lessonsCache = { data: null, ts: 0 };
async function fetchLessons() {
  if (!hasLessonsApi) return [];
  const now = Date.now();
  if (lessonsCache.data && (now - lessonsCache.ts) < LESSONS_CACHE_MS) {
    return lessonsCache.data;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), LESSONS_TIMEOUT_MS);
    const res = await fetch(`${LESSONS_API_URL}/api/lessons`, { headers: lessonsHeaders, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return lessonsCache.data || [];
    const data = await res.json();
    lessonsCache = { data, ts: now };
    return data;
  } catch (e) {
    console.warn('[API] Erro ao buscar lessons:', e.message);
    return lessonsCache.data || [];
  }
}

async function fetchDistinct(field) {
  if (!hasLessonsApi) return [];
  try {
    const res = await fetch(`${LESSONS_API_URL}/api/lessons/distinct/${field}`, { headers: lessonsHeaders });
    if (!res.ok) return [];
    const arr = await res.json();
    return Array.isArray(arr) ? arr.map(n => ({ nome: n })) : [];
  } catch (e) {
    console.warn('[API] Erro ao buscar distinct:', e.message);
    return [];
  }
}

/** Lista gravações (.mp4 em recordings/videos/) com metadata da API Lessons */
app.get('/api/recordings', requireR2, async (req, res) => {
  try {
    const r2Promise = (async () => {
      const list = [];
        let continuationToken;
        do {
          const result = await s3.send(new ListObjectsV2Command({
            Bucket: R2_BUCKET,
            Prefix: R2_VIDEOS_PREFIX,
            ContinuationToken: continuationToken,
            MaxKeys: 1000
          }));
          for (const obj of result.Contents || []) {
            if (!obj.Key || !obj.Key.endsWith('.mp4')) continue;
            const rest = obj.Key.slice(R2_VIDEOS_PREFIX.length);
            const parts = rest.split('/');
            if (parts.length < 2) continue;
            const filename = parts.pop();
            const recPath = parts.join('/');
            const session = filename.replace('.mp4', '');
            list.push({
              path: recPath,
              session,
              key: obj.Key,
              date: session.replace(/_/g, ' '),
              id: `${recPath}|${session}`
            });
          }
          continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
        } while (continuationToken);
      list.sort((a, b) => b.session.localeCompare(a.session));
      return list;
    })();

    const lessonsPromise = (hasLessonsApi && !skipLessonsInList) ? fetchLessons() : Promise.resolve([]);
    const [r2List, lessons] = await Promise.all([r2Promise, lessonsPromise]);

    const lessonMap = new Map((Array.isArray(lessons) ? lessons : []).map(l => [l.id, l]));

    for (const rec of r2List) {
      const lesson = lessonMap.get(rec.id);
      rec.name = lesson?.titulo ?? null;
      rec.numero = lesson?.aula ?? null;
      rec.assunto = lesson?.assunto ?? null;
      rec.professor = lesson?.professor ?? null;
      rec.materia = lesson?.materia ?? null;
      rec.frente = lesson?.frente ?? null;
      rec.cursos = Array.isArray(lesson?.cursos) ? lesson.cursos : [];
    }

    res.json(r2List);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/** URL do vídeo .mp4 (presignada ou redirect) */
app.get('/api/recordings/video', requireR2, async (req, res) => {
  try {
    const { path: p, session } = req.query;
    if (!p || !session) return res.status(400).json({ error: 'path e session obrigatórios' });
    const key = `${R2_VIDEOS_PREFIX}${p}/${session}.mp4`;
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

/** Atualiza nome (retrocompatível) - proxy para API Lessons */
app.put('/api/recordings/name', requireR2, async (req, res) => {
  try {
    const { id, name } = req.body;
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id obrigatório' });
    if (!hasLessonsApi) return res.status(503).json({ error: 'API Lessons não configurada. Defina LESSONS_API_URL e LESSONS_API_TOKEN.' });
    const res2 = await fetch(`${LESSONS_API_URL}/api/lessons`, {
      method: 'PUT',
      headers: lessonsHeaders,
      body: JSON.stringify({ id, nome: name?.trim() || null })
    });
    const data = await res2.json().catch(() => ({}));
    if (!res2.ok) return res.status(res2.status).json(data);
    lessonsCache = { data: null, ts: 0 };
    res.json({ ok: true, name: name?.trim() || null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/** Atualiza metadata completa - proxy para API Lessons */
app.put('/api/recordings/metadata', requireR2, async (req, res) => {
  try {
    const { id, numero, nome, assunto, professor, materia, frente, cursos } = req.body;
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id obrigatório' });
    if (!hasLessonsApi) return res.status(503).json({ error: 'API Lessons não configurada. Defina LESSONS_API_URL e LESSONS_API_TOKEN.' });
    const res2 = await fetch(`${LESSONS_API_URL}/api/lessons`, {
      method: 'PUT',
      headers: lessonsHeaders,
      body: JSON.stringify({ id, numero, nome, assunto, professor, materia, frente, cursos })
    });
    const data = await res2.json().catch(() => ({}));
    if (!res2.ok) return res.status(res2.status).json(data);
    lessonsCache = { data: null, ts: 0 };
    res.json({ ok: true, aula: data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/** Listagem de referências - proxy para API Lessons distinct */
app.get('/api/professores', async (req, res) => {
  const arr = await fetchDistinct('professores');
  res.json(arr);
});
app.get('/api/materias', async (req, res) => {
  const arr = await fetchDistinct('materias');
  res.json(arr);
});
app.get('/api/frentes', async (req, res) => {
  const arr = await fetchDistinct('frentes');
  res.json(arr);
});
app.get('/api/cursos', async (req, res) => {
  const arr = await fetchDistinct('cursos');
  res.json(arr);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
  if (!hasR2) console.log('R2 não configurado — aba Gravações desabilitada');
  if (!hasLessonsApi) console.log('API Lessons não configurada — metadata desabilitada');
});
