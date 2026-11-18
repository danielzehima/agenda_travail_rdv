import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { setSql, ready } from './_lib/db.js';
import { localNow, dueSlot, morningMessage, eveningMessage } from './_lib/reminders.js';
import { runReminders } from './cron.js';

const day = '2026-11-19';
const items = [
  { id: 'a', type: 'travail', title: 'Faire monter le sable', date: day, time: '08:00', validated: true },
  { id: 'b', type: 'travail', title: 'Poser la chape', date: day, time: '10:00', validated: false },
  { id: 'c', type: 'rdv', title: 'Réunion avec mon patron', date: day, time: '14:00', validated: false },
  { id: 'd', type: 'travail', title: 'Commander le ciment', date: '2026-11-17', time: '', validated: false },
];

test('heure locale selon le fuseau', () => {
  const t = new Date('2026-11-19T06:30:00Z');
  assert.deepEqual(localNow('Africa/Abidjan', t), { day, hour: 6, minute: 30 });
  assert.deepEqual(localNow('Europe/Paris', t), { day, hour: 7, minute: 30 });
});

test('quel rappel est dû', () => {
  const h = { morningHour: 7, eveningHour: 17 };
  assert.equal(dueSlot({ hour: 6 }, h, new Set()), null);
  assert.equal(dueSlot({ hour: 7 }, h, new Set()), 'morning');
  assert.equal(dueSlot({ hour: 8 }, h, new Set(['morning'])), null);
  assert.equal(dueSlot({ hour: 12 }, h, new Set()), null); // trop tard pour le programme du matin
  assert.equal(dueSlot({ hour: 17 }, h, new Set(['morning'])), 'evening');
  assert.equal(dueSlot({ hour: 18 }, h, new Set(['morning', 'evening'])), null);
});

test('message du matin', () => {
  const m = morningMessage(items, day);
  assert.equal(m.title, 'Programme du jour : 2 travaux et 1 rendez-vous');
  assert.equal(m.body, '08:00 Faire monter le sable · 10:00 Poser la chape · 14:00 Réunion avec mon patron\n+ 1 en retard');
  assert.match(morningMessage([], day).title, /rien de prévu/);
});

test('message du soir', () => {
  const m = eveningMessage(items, day);
  assert.equal(m.title, 'Fin de journée : 1/3 validés');
  assert.equal(m.body, 'Le programme a-t-il été exécuté ? À valider : 10:00 Poser la chape · 14:00 Réunion avec mon patron');
  const all = eveningMessage(items.map((i) => ({ ...i, validated: true })), day);
  assert.match(all.title, /Bravo : 3\/3/);
});

test('l’horloge envoie au bon moment, une seule fois, par fuseau', async () => {
  const pg = new PGlite();
  setSql({ query: async (t, p) => (await pg.query(t, p)).rows });
  const db = await ready();
  for (const i of items) {
    await db.query('INSERT INTO items (id, type, title, date, time, validated) VALUES ($1,$2,$3,$4,$5,$6)', [i.id, i.type, i.title, i.date, i.time, i.validated]);
  }
  const sub = (n) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'x', auth: 'y' } });
  await db.query("INSERT INTO push_subscriptions (endpoint, subscription, timezone) VALUES ($1, $2::jsonb, 'Africa/Abidjan')", [sub(1).endpoint, JSON.stringify(sub(1))]);
  await db.query("INSERT INTO push_subscriptions (endpoint, subscription, timezone) VALUES ($1, $2::jsonb, 'Europe/Paris')", [sub(2).endpoint, JSON.stringify(sub(2))]);

  const got = [];
  const sender = async (s, payload) => { got.push({ to: s.endpoint, ...JSON.parse(payload) }); };

  // 06:10 UTC : 6h10 à Abidjan (rien), 7h10 à Paris (programme)
  await runReminders({ now: new Date('2026-11-19T06:10:00Z'), sender });
  assert.deepEqual(got.map((g) => [g.to, g.tag]), [['https://push.example/2', `morning:${day}`]]);
  // Une heure plus tard : programme pour Abidjan, rien de plus pour Paris
  await runReminders({ now: new Date('2026-11-19T07:05:00Z'), sender });
  assert.equal(got.length, 2);
  assert.equal(got[1].to, 'https://push.example/1');
  assert.equal(got[1].title, 'Programme du jour : 2 travaux et 1 rendez-vous');
  // Rappel répété : rien ne repart
  await runReminders({ now: new Date('2026-11-19T07:40:00Z'), sender });
  assert.equal(got.length, 2);
  // 17h à Abidjan : bilan, qui ouvre la page de validation
  await runReminders({ now: new Date('2026-11-19T17:02:00Z'), sender });
  const ev = got.find((g) => g.tag === `evening-validate:${day}` && g.to.endsWith('/1'));
  assert.equal(ev.title, 'Fin de journée : 1/3 validés');
  assert.equal(ev.url, '/#bilan');
});

test('inscription expirée supprimée', async () => {
  const db = await ready();
  const { sendToAll } = await import('./_lib/push.js');
  const r = await sendToAll({ title: 't' }, { sender: async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); } });
  assert.equal(r.sent, 0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM push_subscriptions'))[0].n, 0);
});
