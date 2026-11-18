// /api/push
//   GET              → { publicKey }               (clé publique pour s'inscrire)
//   POST { subscription, timezone } → inscrit cet appareil aux rappels
//   POST { test: true }             → envoie une notification de test
//   DELETE { endpoint }             → désinscrit cet appareil
import { ready } from './_lib/db.js';
import { authorized, body, fail } from './_lib/http.js';
import { getVapid, sendToAll } from './_lib/push.js';
import { validTimeZone } from './_lib/reminders.js';

export default async function handler(req, res) {
  if (!authorized(req, res)) return;
  try {
    const db = await ready();
    if (req.method === 'GET') {
      const { publicKey } = await getVapid();
      const [{ n }] = await db.query('SELECT count(*)::int AS n FROM push_subscriptions');
      return res.status(200).json({ publicKey, devices: n });
    }
    const b = body(req);
    if (req.method === 'POST' && b.test) {
      const r = await sendToAll({ title: 'Notifications activées', body: 'Vous recevrez le programme du jour et le bilan du soir.', url: '/#aujourdhui', tag: 'test' });
      return res.status(200).json(r);
    }
    if (req.method === 'POST') {
      const sub = b.subscription;
      if (!sub || typeof sub.endpoint !== 'string' || !sub.keys?.p256dh || !sub.keys?.auth) return res.status(400).json({ error: 'Inscription invalide.' });
      const tz = validTimeZone(b.timezone) ? b.timezone : 'UTC';
      await db.query(
        `INSERT INTO push_subscriptions (endpoint, subscription, timezone) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (endpoint) DO UPDATE SET subscription = EXCLUDED.subscription, timezone = EXCLUDED.timezone`,
        [sub.endpoint, JSON.stringify(sub), tz],
      );
      return res.status(200).json({ subscribed: true, timezone: tz });
    }
    if (req.method === 'DELETE') {
      if (typeof b.endpoint === 'string') await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [b.endpoint]);
      return res.status(200).json({ unsubscribed: true });
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  } catch (e) {
    return fail(res, e);
  }
}
