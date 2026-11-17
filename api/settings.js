// /api/settings  GET → { settings }   PUT { settings } → enregistre
import { ready } from './_lib/db.js';
import { authorized, body, fail } from './_lib/http.js';

const SHARED = ['siteName', 'morningHour', 'eveningHour', 'rdvLeadMinutes'];

export function pick(s = {}) {
  const out = {};
  if (typeof s.siteName === 'string') out.siteName = s.siteName.slice(0, 120);
  for (const k of ['morningHour', 'eveningHour']) if (Number.isInteger(s[k]) && s[k] >= 0 && s[k] <= 23) out[k] = s[k];
  if (Number.isInteger(s.rdvLeadMinutes) && s.rdvLeadMinutes > 0 && s.rdvLeadMinutes <= 1440) out.rdvLeadMinutes = s.rdvLeadMinutes;
  return out;
}

export default async function handler(req, res) {
  if (!authorized(req, res)) return;
  try {
    const db = await ready();
    if (req.method === 'GET') {
      const rows = await db.query("SELECT value FROM settings WHERE key = 'app'");
      return res.status(200).json({ settings: rows[0]?.value || {} });
    }
    if (req.method === 'PUT') {
      const value = pick(body(req).settings);
      await db.query(
        `INSERT INTO settings (key, value) VALUES ('app', $1::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify(value)],
      );
      return res.status(200).json({ settings: value });
    }
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  } catch (e) {
    return fail(res, e);
  }
}

export { SHARED };
