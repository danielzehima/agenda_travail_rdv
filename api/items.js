// /api/items
//   GET               → { items: [...] }
//   POST { items, replace? } → enregistre (crée ou met à jour) ; replace=true remplace tout
//   DELETE { ids }    → supprime
import { ready } from './_lib/db.js';
import { authorized, body, fail } from './_lib/http.js';

const TYPES = new Set(['travail', 'rdv', 'journal']);
const str = (v, max) => String(v ?? '').slice(0, max);

export function clean(i) {
  if (!i || typeof i.id !== 'string' || !i.id || i.id.length > 100) return null;
  if (!TYPES.has(i.type) || !/^\d{4}-\d{2}-\d{2}$/.test(i.date || '')) return null;
  const title = str(i.title, 300).trim();
  if (!title) return null;
  const time = /^\d{2}:\d{2}$/.test(i.time || '') ? i.time : '';
  const at = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
  return {
    id: i.id,
    type: i.type,
    title,
    date: i.date,
    time,
    location: str(i.location, 300),
    notes: str(i.notes, 5000),
    validated: Boolean(i.validated),
    validated_at: i.validated ? at(i.validatedAt) || new Date().toISOString() : null,
    created_at: at(i.createdAt) || new Date().toISOString(),
  };
}

const SELECT = `SELECT id, type, title, to_char(date, 'YYYY-MM-DD') AS date, time, location, notes,
  validated, validated_at, created_at FROM items ORDER BY date, time, created_at`;

const toItem = (r) => ({
  id: r.id,
  type: r.type,
  title: r.title,
  date: r.date,
  time: r.time,
  location: r.location,
  notes: r.notes,
  validated: r.validated,
  validatedAt: r.validated_at ? new Date(r.validated_at).toISOString() : null,
  createdAt: new Date(r.created_at).toISOString(),
});

const UPSERT = `INSERT INTO items (id, type, title, date, time, location, notes, validated, validated_at, created_at, updated_at)
  SELECT id, type, title, date::date, time, location, notes, validated, validated_at, created_at, now()
  FROM jsonb_to_recordset($1::jsonb) AS x(id text, type text, title text, date text, time text, location text,
    notes text, validated boolean, validated_at timestamptz, created_at timestamptz)
  ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, title = EXCLUDED.title, date = EXCLUDED.date,
    time = EXCLUDED.time, location = EXCLUDED.location, notes = EXCLUDED.notes, validated = EXCLUDED.validated,
    validated_at = EXCLUDED.validated_at, updated_at = now()`;

export default async function handler(req, res) {
  if (!authorized(req, res)) return;
  try {
    const db = await ready();

    if (req.method === 'GET') {
      const rows = await db.query(SELECT);
      return res.status(200).json({ items: rows.map(toItem) });
    }

    if (req.method === 'POST') {
      const { items = [], replace = false } = body(req);
      if (!Array.isArray(items) || items.length > 5000) return res.status(400).json({ error: 'Liste « items » invalide.' });
      const rows = items.map(clean).filter(Boolean);
      if (replace) await db.query('DELETE FROM items');
      if (rows.length) await db.query(UPSERT, [JSON.stringify(rows)]);
      return res.status(200).json({ saved: rows.length, rejected: items.length - rows.length });
    }

    if (req.method === 'DELETE') {
      const { ids = [] } = body(req);
      if (!Array.isArray(ids)) return res.status(400).json({ error: 'Liste « ids » invalide.' });
      if (ids.length) await db.query('DELETE FROM items WHERE id = ANY($1::text[])', [ids.map(String)]);
      return res.status(200).json({ deleted: ids.length });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  } catch (e) {
    return fail(res, e);
  }
}
