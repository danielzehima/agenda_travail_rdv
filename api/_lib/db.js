// Connexion à Neon (Lakebase Postgres). La chaîne de connexion reste côté
// serveur (variable d'environnement), jamais dans le navigateur.
// Sur Vercel : node-postgres + attachDatabasePool (recommandation Neon pour
// Vercel Fluid compute), avec la chaîne « pooled » DATABASE_URL.
import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';

let sql = null;
let schemaReady = null;

// Pour les tests : on peut injecter une autre base (PGlite).
export function setSql(custom) {
  sql = custom;
  schemaReady = null;
}

export function getSql() {
  if (!sql) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw Object.assign(new Error('DATABASE_URL manquant : reliez une base Neon au projet Vercel.'), { status: 503 });
    const pool = new pg.Pool({
      connectionString: url,
      max: 5,
      idleTimeoutMillis: 10_000,
      // Neon fournit des chaînes avec channel_binding=require : on l'active côté client
      enableChannelBinding: /channel_binding=require/.test(url),
    });
    attachDatabasePool(pool);
    sql = { query: async (text, params) => (await pool.query(text, params)).rows };
  }
  return sql;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS items (
    id text PRIMARY KEY,
    type text NOT NULL CHECK (type IN ('travail', 'rdv', 'journal')),
    title text NOT NULL,
    date date NOT NULL,
    time text NOT NULL DEFAULT '',
    location text NOT NULL DEFAULT '',
    notes text NOT NULL DEFAULT '',
    validated boolean NOT NULL DEFAULT false,
    validated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  'CREATE INDEX IF NOT EXISTS items_date ON items (date)',
  `CREATE TABLE IF NOT EXISTS settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
];

// Crée les tables au premier appel : rien à faire à la main dans Neon.
export async function ready() {
  const db = getSql();
  if (!schemaReady) {
    schemaReady = (async () => { for (const q of SCHEMA) await db.query(q); })().catch((e) => { schemaReady = null; throw e; });
  }
  await schemaReady;
  return db;
}
