import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, unlinkSync } from 'fs';
import { createReadStream } from 'fs';
import { join } from 'path';
import { ListObjectsV2Command, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(cookieParser());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[API] ${req.method} ${req.url}`);
  next();
});

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

/** Nome base da live para HLS ABR (nginx envia ex.: matematica_1080 → matematica). */
function liveStreamBaseName(stream) {
  if (!stream || typeof stream !== 'string') return '';
  return stream.replace(/_(1080|720|480)$/, '');
}

/** JWT de live (streamName) cobre variantes _1080/_720/_480 servidas pelo mesmo token. */
function liveTokenMatchesHlsStream(payload, requestStream) {
  if (!payload?.streamName || !requestStream) return false;
  if (payload.streamName === requestStream) return true;
  return payload.streamName === liveStreamBaseName(requestStream);
}

/** BANDWIDTH do master HLS (bits/s) — alinhar com mediamtx/transcode-abr.sh */
const LIVE_ABR_BANDWIDTH_1080 = 4628000;
const LIVE_ABR_BANDWIDTH_720 = 2928000;
const LIVE_ABR_BANDWIDTH_480 = 1328000;

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
const RECORDINGS_DIR = (process.env.RECORDINGS_DIR || '/recordings').trim();
const MERGE_INTERNAL_URL = process.env.MERGE_INTERNAL_URL || 'http://merge:8080';
const VIDEOS_API_URL = process.env.VIDEOS_API_URL || process.env.LESSONS_API_URL || 'https://api.posihub.com.br';
const VIDEOS_API_TOKEN = process.env.VIDEOS_API_TOKEN || process.env.LESSONS_API_TOKEN || process.env.API_ACCESS_TOKEN;

const hasR2 = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY);
const skipLessonsInList = process.env.SKIP_LESSONS_API !== '0' && process.env.SKIP_LESSONS_API !== 'false';
const hasLessonsApi = !!(LESSONS_API_URL && LESSONS_API_TOKEN);

const s3 = hasR2 ? new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY }
}) : null;

/** Playback no R2: `session.mp4` (legado) ou `session_1080|720|480.mp4` (merge multires). */
async function getRecordingObjectFromR2(p, session, rangeHeader, variantQuery) {
  const base = `${R2_VIDEOS_PREFIX}${p}/${session}`;
  let order = [`${base}.mp4`, `${base}_1080.mp4`, `${base}_720.mp4`, `${base}_480.mp4`];
  if (variantQuery === '1080' || variantQuery === '720' || variantQuery === '480') {
    const pref = `${base}_${variantQuery}.mp4`;
    order = [pref, ...order.filter((k) => k !== pref)];
  }
  let lastErr = null;
  for (const Key of order) {
    const params = { Bucket: R2_BUCKET, Key };
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

const lessonsHeaders = {
  'X-Access-Token': LESSONS_API_TOKEN,
  'Content-Type': 'application/json'
};

function requireR2(req, res, next) {
  if (!hasR2) return res.status(503).json({ error: 'R2 não configurado. Defina R2_ACCOUNT_ID, R2_ACCESS_KEY e R2_SECRET_KEY no .env' });
  next();
}

/** Descobre path e session atuais para um stream (lê do disco) */
function discoverCurrentSession(streamName) {
  const path = `live/${streamName}`;
  const fullPath = join(RECORDINGS_DIR, path);
  if (!existsSync(fullPath)) return null;
  const tsInStream = readdirSync(fullPath).filter(f => f.endsWith('.ts'));
  if (tsInStream.length > 0) {
    const sorted = tsInStream.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const session = sorted[0].replace(/\.ts$/i, '').replace(/-\d+$/, '');
    return { path, session };
  }
  const entries = readdirSync(fullPath, { withFileTypes: true });
  const dirs = entries
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name, mtime: statSync(join(fullPath, e.name)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!dirs[0]) return null;
  const sessionPath = join(fullPath, dirs[0].name);
  const tsFiles = readdirSync(sessionPath).filter(f => f.endsWith('.ts'));
  if (tsFiles.length === 0) return null;
  return { path, session: dirs[0].name };
}

/** Diretório para status live-ended */
const LIVE_ENDED_DIR = join(RECORDINGS_DIR, 'live-ended');

/** Progresso do merge (escrito pelo serviço merge, mesmo volume) */
const MERGE_PROGRESS_DIR = join(RECORDINGS_DIR, 'merge-progress');

function mergeProgressFilePath(p, session) {
  const safe = `${p.replace(/\//g, '_')}__${String(session).replace(/[/\\]/g, '_')}`;
  return join(MERGE_PROGRESS_DIR, `${safe}.json`);
}

/** Diretório para boundaries (último .ts incluído por stream — 2ª aula = do 1º click até 2º) */
const BOUNDARIES_DIR = join(RECORDINGS_DIR, 'boundaries');

function getBoundariesFile(streamName) {
  const safe = String(streamName).replace(/[/\\]/g, '_');
  return join(BOUNDARIES_DIR, `${safe}.json`);
}

function readLastBoundary(streamName) {
  try {
    const fp = getBoundariesFile(streamName);
    if (!existsSync(fp)) return null;
    const raw = readFileSync(fp, 'utf8');
    const data = JSON.parse(raw);
    return data.lastIncludedTs || null;
  } catch {
    return null;
  }
}

function writeLastBoundary(streamName, lastTsFile) {
  try {
    if (!existsSync(BOUNDARIES_DIR)) mkdirSync(BOUNDARIES_DIR, { recursive: true });
    const fp = getBoundariesFile(streamName);
    writeFileSync(fp, JSON.stringify({ lastIncludedTs: lastTsFile, updatedAt: new Date().toISOString() }));
  } catch (e) {
    console.warn('[API] Erro ao gravar boundary:', e?.message);
  }
}

function getLiveEndedFile(streamName) {
  const safe = String(streamName).replace(/[/\\]/g, '_');
  return join(LIVE_ENDED_DIR, `${safe}.json`);
}

/** Arquivo de status para gravação parcial (aula acabou) — permite múltiplas por stream */
function getLiveEndedFileForPartial(streamName, session) {
  const safeStream = String(streamName).replace(/[/\\]/g, '_');
  const safeSession = String(session).replace(/[/\\]/g, '_');
  return join(LIVE_ENDED_DIR, `${safeStream}__${safeSession}.json`);
}

function readLiveEndedPartial(streamName, session) {
  try {
    const filePath = getLiveEndedFileForPartial(streamName, session);
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeLiveEndedPartial(streamName, session, data) {
  try {
    if (!existsSync(LIVE_ENDED_DIR)) mkdirSync(LIVE_ENDED_DIR, { recursive: true });
    const filePath = getLiveEndedFileForPartial(streamName, session);
    writeFileSync(filePath, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }));
  } catch (e) {
    console.warn('[API] Erro ao gravar live-ended partial:', e?.message);
  }
}

function deleteLiveEndedPartial(streamName, session) {
  try {
    const filePath = getLiveEndedFileForPartial(streamName, session);
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch (e) {
    console.warn('[API] Erro ao remover live-ended partial:', e?.message);
  }
}

function deleteLiveEndedStatusFile(streamName) {
  try {
    const filePath = getLiveEndedFile(streamName);
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch (e) {
    console.warn('[API] Erro ao remover live-ended:', e?.message);
  }
}

function readLiveEndedStatus(streamName) {
  try {
    const filePath = getLiveEndedFile(streamName);
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeLiveEndedStatus(streamName, data) {
  try {
    if (!existsSync(LIVE_ENDED_DIR)) mkdirSync(LIVE_ENDED_DIR, { recursive: true });
    const filePath = getLiveEndedFile(streamName);
    writeFileSync(filePath, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }));
  } catch (e) {
    console.warn('[API] Erro ao gravar live-ended:', e?.message);
  }
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
    if (!payload || !liveTokenMatchesHlsStream(payload, stream)) return res.status(403).end();
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

/**
 * Master HLS (ABR): 1080p / 720p / 480p. Mesmo cookie que /hls (vid_live + JWT ou vid_ctx).
 * Player: hls.js com src = /api/live/hls-master.m3u8?streamName=NOME (NOME = chave RTMP sem live/).
 */
app.get('/api/live/hls-master.m3u8', (req, res) => {
  const raw = req.query.streamName;
  if (!raw || typeof raw !== 'string') {
    return res.status(400).type('text/plain').send('streamName obrigatório');
  }
  const streamName = raw.trim();
  if (!streamName || streamName.includes('..') || /[/\\\s]/.test(streamName) || streamName.length > 200) {
    return res.status(400).type('text/plain').send('streamName inválido');
  }
  if (VIDEO_ACCESS_SECRET) {
    const token = req.cookies?.[VIDEO_LIVE_COOKIE];
    const payload = verifyLiveToken(token);
    if (!payload || payload.streamName !== streamName) return res.status(403).type('text/plain').send('Forbidden');
  } else {
    const cookie = req.cookies?.[VIDEO_ACCESS_COOKIE];
    if (!cookie || cookie.length < 32) return res.status(403).type('text/plain').send('Forbidden');
  }
  const enc = encodeURIComponent(streamName);
  const body = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-STREAM-INF:BANDWIDTH=${LIVE_ABR_BANDWIDTH_1080},RESOLUTION=1920x1080,NAME="1080p"`,
    `/hls/live/${enc}_1080/index.m3u8`,
    `#EXT-X-STREAM-INF:BANDWIDTH=${LIVE_ABR_BANDWIDTH_720},RESOLUTION=1280x720,NAME="720p"`,
    `/hls/live/${enc}_720/index.m3u8`,
    `#EXT-X-STREAM-INF:BANDWIDTH=${LIVE_ABR_BANDWIDTH_480},RESOLUTION=854x480,NAME="480p"`,
    `/hls/live/${enc}_480/index.m3u8`,
    ''
  ].join('\n');
  res.set('Content-Type', 'application/vnd.apple.mpegurl');
  res.set('Cache-Control', 'no-store');
  res.send(body);
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
            let fileBase = filename.replace(/\.mp4$/i, '');
            let session = fileBase;
            let variant = null;
            const vm = fileBase.match(/^(.*)_(1080|720|480)$/);
            if (vm) {
              session = vm[1];
              variant = `${vm[2]}p`;
            }
            list.push({
              path: recPath,
              session,
              variant,
              key: obj.Key,
              date: session.replace(/_/g, ' '),
              id: `${recPath}|${session}`
            });
          }
          continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
        } while (continuationToken);
      const variantOrder = { '1080p': 0, '720p': 1, '480p': 2 };
      list.sort((a, b) => {
        const c = b.session.localeCompare(a.session);
        if (c !== 0) return c;
        return (variantOrder[a.variant] ?? -1) - (variantOrder[b.variant] ?? -1);
      });
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

/** HLS playlist (.m3u8) para gravação em processamento — serve .ts enquanto compacta/sobe pro R2. Suporta flat (path/*.ts) e folder (path/session/*.ts). */
app.get('/api/recordings/hls/playlist.m3u8', requireVideoAuth, (req, res) => {
  try {
    const { path: p, session } = req.query;
    if (!p || !session || typeof p !== 'string' || typeof session !== 'string') {
      return res.status(400).json({ error: 'path e session obrigatórios' });
    }
    if (p.includes('..') || session.includes('..')) return res.status(400).json({ error: 'path inválido' });
    let dir = join(RECORDINGS_DIR, p, session);
    const isFlat = !existsSync(dir);
    if (isFlat) {
      dir = join(RECORDINGS_DIR, p);
      if (!existsSync(dir)) return res.status(404).json({ error: 'Gravação não encontrada ou já processada' });
    }
    const tsFiles = readdirSync(dir).filter(f => f.endsWith('.ts')).sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
      return na - nb || a.localeCompare(b, undefined, { numeric: true });
    });
    if (tsFiles.length === 0) return res.status(404).json({ error: 'Nenhum segmento disponível' });
    const tokenPart = req.query.token ? `&token=${encodeURIComponent(req.query.token)}` : '';
    const segSession = isFlat ? 'flat' : session;
    const baseUrl = `/api/recordings/hls/segment?path=${encodeURIComponent(p)}&session=${encodeURIComponent(segSession)}${tokenPart}&file=`;
    const targetDuration = 60;
    let m3u8 = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:' + targetDuration + '\n#EXT-X-MEDIA-SEQUENCE:0\n';
    for (const f of tsFiles) {
      m3u8 += `#EXTINF:${targetDuration},\n${baseUrl}${encodeURIComponent(f)}\n`;
    }
    m3u8 += '#EXT-X-ENDLIST\n';
    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(m3u8);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/** HLS segment (.ts) — serve um segmento individual */
app.get('/api/recordings/hls/segment', requireVideoAuth, (req, res) => {
  try {
    const { path: p, session, file } = req.query;
    if (!p || !session || !file || typeof p !== 'string' || typeof session !== 'string' || typeof file !== 'string') {
      return res.status(400).json({ error: 'path, session e file obrigatórios' });
    }
    if (p.includes('..') || session.includes('..') || file.includes('..') || file.includes('/') || file.includes('\\') || !file.endsWith('.ts')) {
      return res.status(400).json({ error: 'parâmetros inválidos' });
    }
    const filePath = session === 'flat'
      ? join(RECORDINGS_DIR, p, file)
      : join(RECORDINGS_DIR, p, session, file);
    if (!existsSync(filePath)) return res.status(404).json({ error: 'Segmento não encontrado' });
    res.set('Content-Type', 'video/mp2t');
    createReadStream(filePath).pipe(res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/** Stream do vídeo. Se em processamento (.ts), redireciona para HLS. Se pronto (R2), retorna MP4. */
app.get('/api/recordings/video', requireVideoAuth, async (req, res) => {
  try {
    const { path: p, session, token } = req.query;
    if (!p || !session) return res.status(400).json({ error: 'path e session obrigatórios' });
    if (p.includes('..') || session.includes('..')) return res.status(400).json({ error: 'path inválido' });

    const partialDir = join(RECORDINGS_DIR, p, session);
    let tsFiles = existsSync(partialDir)
      ? readdirSync(partialDir).filter(f => f.endsWith('.ts'))
      : [];
    if (tsFiles.length === 0) {
      const flatDir = join(RECORDINGS_DIR, p);
      if (existsSync(flatDir)) {
        const flatTs = readdirSync(flatDir).filter(f => f.endsWith('.ts')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const derivedSession = flatTs[0]?.replace(/\.ts$/i, '').replace(/-\d+$/, '');
        if (flatTs.length > 0 && derivedSession === session) {
          tsFiles = flatTs;
        }
      }
    }
    if (tsFiles.length > 0) {
      const tokenPart = token ? `&token=${encodeURIComponent(token)}` : '';
      const hlsSession = existsSync(partialDir) ? session : 'flat';
      const hlsUrl = `/api/recordings/hls/playlist.m3u8?path=${encodeURIComponent(p)}&session=${encodeURIComponent(hlsSession)}${tokenPart}`;
      return res.redirect(302, hlsUrl);
    }

    if (!hasR2) return res.status(503).json({ error: 'R2 não configurado' });
    const rangeHeader = req.headers.range;
    const variantQ = req.query.variant;
    try {
      const { obj, Key: key } = await getRecordingObjectFromR2(p, session, rangeHeader, variantQ);
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
    } catch (r2Err) {
      if (r2Err.name === 'NoSuchKey' || r2Err.$metadata?.httpStatusCode === 404) {
        return res.status(404).json({ error: 'Vídeo não encontrado' });
      }
      throw r2Err;
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

/** Remove vídeo do R2 */
app.delete('/api/recordings', requireR2, async (req, res) => {
  try {
    const { path: p, session } = req.body?.path ? req.body : req.query;
    if (!p || !session) return res.status(400).json({ error: 'path e session obrigatórios' });
    const base = `${R2_VIDEOS_PREFIX}${p}/${session}`;
    const keys = [`${base}.mp4`, `${base}_1080.mp4`, `${base}_720.mp4`, `${base}_480.mp4`];
    await Promise.all(keys.map((Key) => s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key }))));
    res.json({ ok: true, message: 'Vídeo(s) removido(s)' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/** Opção C: Operador clica "Aula acabou" — registra vídeo na API (antes do merge) e dispara merge */
app.post('/api/recordings/live-ended', async (req, res) => {
  try {
    const { streamName, name, materia, n_aula, frente, professor, folder_ids, course_ids } = req.body;
    if (!streamName || typeof streamName !== 'string') {
      return res.status(400).json({ error: 'streamName obrigatório' });
    }
    const discovered = discoverCurrentSession(streamName.trim());
    if (!discovered) {
      return res.status(404).json({ error: 'Nenhuma sessão de gravação ativa encontrada para este stream' });
    }
    const { path, session } = discovered;
    const stream = streamName.trim();
    try {
      const bf = getBoundariesFile(stream);
      if (existsSync(bf)) unlinkSync(bf);
    } catch (_) {}
    const videoPath = `${path}/${session}.mp4`;
    writeLiveEndedStatus(stream, { path, session, status: 'processing', endedAt: new Date().toISOString() });

    if (VIDEOS_API_URL && VIDEOS_API_TOKEN) {
      const videoName = name ?? videoPath;
      const body = {
        name: videoName,
        path: videoPath,
        materia: materia ?? null,
        n_aula: n_aula ?? null,
        frente: frente ?? null,
        professor: professor ?? null,
        folder_ids: Array.isArray(folder_ids) ? folder_ids : [],
        course_ids: Array.isArray(course_ids) ? course_ids : []
      };
      try {
        const res2 = await fetch(`${VIDEOS_API_URL}/api/videos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Access-Token': VIDEOS_API_TOKEN },
          body: JSON.stringify(body)
        });
        const data = await res2.json().catch(() => ({}));
        if (!res2.ok) {
          console.warn('[API] Videos API respondeu', res2.status, data);
        } else {
          writeLiveEndedStatus(stream, { path, session, status: 'processing', videoId: data.id, endedAt: new Date().toISOString() });
        }
      } catch (e) {
        console.warn('[API] Erro ao registrar vídeo na API:', e?.message);
      }
    }

    const mergeUrl = `${MERGE_INTERNAL_URL}/merge?path=${encodeURIComponent(path)}&session=${encodeURIComponent(session)}`;
    fetch(mergeUrl, { method: 'POST' }).then(async (mergeRes) => {
      const data = await mergeRes.json().catch(() => ({}));
      if (data.ok) {
        deleteLiveEndedStatusFile(stream);
      } else {
        writeLiveEndedStatus(stream, { path, session, status: 'failed', reason: data.reason || 'merge_failed' });
      }
    }).catch((e) => {
      console.error('[API] Erro ao chamar merge:', e?.message);
      writeLiveEndedStatus(stream, { path, session, status: 'failed', reason: e?.message });
    });

    res.json({
      ok: true,
      path,
      session,
      status: 'processing',
      message: 'Gravação finalizada. Processamento iniciado em background.'
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const tsSort = (a, b) => {
  const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
  const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
  return na - nb || a.localeCompare(b, undefined, { numeric: true });
};

/** "Aula acabou" — 1ª vez: do início até agora. 2ª vez: do 1º click até 2º. 3ª: do 2º até 3º. A live continua. */
app.post('/api/recordings/lesson-boundary', async (req, res) => {
  try {
    const { streamName, name, materia, n_aula, frente, professor, folder_ids, course_ids } = req.body;
    if (!streamName || typeof streamName !== 'string') {
      return res.status(400).json({ error: 'streamName obrigatório' });
    }
    const stream = streamName.trim();
    const path = `live/${stream}`;
    const fullPath = join(RECORDINGS_DIR, path);
    if (!existsSync(fullPath)) {
      return res.status(404).json({ error: 'Nenhuma gravação ativa para este stream' });
    }

    let srcDir, allTs;
    const tsInStream = readdirSync(fullPath).filter(f => f.endsWith('.ts'));
    if (tsInStream.length > 0) {
      srcDir = fullPath;
      allTs = tsInStream.sort(tsSort);
    } else {
      const dirs = readdirSync(fullPath, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => ({ name: e.name, mtime: statSync(join(fullPath, e.name)).mtime }))
        .sort((a, b) => b.mtime - a.mtime);
      if (!dirs[0]) return res.status(404).json({ error: 'Nenhum segmento .ts encontrado' });
      srcDir = join(fullPath, dirs[0].name);
      allTs = readdirSync(srcDir).filter(f => f.endsWith('.ts')).sort(tsSort);
    }

    const lastIncluded = readLastBoundary(stream);
    let tsFiles = allTs;
    if (lastIncluded) {
      const idx = allTs.indexOf(lastIncluded);
      if (idx >= 0) {
        tsFiles = allTs.slice(idx + 1);
      }
    }

    if (tsFiles.length === 0) {
      return res.status(404).json({
        error: lastIncluded
          ? 'Nenhum segmento novo desde o último "aula acabou". Aguarde mais gravação.'
          : 'Nenhum segmento .ts para copiar'
      });
    }

    const now = new Date();
    const sessionSuffix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}_aula`;
    const session = sessionSuffix;
    const partialDir = join(fullPath, session);
    mkdirSync(partialDir, { recursive: true });

    for (const f of tsFiles) {
      copyFileSync(join(srcDir, f), join(partialDir, f));
    }
    writeLastBoundary(stream, tsFiles[tsFiles.length - 1]);

    const videoPath = `${path}/${session}.mp4`;
    writeLiveEndedPartial(stream, session, { path, session, status: 'processing', endedAt: now.toISOString() });

    if (VIDEOS_API_URL && VIDEOS_API_TOKEN) {
      const videoName = name ?? videoPath;
      const body = {
        name: videoName,
        path: videoPath,
        materia: materia ?? null,
        n_aula: n_aula ?? null,
        frente: frente ?? null,
        professor: professor ?? null,
        folder_ids: Array.isArray(folder_ids) ? folder_ids : [],
        course_ids: Array.isArray(course_ids) ? course_ids : []
      };
      try {
        const res2 = await fetch(`${VIDEOS_API_URL}/api/videos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Access-Token': VIDEOS_API_TOKEN },
          body: JSON.stringify(body)
        });
        const data = await res2.json().catch(() => ({}));
        if (res2.ok) {
          writeLiveEndedPartial(stream, session, { path, session, status: 'processing', videoId: data.id, endedAt: now.toISOString() });
        }
      } catch (e) {
        console.warn('[API] Erro ao registrar vídeo na API:', e?.message);
      }
    }

    const mergeUrl = `${MERGE_INTERNAL_URL}/merge?path=${encodeURIComponent(path)}&session=${encodeURIComponent(session)}`;
    fetch(mergeUrl, { method: 'POST' }).then(async (mergeRes) => {
      const data = await mergeRes.json().catch(() => ({}));
      if (data.ok) {
        deleteLiveEndedPartial(stream, session);
      } else {
        writeLiveEndedPartial(stream, session, { path, session, status: 'failed', reason: data.reason || 'merge_failed' });
      }
    }).catch((e) => {
      console.error('[API] Erro ao chamar merge:', e?.message);
      writeLiveEndedPartial(stream, session, { path, session, status: 'failed', reason: e?.message });
    });

    res.json({
      ok: true,
      path,
      session,
      status: 'processing',
      message: 'Aula registrada. Vídeo disponível em HLS enquanto compacta. Após upload no R2, os .ts desta aula são removidos do disco.',
      hlsUrl: `/api/recordings/hls/playlist.m3u8?path=${encodeURIComponent(path)}&session=${encodeURIComponent(session)}`,
      mergeProgressUrl: `/api/recordings/merge-progress?path=${encodeURIComponent(path)}&session=${encodeURIComponent(session)}`
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/** Lista vídeos de live-ended (aulas registradas, ainda não no R2 ou já prontas). Inclui live-ended e lesson-boundary (parciais). */
app.get('/api/recordings/pending', (req, res) => {
  try {
    if (!existsSync(LIVE_ENDED_DIR)) return res.json([]);
    const files = readdirSync(LIVE_ENDED_DIR).filter(f => f.endsWith('.json'));
    const list = [];
    for (const f of files) {
      const base = f.replace(/\.json$/, '');
      const isPartial = base.includes('__');
      let data;
      if (isPartial) {
        const [streamPart, sessionPart] = base.split('__');
        const streamName = streamPart.replace(/_/g, '/');
        data = readLiveEndedPartial(streamName, sessionPart);
      } else {
        const streamName = base.replace(/_/g, '/');
        data = readLiveEndedStatus(streamName);
      }
      if (data && data.path && data.session) {
        list.push({
          streamName: data.path.replace(/^live\//, ''),
          path: data.path,
          session: data.session,
          status: data.status || 'processing',
          videoPath: data.status === 'ready' ? `${data.path}/${data.session}.mp4` : null,
          hlsUrl: data.session?.endsWith('_aula') && data.status === 'processing'
            ? `/api/recordings/hls/playlist.m3u8?path=${encodeURIComponent(data.path)}&session=${encodeURIComponent(data.session)}`
            : null,
          mergeProgressUrl: data.status === 'processing'
            ? `/api/recordings/merge-progress?path=${encodeURIComponent(data.path)}&session=${encodeURIComponent(data.session)}`
            : null,
          endedAt: data.endedAt,
          updatedAt: data.updatedAt
        });
      }
    }
    list.sort((a, b) => (b.endedAt || '').localeCompare(a.endedAt || ''));
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/** Status da gravação (para polling do frontend). Com session, retorna status de gravação parcial. */
app.get('/api/recordings/status', (req, res) => {
  try {
    const { streamName, session: sessionParam } = req.query;
    if (!streamName) {
      return res.status(400).json({ error: 'streamName obrigatório' });
    }
    const stream = streamName.trim();
    if (sessionParam && sessionParam.endsWith('_aula')) {
      const statusData = readLiveEndedPartial(stream, sessionParam);
      if (statusData) {
        const { path, session, status } = statusData;
        return res.json({
          path,
          session,
          status: status || 'processing',
          videoPath: status === 'ready' ? `${path}/${session}.mp4` : null,
          hlsUrl: status === 'processing' ? `/api/recordings/hls/playlist.m3u8?path=${encodeURIComponent(path)}&session=${encodeURIComponent(session)}` : null,
          mergeProgressUrl: status === 'processing' ? `/api/recordings/merge-progress?path=${encodeURIComponent(path)}&session=${encodeURIComponent(session)}` : null,
          message: status === 'processing' ? 'Compactando e enviando...' : status === 'ready' ? 'Pronto' : statusData.reason || status
        });
      }
      return res.json({ path: null, session: null, status: 'not_found', message: 'Gravação não encontrada' });
    }
    const statusData = readLiveEndedStatus(stream);
    if (statusData) {
      const { path, session, status } = statusData;
      return res.json({
        path,
        session,
        status: status || 'processing',
        videoPath: status === 'ready' ? `${path}/${session}.mp4` : null,
        mergeProgressUrl: status === 'processing' ? `/api/recordings/merge-progress?path=${encodeURIComponent(path)}&session=${encodeURIComponent(session)}` : null,
        message: status === 'processing' ? 'Compactando e enviando...' : status === 'ready' ? 'Pronto' : statusData.reason || status
      });
    }
    const discovered = discoverCurrentSession(stream);
    if (!discovered) {
      return res.json({ path: null, session: null, status: 'no_session', message: 'Nenhuma sessão ativa' });
    }
    const { path, session } = discovered;
    res.json({
      path,
      session,
      status: 'live',
      videoPath: null,
      message: 'Gravando'
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/** Progresso de compactação + upload (merge). Lê JSON gerado pelo serviço merge. */
app.get('/api/recordings/merge-progress', (req, res) => {
  try {
    const { path: p, session } = req.query;
    if (!p || !session) return res.status(400).json({ error: 'path e session obrigatórios' });
    if (p.includes('..') || session.includes('..')) return res.status(400).json({ error: 'parâmetros inválidos' });
    const fp = mergeProgressFilePath(p, session);
    if (!existsSync(fp)) {
      return res.json({
        status: 'idle',
        phase: 'idle',
        percentOverall: null,
        message: 'Nenhum processamento ativo para este path/session (ou já concluiu há mais de alguns minutos).'
      });
    }
    const data = JSON.parse(readFileSync(fp, 'utf8'));
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/** Chamado pelo merge quando upload conclui — remove entrada em live-ended (vídeo já no R2) */
app.post('/api/recordings/upload-complete', async (req, res) => {
  try {
    const { path, session, variants } = req.body || {};
    if (!path || !session) {
      console.warn('[API] upload-complete sem path/session — body:', JSON.stringify(req.body));
      return res.status(400).json({ error: 'path e session obrigatórios' });
    }
    const streamName = path.replace(/^live\//, '');
    if (session.endsWith('_aula')) {
      deleteLiveEndedPartial(streamName, session);
    } else {
      deleteLiveEndedStatusFile(streamName);
    }
    if (Array.isArray(variants) && variants.length > 0) {
      console.log('[API] upload-complete OK, variantes R2:', variants.map((v) => v.key || v.label).join(', '));
    }
    console.log('[API] upload-complete OK, removido live-ended:', path, session);
    res.json({ ok: true });
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
