import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { ListObjectsV2Command, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { S3Client } from '@aws-sdk/client-s3';
import cors from 'cors';

const app = express();
const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,https://api.posihub.com.br,http://localhost:8081').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, callback) => {
    if (origin && corsOrigins.includes(origin)) {
      callback(null, origin);
    } else if (!origin) {
      callback(null, corsOrigins[0]);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(cookieParser());
app.use(express.json());

const VIDEO_ACCESS_SECRET = process.env.VIDEO_ACCESS_SECRET;
const VIDEO_LIVE_COOKIE = 'vid_live';
const VIDEO_LIVE_MAX_AGE = 14400; // 4h para live

/** Valida JWT de gravação (path, session). Retorna payload ou null. */
function verifyVideoToken(token) {
  if (!VIDEO_ACCESS_SECRET || !token) return null;
  try {
    const payload = jwt.verify(token, VIDEO_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (!payload.path || !payload.session) return null;
    return payload;
  } catch (e) {
    console.log('[video] JWT verify error:', e.message);
    return null;
  }
}

/** Valida JWT de live (streamName). Retorna payload ou null. */
function verifyLiveToken(token) {
  if (!VIDEO_ACCESS_SECRET || !token) return null;
  try {
    const payload = jwt.verify(token, VIDEO_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (!payload.streamName) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Cookie legado para /api/recordings (listagem) — mantido para compatibilidade */
const VIDEO_ACCESS_COOKIE = 'vid_ctx';
const VIDEO_ACCESS_MAX_AGE = 86400;

function setVideoAccessCookie(res) {
  const token = crypto.randomBytes(24).toString('hex');
  res.cookie(VIDEO_ACCESS_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: VIDEO_ACCESS_MAX_AGE
  });
}

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
function extractLessonsArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    return data.content ?? data.data ?? data.lessons ?? data.items ?? [];
  }
  return [];
}
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
    if (!res.ok) {
      console.warn('[API] Lessons API respondeu', res.status, res.statusText);
      return lessonsCache.data || [];
    }
    const raw = await res.json();
    const data = extractLessonsArray(raw);
    if (!Array.isArray(data)) {
      console.warn('[API] Lessons API retornou formato inesperado');
      return lessonsCache.data || [];
    }
    if (process.env.DEBUG_LESSONS && data.length > 0) {
      console.log('[API] Lessons sample:', JSON.stringify(data[0]));
    }
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

/** Inicializa sessão de vídeo (cookie para listagem — gravações e live usam JWT) */
app.get('/api/init', (req, res) => {
  setVideoAccessCookie(res);
  res.json({ ok: true });
});

/** Valida acesso a HLS (usado pelo nginx auth_request). Query: stream=nome_do_stream */
app.get('/api/check-video-access', (req, res) => {
  const stream = req.query.stream;
  if (VIDEO_ACCESS_SECRET) {
    if (!stream || typeof stream !== 'string') return res.status(403).end();
    const token = req.cookies?.[VIDEO_LIVE_COOKIE];
    const payload = verifyLiveToken(token);
    if (!payload || payload.streamName !== stream) return res.status(403).end();
  } else {
    const cookie = req.cookies?.[VIDEO_ACCESS_COOKIE];
    if (!cookie || cookie.length < 32) return res.status(403).end();
  }
  res.status(200).end();
});

/** Inicializa sessão de live — token JWT obtido do Java (check-live-access) */
app.post('/api/init-live', express.json(), (req, res) => {
  const { streamName, token } = req.body;
  if (!streamName || !token) return res.status(400).json({ error: 'streamName e token obrigatórios' });
  const payload = verifyLiveToken(token);
  if (!payload || payload.streamName !== streamName) return res.status(403).json({ error: 'Token inválido ou expirado' });
  res.cookie(VIDEO_LIVE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: VIDEO_LIVE_MAX_AGE
  });
  res.json({ ok: true });
});

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

    setVideoAccessCookie(res);
    const lessonMap = new Map();
    for (const l of Array.isArray(lessons) ? lessons : []) {
      const key = l.id ?? (l.path && l.session ? `${l.path}|${l.session}` : null);
      if (key) lessonMap.set(key, l);
    }

    for (const rec of r2List) {
      const lesson = lessonMap.get(rec.id);
      rec.name = lesson?.titulo ?? lesson?.nome ?? null;
      rec.numero = lesson?.aula ?? null;
      rec.assunto = lesson?.assunto ?? null;
      rec.professor = lesson?.professor ?? null;
      rec.materia = lesson?.materia ?? null;
      rec.frente = lesson?.frente ?? null;
      rec.cursos = Array.isArray(lesson?.cursos) ? lesson.cursos : [];
      rec.ativo = lesson?.ativo ?? true;
    }

    res.json(r2List);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/** Middleware: exige token JWT OU cookie vid_ctx (player embutido do LiveBridge) */
function requireVideoAuth(req, res, next) {
  const { path: p, session, token } = req.query;
  const cookie = req.cookies?.[VIDEO_ACCESS_COOKIE];

  if (VIDEO_ACCESS_SECRET) {
    const payload = verifyVideoToken(token);
    if (payload && payload.path === p && payload.session === session) return next();
    if (cookie && cookie.length >= 32) return next();
    return res.status(403).json({ error: 'Token inválido ou expirado. Obtenha novo token na plataforma.' });
  }
  if (!cookie || cookie.length < 32) return res.status(403).json({ error: 'Acesso negado. Acesse a plataforma primeiro.' });
  next();
}

/** Stream do vídeo .mp4. Exige token JWT (obtido do Java) ou cookie legado. */
app.get('/api/recordings/video', requireR2, requireVideoAuth, async (req, res) => {
  try {
    const { path: p, session } = req.query;
    if (!p || !session) return res.status(400).json({ error: 'path e session obrigatórios' });
    const key = `${R2_VIDEOS_PREFIX}${p}/${session}.mp4`;
    const rangeHeader = req.headers.range;
    const params = { Bucket: R2_BUCKET, Key: key };
    if (rangeHeader) params.Range = rangeHeader;
    const obj = await s3.send(new GetObjectCommand(params));
    res.set('Content-Type', 'video/mp4');
    res.set('Accept-Ranges', 'bytes');
    if (obj.ContentLength) res.set('Content-Length', String(obj.ContentLength));
    if (rangeHeader) {
      res.status(206);
      let contentRange = obj.ContentRange;
      if (!contentRange) {
        const head = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
        const total = head.ContentLength || 0;
        const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
        if (m) {
          const start = m[1] ? parseInt(m[1], 10) : 0;
          const end = m[2] ? parseInt(m[2], 10) : total - 1;
          contentRange = `bytes ${start}-${end}/${total}`;
        }
      }
      if (contentRange) res.set('Content-Range', contentRange);
    }
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
    const { id, numero, nome, assunto, professor, materia, frente, cursos, ativo } = req.body;
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id obrigatório' });
    if (!hasLessonsApi) return res.status(503).json({ error: 'API Lessons não configurada. Defina LESSONS_API_URL e LESSONS_API_TOKEN.' });
    const ativoValue = ativo === false || ativo === 'false' ? false : true;
    const res2 = await fetch(`${LESSONS_API_URL}/api/lessons`, {
      method: 'PUT',
      headers: lessonsHeaders,
      body: JSON.stringify({ id, numero, nome, assunto, professor, materia, frente, cursos, ativo: ativoValue })
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
  if (!VIDEO_ACCESS_SECRET) console.log('VIDEO_ACCESS_SECRET não configurado — vídeo e live exigem token JWT do Java');
  if (!hasR2) console.log('R2 não configurado — aba Gravações desabilitada');
  if (!hasLessonsApi) console.log('API Lessons não configurada — metadata desabilitada');
});
