import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import * as cfg from '../config.js';
import { applyIngestRecording } from './mediamtxControl.js';

const SETTINGS_FILE = join(cfg.RECORDINGS_DIR, 'livebridge-settings.json');

const PRESETS = new Set([
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow'
]);
const ALLOWED_HEIGHTS = new Set([1080, 720, 480]);

function envFlag(name, defaultOn = true) {
  const v = process.env[name];
  if (v === undefined || v === '') return defaultOn;
  return !['0', 'false', 'off', 'no'].includes(String(v).trim().toLowerCase());
}

function envDefaults() {
  const codecRaw = String(process.env.COMPRESS_CODEC || 'h265').trim().toLowerCase();
  const compressCodec = codecRaw === 'h264' ? 'h264' : 'h265';
  const preset = String(process.env.COMPRESS_PRESET || 'veryslow').trim().toLowerCase();
  let mergeResolutions = String(process.env.MERGE_RESOLUTIONS || '1080,720,480').trim() || '1080,720,480';
  try {
    mergeResolutions = normalizeMergeResolutions(mergeResolutions);
  } catch {
    mergeResolutions = '1080,720,480';
  }
  return {
    mergeEnabled: cfg.MERGE_ENABLED,
    compressPreset: PRESETS.has(preset) ? preset : 'veryslow',
    compressCodec,
    mergeResolutions,
    recordLive: envFlag('RECORD_LIVE', true)
  };
}

function readRaw() {
  try {
    if (!existsSync(SETTINGS_FILE)) return null;
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch (e) {
    console.warn('[settings] Falha ao ler', SETTINGS_FILE, e?.message);
    return null;
  }
}

function normalizeMergeResolutions(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s || s === 'single' || s === '0' || s === 'false') return 'single';
  const parts = s
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => ALLOWED_HEIGHTS.has(n));
  if (!parts.length) {
    throw new Error('mergeResolutions inválido. Use "single" ou lista entre 1080,720,480 (ex.: "1080,720,480").');
  }
  const uniq = [...new Set(parts)].sort((a, b) => b - a);
  return uniq.join(',');
}

function normalizeCodec(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'h264') return 'h264';
  if (s === 'h265' || s === 'hevc') return 'h265';
  throw new Error('compressCodec inválido. Use "h264" ou "h265".');
}

function normalizePreset(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!PRESETS.has(s)) {
    throw new Error(`compressPreset inválido. Use: ${[...PRESETS].join(', ')}`);
  }
  return s;
}

function pickFromRaw(raw, defaults) {
  const out = { ...defaults };
  if (!raw) return out;

  if (typeof raw.mergeEnabled === 'boolean') out.mergeEnabled = raw.mergeEnabled;

  if (typeof raw.compressPreset === 'string') {
    try {
      out.compressPreset = normalizePreset(raw.compressPreset);
    } catch (_) {}
  }
  if (typeof raw.compressCodec === 'string') {
    try {
      out.compressCodec = normalizeCodec(raw.compressCodec);
    } catch (_) {}
  }
  if (raw.mergeResolutions != null) {
    try {
      out.mergeResolutions = normalizeMergeResolutions(raw.mergeResolutions);
    } catch (_) {}
  }
  if (typeof raw.recordLive === 'boolean') out.recordLive = raw.recordLive;

  return out;
}

/**
 * Estado efetivo: ficheiro + defaults do env para campos em falta.
 */
export function getSettings() {
  const defaults = envDefaults();
  const raw = readRaw();
  return {
    ...pickFromRaw(raw, defaults),
    updatedAt: raw?.updatedAt || null,
    source: raw ? 'file' : 'env'
  };
}

export function isMergeEnabled() {
  return getSettings().mergeEnabled === true;
}

/**
 * Valida e faz merge parcial com o estado atual.
 */
export function validateAndMergePatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Body JSON objeto obrigatório'), { status: 400 });
  }
  const keys = Object.keys(body);
  if (!keys.length) {
    throw Object.assign(new Error('Nenhum campo para atualizar'), { status: 400 });
  }
  const allowed = new Set([
    'mergeEnabled',
    'compressPreset',
    'compressCodec',
    'mergeResolutions',
    'recordLive'
  ]);
  for (const k of keys) {
    if (!allowed.has(k)) {
      throw Object.assign(new Error(`Campo não suportado: ${k}`), { status: 400 });
    }
  }

  const current = getSettings();
  const next = {
    mergeEnabled: current.mergeEnabled,
    compressPreset: current.compressPreset,
    compressCodec: current.compressCodec,
    mergeResolutions: current.mergeResolutions,
    recordLive: current.recordLive
  };

  if ('mergeEnabled' in body) {
    if (typeof body.mergeEnabled !== 'boolean') {
      throw Object.assign(new Error('mergeEnabled deve ser boolean'), { status: 400 });
    }
    next.mergeEnabled = body.mergeEnabled;
  }
  if ('compressPreset' in body) next.compressPreset = normalizePreset(body.compressPreset);
  if ('compressCodec' in body) next.compressCodec = normalizeCodec(body.compressCodec);
  if ('mergeResolutions' in body) next.mergeResolutions = normalizeMergeResolutions(body.mergeResolutions);
  if ('recordLive' in body) {
    if (typeof body.recordLive !== 'boolean') {
      throw Object.assign(new Error('recordLive deve ser boolean'), { status: 400 });
    }
    next.recordLive = body.recordLive;
  }

  return {
    settings: next,
    recordLiveChanged: 'recordLive' in body && body.recordLive !== current.recordLive
  };
}

function writeSettingsFile(settings) {
  const next = {
    ...settings,
    updatedAt: new Date().toISOString()
  };
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
  const tmp = `${SETTINGS_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  renameSync(tmp, SETTINGS_FILE);
  return { ...next, source: 'file' };
}

/**
 * Persiste settings e aplica recordLive no MediaMTX quando mudar.
 */
export async function updateSettings(body) {
  const { settings, recordLiveChanged } = validateAndMergePatch(body);
  const saved = writeSettingsFile(settings);
  console.log(
    `[settings] mergeEnabled=${saved.mergeEnabled} compress=${saved.compressCodec}/${saved.compressPreset} ` +
      `resolutions=${saved.mergeResolutions} recordLive=${saved.recordLive}`
  );

  let recordLiveApply = null;
  if (recordLiveChanged) {
    try {
      await applyIngestRecording(saved.recordLive);
      recordLiveApply = { ok: true };
    } catch (e) {
      console.warn('[settings] MediaMTX recordLive:', e?.message);
      recordLiveApply = { ok: false, error: e?.message || String(e) };
    }
  }

  return { ...saved, recordLiveApply };
}

/** Compat: só altera mergeEnabled. */
export async function setMergeEnabled(enabled) {
  return updateSettings({ mergeEnabled: !!enabled });
}

/** Alinha MediaMTX ao ficheiro/env no arranque da API. */
export async function syncRecordLiveToMediaMtx() {
  const s = getSettings();
  await applyIngestRecording(s.recordLive);
  return s.recordLive;
}

export function settingsFilePath() {
  return SETTINGS_FILE;
}

export function settingsPublicShape(s) {
  return {
    mergeEnabled: s.mergeEnabled,
    compressPreset: s.compressPreset,
    compressCodec: s.compressCodec,
    mergeResolutions: s.mergeResolutions,
    recordLive: s.recordLive,
    updatedAt: s.updatedAt,
    source: s.source
  };
}
