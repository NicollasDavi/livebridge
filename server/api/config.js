import { join } from 'path';

const trim = (s, d) => String(s ?? d ?? '').trim();

export const VIDEO_LIVE_COOKIE = 'vid_live';
export const VIDEO_LIVE_MAX_AGE = 14400;
export const VIDEO_ACCESS_COOKIE = 'vid_ctx';
export const VIDEO_ACCESS_MAX_AGE = 86400;

export const LIVE_ABR_BANDWIDTH_1080 = 4628000;
export const LIVE_ABR_BANDWIDTH_720 = 2928000;
export const LIVE_ABR_BANDWIDTH_480 = 1328000;

export const VIDEO_ACCESS_SECRET = process.env.VIDEO_ACCESS_SECRET;
export const R2_BUCKET = process.env.R2_BUCKET || 'livebridge';

export const LESSONS_API_URL = process.env.LESSONS_API_URL || 'https://api.posihub.com.br';
export const LESSONS_API_TOKEN = process.env.LESSONS_API_TOKEN || process.env.API_ACCESS_TOKEN;
export const RECORDINGS_DIR = trim(process.env.RECORDINGS_DIR, '/recordings');
export const MERGE_INTERNAL_URL = process.env.MERGE_INTERNAL_URL || 'http://merge:8080';
export const VIDEOS_API_URL = process.env.VIDEOS_API_URL || process.env.LESSONS_API_URL || 'https://api.posihub.com.br';
export const VIDEOS_API_TOKEN = process.env.VIDEOS_API_TOKEN || process.env.LESSONS_API_TOKEN || process.env.API_ACCESS_TOKEN;

export const LESSONS_TIMEOUT_MS = parseInt(process.env.LESSONS_TIMEOUT_MS || '2000', 10);
export const LESSONS_CACHE_MS = parseInt(process.env.LESSONS_CACHE_MS || '30000', 10);
export const CHECK_VIDEO_ACCESS_CACHE_MS = parseInt(process.env.CHECK_VIDEO_ACCESS_CACHE_MS || '1500', 10);

/** 1 = logar todas as requisições; 0 = omitir rotas ruidosas (ex.: check-video-access). */
export const API_LOG_ALL_REQUESTS = process.env.API_LOG_ALL_REQUESTS === '1' || process.env.API_LOG_ALL_REQUESTS === 'true';

/** Paginação R2: tamanho máximo por página (1–1000). */
export const RECORDINGS_PAGE_MAX_KEYS = Math.min(
  1000,
  Math.max(1, parseInt(process.env.RECORDINGS_PAGE_MAX_KEYS || '500', 10) || 500)
);

/** Leituras em paralelo ao montar /api/recordings/pending. */
export const PENDING_READ_CONCURRENCY = Math.min(
  32,
  Math.max(1, parseInt(process.env.PENDING_READ_CONCURRENCY || '8', 10) || 8)
);

export const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,https://api.posihub.com.br,http://localhost:8081')
  .split(',')
  .map((s) => s.trim());

export const corsOriginSet = new Set(corsOrigins);

export const skipLessonsInList = process.env.SKIP_LESSONS_API !== '0' && process.env.SKIP_LESSONS_API !== 'false';
export const hasLessonsApi = !!(LESSONS_API_URL && LESSONS_API_TOKEN);

export const LIVE_ENDED_DIR = join(RECORDINGS_DIR, 'live-ended');
export const MERGE_PROGRESS_DIR = join(RECORDINGS_DIR, 'merge-progress');
export const BOUNDARIES_DIR = join(RECORDINGS_DIR, 'boundaries');
