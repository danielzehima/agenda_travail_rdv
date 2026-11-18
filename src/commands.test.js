import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCommand, applyCommand } from './commands.js';

const now = new Date(2026, 10, 18, 9, 0); // mercredi 18 novembre 2026
const items = [
  { id: 'r1', type: 'rdv', title: 'Réunion avec mon patron', date: '2026-11-18', time: '14:00', location: 'mon patron', validated: false },
  { id: 't1', type: 'travail', title: 'Poser la chape', date: '2026-11-18', time: '10:00', location: '', validated: false },
  { id: 't2', type: 'travail', title: 'Faire monter du sable au 5è étage', date: '2026-11-18', time: '08:00', location: '', validated: false },
  { id: 'r2', type: 'rdv', title: 'Rendez-vous avec le plombier', date: '2026-11-19', time: '10:00', location: 'le plombier', validated: false },
  { id: 'r3', type: 'rdv', title: 'Rendez-vous avec le plombier', date: '2026-11-24', time: '09:00', location: 'le plombier', validated: false },
];

test('pas une commande : renvoie null', () => {
  assert.equal(detectCommand('demain réunion avec le client à 10h', items, now), null);
});

test('décaler à une autre heure', () => {
  const c = detectCommand('décale la réunion avec mon patron à 16h', items, now);
  assert.equal(c.action, 'update');
  assert.deepEqual(c.candidates.map((i) => i.id), ['r1']);
  assert.deepEqual(c.changes, { time: '16:00' });
  assert.equal(applyCommand(c, c.candidates[0], now).time, '16:00');
});

test('déplacer à un autre jour', () => {
  const c = detectCommand('déplace la chape à jeudi', items, now);
  assert.deepEqual(c.candidates.map((i) => i.id), ['t1']);
  assert.deepEqual(c.changes, { date: '2026-11-19' });
});

test('formule polie et date + heure', () => {
  const c = detectCommand('tu peux reporter la réunion avec le patron à vendredi 9h', items, now);
  assert.deepEqual(c.candidates.map((i) => i.id), ['r1']);
  assert.deepEqual(c.changes, { date: '2026-11-20', time: '09:00' });
});

test('décalage relatif', () => {
  const c = detectCommand("repousse la chape d'une heure", items, now);
  assert.equal(applyCommand(c, c.candidates[0], now).time, '11:00');
  const c2 = detectCommand('avance le sable de 30 minutes', items, now);
  assert.equal(applyCommand(c2, c2.candidates[0], now).time, '07:30');
  const c3 = detectCommand('repousse la réunion avec mon patron de 2 jours', items, now);
  assert.equal(applyCommand(c3, c3.candidates[0], now).date, '2026-11-20');
});

test('plusieurs éléments possibles : on demande lequel', () => {
  const c = detectCommand('annule le rendez-vous avec le plombier', items, now);
  assert.equal(c.action, 'delete');
  assert.deepEqual(c.candidates.map((i) => i.id), ['r2', 'r3']);
});

test('un indice de date choisit le bon', () => {
  const c = detectCommand('annule le rendez-vous du plombier de jeudi', items, now);
  assert.deepEqual(c.candidates.map((i) => i.id), ['r2']);
});

test('valider', () => {
  const c = detectCommand('valide la pose de la chape', items, now);
  assert.equal(c.action, 'validate');
  assert.deepEqual(c.candidates.map((i) => i.id), ['t1']);
  assert.equal(applyCommand(c, c.candidates[0], now).validated, true);
});

test('rien de correspondant', () => {
  assert.match(detectCommand('annule la visite du notaire', items, now).error, /pas trouvé/);
});

test('déplacement sans nouvelle valeur', () => {
  assert.match(detectCommand('décale la chape', items, now).error, /nouvelle date ou heure/);
});

test('« la réunion de demain à 16h » : demain identifie, 16h est la nouvelle heure', () => {
  const c = detectCommand('décale la réunion de demain à 16h', [...items, { id: 'r4', type: 'rdv', title: 'Réunion de chantier', date: '2026-11-19', time: '08:00', validated: false }], now);
  assert.deepEqual(c.candidates.map((i) => i.id), ['r4']);
  assert.deepEqual(c.changes, { time: '16:00' });
});

test('décalage annoncé avant l’élément', () => {
  const c = detectCommand('repousse de 2 jours la réunion avec mon patron', items, now);
  assert.equal(c.changes.shiftMinutes, 2 * 1440);
  assert.deepEqual(c.candidates.map((i) => i.id), ['r1']);
});
