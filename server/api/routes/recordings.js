import { createReadStream } from 'fs';
import { readFile, copyFile, link } from 'fs/promises';
import { join } from 'path';
import { ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import * as cfg from '../config.js';
import { s3, hasR2, R2_VIDEOS_PREFIX } from '../r2.js';
import { setVideoAccessCookie } from '../lib/cookies.js';
import { mapPool } from '../lib/asyncPool.js';
import { getRecordingObjectFromR2, HeadObjectCommand } from '../services/r2Playback.js';
import {
  decodeS3Cursor,
  encodeS3Cursor,
  mapContentsToRecordings,
  collapseMultiresRecordingRows,
  sortRecordingsList
} from '../services/r2Listing.js';
import {
  fetchLessons,
  invalidateLessonsCache,
  lessonsHeaders,
  logLessonsApiAuthFailure
} from '../services/lessons.js';
import * as disk from '../services/disk.js';
import { isMainLiveStreamOnline } from '../services/mediamtxControl.js';
import { requireR2, requireVideoAuth } from '../middleware/authRecordings.js';

function enrichRecordingsWithLessons(r2List, lessons) {
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
}

/** Renditions gravadas em paralelo ao ingest (MediaMTX paths live/<stream>_<h>). */
const ABR_RENDITIONS = ['1080', '720', '480'];

function findRecordingTsSource(fullPath) {
  if (!disk.existsSync(fullPath)) return null;
  const tsInStream = disk.readdirSync(fullPath).filter((f) => f.endsWith('.ts'));
  if (tsInStream.length > 0) {
    return { srcDir: fullPath, allTs: tsInStream.sort(disk.tsSort) };
  }
  const dirs = disk
    .readdirSync(fullPath, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_w_'))
    .map((e) => ({ name: e.name, mtime: disk.statSync(join(fullPath, e.name)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!dirs[0]) return null;
  const srcDir = join(fullPath, dirs[0].name);
  const allTs = disk.readdirSync(srcDir).filter((f) => f.endsWith('.ts')).sort(disk.tsSort);
  if (allTs.length === 0) return null;
  return { srcDir, allTs };
}

function sliceTsAfterBoundary(allTs, lastIncluded) {
  if (!lastIncluded) {
    const files = [...allTs];
    return { files, lastFile: files.length ? files[files.length - 1] : null };
  }
  const idx = allTs.indexOf(lastIncluded);
  const files = idx >= 0 ? allTs.slice(idx + 1) : [...allTs];
  return { files, lastFile: files.length ? files[files.length - 1] : null };
}

/**
 * Fatia de .ts da variante ABR para esta aula.
 * Sem último ficheiro guardado: usar **todos** os .ts da sessão atual na variante — não os últimos N da lista,
 * porque N = contagem na base e as variantes podem ter mais segmentos (mesmo tempo, mais ficheiros);
 * slice(-N) cortava o início e o HLS “só mostrava o fim”, como se a aula tivesse começado de novo.
 */
function variantSliceForBoundary(variantAllTs, lastVarFile) {
  if (!lastVarFile) {
    const files = [...variantAllTs];
    return { files, lastFile: files.length ? files[files.length - 1] : null };
  }
  return sliceTsAfterBoundary(variantAllTs, lastVarFile);
}

function partialAbrHasSegments(sessionDir) {
  if (!disk.existsSync(sessionDir)) return false;
  return ABR_RENDITIONS.some((h) => {
    const d = join(sessionDir, `_${h}`);
    if (!disk.existsSync(d)) return false;
    return disk.readdirSync(d).some((f) => f.endsWith('.ts'));
  });
}

/** Hard link no mesmo volume = instantâneo; cópia só se FS não suportar (EXDEV, SMB, etc.). */
async function linkOrCopy(src, dest) {
  try {
    await link(src, dest);
  } catch (e) {
    const c = e?.code;
    if (c === 'EEXIST') {
      await copyFile(src, dest);
      return;
    }
    if (c === 'EXDEV' || c === 'EPERM' || c === 'EOPNOTSUPP' || c === 'ENOTSUP') {
      await copyFile(src, dest);
      return;
    }
    throw e;
  }
}

function hlsMasterUrlForPartial(req, path, session, tokenQ) {
  const q = `path=${encodeURIComponent(path)}&session=${encodeURIComponent(session)}${tokenQ}`;
  return cfg.publicApiUrl(req, `/api/recordings/hls/master.m3u8?${q}`);
}

function recordingsPlaylistUrl(req, path, session) {
  return cfg.publicApiUrl(
    req,
    `/api/recordings/hls/playlist.m3u8?path=${encodeURIComponent(path)}&session=${encodeURIComponent(session)}`
  );
}

function recordingsMergeProgressUrl(req, path, session) {
  return cfg.publicApiUrl(
    req,
    `/api/recordings/merge-progress?path=${encodeURIComponent(path)}&session=${encodeURIComponent(session)}`
  );
}

/** Após merge bem-sucedido o JSON local é apagado; confirma no R2 para o front não mostrar "failed". */
function mergeFetchOptions() {
  const ms = cfg.MERGE_POST_TIMEOUT_MS;
  if (ms > 0 && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { method: 'POST', signal: AbortSignal.timeout(ms) };
  }
  return { method: 'POST' };
}

async function r2HasAnySessionMp4(streamName, session) {
  if (!hasR2 || !s3) return false;
  const base = `${R2_VIDEOS_PREFIX}live/${streamName}/${session}`;
  const keys = [`${base}.mp4`, `${base}_1080.mp4`, `${base}_720.mp4`, `${base}_480.mp4`];
  for (const Key of keys) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: cfg.R2_BUCKET, Key }));
      return true;
    } catch (e) {
      const code = e?.$metadata?.httpStatusCode;
      if (e?.name === 'NotFound' || code === 404) continue;
    }
  }
  return false;
}

export function registerRecordingsRoutes(app) {
  app.get('/api/recordings', requireR2, async (req, res) => {
    try {
      const paginate = req.query.paginate === '1' || req.query.paginate === 'true';
      const maxKeysReq = parseInt(req.query.maxKeys ?? '', 10);
      const maxKeys = Number.isFinite(maxKeysReq)
        ? Math.min(1000, Math.max(1, maxKeysReq))
        : cfg.RECORDINGS_PAGE_MAX_KEYS;

      const lessonsPromise = cfg.hasLessonsApi && !cfg.skipLessonsInList ? fetchLessons() : Promise.resolve([]);

      if (paginate) {
        const rawCursor = req.query.cursor;
        if (rawCursor != null && String(rawCursor) !== '' && decodeS3Cursor(rawCursor) === undefined) {
          return res.status(400).json({ error: 'cursor inválido (Base64 URL do token S3 esperado)' });
        }
        const ContinuationToken = decodeS3Cursor(rawCursor);
        const result = await s3.send(
          new ListObjectsV2Command({
            Bucket: cfg.R2_BUCKET,
            Prefix: R2_VIDEOS_PREFIX,
            ContinuationToken,
            MaxKeys: maxKeys
          })
        );
        const r2List = collapseMultiresRecordingRows(mapContentsToRecordings(result.Contents));
        sortRecordingsList(r2List);
        const lessons = await lessonsPromise;
        setVideoAccessCookie(res);
        enrichRecordingsWithLessons(r2List, lessons);
        const nextCursor =
          result.IsTruncated && result.NextContinuationToken
            ? encodeS3Cursor(result.NextContinuationToken)
            : null;
        res.json({
          items: r2List,
          nextCursor,
          maxKeys,
          paginated: true,
          note:
            'Ordem e cortes seguem uma página do ListObjects R2; para lista completa ordenada como antes, omita paginate=1.'
        });
        return;
      }

      const r2Promise = (async () => {
        const list = [];
        let continuationToken;
        do {
          const result = await s3.send(
            new ListObjectsV2Command({
              Bucket: cfg.R2_BUCKET,
              Prefix: R2_VIDEOS_PREFIX,
              ContinuationToken: continuationToken,
              MaxKeys: 1000
            })
          );
          list.push(...mapContentsToRecordings(result.Contents));
          continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
        } while (continuationToken);
        const collapsed = collapseMultiresRecordingRows(list);
        sortRecordingsList(collapsed);
        return collapsed;
      })();

      const [r2List, lessons] = await Promise.all([r2Promise, lessonsPromise]);

      setVideoAccessCookie(res);
      enrichRecordingsWithLessons(r2List, lessons);

      res.json(r2List);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/recordings/hls/master.m3u8', requireVideoAuth, async (req, res) => {
    try {
      const { path: p, session } = req.query;
      if (!p || !session || typeof p !== 'string' || typeof session !== 'string') {
        return res.status(400).type('text/plain').send('path e session obrigatórios');
      }
      if (p.includes('..') || session.includes('..')) {
        return res.status(400).type('text/plain').send('path inválido');
      }
      const tokenPart = req.query.token ? `&token=${encodeURIComponent(req.query.token)}` : '';
      const variantDefs = [
        { h: '1080', bw: cfg.LIVE_ABR_BANDWIDTH_1080, resolution: '1920x1080' },
        { h: '720', bw: cfg.LIVE_ABR_BANDWIDTH_720, resolution: '1280x720' },
        { h: '480', bw: cfg.LIVE_ABR_BANDWIDTH_480, resolution: '854x480' }
      ];
      const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
      let any = false;
      const sessionBase = join(cfg.RECORDINGS_DIR, p, session);
      for (const { h, bw, resolution } of variantDefs) {
        const dir = join(sessionBase, `_${h}`);
        if (!disk.existsSync(dir)) continue;
        const names = await disk.readdir(dir);
        if (!names.some((f) => f.endsWith('.ts'))) continue;
        any = true;
        lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bw},RESOLUTION=${resolution},NAME="${h}p"`);
        lines.push(
          `/api/recordings/hls/playlist.m3u8?path=${encodeURIComponent(p)}&session=${encodeURIComponent(session)}&rendition=${h}${tokenPart}`
        );
      }
      if (!any) {
        return res.status(404).type('text/plain').send('Nenhuma variante ABR disponível para esta sessão');
      }
      lines.push('');
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Cache-Control', 'no-store');
      res.send(lines.join('\n'));
    } catch (e) {
      console.error(e);
      res.status(500).type('text/plain').send(e.message);
    }
  });

  app.get('/api/recordings/hls/playlist.m3u8', requireVideoAuth, async (req, res) => {
    try {
      const { path: p, session } = req.query;
      if (!p || !session || typeof p !== 'string' || typeof session !== 'string') {
        return res.status(400).json({ error: 'path e session obrigatórios' });
      }
      if (p.includes('..') || session.includes('..')) return res.status(400).json({ error: 'path inválido' });
      const renditionRaw = req.query.rendition;
      const rendition =
        typeof renditionRaw === 'string' && ABR_RENDITIONS.includes(renditionRaw) ? renditionRaw : null;

      let dir;
      let isFlat;
      if (rendition) {
        dir = join(cfg.RECORDINGS_DIR, p, session, `_${rendition}`);
        isFlat = false;
        if (!disk.existsSync(dir)) {
          return res.status(404).json({ error: 'Gravação não encontrada ou já processada' });
        }
      } else {
        dir = join(cfg.RECORDINGS_DIR, p, session);
        isFlat = !disk.existsSync(dir);
        if (isFlat) {
          dir = join(cfg.RECORDINGS_DIR, p);
          if (!disk.existsSync(dir)) return res.status(404).json({ error: 'Gravação não encontrada ou já processada' });
        }
      }
      const names = await disk.readdir(dir);
      const tsFiles = names
        .filter((f) => f.endsWith('.ts'))
        .sort((a, b) => {
          const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
          const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
          return na - nb || a.localeCompare(b, undefined, { numeric: true });
        });
      if (tsFiles.length === 0) return res.status(404).json({ error: 'Nenhum segmento disponível' });
      const tokenPart = req.query.token ? `&token=${encodeURIComponent(req.query.token)}` : '';
      const segSession = isFlat ? 'flat' : session;
      const rendPart = rendition ? `&rendition=${encodeURIComponent(rendition)}` : '';
      const baseUrl = `/api/recordings/hls/segment?path=${encodeURIComponent(p)}&session=${encodeURIComponent(segSession)}${rendPart}${tokenPart}&file=`;
      const targetDuration = 60;
      let m3u8 =
        '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-TARGETDURATION:' +
        targetDuration +
        '\n#EXT-X-MEDIA-SEQUENCE:0\n';
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

  app.get('/api/recordings/hls/segment', requireVideoAuth, (req, res) => {
    try {
      const { path: p, session, file } = req.query;
      if (!p || !session || !file || typeof p !== 'string' || typeof session !== 'string' || typeof file !== 'string') {
        return res.status(400).json({ error: 'path, session e file obrigatórios' });
      }
      const renditionRaw = req.query.rendition;
      const rendition =
        typeof renditionRaw === 'string' && ABR_RENDITIONS.includes(renditionRaw) ? renditionRaw : null;
      if (
        p.includes('..') ||
        session.includes('..') ||
        file.includes('..') ||
        file.includes('/') ||
        file.includes('\\') ||
        !file.endsWith('.ts')
      ) {
        return res.status(400).json({ error: 'parâmetros inválidos' });
      }
      let filePath;
      if (session === 'flat') {
        filePath = join(cfg.RECORDINGS_DIR, p, file);
      } else if (rendition) {
        filePath = join(cfg.RECORDINGS_DIR, p, session, `_${rendition}`, file);
      } else {
        filePath = join(cfg.RECORDINGS_DIR, p, session, file);
      }
      if (!disk.existsSync(filePath)) return res.status(404).json({ error: 'Segmento não encontrado' });
      res.set('Content-Type', 'video/mp2t');
      createReadStream(filePath).pipe(res);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/recordings/video', requireVideoAuth, async (req, res) => {
    try {
      const { path: p, session, token } = req.query;
      if (!p || !session) return res.status(400).json({ error: 'path e session obrigatórios' });
      if (p.includes('..') || session.includes('..')) return res.status(400).json({ error: 'path inválido' });

      const partialDir = join(cfg.RECORDINGS_DIR, p, session);
      let tsFiles = disk.existsSync(partialDir)
        ? (await disk.readdir(partialDir)).filter((f) => f.endsWith('.ts'))
        : [];
      if (tsFiles.length === 0) {
        const flatDir = join(cfg.RECORDINGS_DIR, p);
        if (disk.existsSync(flatDir)) {
          const flatTs = (await disk.readdir(flatDir))
            .filter((f) => f.endsWith('.ts'))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
          const derivedSession = flatTs[0]?.replace(/\.ts$/i, '').replace(/-\d+$/, '');
          if (flatTs.length > 0 && derivedSession === session) {
            tsFiles = flatTs;
          }
        }
      }
      if (tsFiles.length > 0) {
        const tokenPart = token ? `&token=${encodeURIComponent(token)}` : '';
        const hlsSession = disk.existsSync(partialDir) ? session : 'flat';
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
            const head = await s3.send(new HeadObjectCommand({ Bucket: cfg.R2_BUCKET, Key: key }));
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

  app.put('/api/recordings/name', requireR2, async (req, res) => {
    try {
      const { id, name } = req.body;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id obrigatório' });
      if (!cfg.hasLessonsApi) {
        return res.status(503).json({ error: 'API Lessons não configurada. Defina LESSONS_API_URL e LESSONS_API_TOKEN.' });
      }
      const lessonsPutUrl = `${cfg.LESSONS_API_URL}/api/lessons`;
      const res2 = await fetch(lessonsPutUrl, {
        method: 'PUT',
        headers: lessonsHeaders,
        body: JSON.stringify({ id, nome: name?.trim() || null })
      });
      const data = await res2.json().catch(() => ({}));
      if (!res2.ok) {
        logLessonsApiAuthFailure(res2.status, lessonsPutUrl, 'PUT name');
        return res.status(res2.status).json(data);
      }
      invalidateLessonsCache();
      res.json({ ok: true, name: name?.trim() || null });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/recordings/metadata', requireR2, async (req, res) => {
    try {
      const { id, numero, nome, assunto, professor, materia, frente, cursos, ativo } = req.body;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id obrigatório' });
      if (!cfg.hasLessonsApi) {
        return res.status(503).json({ error: 'API Lessons não configurada. Defina LESSONS_API_URL e LESSONS_API_TOKEN.' });
      }
      const ativoValue = ativo === false || ativo === 'false' ? false : true;
      const lessonsPutUrl = `${cfg.LESSONS_API_URL}/api/lessons`;
      const res2 = await fetch(lessonsPutUrl, {
        method: 'PUT',
        headers: lessonsHeaders,
        body: JSON.stringify({ id, numero, nome, assunto, professor, materia, frente, cursos, ativo: ativoValue })
      });
      const data = await res2.json().catch(() => ({}));
      if (!res2.ok) {
        logLessonsApiAuthFailure(res2.status, lessonsPutUrl, 'PUT metadata');
        return res.status(res2.status).json(data);
      }
      invalidateLessonsCache();
      res.json({ ok: true, aula: data });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/recordings', requireR2, async (req, res) => {
    try {
      const { path: p, session } = req.body?.path ? req.body : req.query;
      if (!p || !session) return res.status(400).json({ error: 'path e session obrigatórios' });
      const base = `${R2_VIDEOS_PREFIX}${p}/${session}`;
      const keys = [`${base}.mp4`, `${base}_1080.mp4`, `${base}_720.mp4`, `${base}_480.mp4`];
      await Promise.all(keys.map((Key) => s3.send(new DeleteObjectCommand({ Bucket: cfg.R2_BUCKET, Key }))));
      res.json({ ok: true, message: 'Vídeo(s) removido(s)' });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/recordings/live-ended', async (req, res) => {
    try {
      const { streamName, name, materia, n_aula, frente, professor, folder_ids, course_ids } = req.body;
      if (!streamName || typeof streamName !== 'string') {
        return res.status(400).json({ error: 'streamName obrigatório' });
      }
      const discovered = await disk.discoverCurrentSessionAsync(streamName.trim());
      if (!discovered) {
        return res.status(404).json({ error: 'Nenhuma sessão de gravação ativa encontrada para este stream' });
      }
      const { path, session } = discovered;
      const stream = streamName.trim();
      try {
        const bf = disk.getBoundariesFile(stream);
        if (disk.existsSync(bf)) disk.unlinkSync(bf);
      } catch (_) {}
      const videoPath = `${path}/${session}.mp4`;
      disk.writeLiveEndedStatus(stream, { path, session, status: 'processing', endedAt: new Date().toISOString() });

      if (cfg.VIDEOS_API_URL && cfg.VIDEOS_API_TOKEN) {
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
          const res2 = await fetch(`${cfg.VIDEOS_API_URL}/api/videos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Access-Token': cfg.VIDEOS_API_TOKEN },
            body: JSON.stringify(body)
          });
          const data = await res2.json().catch(() => ({}));
          if (!res2.ok) {
            console.warn('[API] Videos API respondeu', res2.status, data);
          } else {
            disk.writeLiveEndedStatus(stream, {
              path,
              session,
              status: 'processing',
              videoId: data.id,
              endedAt: new Date().toISOString()
            });
          }
        } catch (e) {
          console.warn('[API] Erro ao registrar vídeo na API:', e?.message);
        }
      }

      const mergeUrl = `${cfg.MERGE_INTERNAL_URL}/merge?path=${encodeURIComponent(path)}&session=${encodeURIComponent(session)}`;
      fetch(mergeUrl, mergeFetchOptions())
        .then(async (mergeRes) => {
          const data = await mergeRes.json().catch(() => ({}));
          if (data.ok) {
            disk.deleteLiveEndedStatusFile(stream);
          } else {
            disk.writeLiveEndedStatus(stream, { path, session, status: 'failed', reason: data.reason || 'merge_failed' });
          }
        })
        .catch((e) => {
          const reason = e?.message || String(e);
          console.error('[API] Erro ao chamar merge (live-ended):', reason, e?.cause || '');
          disk.writeLiveEndedStatus(stream, { path, session, status: 'failed', reason });
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

  app.post('/api/recordings/lesson-boundary', async (req, res) => {
    try {
      const { streamName, name, materia, n_aula, frente, professor, folder_ids, course_ids } = req.body;
      if (!streamName || typeof streamName !== 'string') {
        return res.status(400).json({ error: 'streamName obrigatório' });
      }
      const stream = streamName.trim();
      const path = `live/${stream}`;
      const fullPath = join(cfg.RECORDINGS_DIR, path);
      if (!disk.existsSync(fullPath)) {
        return res.status(404).json({ error: 'Nenhuma gravação ativa para este stream' });
      }

      const baseSource = findRecordingTsSource(fullPath);
      if (!baseSource) return res.status(404).json({ error: 'Nenhum segmento .ts encontrado' });

      const prevBound = disk.readBoundaryState(stream);
      const baseSlice = sliceTsAfterBoundary(baseSource.allTs, prevBound.lastIncludedTs);
      const tsFiles = baseSlice.files;

      if (tsFiles.length === 0) {
        return res.status(404).json({
          error: prevBound.lastIncludedTs
            ? 'Nenhum segmento novo desde o último "aula acabou". Aguarde mais gravação.'
            : 'Nenhum segmento .ts para copiar'
        });
      }

      const now = new Date();
      const sessionSuffix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}_aula`;
      const session = sessionSuffix;
      const partialDir = join(fullPath, session);
      disk.mkdirSync(partialDir, { recursive: true });

      // Hard links: O(n) em metadados, sem duplicar GB. copyFile só se outro volume / FS sem link.
      const linkConcurrency = cfg.LESSON_BOUNDARY_LINK_CONCURRENCY;
      await mapPool(tsFiles, linkConcurrency, (f) =>
        linkOrCopy(join(baseSource.srcDir, f), join(partialDir, f))
      );

      const nextVar = { ...(prevBound.lastIncludedByVariant || {}) };
      for (const h of ABR_RENDITIONS) {
        const varPath = join(cfg.RECORDINGS_DIR, `live/${stream}_${h}`);
        const vs = findRecordingTsSource(varPath);
        if (!vs) continue;
        const lastVar = prevBound.lastIncludedByVariant?.[h] ?? null;
        const vslice = variantSliceForBoundary(vs.allTs, lastVar);
        if (vslice.files.length === 0) continue;
        const sub = join(partialDir, `_${h}`);
        disk.mkdirSync(sub, { recursive: true });
        await mapPool(vslice.files, linkConcurrency, (f) =>
          linkOrCopy(join(vs.srcDir, f), join(sub, f))
        );
        nextVar[h] = vslice.lastFile;
      }

      disk.writeBoundaryState(stream, {
        lastIncludedTs: baseSlice.lastFile,
        lastIncludedByVariant: nextVar
      });

      const videoPath = `${path}/${session}.mp4`;
      disk.writeLiveEndedPartial(stream, session, { path, session, status: 'processing', endedAt: now.toISOString() });

      const mergeUrl = `${cfg.MERGE_INTERNAL_URL}/merge?path=${encodeURIComponent(path)}&session=${encodeURIComponent(session)}`;
      const runLessonBoundaryMerge = () => {
        fetch(mergeUrl, mergeFetchOptions())
          .then(async (mergeRes) => {
            const data = await mergeRes.json().catch(() => ({}));
            if (data.ok) {
              disk.deleteLiveEndedPartial(stream, session);
            } else {
              disk.writeLiveEndedPartial(stream, session, {
                path,
                session,
                status: 'failed',
                reason: data.reason || 'merge_failed'
              });
            }
          })
          .catch((e) => {
            const reason = e?.message || String(e);
            console.error('[API] Erro ao chamar merge (lesson-boundary):', reason, e?.cause || '');
            disk.writeLiveEndedPartial(stream, session, { path, session, status: 'failed', reason });
          });
      };
      const mergeDelay = cfg.LESSON_BOUNDARY_MERGE_DELAY_MS;
      if (mergeDelay > 0) {
        setTimeout(runLessonBoundaryMerge, mergeDelay);
      } else {
        runLessonBoundaryMerge();
      }

      const payload = {
        ok: true,
        path,
        session,
        status: 'processing',
        message:
          'Aula registrada. Vídeo disponível em HLS enquanto compacta. Após upload no R2, os .ts desta aula são removidos do disco.',
        hlsUrl: recordingsPlaylistUrl(req, path, session),
        mergeProgressUrl: recordingsMergeProgressUrl(req, path, session)
      };
      if (partialAbrHasSegments(partialDir)) {
        payload.hlsMasterUrl = hlsMasterUrlForPartial(req, path, session, '');
      }
      res.json(payload);

      if (cfg.VIDEOS_API_URL && cfg.VIDEOS_API_TOKEN) {
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
        fetch(`${cfg.VIDEOS_API_URL}/api/videos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Access-Token': cfg.VIDEOS_API_TOKEN },
          body: JSON.stringify(body)
        })
          .then(async (res2) => {
            const data = await res2.json().catch(() => ({}));
            if (res2.ok) {
              disk.writeLiveEndedPartial(stream, session, {
                path,
                session,
                status: 'processing',
                videoId: data.id,
                endedAt: now.toISOString()
              });
            }
          })
          .catch((e) => console.warn('[API] Erro ao registrar vídeo na API:', e?.message));
      }
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/recordings/pending', async (req, res) => {
    try {
      if (!disk.existsSync(cfg.LIVE_ENDED_DIR)) return res.json([]);
      const files = (await disk.readdir(cfg.LIVE_ENDED_DIR)).filter((f) => f.endsWith('.json'));
      const rows = await mapPool(files, cfg.PENDING_READ_CONCURRENCY, async (f) => {
        try {
          const raw = await readFile(join(cfg.LIVE_ENDED_DIR, f), 'utf8');
          const data = JSON.parse(raw);
          if (!data || !data.path || !data.session) return null;
          const sessionDir = join(cfg.RECORDINGS_DIR, data.path, data.session);
          const processingAula = data.session?.endsWith('_aula') && data.status === 'processing';
          return {
            streamName: data.path.replace(/^live\//, ''),
            path: data.path,
            session: data.session,
            status: data.status || 'processing',
            videoPath: data.status === 'ready' ? `${data.path}/${data.session}.mp4` : null,
            hlsUrl: processingAula
              ? recordingsPlaylistUrl(req, data.path, data.session)
              : null,
            hlsMasterUrl:
              processingAula && partialAbrHasSegments(sessionDir)
                ? hlsMasterUrlForPartial(req, data.path, data.session, '')
                : null,
            mergeProgressUrl:
              data.status === 'processing'
                ? recordingsMergeProgressUrl(req, data.path, data.session)
                : null,
            endedAt: data.endedAt,
            updatedAt: data.updatedAt
          };
        } catch {
          return null;
        }
      });
      const list = rows.filter(Boolean);
      list.sort((a, b) => (b.endedAt || '').localeCompare(a.endedAt || ''));
      res.json(list);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/recordings/status', async (req, res) => {
    try {
      const { streamName, session: sessionParam } = req.query;
      if (!streamName) {
        return res.status(400).json({ error: 'streamName obrigatório' });
      }
      const stream = streamName.trim();
      if (sessionParam && sessionParam.endsWith('_aula')) {
        const statusData = disk.readLiveEndedPartial(stream, sessionParam);
        if (statusData) {
          const { path, session, status } = statusData;
          const sessionDir = join(cfg.RECORDINGS_DIR, path, session);
          const proc = status === 'processing';
          return res.json({
            path,
            session,
            status: status || 'processing',
            videoPath: status === 'ready' ? `${path}/${session}.mp4` : null,
            hlsUrl: proc ? recordingsPlaylistUrl(req, path, session) : null,
            hlsMasterUrl:
              proc && partialAbrHasSegments(sessionDir) ? hlsMasterUrlForPartial(req, path, session, '') : null,
            mergeProgressUrl: proc ? recordingsMergeProgressUrl(req, path, session) : null,
            message:
              status === 'processing'
                ? 'Compactando e enviando...'
                : status === 'ready'
                  ? 'Pronto'
                  : statusData.reason || status
          });
        }
        const pathLive = `live/${stream}`;
        if (await r2HasAnySessionMp4(stream, sessionParam)) {
          return res.json({
            path: pathLive,
            session: sessionParam,
            status: 'ready',
            videoPath: `${pathLive}/${sessionParam}.mp4`,
            hlsUrl: null,
            hlsMasterUrl: null,
            mergeProgressUrl: null,
            message: 'Upload concluído (vídeo no armazenamento).'
          });
        }
        return res.json({ path: null, session: null, status: 'not_found', message: 'Gravação não encontrada' });
      }
      const statusData = disk.readLiveEndedStatus(stream);
      if (statusData) {
        const { path, session, status } = statusData;
        const mergeProgressUrl =
          status === 'processing' ? recordingsMergeProgressUrl(req, path, session) : null;
        const mergeMessage =
          status === 'processing'
            ? 'Compactando e enviando...'
            : status === 'ready'
              ? 'Pronto'
              : statusData.reason || status;

        let publisherStillLive = false;
        try {
          publisherStillLive = await isMainLiveStreamOnline(stream);
        } catch (_) {}

        if (publisherStillLive) {
          const discovered = await disk.discoverCurrentSessionAsync(stream);
          return res.json({
            path: discovered?.path ?? path,
            session: discovered?.session ?? session,
            status: 'live',
            videoPath: null,
            message: 'Gravando',
            mergePending: {
              path,
              session,
              status: status || 'processing',
              videoPath: status === 'ready' ? `${path}/${session}.mp4` : null,
              mergeProgressUrl,
              message: mergeMessage
            }
          });
        }

        return res.json({
          path,
          session,
          status: status || 'processing',
          videoPath: status === 'ready' ? `${path}/${session}.mp4` : null,
          mergeProgressUrl,
          message: mergeMessage
        });
      }
      const discovered = await disk.discoverCurrentSessionAsync(stream);
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

  app.get('/api/recordings/merge-progress', async (req, res) => {
    try {
      const { path: p, session } = req.query;
      if (!p || !session) return res.status(400).json({ error: 'path e session obrigatórios' });
      if (p.includes('..') || session.includes('..')) return res.status(400).json({ error: 'parâmetros inválidos' });
      const fp = disk.mergeProgressFilePath(p, session);
      if (!disk.existsSync(fp)) {
        if (session.endsWith('_aula') && p.startsWith('live/')) {
          const sn = p.replace(/^live\//, '');
          if (sn && !sn.includes('/') && (await r2HasAnySessionMp4(sn, session))) {
            return res.json({
              path: p,
              session,
              status: 'done',
              phase: 'done',
              percentOverall: 100,
              message: 'Concluído (vídeo disponível no armazenamento).'
            });
          }
        }
        return res.json({
          status: 'idle',
          phase: 'idle',
          percentOverall: null,
          message: 'Nenhum processamento ativo para este path/session (ou já concluiu há mais de alguns minutos).'
        });
      }
      const raw = await disk.readFile(fp, 'utf8');
      const data = JSON.parse(raw);
      res.json(data);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/recordings/upload-complete', async (req, res) => {
    try {
      const { path, session, variants } = req.body || {};
      if (!path || !session) {
        console.warn('[API] upload-complete sem path/session — body:', JSON.stringify(req.body));
        return res.status(400).json({ error: 'path e session obrigatórios' });
      }
      const streamName = path.replace(/^live\//, '');
      if (session.endsWith('_aula')) {
        disk.deleteLiveEndedPartial(streamName, session);
      } else {
        disk.deleteLiveEndedStatusFile(streamName);
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
}
