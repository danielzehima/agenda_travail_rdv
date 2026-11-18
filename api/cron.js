// /api/cron : appelé chaque heure par l'horloge (GitHub Actions et/ou Vercel Cron).
// Pour chaque fuseau horaire des appareils inscrits : envoie le programme du jour
// à l'heure du matin et le bilan à l'heure du soir, une seule fois par jour.
// Pas de mot de passe : sans effet si rien n'est dû, et chaque rappel ne part qu'une fois.
import { ready } from './_lib/db.js';
import { fail } from './_lib/http.js';
import { sendToAll } from './_lib/push.js';
import { localNow, dueSlot, morningMessage, eveningMessage } from './_lib/reminders.js';

export async function runReminders({ now = new Date(), sender } = {}) {
  const db = await ready();
  const zones = (await db.query('SELECT DISTINCT timezone FROM push_subscriptions')).map((r) => r.timezone);
  if (!zones.length) return { zones: 0, sent: [] };
  const app = (await db.query("SELECT value FROM settings WHERE key = 'app'"))[0]?.value || {};
  const hours = { morningHour: app.morningHour ?? 7, eveningHour: app.eveningHour ?? 17 };
  const out = [];
  for (const tz of zones) {
    const local = localNow(tz, now);
    const done = new Set((await db.query('SELECT slot FROM reminder_log WHERE day = $1 AND timezone = $2', [local.day, tz])).map((r) => r.slot));
    const slot = dueSlot(local, hours, done);
    if (!slot) continue;
    // Réserver l'envoi d'abord : deux appels simultanés n'enverront pas deux fois
    const claimed = await db.query(
      'INSERT INTO reminder_log (day, slot, timezone) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING slot',
      [local.day, slot, tz],
    );
    if (!claimed.length) continue;
    const items = await db.query(`SELECT id, type, title, to_char(date, 'YYYY-MM-DD') AS date, time, validated FROM items
      WHERE date >= ($1::date - 30) AND date <= $1::date`, [local.day]);
    const msg = slot === 'morning' ? morningMessage(items, local.day) : eveningMessage(items, local.day);
    const r = await sendToAll({ ...msg, url: slot === 'evening' ? '/#bilan' : '/#aujourdhui', tag: slot === 'morning' ? `morning:${local.day}` : `evening-validate:${local.day}` }, { timezone: tz, sender });
    out.push({ timezone: tz, day: local.day, slot, ...r });
  }
  return { zones: zones.length, sent: out };
}

export default async function handler(req, res) {
  try {
    const r = await runReminders();
    res.setHeader('cache-control', 'no-store');
    return res.status(200).json(r);
  } catch (e) {
    return fail(res, e);
  }
}
