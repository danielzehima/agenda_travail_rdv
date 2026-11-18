import { test } from 'node:test';
import assert from 'node:assert/strict';
import assistant, { setClient, sanitizeActions, buildUserMessage } from './assistant.js';

process.env.APP_PASSWORD = 'secret';

const items = [
  { id: 'r1', type: 'rdv', title: 'Réunion avec mon patron', date: '2026-11-19', time: '14:00', location: 'mon patron', notes: '', validated: false },
  { id: 't1', type: 'travail', title: 'Poser la chape', date: '2026-11-19', time: '10:00', location: '', notes: '', validated: false },
];

function call(b, pw = 'secret') {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, setHeader() {},
      status(c) { this.statusCode = c; return this; },
      json(d) { resolve({ status: this.statusCode, data: d }); return this; },
    };
    assistant({ method: 'POST', body: b, headers: { 'x-app-password': pw } }, res);
  });
}

function fakeClient(answer, capture = {}) {
  return { beta: { messages: { parse: async (params) => { capture.params = params; return answer; } } } };
}

test('mot de passe requis', async () => {
  assert.equal((await call({ text: 'x' }, 'faux')).status, 401);
});

test('requête envoyée à Claude : modèle, sortie structurée, repli, contexte', async () => {
  const cap = {};
  setClient(fakeClient({ stop_reason: 'end_turn', parsed_output: { reply: 'ok', actions: [] } }, cap));
  await call({ text: 'décale la réunion à 16h', items, today: '2026-11-18', time: '09:00', weekday: 'mercredi' });
  const p = cap.params;
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(p.output_config.effort, 'low');
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.equal(p.thinking, undefined); // toujours actif sur ce modèle : on ne l'envoie pas
  assert.match(p.messages[0].content, /mercredi 2026-11-18/);
  assert.match(p.messages[0].content, /"id":"r1"/);
  assert.match(p.messages[0].content, /décale la réunion à 16h/);
});

test('actions renvoyées et nettoyées', async () => {
  setClient(fakeClient({ stop_reason: 'end_turn', parsed_output: { reply: 'Je décale la réunion à 16h.', actions: [
    { kind: 'update', item_id: 'r1', type: null, title: null, date: null, time: '16:00', location: null, notes: null },
    { kind: 'update', item_id: 'inconnu', type: null, title: null, date: null, time: '16:00', location: null, notes: null },
    { kind: 'create', item_id: null, type: 'travail', title: 'Commander le sable', date: '2026-11-20', time: '', location: null, notes: null },
  ] } }));
  const r = await call({ text: 'x', items, today: '2026-11-18', time: '09:00', weekday: 'mercredi' });
  assert.equal(r.status, 200);
  assert.equal(r.data.reply, 'Je décale la réunion à 16h.');
  assert.deepEqual(r.data.actions.map((a) => [a.kind, a.item_id, a.time]), [['update', 'r1', '16:00'], ['create', null, '']]);
});

test('refus → 422 (l’app bascule sur l’assistant simple)', async () => {
  setClient(fakeClient({ stop_reason: 'refusal', parsed_output: null }));
  assert.equal((await call({ text: 'x', items })).status, 422);
});

test('nettoyage : dates/heures invalides, création sans titre', () => {
  const out = sanitizeActions([
    { kind: 'create', item_id: 'zz', type: 'bizarre', title: ' Couler la dalle ', date: '18/11', time: '25:00', location: null, notes: null },
    { kind: 'create', item_id: null, type: 'rdv', title: '', date: null, time: null, location: null, notes: null },
    { kind: 'delete', item_id: 't1', type: null, title: null, date: null, time: null, location: null, notes: null },
  ], items, '2026-11-18');
  assert.deepEqual(out, [
    { kind: 'create', item_id: null, type: 'travail', title: 'Couler la dalle', date: '2026-11-18', time: '', location: '', notes: '' },
    { kind: 'delete', item_id: 't1', type: null, title: null, date: null, time: null, location: null, notes: null },
  ]);
});

test('message utilisateur', () => {
  const m = buildUserMessage({ text: 'bonjour', items: [], today: '2026-11-18', time: '09:00', weekday: 'mercredi' });
  assert.match(m, /Agenda actuel/);
});
