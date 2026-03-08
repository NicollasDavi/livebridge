import express from 'express';
import { execSync } from 'child_process';
import { readdirSync, statSync, writeFileSync, unlinkSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { createReadStream } from 'fs';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { S3Client } from '@aws-sdk/client-s3';

const app = express();
app.use(express.json());

const RECORDINGS_DIR = process.env.RECORDINGS_DIR || '/recordings';
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_BUCKET = process.env.R2_BUCKET || 'livebridge';
const R2_VIDEOS_PREFIX = 'recordings/videos/';

const hasR2 = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY);
const s3 = hasR2 ? new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY }
}) : null;

function mergeAndUpload(path, sessionNameOrDir = null) {
  let sessionDir, sessionName;
  if (sessionNameOrDir) {
    if (typeof sessionNameOrDir === 'string' && sessionNameOrDir.includes('/')) {
      sessionDir = sessionNameOrDir;
      sessionName = sessionDir.split('/').pop();
    } else {
      sessionDir = join(RECORDINGS_DIR, path, sessionNameOrDir);
      sessionName = sessionNameOrDir;
    }
    if (!existsSync(sessionDir)) {
      return Promise.resolve({ ok: false, reason: 'no_session' });
    }
  } else {
    const fullPath = join(RECORDINGS_DIR, path);
    if (!existsSync(fullPath)) return Promise.resolve({ ok: false, reason: 'no_session' });
    const entries = readdirSync(fullPath, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory())
      .map(e => ({ name: e.name, path: join(fullPath, e.name), mtime: statSync(join(fullPath, e.name)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    if (!dirs[0]) return Promise.resolve({ ok: false, reason: 'no_session' });
    sessionDir = dirs[0].path;
    sessionName = dirs[0].name;
  }
  const tsFiles = readdirSync(sessionDir)
    .filter(f => f.endsWith('.ts'))
    .sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
      return na - nb || a.localeCompare(b, undefined, { numeric: true });
    });
  if (tsFiles.length === 0) {
    console.log('[merge] Nenhum .ts na pasta', sessionDir);
    return { ok: false, reason: 'no_segments' };
  }
  const listPath = join(sessionDir, '_concat.txt');
  const listContent = tsFiles.map(f => `file '${join(sessionDir, f)}'`).join('\n');
  writeFileSync(listPath, listContent);
  const outPath = join(sessionDir, `${sessionName}.mp4`);
  try {
    execSync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outPath}"`, {
      stdio: 'inherit',
      timeout: 300000
    });
  } catch (e) {
    console.error('[merge] ffmpeg falhou', e);
    try { unlinkSync(listPath); } catch (_) {}
    return { ok: false, reason: 'ffmpeg_failed' };
  }
  unlinkSync(listPath);
  if (!hasR2) {
    console.log('[merge] R2 não configurado, mp4 gerado em', outPath);
    return { ok: true, local: outPath };
  }
  const r2Key = `${R2_VIDEOS_PREFIX}${path}/${sessionName}.mp4`;
  const stream = createReadStream(outPath);
  const uploadPromise = s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: r2Key,
    Body: stream,
    ContentType: 'video/mp4'
  }));
  return uploadPromise.then(() => {
    for (const f of tsFiles) {
      try { unlinkSync(join(sessionDir, f)); } catch (_) {}
    }
    try { unlinkSync(outPath); } catch (_) {}
    try { rmSync(sessionDir, { recursive: true }); } catch (_) {}
    console.log('[merge] Upload concluído:', r2Key);
    return { ok: true, key: r2Key };
  }).catch(e => {
    console.error('[merge] Upload R2 falhou', e);
    return { ok: false, reason: 'upload_failed' };
  });
}

app.post('/merge', async (req, res) => {
  const path = req.query.path || req.body?.path;
  if (!path) {
    return res.status(400).json({ error: 'path obrigatório' });
  }
  try {
    const result = await mergeAndUpload(path);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

const STALE_MS = 2 * 60 * 1000;
const processedDirs = new Set();

function findStaleSessions() {
  try {
    const pathBase = join(RECORDINGS_DIR, 'live');
    if (!existsSync(pathBase)) return;
    const streams = readdirSync(pathBase, { withFileTypes: true }).filter(e => e.isDirectory());
    for (const s of streams) {
      const streamPath = join(pathBase, s.name);
      const sessions = readdirSync(streamPath, { withFileTypes: true }).filter(e => e.isDirectory());
      for (const sess of sessions) {
        const sessionPath = join(streamPath, sess.name);
        const key = sessionPath;
        if (processedDirs.has(key)) continue;
        const stat = statSync(sessionPath);
        const age = Date.now() - stat.mtimeMs;
        if (age < STALE_MS) continue;
        const tsFiles = readdirSync(sessionPath).filter(f => f.endsWith('.ts'));
        if (tsFiles.length === 0) continue;
        const mtxPath = `live/${s.name}`;
        processedDirs.add(key);
        console.log('[merge] Sessão finalizada detectada:', mtxPath, sess.name);
        mergeAndUpload(mtxPath, sess.name).then(r => {
          if (r.ok) processedDirs.delete(key);
        }).catch(() => processedDirs.delete(key));
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[merge] scan error', e.message);
  }
}

setInterval(findStaleSessions, 30000);
setTimeout(findStaleSessions, 5000);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Merge service rodando na porta ${PORT}`));
