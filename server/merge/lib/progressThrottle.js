import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

/**
 * Grava JSON de progresso com throttle (menos fs síncrono durante ffmpeg/upload).
 */
export function createProgressWriter({ recordingsDir, throttleMs = 400 }) {
  const PROGRESS_DIR = join(recordingsDir, 'merge-progress');
  const throttleState = new Map();
  let progressDirReady = false;

  function progressFilePath(path, sessionName) {
    const safe = `${path.replace(/\//g, '_')}__${String(sessionName).replace(/[/\\]/g, '_')}`;
    return join(PROGRESS_DIR, `${safe}.json`);
  }

  function writePayload(path, sessionName, inner) {
    try {
      if (!progressDirReady || !existsSync(PROGRESS_DIR)) {
        mkdirSync(PROGRESS_DIR, { recursive: true });
        progressDirReady = true;
      }
      const payload = { path, session: sessionName, ...inner, updatedAt: new Date().toISOString() };
      writeFileSync(progressFilePath(path, sessionName), JSON.stringify(payload));
    } catch (e) {
      console.warn('[merge] progress write:', e?.message);
    }
  }

  function flushKey(key) {
    const st = throttleState.get(key);
    if (!st || !st.pending) return;
    const { path, sessionName, data } = st.pending;
    st.pending = null;
    st.last = Date.now();
    if (st.timer) {
      clearTimeout(st.timer);
      st.timer = null;
    }
    writePayload(path, sessionName, data);
  }

  function writeProgress(path, sessionName, data, { immediate = false } = {}) {
    const key = `${path}::${sessionName}`;
    if (immediate) {
      const st = throttleState.get(key);
      if (st?.timer) {
        clearTimeout(st.timer);
        st.timer = null;
      }
      if (st) st.pending = null;
      writePayload(path, sessionName, data);
      const st2 = throttleState.get(key) || { last: 0, pending: null, timer: null };
      st2.last = Date.now();
      throttleState.set(key, st2);
      return;
    }

    let st = throttleState.get(key);
    if (!st) st = { last: 0, pending: null, timer: null };
    st.pending = { path, sessionName, data };
    const now = Date.now();
    throttleState.set(key, st);

    if (now - st.last >= throttleMs) {
      flushKey(key);
    } else if (!st.timer) {
      st.timer = setTimeout(() => flushKey(key), throttleMs - (now - st.last));
    }
  }

  function clearProgress(path, sessionName) {
    const key = `${path}::${sessionName}`;
    const st = throttleState.get(key);
    if (st?.timer) clearTimeout(st.timer);
    throttleState.delete(key);
    try {
      const fp = progressFilePath(path, sessionName);
      if (existsSync(fp)) unlinkSync(fp);
    } catch (_) {}
  }

  return { writeProgress, clearProgress, progressFilePath };
}
