import express from 'express';
import { spawn, execFileSync } from 'child_process';
import { readdirSync, statSync, writeFileSync, readFileSync, unlinkSync, rmSync, existsSync, mkdirSync, createReadStream } from 'fs';
import { join } from 'path';
import { Transform } from 'stream';
import { ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

const app = express();
app.use(express.json());

const RECORDINGS_DIR = (process.env.RECORDINGS_DIR || '/recordings').trim();
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID?.trim();
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY?.trim();
const R2_SECRET_KEY = process.env.R2_SECRET_KEY?.trim();
const R2_BUCKET = (process.env.R2_BUCKET || 'livebridge').trim();
const R2_VIDEOS_PREFIX = 'recordings/videos/';
const MERGE_CALLBACK_URL = process.env.MERGE_CALLBACK_URL || '';
const COMPRESS_VIDEO = process.env.COMPRESS_VIDEO !== '0';
/** h265 = menor arquivo (HEVC). h264 = compatibilidade máxima com players antigos */
const COMPRESS_CODEC = (process.env.COMPRESS_CODEC || 'h265').toLowerCase();
/** veryslow = melhor eficiência de compressão (mais tempo de CPU) */
const COMPRESS_PRESET = process.env.COMPRESS_PRESET || 'veryslow';
const COMPRESS_CRF_H264 = parseInt(process.env.COMPRESS_CRF_H264 || process.env.COMPRESS_CRF || '23', 10) || 23;
const COMPRESS_CRF_H265 = parseInt(process.env.COMPRESS_CRF_H265 || process.env.COMPRESS_CRF || '28', 10) || 28;
const COMPRESS_AUDIO_BITRATE = (process.env.COMPRESS_AUDIO_BITRATE || '64k').trim();
const FFMPEG_TIMEOUT_MS = parseInt(process.env.FFMPEG_TIMEOUT_MS || '43200000', 10) || 43200000;
/** single = um MP4 session.mp4 (legado). Padrão: 1080,720,480 → três MP4 no R2 */
const MERGE_RESOLUTIONS_RAW = (process.env.MERGE_RESOLUTIONS || '1080,720,480').trim().toLowerCase();

function parseMergeHeights() {
  if (MERGE_RESOLUTIONS_RAW === 'single' || MERGE_RESOLUTIONS_RAW === '0' || MERGE_RESOLUTIONS_RAW === 'false') {
    return null;
  }
  const parts = MERGE_RESOLUTIONS_RAW.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0);
  return parts.length ? parts : [1080, 720, 480];
}

const hasR2 = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY);
const s3 = hasR2 ? new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY }
}) : null;

const BOUNDARIES_DIR = join(RECORDINGS_DIR, 'boundaries');
const PROGRESS_DIR = join(RECORDINGS_DIR, 'merge-progress');

function progressFilePath(path, sessionName) {
  const safe = `${path.replace(/\//g, '_')}__${String(sessionName).replace(/[/\\]/g, '_')}`;
  return join(PROGRESS_DIR, `${safe}.json`);
}

function writeProgress(path, sessionName, data) {
  try {
    if (!existsSync(PROGRESS_DIR)) mkdirSync(PROGRESS_DIR, { recursive: true });
    const payload = { path, session: sessionName, ...data, updatedAt: new Date().toISOString() };
    writeFileSync(progressFilePath(path, sessionName), JSON.stringify(payload));
  } catch (e) {
    console.warn('[merge] progress write:', e?.message);
  }
}

function clearProgress(path, sessionName) {
  try {
    const fp = progressFilePath(path, sessionName);
    if (existsSync(fp)) unlinkSync(fp);
  } catch (_) {}
}

function probeConcatDurationSec(listPath) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      '-f', 'concat', '-safe', '0', '-i', listPath
    ], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
    const v = parseFloat(String(out).trim());
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function deleteAulaSourceTs(path, tsFiles) {
  const parent = join(RECORDINGS_DIR, path);
  for (const f of tsFiles) {
    try {
      const fp = join(parent, f);
      if (existsSync(fp)) unlinkSync(fp);
    } catch (_) {}
  }
}

function clearBoundariesForStream(path) {
  const streamName = path.replace(/^live\//, '');
  try {
    const safe = String(streamName).replace(/[/\\]/g, '_');
    const fp = join(BOUNDARIES_DIR, `${safe}.json`);
    if (existsSync(fp)) unlinkSync(fp);
  } catch (_) {}
}

/** Args ffmpeg para máxima compactação: HEVC + preset lento ou H.264 equivalente */
function buildCompressFfmpegArgs(listPath, outPath, opts = {}) {
  const targetHeight = opts.targetHeight;
  const tail = ['-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', outPath];
  const base = ['-y', '-threads', '0', '-f', 'concat', '-safe', '0', '-i', listPath];
  if (targetHeight != null && Number.isFinite(targetHeight)) {
    base.push('-vf', `scale=-2:${targetHeight}:force_original_aspect_ratio=decrease`);
  }
  const audio = ['-c:a', 'aac', '-b:a', COMPRESS_AUDIO_BITRATE, '-aac_coder', 'twoloop'];

  if (COMPRESS_CODEC === 'h265' || COMPRESS_CODEC === 'hevc') {
    return [
      ...base,
      '-c:v', 'libx265',
      '-crf', String(COMPRESS_CRF_H265),
      '-preset', COMPRESS_PRESET,
      '-tag:v', 'hvc1',
      ...audio,
      ...tail
    ];
  }
  return [
    ...base,
    '-c:v', 'libx264',
    '-crf', String(COMPRESS_CRF_H264),
    '-preset', COMPRESS_PRESET,
    '-tune', 'animation',
    ...audio,
    ...tail
  ];
}

function variantLabel(h) {
  return `${h}p`;
}

function makeVariantStates(heights) {
  return heights.map((height) => ({
    id: variantLabel(height),
    height,
    label: variantLabel(height),
    phase: 'pending',
    encodingPercent: null,
    uploadPercent: null,
    bytesUploaded: null,
    bytesTotal: null,
    r2Key: null,
    currentTimeSec: null,
    durationSec: null,
    etaSecondsEncoding: null
  }));
}

function computeOverallMulti(variants, globalPhase) {
  const n = variants.length;
  if (n === 0) return 0;
  const encW = 75 / n;
  const upW = 25 / n;
  let sum = 0;
  for (const v of variants) {
    if (v.phase === 'done') sum += encW + upW;
    else if (v.phase === 'uploading') {
      sum += encW + ((v.uploadPercent || 0) / 100) * upW;
    } else if (v.phase === 'encoding') {
      sum += ((v.encodingPercent || 0) / 100) * encW;
    } else if (v.phase === 'failed') {
      return sum;
    }
  }
  if (globalPhase === 'done') return 100;
  return Math.min(99, Math.round(sum));
}

async function mergeAndUploadMulti(path, sessionName, sessionDir, tsFiles, listPath, durationSec, isAula, deleteFolderAfter, heights) {
  const videoCodecLabel = (COMPRESS_CODEC === 'h265' || COMPRESS_CODEC === 'hevc') ? 'hevc' : 'h264';
  const variants = makeVariantStates(heights);
  const n = heights.length;
  const variantPayload = [];

  for (let j = 0; j < n; j++) {
    const h = heights[j];
    const label = variantLabel(h);
    const outPath = join(sessionDir, `${sessionName}_${h}.mp4`);
    const r2Key = `${R2_VIDEOS_PREFIX}${path}/${sessionName}_${h}.mp4`;

    variants[j].phase = 'encoding';
    variants[j].durationSec = durationSec;
    writeProgress(path, sessionName, {
      schemaVersion: 2,
      mergeMode: 'multi',
      videoCodec: videoCodecLabel,
      phase: 'encoding',
      currentVariant: { height: h, label, index: j + 1, total: n },
      currentResolution: { height: h, label, index: j + 1, total: n },
      variants: JSON.parse(JSON.stringify(variants)),
      percentOverall: computeOverallMulti(variants, 'encoding'),
      encodingPercent: 0,
      uploadPercent: 0,
      currentTimeSec: 0,
      durationSec,
      etaSecondsEncoding: null,
      etaSecondsOverall: null,
      bytesUploaded: 0,
      bytesTotal: null,
      message: `Convertendo ${label} (${j + 1}/${n}) — ${videoCodecLabel.toUpperCase()}…`
    });

    const ffmpegArgs = buildCompressFfmpegArgs(listPath, outPath, { targetHeight: h });
    const encStart = Date.now();
    try {
      await runFfmpegWithProgress(ffmpegArgs, durationSec, encStart, (tick) => {
        variants[j].encodingPercent = tick.encodingPercent;
        variants[j].currentTimeSec = tick.currentTimeSec;
        variants[j].etaSecondsEncoding = tick.etaSecondsEncoding;
        writeProgress(path, sessionName, {
          schemaVersion: 2,
          mergeMode: 'multi',
          videoCodec: videoCodecLabel,
          phase: 'encoding',
          currentVariant: { height: h, label, index: j + 1, total: n },
          currentResolution: { height: h, label, index: j + 1, total: n },
          variants: JSON.parse(JSON.stringify(variants)),
          percentOverall: computeOverallMulti(variants, 'encoding'),
          encodingPercent: tick.encodingPercent,
          uploadPercent: 0,
          currentTimeSec: tick.currentTimeSec,
          durationSec,
          etaSecondsEncoding: tick.etaSecondsEncoding,
          etaSecondsOverall: tick.etaSecondsEncoding,
          bytesUploaded: 0,
          bytesTotal: null,
          message: `Convertendo ${label} (${j + 1}/${n})…`
        });
      });
    } catch (e) {
      console.error('[merge] ffmpeg falhou', label, e);
      variants[j].phase = 'failed';
      writeProgress(path, sessionName, {
        schemaVersion: 2,
        mergeMode: 'multi',
        videoCodec: videoCodecLabel,
        phase: 'failed',
        currentVariant: { height: h, label, index: j + 1, total: n },
        variants: JSON.parse(JSON.stringify(variants)),
        percentOverall: computeOverallMulti(variants, 'failed'),
        message: `${label}: ${e?.message || 'ffmpeg_failed'}`,
        encodingPercent: variants[j].encodingPercent || 0,
        uploadPercent: 0
      });
      try { unlinkSync(listPath); } catch (_) {}
      return { ok: false, reason: 'ffmpeg_failed', path, session: sessionName, failedVariant: label };
    }

    variants[j].encodingPercent = 100;
    variants[j].currentTimeSec = null;
    variants[j].etaSecondsEncoding = 0;

    if (!hasR2) {
      variantPayload.push({ height: h, label, id: label, key: null });
      variants[j].phase = 'done';
      variants[j].uploadPercent = 100;
      continue;
    }

    let fileSize;
    try {
      fileSize = statSync(outPath).size;
    } catch {
      fileSize = 0;
    }
    variants[j].bytesTotal = fileSize;
    variants[j].r2Key = r2Key;
    variants[j].phase = 'uploading';
    variants[j].uploadPercent = 0;
    variants[j].bytesUploaded = 0;

    const MAX_RETRIES = 3;
    let uploadedOk = false;
    for (let attempt = 1; attempt <= MAX_RETRIES && !uploadedOk; attempt++) {
      let uploaded = 0;
      const uploadStartedAt = Date.now();
      const body = new Transform({
        transform(chunk, enc, cb) {
          uploaded += chunk.length;
          const upPct = fileSize > 0 ? Math.min(100, Math.round((uploaded / fileSize) * 100)) : 0;
          variants[j].uploadPercent = upPct;
          variants[j].bytesUploaded = uploaded;
          const elapsed = (Date.now() - uploadStartedAt) / 1000;
          let etaUp = null;
          if (fileSize > 0 && uploaded > 0) {
            const rate = uploaded / elapsed;
            etaUp = Math.max(0, Math.round((fileSize - uploaded) / rate));
          }
          writeProgress(path, sessionName, {
            schemaVersion: 2,
            mergeMode: 'multi',
            videoCodec: videoCodecLabel,
            phase: 'uploading',
            currentVariant: { height: h, label, index: j + 1, total: n },
            currentResolution: { height: h, label, index: j + 1, total: n },
            variants: JSON.parse(JSON.stringify(variants)),
            percentOverall: computeOverallMulti(variants, 'uploading'),
            encodingPercent: 100,
            uploadPercent: upPct,
            durationSec,
            etaSecondsEncoding: 0,
            etaSecondsOverall: etaUp,
            bytesUploaded: uploaded,
            bytesTotal: fileSize,
            message: `Enviando ${label} (${j + 1}/${n}) para o armazenamento…`
          });
          cb(null, chunk);
        }
      });
      createReadStream(outPath).pipe(body);
      try {
        if (attempt > 1) console.log(`[merge] Upload ${label} tentativa ${attempt}/${MAX_RETRIES}`);
        const upload = new Upload({
          client: s3,
          params: {
            Bucket: R2_BUCKET,
            Key: r2Key,
            Body: body,
            ContentType: 'video/mp4'
          },
          queueSize: 4,
          partSize: 100 * 1024 * 1024,
          leavePartsOnError: false
        });
        await upload.done();
        uploadedOk = true;
        console.log('[merge] Upload concluído:', r2Key);
        variantPayload.push({ height: h, label, id: label, key: r2Key });
        variants[j].phase = 'done';
        variants[j].uploadPercent = 100;
        variants[j].bytesUploaded = fileSize;
      } catch (e) {
        console.error('[merge] Upload falhou', label, e?.message);
        if (attempt >= MAX_RETRIES) {
          variants[j].phase = 'failed';
          writeProgress(path, sessionName, {
            schemaVersion: 2,
            mergeMode: 'multi',
            videoCodec: videoCodecLabel,
            phase: 'failed',
            variants: JSON.parse(JSON.stringify(variants)),
            message: `Upload ${label} falhou: ${e?.message}`,
            percentOverall: computeOverallMulti(variants, 'failed')
          });
          try { unlinkSync(listPath); } catch (_) {}
          return { ok: false, reason: 'upload_failed', path, session: sessionName, failedVariant: label };
        }
        await new Promise((r) => setTimeout(r, attempt * 5000));
      }
    }
    try { unlinkSync(outPath); } catch (_) {}
  }

  try { unlinkSync(listPath); } catch (_) {}

  if (!hasR2) {
    writeProgress(path, sessionName, {
      schemaVersion: 2,
      mergeMode: 'multi',
      videoCodec: videoCodecLabel,
      phase: 'done',
      percentOverall: 100,
      currentVariant: null,
      variants: JSON.parse(JSON.stringify(variants)),
      message: 'Concluído (sem R2)',
      encodingPercent: 100,
      uploadPercent: 100
    });
    setTimeout(() => clearProgress(path, sessionName), 60000);
    return { ok: true, path, session: sessionName, keys: [], variants: variantPayload };
  }

  for (const f of tsFiles) {
    try { unlinkSync(join(sessionDir, f)); } catch (_) {}
  }
  if (deleteFolderAfter) {
    try { rmSync(sessionDir, { recursive: true }); } catch (_) {}
  }
  if (isAula) {
    deleteAulaSourceTs(path, tsFiles);
    clearBoundariesForStream(path);
  }

  writeProgress(path, sessionName, {
    schemaVersion: 2,
    mergeMode: 'multi',
    videoCodec: videoCodecLabel,
    phase: 'done',
    percentOverall: 100,
    currentVariant: null,
    variants: JSON.parse(JSON.stringify(variants)),
    message: 'Concluído',
    encodingPercent: 100,
    uploadPercent: 100
  });
  setTimeout(() => clearProgress(path, sessionName), 300000);
  const primaryKey = variantPayload[0]?.key;
  return {
    ok: true,
    key: primaryKey,
    keys: variantPayload.map((v) => v.key).filter(Boolean),
    path,
    session: sessionName,
    variants: variantPayload
  };
}

function runFfmpegWithProgress(ffmpegArgs, durationSec, startedAt, onTick) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdoutBuf = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('ffmpeg timeout'));
    }, FFMPEG_TIMEOUT_MS);
    proc.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString();
      let idx;
      while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (line.startsWith('out_time_ms=')) {
          const ms = parseInt(line.split('=')[1], 10);
          if (Number.isFinite(ms) && ms >= 0) {
            const cur = ms / 1000;
            const encPct = durationSec ? Math.min(99, Math.round((cur / durationSec) * 100)) : null;
            const elapsed = (Date.now() - startedAt) / 1000;
            let etaEnc = null;
            if (durationSec && cur > 0.5) {
              etaEnc = Math.max(0, Math.round((elapsed / cur) * (durationSec - cur)));
            }
            onTick({ currentTimeSec: Math.round(cur * 10) / 10, encodingPercent: encPct, etaSecondsEncoding: etaEnc });
          }
        }
      }
    });
    proc.stderr.on('data', () => {});
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}`));
    });
  });
}

async function mergeAndUpload(path, sessionNameOrDir = null) {
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

  const isAula = sessionName.endsWith('_aula');
  const listPath = join(sessionDir, '_concat.txt');
  const listContent = tsFiles.map(f => `file '${join(sessionDir, f)}'`).join('\n');
  writeFileSync(listPath, listContent);

  const durationSec = probeConcatDurationSec(listPath);
  let heights = parseMergeHeights();
  if (heights && !COMPRESS_VIDEO) {
    console.warn('[merge] Multi-resolução (MERGE_RESOLUTIONS) exige COMPRESS_VIDEO=1; gerando um arquivo (copy).');
    heights = null;
  }
  if (Array.isArray(heights) && heights.length > 0) {
    return mergeAndUploadMulti(path, sessionName, sessionDir, tsFiles, listPath, durationSec, isAula, deleteFolderAfter, heights);
  }

  const videoCodecLabel = (COMPRESS_CODEC === 'h265' || COMPRESS_CODEC === 'hevc') ? 'hevc' : 'h264';
  const singlePb = () => ({
    schemaVersion: 2,
    mergeMode: 'single',
    videoCodec: videoCodecLabel,
    currentVariant: null,
    currentResolution: null,
    variants: null
  });
  const outPath = join(sessionDir, `${sessionName}.mp4`);
  const startedAt = Date.now();

  writeProgress(path, sessionName, {
    ...singlePb(),
    phase: 'encoding',
    percentOverall: 0,
    encodingPercent: 0,
    uploadPercent: 0,
    currentTimeSec: 0,
    durationSec,
    etaSecondsEncoding: null,
    etaSecondsOverall: null,
    bytesUploaded: 0,
    bytesTotal: null,
    message: 'Compactando vídeo…'
  });

  const ffmpegArgs = COMPRESS_VIDEO
    ? buildCompressFfmpegArgs(listPath, outPath, {})
    : ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy',
      '-progress', 'pipe:1', '-nostats', outPath];

  try {
    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdoutBuf = '';
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('ffmpeg timeout'));
      }, FFMPEG_TIMEOUT_MS);
      proc.stdout.on('data', (chunk) => {
        stdoutBuf += chunk.toString();
        let idx;
        while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
          const line = stdoutBuf.slice(0, idx).trim();
          stdoutBuf = stdoutBuf.slice(idx + 1);
          if (line.startsWith('out_time_ms=')) {
            const ms = parseInt(line.split('=')[1], 10);
            if (Number.isFinite(ms) && ms >= 0) {
              const cur = ms / 1000;
              let encPct = durationSec ? Math.min(99, Math.round((cur / durationSec) * 100)) : null;
              const elapsed = (Date.now() - startedAt) / 1000;
              let etaEnc = null;
              if (durationSec && cur > 0.5) {
                etaEnc = Math.max(0, Math.round((elapsed / cur) * (durationSec - cur)));
              }
              const overall = encPct != null ? Math.round(encPct * 0.75) : Math.min(70, Math.round(elapsed / 2));
              writeProgress(path, sessionName, {
                ...singlePb(),
                phase: 'encoding',
                percentOverall: overall,
                encodingPercent: encPct,
                uploadPercent: 0,
                currentTimeSec: Math.round(cur * 10) / 10,
                durationSec,
                etaSecondsEncoding: etaEnc,
                etaSecondsOverall: etaEnc != null ? Math.round(etaEnc * 1.1) : null,
                bytesUploaded: 0,
                bytesTotal: null,
                message: 'Compactando vídeo…'
              });
            }
          }
        }
      });
      proc.stderr.on('data', () => {});
      proc.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exit ${code}`));
      });
    });
  } catch (e) {
    console.error('[merge] ffmpeg falhou', e);
    try { unlinkSync(listPath); } catch (_) {}
    writeProgress(path, sessionName, {
      ...singlePb(),
      phase: 'failed',
      percentOverall: 0,
      message: e?.message || 'ffmpeg_failed',
      encodingPercent: 0,
      uploadPercent: 0
    });
    return { ok: false, reason: 'ffmpeg_failed' };
  }
  try { unlinkSync(listPath); } catch (_) {}

  if (!hasR2) {
    console.log('[merge] R2 não configurado, mp4 gerado em', outPath);
    writeProgress(path, sessionName, { ...singlePb(), phase: 'done', percentOverall: 100, message: 'Concluído (sem R2)' });
    setTimeout(() => clearProgress(path, sessionName), 60000);
    return { ok: true, local: outPath };
  }

  let fileSize;
  try {
    fileSize = statSync(outPath).size;
  } catch {
    fileSize = 0;
  }

  const r2Key = `${R2_VIDEOS_PREFIX}${path}/${sessionName}.mp4`;
  const MAX_RETRIES = 3;
  let lastError;
  const uploadStartedAt = Date.now();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let uploaded = 0;
    const body = new Transform({
      transform(chunk, enc, cb) {
        uploaded += chunk.length;
        const upPct = fileSize > 0 ? Math.min(100, Math.round((uploaded / fileSize) * 100)) : 0;
        const overall = Math.round(75 + upPct * 0.25);
        const elapsed = (Date.now() - uploadStartedAt) / 1000;
        let etaUp = null;
        if (fileSize > 0 && uploaded > 0) {
          const rate = uploaded / elapsed;
          etaUp = Math.max(0, Math.round((fileSize - uploaded) / rate));
        }
        writeProgress(path, sessionName, {
          ...singlePb(),
          phase: 'uploading',
          percentOverall: overall,
          encodingPercent: 100,
          uploadPercent: upPct,
          currentTimeSec: null,
          durationSec,
          etaSecondsEncoding: 0,
          etaSecondsOverall: etaUp,
          bytesUploaded: uploaded,
          bytesTotal: fileSize,
          message: 'Enviando para o armazenamento…'
        });
        cb(null, chunk);
      }
    });
    createReadStream(outPath).pipe(body);

    try {
      if (attempt > 1) console.log(`[merge] Tentativa ${attempt}/${MAX_RETRIES} de upload...`);
      writeProgress(path, sessionName, {
        ...singlePb(),
        phase: 'uploading',
        percentOverall: 76,
        encodingPercent: 100,
        uploadPercent: 0,
        bytesUploaded: 0,
        bytesTotal: fileSize,
        message: 'Enviando para o armazenamento…'
      });
      const upload = new Upload({
        client: s3,
        params: {
          Bucket: R2_BUCKET,
          Key: r2Key,
          Body: body,
          ContentType: 'video/mp4'
        },
        queueSize: 4,
        partSize: 100 * 1024 * 1024,
        leavePartsOnError: false
      });
      await upload.done();
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: r2Key }));
        console.log('[merge] Upload concluído:', R2_BUCKET, r2Key, `(${Math.round((head.ContentLength || 0) / 1024 / 1024)}MB)`);
      } catch (verifyErr) {
        console.warn('[merge] Upload OK mas verificação falhou:', verifyErr?.message);
      }
      for (const f of tsFiles) {
        try { unlinkSync(join(sessionDir, f)); } catch (_) {}
      }
      try { unlinkSync(outPath); } catch (_) {}
      if (deleteFolderAfter) {
        try { rmSync(sessionDir, { recursive: true }); } catch (_) {}
      }
      if (isAula) {
        deleteAulaSourceTs(path, tsFiles);
        clearBoundariesForStream(path);
      }
      writeProgress(path, sessionName, {
        ...singlePb(),
        phase: 'done',
        percentOverall: 100,
        encodingPercent: 100,
        uploadPercent: 100,
        bytesUploaded: fileSize,
        bytesTotal: fileSize,
        message: 'Concluído'
      });
      setTimeout(() => clearProgress(path, sessionName), 300000);
      const vOne = { height: null, label: 'single', id: 'single', key: r2Key };
      return { ok: true, key: r2Key, keys: [r2Key], path, session: sessionName, variants: [vOne] };
    } catch (e) {
      lastError = e;
      console.error('[merge] Upload R2 falhou (tentativa ' + attempt + '):', e?.message || e);
      writeProgress(path, sessionName, {
        ...singlePb(),
        phase: 'uploading',
        percentOverall: 75,
        message: `Upload falhou (tentativa ${attempt}): ${e?.message || e}`,
        encodingPercent: 100,
        uploadPercent: 0
      });
      if (attempt < MAX_RETRIES) {
        const delay = attempt * 5000;
        console.log(`[merge] Aguardando ${delay / 1000}s antes de tentar novamente...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  writeProgress(path, sessionName, {
    ...singlePb(),
    phase: 'failed',
    percentOverall: 0,
    message: lastError?.message || 'upload_failed',
    encodingPercent: 100,
    uploadPercent: 0
  });
  return { ok: false, reason: 'upload_failed' };
}

async function notifyUploadComplete(path, session, variants = null) {
  if (!MERGE_CALLBACK_URL || !path || !session) return;
  const url = MERGE_CALLBACK_URL.replace(/\/$/, '') + '/api/recordings/upload-complete';
  try {
    const payload = { path, session };
    if (variants && Array.isArray(variants) && variants.length > 0) {
      payload.variants = variants;
    }
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await r.text();
    if (!r.ok) console.warn('[merge] upload-complete HTTP', r.status, text?.slice(0, 200));
    else console.log('[merge] upload-complete OK', path, session);
  } catch (e) {
    console.warn('[merge] upload-complete falhou:', e?.message);
  }
}

app.post('/merge', async (req, res) => {
  const path = req.query.path || req.body?.path;
  if (!path) {
    return res.status(400).json({ error: 'path obrigatório' });
  }
  try {
    const session = req.query.session || req.body?.session;
    const result = await mergeAndUpload(path, session || null);
    if (result.ok && result.path && result.session && MERGE_CALLBACK_URL) {
      await notifyUploadComplete(result.path, result.session, result.variants || null);
    }
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/merge/progress', (req, res) => {
  try {
    const path = req.query.path;
    const session = req.query.session;
    if (!path || !session) return res.status(400).json({ error: 'path e session obrigatórios' });
    const fp = progressFilePath(path, session);
    if (!existsSync(fp)) return res.status(404).json({ status: 'idle', message: 'Nenhum job em andamento' });
    const data = JSON.parse(readFileSync(fp, 'utf8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/merge/upload', async (req, res) => {
  const path = req.query.path || req.body?.path;
  const session = req.query.session || req.body?.session;
  if (!path || !session) {
    return res.status(400).json({ error: 'path e session obrigatórios (ex: path=live/teste&session=2026-03-10_10-10-39)' });
  }
  if (!hasR2) {
    return res.status(503).json({ error: 'R2 não configurado' });
  }
  const outPath = join(RECORDINGS_DIR, path, `${session}.mp4`);
  if (!existsSync(outPath)) {
    return res.status(404).json({ error: `Arquivo não encontrado: ${outPath}` });
  }
  const r2Key = `${R2_VIDEOS_PREFIX}${path}/${session}.mp4`;
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) console.log(`[merge/upload] Tentativa ${attempt}/${MAX_RETRIES}...`);
      const upload = new Upload({
        client: s3,
        params: {
          Bucket: R2_BUCKET,
          Key: r2Key,
          Body: createReadStream(outPath),
          ContentType: 'video/mp4'
        },
        queueSize: 4,
        partSize: 100 * 1024 * 1024,
        leavePartsOnError: false
      });
      await upload.done();
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: r2Key }));
        console.log('[merge/upload] Upload concluído:', r2Key, `(${Math.round((head.ContentLength || 0) / 1024 / 1024)}MB)`);
      } catch (_) {}
      return res.json({ ok: true, key: r2Key });
    } catch (e) {
      console.error('[merge/upload] Falhou:', e?.message || e);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, attempt * 5000));
      } else {
        return res.status(500).json({ ok: false, error: e?.message || 'upload_failed' });
      }
    }
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

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
            mergeAndUpload(mtxPath).then(async (r) => {
              processedDirs.delete(key);
              if (r.ok) {
                console.log('[merge] Upload OK:', r.key);
                if (r.path && r.session && MERGE_CALLBACK_URL) await notifyUploadComplete(r.path, r.session);
              } else {
                console.warn('[merge] Falhou:', r.reason);
              }
            }).catch(e => {
              processedDirs.delete(key);
              console.error('[merge] Erro:', e.message);
            });
          }
        }
      }

      const sessions = readdirSync(streamPath, { withFileTypes: true }).filter(e => e.isDirectory());
      for (const sess of sessions) {
        if (sess.name.endsWith('_aula')) continue;
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
        mergeAndUpload(mtxPath, sess.name).then(async (r) => {
          processedDirs.delete(key);
          if (r.ok) {
            console.log('[merge] Upload OK:', r.key);
            if (r.path && r.session && MERGE_CALLBACK_URL) await notifyUploadComplete(r.path, r.session, r.variants || null);
          } else {
            console.warn('[merge] Falhou:', r.reason);
          }
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
  const mh = parseMergeHeights();
  if (mh) {
    console.log(`[merge] Saídas por sessão: ${mh.map(variantLabel).join(', ')} (MERGE_RESOLUTIONS). Um encode + upload por resolução.`);
  } else {
    console.log('[merge] Saída única: session.mp4 (MERGE_RESOLUTIONS=single)');
  }
  if (COMPRESS_VIDEO) {
    const v = (COMPRESS_CODEC === 'h265' || COMPRESS_CODEC === 'hevc')
      ? `HEVC (libx265) CRF ${COMPRESS_CRF_H265}, preset ${COMPRESS_PRESET}, AAC ${COMPRESS_AUDIO_BITRATE}`
      : `H.264 CRF ${COMPRESS_CRF_H264}, preset ${COMPRESS_PRESET}, AAC ${COMPRESS_AUDIO_BITRATE}`;
    console.log(`[merge] Compressão (máx. eficiência): ${v}`);
  } else {
    console.log('[merge] Compressão: desligada (copy)');
  }
  if (hasR2) {
    s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, MaxKeys: 1 }))
      .then(() => console.log(`[merge] R2 bucket "${R2_BUCKET}" acessível`))
      .catch(e => console.error('[merge] R2 inacessível:', e?.message || e));
  }
  console.log(`[merge] Aguardando sessões finalizadas há 2+ min em ${RECORDINGS_DIR}/live/`);
});
