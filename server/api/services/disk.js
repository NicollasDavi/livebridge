import {
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  unlinkSync
} from 'fs';
import { readdir, readFile, access, stat } from 'fs/promises';
import { join } from 'path';
import * as cfg from '../config.js';

export function mergeProgressFilePath(p, session) {
  const safe = `${p.replace(/\//g, '_')}__${String(session).replace(/[/\\]/g, '_')}`;
  return join(cfg.MERGE_PROGRESS_DIR, `${safe}.json`);
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
