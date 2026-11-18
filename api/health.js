// /api/health : diagnostic sans secret. Indique si le mot de passe et la base
// Neon sont configurés, et si la base répond. N'affiche jamais de valeur.
import Anthropic from '@anthropic-ai/sdk';
import { ready } from './_lib/db.js';

// Vérifie la clé Claude par un appel gratuit (infos du modèle), mis en cache 10 min
let keyCheck = { at: 0, result: null };
async function checkClaudeKey() {
  if (!process.env.ANTHROPIC_API_KEY) return 'assistant simple (ANTHROPIC_API_KEY absente)';
  if (keyCheck.result && Date.now() - keyCheck.at < 600_000) return keyCheck.result;
  let result;
  try {
    await new Anthropic().models.retrieve('claude-opus-5-5');
    result = 'Claude configuré, clé valide';
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) result = 'clé ANTHROPIC_API_KEY refusée (mal copiée ou supprimée)';
    else if (e instanceof Anthropic.PermissionDeniedError) result = "clé valide mais sans accès à ce modèle";
    else if (e instanceof Anthropic.APIError) result = `Claude injoignable pour l'instant (${e.status ?? 'réseau'})`;
    else result = "Claude injoignable pour l'instant";
  }
  keyCheck = { at: Date.now(), result };
  return result;
}

export default async function handler(req, res) {
  const out = {
    server: 'ok',
    password: process.env.APP_PASSWORD ? 'configuré' : 'manquant (ajoutez APP_PASSWORD)',
    database: 'non testée',
    assistant: await checkClaudeKey(),
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
