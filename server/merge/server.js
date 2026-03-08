import express from 'express';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { readdir, readFile, unlink, rmdir, writeFile, mkdir, stat } from 'fs/promises';
import { createReadStream } from 'fs';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

const RECORDINGS = process.env.RECORDINGS_PATH || '/recordings';
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_BUCKET = process.env.R2_BUCKET || 'livebridge';
const R2_PREFIX = 'recordings/videos/';

const hasR2 = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY);
const s3 = hasR2 ? new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY }
}) : null;

function exec(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: 'pipe' });
    let err = '';
    p.stderr?.on('data', d => { err += d.toString(); });
    p.on('close', code => code === 0 ? resolve() : reject(new Error(err || `exit ${code}`)));
  });
}

async function getLatestSession(path) {
  const base = join(RECORDINGS, path);
  const sessions = await readdir(base, { withFileTypes: true });
  const dirs = sessions.filter(d => d.isDirectory()).map(d => d.name);
  if (dirs.length === 0) return null;
  dirs.sort((a, b) => b.localeCompare(a));
  return dirs[0];
}

app.post('/webhook/stream-ended', async (req, res) => {
  const path = req.query.path || req.body?.path;
  if (!path) return res.status(400).json({ error: 'path required' });
  if (!hasR2) return res.status(503).json({ error: 'R2 não configurado' });

  res.status(202).json({ status: 'processing' });

  try {
    const session = await getLatestSession(path);
    if (!session) {
      console.warn('[merge] Nenhuma sessão para', path);
      return;
    }
    const sessionPath = join(RECORDINGS, path, session);
    const files = await readdir(sessionPath);
    const tsFiles = files.filter(f => f.endsWith('.ts')).sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, ''), 10);
      const nb = parseInt(b.replace(/\D/g, ''), 10);
      return (na || 0) - (nb || 0) || a.localeCompare(b);
    });
    if (tsFiles.length === 0) {
      console.warn('[merge] Nenhum .ts em', sessionPath);
      return;
    }

    const id = randomUUID();
    const listPath = join(sessionPath, `concat_${id}.txt`);
    const listContent = tsFiles.map(f => `file '${f}'`).join('\n');
    await writeFile(listPath, listContent);

    const mergedDir = join(RECORDINGS, 'merged');
    await mkdir(mergedDir, { recursive: true });
    const outPath = join(mergedDir, `${id}.mp4`);

    await exec('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath], sessionPath);
    await unlink(listPath);

    const size = (await stat(outPath)).size;
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: R2_PREFIX + id + '.mp4',
      Body: createReadStream(outPath),
      ContentLength: size,
      ContentType: 'video/mp4'
    }));

    for (const f of tsFiles) await unlink(join(sessionPath, f)).catch(() => {});
    await rmdir(sessionPath).catch(() => {});
    await unlink(outPath).catch(() => {});

    console.log('[merge] Gravado', path, session, '->', id + '.mp4');
  } catch (e) {
    console.error('[merge] Erro', e);
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('[merge] Rodando na porta', PORT);
  if (!hasR2) console.log('[merge] R2 não configurado — merge desabilitado');
});
