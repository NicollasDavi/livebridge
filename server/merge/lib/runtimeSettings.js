import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const RECORDINGS_DIR = (process.env.RECORDINGS_DIR || '/recordings').trim();
const SETTINGS_FILE = join(RECORDINGS_DIR, 'livebridge-settings.json');

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

function normalizeMergeResolutions(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s || s === 'single' || s === '0' || s === 'false') return 'single';
  const parts = s
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => ALLOWED_HEIGHTS.has(n));
  if (!parts.length) return '1080,720,480';
  return [...new Set(parts)].sort((a, b) => b - a).join(',');
}

function envDefaults() {
  const codecRaw = String(process.env.COMPRESS_CODEC || 'h265').trim().toLowerCase();
  const compressCodec = codecRaw === 'h264' ? 'h264' : 'h265';
  const preset = String(process.env.COMPRESS_PRESET || 'veryslow').trim().toLowerCase();
  return {
    mergeEnabled: envFlag('MERGE_ENABLED', true),
    compressVideo: process.env.COMPRESS_VIDEO !== '0',
    compressPreset: PRESETS.has(preset) ? preset : 'veryslow',
    compressCodec,
    compressCrfH264: parseInt(process.env.COMPRESS_CRF_H264 || process.env.COMPRESS_CRF || '23', 10) || 23,
    compressCrfH265: parseInt(process.env.COMPRESS_CRF_H265 || process.env.COMPRESS_CRF || '28', 10) || 28,
    compressAudioBitrate: (process.env.COMPRESS_AUDIO_BITRATE || '64k').trim(),
    mergeResolutions: normalizeMergeResolutions(process.env.MERGE_RESOLUTIONS || '1080,720,480'),
    recordLive: envFlag('RECORD_LIVE', true)
  };
}

/**
 * Mesmo ficheiro que a API grava (`/recordings/livebridge-settings.json`).
 * Relevante a cada job/scan — não fica preso ao env do arranque.
 */
export function getRuntimeSettings() {
  const defaults = envDefaults();
  try {
    if (!existsSync(SETTINGS_FILE)) return defaults;
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    if (!data || typeof data !== 'object') return defaults;

    if (typeof data.mergeEnabled === 'boolean') defaults.mergeEnabled = data.mergeEnabled;
    if (typeof data.compressPreset === 'string') {
      const p = data.compressPreset.trim().toLowerCase();
      if (PRESETS.has(p)) defaults.compressPreset = p;
    }
    if (typeof data.compressCodec === 'string') {
      const c = data.compressCodec.trim().toLowerCase();
      if (c === 'h264') defaults.compressCodec = 'h264';
      else if (c === 'h265' || c === 'hevc') defaults.compressCodec = 'h265';
    }
    if (data.mergeResolutions != null) {
      defaults.mergeResolutions = normalizeMergeResolutions(data.mergeResolutions);
    }
    if (typeof data.recordLive === 'boolean') defaults.recordLive = data.recordLive;
  } catch (e) {
    console.warn('[merge] settings:', e?.message);
  }
  return defaults;
}

export function isMergeEnabled() {
  return getRuntimeSettings().mergeEnabled === true;
}
