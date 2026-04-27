import { R2_VIDEOS_PREFIX } from '../r2.js';

const variantOrder = { '1080p': 0, '720p': 1, '480p': 2 };

export function mapContentsToRecordings(contents) {
  const list = [];
  for (const obj of contents || []) {
    if (!obj.Key || !obj.Key.endsWith('.mp4')) continue;
    const rest = obj.Key.slice(R2_VIDEOS_PREFIX.length);
    const parts = rest.split('/');
    if (parts.length < 2) continue;
    const filename = parts.pop();
    const recPath = parts.join('/');
    let fileBase = filename.replace(/\.mp4$/i, '');
    let session = fileBase;
    let variant = null;
    const vm = fileBase.match(/^(.*)_(1080|720|480)$/);
    if (vm) {
      session = vm[1];
      variant = `${vm[2]}p`;
    }
    list.push({
      path: recPath,
      session,
      variant,
      key: obj.Key,
      date: session.replace(/_/g, ' '),
      id: `${recPath}|${session}`
    });
  }
  return list;
}

/**
 * Uma aula multiresolução no R2 = 3 objetos (*_1080/_720/_480.mp4) com o mesmo id lógico.
 * Colapsa num único item (como um único registo "Aula acabou"), não três gravações separadas.
 */
export function collapseMultiresRecordingRows(list) {
  const m = new Map();
  for (const rec of list) {
    const id = rec.id;
    let agg = m.get(id);
    if (!agg) {
      agg = {
        path: rec.path,
        session: rec.session,
        date: rec.date,
        id: rec.id,
        key: rec.key,
        variant: null
      };
      m.set(id, agg);
    }
    if (rec.variant) {
      if (!agg.variants) agg.variants = [];
      agg.variants.push({ variant: rec.variant, key: rec.key });
    } else {
      agg.key = rec.key;
      agg._legacySingleFile = true;
    }
  }
  const out = [];
  for (const agg of m.values()) {
    if (agg.variants && agg.variants.length > 0) {
      agg.variants.sort(
        (a, b) => (variantOrder[a.variant] ?? 99) - (variantOrder[b.variant] ?? 99)
      );
      agg.key = agg.variants[0].key;
      agg.variant = null;
    }
    delete agg._legacySingleFile;
    out.push(agg);
  }
  return out;
}

export function sortRecordingsList(list) {
  list.sort((a, b) => {
    const c = b.session.localeCompare(a.session);
    if (c !== 0) return c;
    return (variantOrder[a.variant] ?? -1) - (variantOrder[b.variant] ?? -1);
  });
}

export function encodeS3Cursor(token) {
  if (!token) return null;
  return Buffer.from(token, 'utf8').toString('base64url');
}

export function decodeS3Cursor(cursor) {
  if (cursor == null || cursor === '') return undefined;
  try {
    return Buffer.from(String(cursor), 'base64url').toString('utf8');
  } catch {
    return undefined;
  }
}
