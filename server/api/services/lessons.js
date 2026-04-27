import * as cfg from '../config.js';

const lessonsHeaders = {
  'X-Access-Token': cfg.LESSONS_API_TOKEN,
  'Content-Type': 'application/json'
};

export let lessonsCache = { data: null, ts: 0 };

export function invalidateLessonsCache() {
  lessonsCache = { data: null, ts: 0 };
}

function extractLessonsArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    return data.content ?? data.data ?? data.lessons ?? data.items ?? [];
  }
  return [];
}

/**
 * 401/403 ao contactar a API Java em /api/lessons — quase sempre token desalinhado.
 */
export function logLessonsApiAuthFailure(status, url, context = '') {
  if (status !== 401 && status !== 403) return;
  const ctx = context ? ` [${context}]` : '';
  console.warn(
    `[API] Lessons/Java ${status} em ${url}${ctx}. ` +
      'Defina o MESMO segredo em API_ACCESS_TOKEN (API Java → api.access.token) e LESSONS_API_TOKEN (LiveBridge).'
  );
}

export async function fetchLessons() {
  if (!cfg.hasLessonsApi) return [];
  const now = Date.now();
  if (lessonsCache.data && now - lessonsCache.ts < cfg.LESSONS_CACHE_MS) {
    return lessonsCache.data;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), cfg.LESSONS_TIMEOUT_MS);
    const res = await fetch(`${cfg.LESSONS_API_URL}/api/lessons`, { headers: lessonsHeaders, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) {
      const url = `${cfg.LESSONS_API_URL}/api/lessons`;
      console.warn('[API] Lessons API respondeu', res.status, res.statusText, url);
      logLessonsApiAuthFailure(res.status, url, 'GET fetchLessons');
      return lessonsCache.data || [];
    }
    const raw = await res.json();
    const data = extractLessonsArray(raw);
    if (!Array.isArray(data)) {
      console.warn('[API] Lessons API retornou formato inesperado');
      return lessonsCache.data || [];
    }
    if (process.env.DEBUG_LESSONS && data.length > 0) {
      console.log('[API] Lessons sample:', JSON.stringify(data[0]));
    }
    lessonsCache = { data, ts: now };
    return data;
  } catch (e) {
    console.warn('[API] Erro ao buscar lessons:', e.message);
    return lessonsCache.data || [];
  }
}

export async function fetchDistinct(field) {
  if (!cfg.hasLessonsApi) return [];
  try {
    const url = `${cfg.LESSONS_API_URL}/api/lessons/distinct/${field}`;
    const res = await fetch(url, { headers: lessonsHeaders });
    if (!res.ok) {
      logLessonsApiAuthFailure(res.status, url, `GET distinct/${field}`);
      return [];
    }
    const arr = await res.json();
    return Array.isArray(arr) ? arr.map((n) => ({ nome: n })) : [];
  } catch (e) {
    console.warn('[API] Erro ao buscar distinct:', e.message);
    return [];
  }
}

export { lessonsHeaders };
