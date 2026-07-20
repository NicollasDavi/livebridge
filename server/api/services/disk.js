import {
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  unlinkSync,
  rmSync
} from 'fs';
import { readdir, readFile, access, stat } from 'fs/promises';
import { join } from 'path';
import * as cfg from '../config.js';

export function mergeProgressFilePath(p, session) {
  const safe = `${p.replace(/\//g, '_')}__${String(session).replace(/[/\\]/g, '_')}`;
  return join(cfg.MERGE_PROGRESS_DIR, `${safe}.json`);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remove gravação no disco: pasta `RECORDINGS_DIR/path/session` (se existir), ou layout “flat”
 * (só .ts + mp4 com prefixo session em `RECORDINGS_DIR/path`). Também apaga JSON de merge-progress
 * e pending live-ended quando aplicável.
 */
export function deleteLocalRecordingArtifacts(path, session) {
  if (!path || !session || typeof path !== 'string' || typeof session !== 'string') {
    return { ok: false, reason: 'invalid' };
  }
  if (path.includes('..') || session.includes('..')) return { ok: false, reason: 'invalid' };
  if (session.includes('/') || session.includes('\\')) return { ok: false, reason: 'invalid_session' };
  if (!path.startsWith('live/')) return { ok: false, reason: 'invalid_path' };
  const streamName = path.replace(/^live\//, '');
  if (!streamName || streamName.includes('/')) return { ok: false, reason: 'invalid_path' };
  if (session.startsWith('_w_')) return { ok: false, reason: 'invalid_session' };

  const livePath = join(cfg.RECORDINGS_DIR, path);
  const sessionSubdir = join(livePath, session);
  let removedDir = false;

  try {
    if (existsSync(sessionSubdir) && statSync(sessionSubdir).isDirectory()) {
      rmSync(sessionSubdir, { recursive: true, force: true });
      removedDir = true;
    } else if (existsSync(livePath) && statSync(livePath).isDirectory()) {
      const tsRe = new RegExp(`^${escapeRegex(session)}(-\\d+)?\\.ts$`, 'i');
      for (const name of readdirSync(livePath)) {
        if (tsRe.test(name)) {
          try {
            unlinkSync(join(livePath, name));
          } catch (_) {}
        }
      }
      for (const suf of ['', '_1080', '_720', '_480']) {
        const mp4 = `${session}${suf}.mp4`;
        const fp = join(livePath, mp4);
        if (existsSync(fp)) {
          try {
            unlinkSync(fp);
          } catch (_) {}
        }
      }
    }
  } catch (e) {
    console.warn('[disk] deleteLocalRecordingArtifacts I/O:', e?.message);
    return { ok: false, reason: e?.message || 'io_error' };
  }

  try {
    const mp = mergeProgressFilePath(path, session);
    if (existsSync(mp)) unlinkSync(mp);
  } catch (e) {
    console.warn('[disk] merge-progress cleanup:', e?.message);
  }

  try {
    if (session.endsWith('_aula')) {
      deleteLiveEndedPartial(streamName, session);
    } else {
      const st = readLiveEndedStatus(streamName);
      if (st && st.session === session && st.path === path) {
        deleteLiveEndedStatusFile(streamName);
      }
    }
  } catch (e) {
    console.warn('[disk] live-ended cleanup:', e?.message);
  }

  return { ok: true, removedDir };
}

export function getBoundariesFile(streamName) {
  const safe = String(streamName).replace(/[/\\]/g, '_');
  return join(cfg.BOUNDARIES_DIR, `${safe}.json`);
}

/** Estado de cortes entre aulas (base + variantes ABR gravadas no MediaMTX). */
export function readBoundaryState(streamName) {
  try {
    const fp = getBoundariesFile(streamName);
    if (!existsSync(fp)) return { lastIncludedTs: null, lastIncludedByVariant: null };
    const raw = readFileSync(fp, 'utf8');
    const data = JSON.parse(raw);
    const v = data.lastIncludedByVariant;
    return {
      lastIncludedTs: data.lastIncludedTs || null,
      lastIncludedByVariant:
        v && typeof v === 'object' && !Array.isArray(v)
          ? { ...v }
          : null
    };
  } catch {
    return { lastIncludedTs: null, lastIncludedByVariant: null };
  }
}

export function writeBoundaryState(streamName, { lastIncludedTs, lastIncludedByVariant }) {
  try {
    if (!existsSync(cfg.BOUNDARIES_DIR)) mkdirSync(cfg.BOUNDARIES_DIR, { recursive: true });
    const fp = getBoundariesFile(streamName);
    writeFileSync(
      fp,
      JSON.stringify({
        lastIncludedTs,
        lastIncludedByVariant: lastIncludedByVariant && typeof lastIncludedByVariant === 'object' ? lastIncludedByVariant : {},
        updatedAt: new Date().toISOString()
      })
    );
  } catch (e) {
    console.warn('[API] Erro ao gravar boundary:', e?.message);
  }
}

export function getLiveEndedFile(streamName) {
  const safe = String(streamName).replace(/[/\\]/g, '_');
  return join(cfg.LIVE_ENDED_DIR, `${safe}.json`);
}

export function getLiveEndedFileForPartial(streamName, session) {
  const safeStream = String(streamName).replace(/[/\\]/g, '_');
  const safeSession = String(session).replace(/[/\\]/g, '_');
  return join(cfg.LIVE_ENDED_DIR, `${safeStream}__${safeSession}.json`);
}

export function readLiveEndedPartial(streamName, session) {
  try {
    const filePath = getLiveEndedFileForPartial(streamName, session);
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeLiveEndedPartial(streamName, session, data) {
  try {
    if (!existsSync(cfg.LIVE_ENDED_DIR)) mkdirSync(cfg.LIVE_ENDED_DIR, { recursive: true });
    const filePath = getLiveEndedFileForPartial(streamName, session);
    writeFileSync(filePath, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }));
  } catch (e) {
    console.warn('[API] Erro ao gravar live-ended partial:', e?.message);
  }
}

export function deleteLiveEndedPartial(streamName, session) {
  try {
    const filePath = getLiveEndedFileForPartial(streamName, session);
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch (e) {
    console.warn('[API] Erro ao remover live-ended partial:', e?.message);
  }
}

export function deleteLiveEndedStatusFile(streamName) {
  try {
    const filePath = getLiveEndedFile(streamName);
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch (e) {
    console.warn('[API] Erro ao remover live-ended:', e?.message);
  }
}

export function readLiveEndedStatus(streamName) {
  try {
    const filePath = getLiveEndedFile(streamName);
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeLiveEndedStatus(streamName, data) {
  try {
    if (!existsSync(cfg.LIVE_ENDED_DIR)) mkdirSync(cfg.LIVE_ENDED_DIR, { recursive: true });
    const filePath = getLiveEndedFile(streamName);
    writeFileSync(filePath, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }));
  } catch (e) {
    console.warn('[API] Erro ao gravar live-ended:', e?.message);
  }
}

/** Descobre path e session atuais para um stream (lê do disco) — síncrono. */
export function discoverCurrentSession(streamName) {
  const path = `live/${streamName}`;
  const fullPath = join(cfg.RECORDINGS_DIR, path);
  if (!existsSync(fullPath)) return null;
  const tsInStream = readdirSync(fullPath).filter((f) => f.endsWith('.ts'));
  if (tsInStream.length > 0) {
    const sorted = tsInStream.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const session = sorted[0].replace(/\.ts$/i, '').replace(/-\d+$/, '');
    return { path, session };
  }
  const entries = readdirSync(fullPath, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory() && !/_aula$/i.test(e.name) && !e.name.startsWith('_w_'))
    .map((e) => ({ name: e.name, mtime: statSync(join(fullPath, e.name)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!dirs[0]) return null;
  const sessionPath = join(fullPath, dirs[0].name);
  const tsFiles = readdirSync(sessionPath).filter((f) => f.endsWith('.ts'));
  if (tsFiles.length === 0) return null;
  return { path, session: dirs[0].name };
}

/** Versão assíncrona (não bloqueia o event loop em I/O). */
export async function discoverCurrentSessionAsync(streamName) {
  const path = `live/${streamName}`;
  const fullPath = join(cfg.RECORDINGS_DIR, path);
  try {
    await access(fullPath);
  } catch {
    return null;
  }
  const names = await readdir(fullPath);
  const tsInStream = names.filter((f) => f.endsWith('.ts'));
  if (tsInStream.length > 0) {
    const sorted = tsInStream.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const session = sorted[0].replace(/\.ts$/i, '').replace(/-\d+$/, '');
    return { path, session };
  }
  const dirents = await readdir(fullPath, { withFileTypes: true });
  const dirs = dirents
    .filter((e) => e.isDirectory() && !/_aula$/i.test(e.name) && !e.name.startsWith('_w_'))
    .map((e) => ({ name: e.name, p: join(fullPath, e.name) }));
  const withMtime = await Promise.all(
    dirs.map(async (d) => ({ name: d.name, mtime: (await stat(d.p)).mtime }))
  );
  withMtime.sort((a, b) => b.mtime - a.mtime);
  if (!withMtime[0]) return null;
  const sessionPath = join(fullPath, withMtime[0].name);
  const tsFiles = (await readdir(sessionPath)).filter((f) => f.endsWith('.ts'));
  if (tsFiles.length === 0) return null;
  return { path, session: withMtime[0].name };
}

export const tsSort = (a, b) => {
  const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
  const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
  return na - nb || a.localeCompare(b, undefined, { numeric: true });
};

export { existsSync, mkdirSync, copyFileSync, join, readdirSync, readFileSync, unlinkSync, statSync };
export { readdir, readFile };
