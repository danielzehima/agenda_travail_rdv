// Notifications push (Web Push). Les clés VAPID sont créées au premier usage
// et rangées dans la base (table settings) : rien à configurer à la main.
import * as webpush from 'web-push';
import { ready } from './db.js';

let vapid = null;

export async function getVapid() {
  if (vapid) return vapid;
  const db = await ready();
  const rows = await db.query("SELECT value FROM settings WHERE key = 'vapid'");
  if (rows[0]?.value?.publicKey) {
    vapid = rows[0].value;
  } else {
    const keys = webpush.generateVAPIDKeys();
    await db.query("INSERT INTO settings (key, value) VALUES ('vapid', $1::jsonb) ON CONFLICT (key) DO NOTHING", [JSON.stringify(keys)]);
    vapid = (await db.query("SELECT value FROM settings WHERE key = 'vapid'"))[0].value; // si deux appels simultanés
  }
  return vapid;
}

// Envoie une notification à tous les appareils inscrits (filtrés par fuseau si donné).
// Les inscriptions expirées (404/410) sont supprimées.
export async function sendToAll(payload, { timezone, sender = webpush.sendNotification } = {}) {
  const db = await ready();
  const { publicKey, privateKey } = await getVapid();
  const subs = timezone
    ? await db.query('SELECT endpoint, subscription FROM push_subscriptions WHERE timezone = $1', [timezone])
    : await db.query('SELECT endpoint, subscription FROM push_subscriptions');
  let sent = 0;
  for (const s of subs) {
    try {
      await sender(s.subscription, JSON.stringify(payload), {
        TTL: 6 * 3600,
        urgency: 'high',
        vapidDetails: { subject: 'https://agenda-travail-rdv.vercel.app', publicKey, privateKey },
      });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [s.endpoint]);
      else console.error('push', e.statusCode, e.body || e.message);
    }
  }
  return { sent, total: subs.length };
}
