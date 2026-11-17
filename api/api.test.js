import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { setSql } from './_lib/db.js';
import items from './items.js';
import settings from './settings.js';

process.env.APP_PASSWORD = 'secret';

before(async () => {
  const pg = new PGlite();
  setSql({ query: async (t, p) => (await pg.query(t, p)).rows });
});

function call(handler, { method = 'GET', body, pw = 'secret' } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(d) { resolve({ status: this.statusCode, data: d }); return this; },
    };
    handler({ method, body, headers: { 'x-app-password': pw } }, res);
  });
}

test('mot de passe requis', async () => {
  const r = await call(items, { pw: 'faux' });
  assert.equal(r.status, 401);
});

test('créer, lire, modifier, supprimer', async () => {
  let r = await call(items);
  assert.deepEqual(r.data.items, []);

  r = await call(items, { method: 'POST', body: { items: [
    { id: 'a', type: 'rdv', title: 'Réunion plombier', date: '2026-11-18', time: '10:00', location: 'Dupont', notes: '', validated: false },
    { id: 'b', type: 'travail', title: 'Carrelage', date: '2026-11-17', time: '', validated: true, validatedAt: '2026-11-17T09:00:00.000Z' },
    { id: 'x', type: 'inconnu', title: 'rejeté', date: '2026-11-17' },
  ] } });
  assert.deepEqual(r.data, { saved: 2, rejected: 1 });

  r = await call(items);
  assert.equal(r.data.items.length, 2);
  assert.equal(r.data.items[0].id, 'b'); // trié par date
  assert.equal(r.data.items[0].validatedAt, '2026-11-17T09:00:00.000Z');
  assert.equal(r.data.items[1].date, '2026-11-18');
  assert.equal(r.data.items[1].time, '10:00');

  await call(items, { method: 'POST', body: { items: [{ ...r.data.items[1], validated: true, validatedAt: '2026-11-18T10:30:00.000Z' }] } });
  r = await call(items);
  assert.equal(r.data.items.find((i) => i.id === 'a').validated, true);

  await call(items, { method: 'DELETE', body: { ids: ['a'] } });
  r = await call(items);
  assert.deepEqual(r.data.items.map((i) => i.id), ['b']);

  await call(items, { method: 'POST', body: { replace: true, items: [{ id: 'c', type: 'journal', title: 'Dalle coulée', date: '2026-11-16' }] } });
  r = await call(items);
  assert.deepEqual(r.data.items.map((i) => i.id), ['c']);
});

test('réglages', async () => {
  let r = await call(settings);
  assert.deepEqual(r.data.settings, {});
  await call(settings, { method: 'PUT', body: { settings: { siteName: 'Les Acacias', morningHour: 6, eveningHour: 99, notifications: true } } });
  r = await call(settings);
  assert.deepEqual(r.data.settings, { siteName: 'Les Acacias', morningHour: 6 });
});

test('diagnostic', async () => {
  const { default: health } = await import('./health.js');
  process.env.DATABASE_URL = 'postgresql://test';
  const r = await call(health);
  assert.equal(r.data.database, 'ok');
  assert.equal(r.data.password, 'configuré');
  assert.equal(typeof r.data.items, 'number');
});
