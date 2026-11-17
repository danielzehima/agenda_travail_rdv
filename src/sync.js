// Synchronisation avec le serveur (Vercel + Neon).
// - Chaque modification est mise dans une file d'attente gardée sur l'appareil,
//   puis envoyée au serveur. Sans réseau, la file attend et repart plus tard.
// - Sans serveur (page statique, claude.ai), l'app reste en mode local.

const PW_KEY = 'chantier-agenda:password';
const QUEUE_KEY = 'chantier-agenda:queue';
const SYNCED_KEY = 'chantier-agenda:synced-once';

const read = (k, fallback) => { try { const v = localStorage.getItem(k); return v === null ? fallback : v; } catch { return fallback; } };
const write = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };

export const getPassword = () => read(PW_KEY, '');
export const setPassword = (p) => write(PW_KEY, p || null);
export const hasSyncedOnce = () => read(SYNCED_KEY, '') === '1';
export const markSynced = () => write(SYNCED_KEY, '1');

export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export async function api(method, path, data) {
  let res;
  try {
    res = await fetch(`/api/${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-app-password': getPassword() },
      body: data ? JSON.stringify(data) : undefined,
    });
  } catch {
    throw new ApiError('offline', 'Pas de connexion internet.');
  }
  if (!(res.headers.get('content-type') || '').includes('application/json')) {
    throw new ApiError('no_api', "Pas de serveur : l'app fonctionne en local.");
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new ApiError('unauthorized', json.error || 'Mot de passe incorrect.');
  if (res.status >= 500) throw new ApiError('server', json.error || 'Erreur du serveur.');
  if (!res.ok) throw new ApiError('bad', json.error || 'Requête refusée.');
  return json;
}

let queue = (() => { try { return JSON.parse(read(QUEUE_KEY, '[]')); } catch { return []; } })();
const saveQueue = () => write(QUEUE_KEY, JSON.stringify(queue));

export const pendingCount = () => queue.length;

export function enqueue(op) {
  queue.push(op);
  saveQueue();
}

let flushing = null;

// Envoie la file dans l'ordre. S'arrête (et lève l'erreur) au premier échec réseau.
export function flush() {
  if (!flushing) {
    flushing = (async () => {
      while (queue.length) {
        const op = queue[0];
        try {
          if (op.op === 'upsert') await api('POST', 'items', { items: op.items, replace: Boolean(op.replace) });
          else if (op.op === 'delete') await api('DELETE', 'items', { ids: op.ids });
          else if (op.op === 'settings') await api('PUT', 'settings', { settings: op.settings });
        } catch (e) {
          if (e.code !== 'bad') throw e; // une requête refusée ne doit pas bloquer la file
        }
        queue.shift();
        saveQueue();
      }
    })().finally(() => { flushing = null; });
  }
  return flushing;
}

export async function pull() {
  const [a, b] = await Promise.all([api('GET', 'items'), api('GET', 'settings')]);
  return { items: a.items || [], settings: b.settings || {} };
}
