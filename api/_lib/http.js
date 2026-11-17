import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s) => createHash('sha256').update(String(s)).digest();

// Protection simple pour un usage personnel : un mot de passe défini dans
// la variable APP_PASSWORD de Vercel, envoyé par l'app dans un en-tête.
export function authorized(req, res) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    res.status(503).json({ error: 'APP_PASSWORD manquant : définissez un mot de passe dans les variables du projet Vercel.' });
    return false;
  }
  const given = req.headers['x-app-password'] || '';
  if (!timingSafeEqual(digest(given), digest(expected))) {
    res.status(401).json({ error: 'Mot de passe incorrect.' });
    return false;
  }
  return true;
}

export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

export function fail(res, e) {
  console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Erreur du serveur ou de la base de données.' });
}
