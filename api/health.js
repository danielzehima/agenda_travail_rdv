// /api/health : diagnostic sans secret. Indique si le mot de passe et la base
// Neon sont configurés, et si la base répond. N'affiche jamais de valeur.
import { ready } from './_lib/db.js';

export default async function handler(req, res) {
  const out = {
    server: 'ok',
    password: process.env.APP_PASSWORD ? 'configuré' : 'manquant (ajoutez APP_PASSWORD)',
    database: 'non testée',
    assistant: process.env.ANTHROPIC_API_KEY ? 'Claude configuré' : 'assistant simple (ANTHROPIC_API_KEY absente)',
  };
  if (!(process.env.DATABASE_URL || process.env.POSTGRES_URL)) {
    out.database = 'manquante (reliez Neon au projet : DATABASE_URL absent)';
  } else {
    try {
      const db = await ready();
      const [row] = await db.query('SELECT count(*)::int AS n FROM items');
      out.database = 'ok';
      out.items = row.n;
    } catch (e) {
      console.error(e);
      out.database = 'erreur de connexion à Neon';
    }
  }
  res.setHeader('cache-control', 'no-store');
  res.status(200).json(out);
}
