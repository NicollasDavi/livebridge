import express from 'express';
import { execSync } from 'child_process';
import { readdirSync, statSync, writeFileSync, unlinkSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { createReadStream } from 'fs';
import { PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { S3Client } from '@aws-sdk/client-s3';

const app = express();
app.use(express.json());

const RECORDINGS_DIR = (process.env.RECORDINGS_DIR || '/recordings').trim();
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID?.trim();
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY?.trim();
const R2_SECRET_KEY = process.env.R2_SECRET_KEY?.trim();
const R2_BUCKET = (process.env.R2_BUCKET || 'livebridge').trim();
const R2_VIDEOS_PREFIX = 'recordings/videos/';
const COMPRESS_VIDEO = process.env.COMPRESS_VIDEO !== '0';

const hasR2 = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY);
const s3 = hasR2 ? new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY }
}) : null;

function mergeAndUpload(path, sessionNameOrDir = null) {
  let sessionDir, sessionName, deleteFolderAfter = true;
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
    const tsInStream = readdirSync(fullPath).filter(f => f.endsWith('.ts'));
    if (tsInStream.length > 0) {
      sessionDir = fullPath;
      deleteFolderAfter = false;
      const sorted = tsInStream.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      sessionName = sorted[0].replace(/\.ts$/i, '').replace(/-\d+$/, '');
    } else {
      const entries = readdirSync(fullPath, { withFileTypes: true });
      const dirs = entries
        .filter(e => e.isDirectory())
        .map(e => ({ name: e.name, path: join(fullPath, e.name), mtime: statSync(join(fullPath, e.name)).mtime }))
        .sort((a, b) => b.mtime - a.mtime);
      if (!dirs[0]) return Promise.resolve({ ok: false, reason: 'no_session' });
      sessionDir = dirs[0].path;
      sessionName = dirs[0].name;
    }
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
  const ffmpegCmd = COMPRESS_VIDEO
    ? `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c:v libx264 -crf 21 -preset slower -c:a aac -b:a 96k -aac_coder twoloop -movflags +faststart "${outPath}"`
    : `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outPath}"`;
  try {
    execSync(ffmpegCmd, {
      stdio: 'inherit',
      timeout: 3600000
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
    if (deleteFolderAfter) {
      try { rmSync(sessionDir, { recursive: true }); } catch (_) {}
    }
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

// Debug: lista sessões locais e status R2
function scanRecordings() {
  const result = {
    recordingsDir: RECORDINGS_DIR,
    hasR2,
    r2Bucket: R2_BUCKET,
    r2AccountId: R2_ACCOUNT_ID ? '***' + R2_ACCOUNT_ID.slice(-4) : null,
    sessions: [],
    error: null
  };
  try {
    const pathBase = join(RECORDINGS_DIR, 'live');
    result.pathExists = existsSync(pathBase);
    result.underLive = existsSync(pathBase) ? readdirSync(pathBase, { withFileTypes: true }).map(e => ({ name: e.name, isDir: e.isDirectory() })) : [];
    if (!result.pathExists) {
      result.error = `Pasta ${pathBase} não existe`;
      result.underRecordings = existsSync(RECORDINGS_DIR) ? readdirSync(RECORDINGS_DIR) : [];
      return result;
    }
    result.underRecordings = readdirSync(RECORDINGS_DIR);
    const streams = readdirSync(pathBase, { withFileTypes: true }).filter(e => e.isDirectory());
    for (const s of streams) {
      const streamPath = join(pathBase, s.name);
      const tsInStream = readdirSync(streamPath).filter(f => f.endsWith('.ts'));
      if (tsInStream.length > 0) {
        const newestTs = tsInStream.map(f => ({ f, m: statSync(join(streamPath, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0];
        const ageSec = Math.round((Date.now() - newestTs.m) / 1000);
        result.sessions.push({
          path: `live/${s.name}`,
          session: '(flat)',
          tsCount: tsInStream.length,
          ageSeconds: ageSec,
          stale: ageSec >= 120
        });
      }
      const sessions = readdirSync(streamPath, { withFileTypes: true }).filter(e => e.isDirectory());
      for (const sess of sessions) {
        const sessionPath = join(streamPath, sess.name);
        const tsFiles = readdirSync(sessionPath).filter(f => f.endsWith('.ts'));
        if (tsFiles.length === 0) continue;
        const stat = statSync(sessionPath);
        const ageSec = Math.round((Date.now() - stat.mtimeMs) / 1000);
        result.sessions.push({
          path: `live/${s.name}`,
          session: sess.name,
          tsCount: tsFiles.length,
          ageSeconds: ageSec,
          stale: ageSec >= 120
        });
      }
    }
  } catch (e) {
    result.error = e.message;
  }
  return result;
}

app.get('/debug', (req, res) => res.json(scanRecordings()));

const STALE_MS = 2 * 60 * 1000;
const processedDirs = new Set();

let lastLogTime = 0;
let scanCount = 0;
function findStaleSessions() {
  try {
    scanCount++;
    const pathBase = join(RECORDINGS_DIR, 'live');
    if (!existsSync(pathBase)) {
      if (scanCount % 20 === 1) console.log('[merge] Scan:', pathBase, 'não existe');
      return;
    }
    const streams = readdirSync(pathBase, { withFileTypes: true }).filter(e => e.isDirectory());
    if (streams.length === 0) {
      if (scanCount % 20 === 1) console.log('[merge] Scan:', pathBase, 'vazio (MediaMTX não gravou?)');
      return;
    }
    let totalSessions = 0;
    for (const s of streams) {
      const streamPath = join(pathBase, s.name);
      const mtxPath = `live/${s.name}`;

      const tsInStream = readdirSync(streamPath).filter(f => f.endsWith('.ts'));
      if (tsInStream.length > 0) {
        totalSessions++;
        const newestMs = Math.max(...tsInStream.map(f => statSync(join(streamPath, f)).mtimeMs));
        const age = Date.now() - newestMs;
        if (age >= STALE_MS) {
          const key = streamPath + ':flat';
          if (!processedDirs.has(key)) {
            processedDirs.add(key);
            console.log('[merge] Stream finalizado (flat):', mtxPath, tsInStream.length, 'segmentos');
            mergeAndUpload(mtxPath).then(r => {
              processedDirs.delete(key);
              if (r.ok) console.log('[merge] Upload OK:', r.key);
              else console.warn('[merge] Falhou:', r.reason);
            }).catch(e => {
              processedDirs.delete(key);
              console.error('[merge] Erro:', e.message);
            });
          }
        }
      }

      const sessions = readdirSync(streamPath, { withFileTypes: true }).filter(e => e.isDirectory());
      for (const sess of sessions) {
        const sessionPath = join(streamPath, sess.name);
        const tsFiles = readdirSync(sessionPath).filter(f => f.endsWith('.ts'));
        if (tsFiles.length === 0) continue;
        totalSessions++;
        const key = sessionPath;
        if (processedDirs.has(key)) continue;
        const stat = statSync(sessionPath);
        const age = Date.now() - stat.mtimeMs;
        if (age < STALE_MS) continue;
        processedDirs.add(key);
        console.log('[merge] Sessão finalizada detectada:', mtxPath, sess.name);
        mergeAndUpload(mtxPath, sess.name).then(r => {
          processedDirs.delete(key);
          if (r.ok) console.log('[merge] Upload OK:', r.key);
          else console.warn('[merge] Falhou:', r.reason);
        }).catch(e => {
          processedDirs.delete(key);
          console.error('[merge] Erro:', e.message);
        });
      }
    }
    if (totalSessions > 0 && Date.now() - lastLogTime > 60000) {
      lastLogTime = Date.now();
      console.log(`[merge] Scan: ${streams.length} stream(s), ${totalSessions} sessão(ões) com .ts`);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[merge] scan error', e.message);
  }
}

setInterval(findStaleSessions, 30000);
setTimeout(findStaleSessions, 5000);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Merge service rodando na porta ${PORT}`);
  console.log(`[merge] R2: ${hasR2 ? 'configurado' : 'NÃO configurado - gravações ficarão só locais'}`);
  console.log(`[merge] Compressão: ${COMPRESS_VIDEO ? 'H.264 CRF 21 + AAC 96k (câmera real/sala de aula)' : 'copy (rápido, tamanho original)'}`);
  if (hasR2) {
    s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, MaxKeys: 1 }))
      .then(() => console.log(`[merge] R2 bucket "${R2_BUCKET}" acessível`))
      .catch(e => console.error('[merge] R2 inacessível:', e?.message || e));
  }
  console.log(`[merge] Aguardando sessões finalizadas há 2+ min em ${RECORDINGS_DIR}/live/`);
});
