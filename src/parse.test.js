import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNote } from './parse.js';

const now = new Date(2026, 10, 17, 9, 0); // mardi 17 novembre 2026

test('rendez-vous demain avec heure', () => {
  const [i] = parseNote('Demain à 10h rendez-vous avec le plombier', now);
  assert.equal(i.type, 'rdv');
  assert.equal(i.date, '2026-11-18');
  assert.equal(i.time, '10:00');
  assert.equal(i.title, 'Rendez-vous avec le plombier');
  assert.equal(i.location, 'le plombier');
});

test('journal du jour', () => {
  const [i] = parseNote("J'ai terminé le coulage de la dalle", now);
  assert.equal(i.type, 'journal');
  assert.equal(i.date, '2026-11-17');
});

test('travail à un jour de la semaine', () => {
  const [i] = parseNote('Pose du carrelage vendredi', now);
  assert.equal(i.type, 'travail');
  assert.equal(i.date, '2026-11-20');
  assert.equal(i.title, 'Pose du carrelage');
});

test('date explicite et heure et demie', () => {
  const [i] = parseNote('Réunion de chantier le 25 novembre à 14h30', now);
  assert.equal(i.type, 'rdv');
  assert.equal(i.date, '2026-11-25');
  assert.equal(i.time, '14:30');
  assert.equal(i.title, 'Réunion de chantier');
});

test('plusieurs phrases', () => {
  const items = parseNote("J'ai fini le ferraillage. Demain 8h livraison des parpaings", now);
  assert.equal(items.length, 2);
  assert.equal(items[0].type, 'journal');
  assert.equal(items[1].date, '2026-11-18');
  assert.equal(items[1].time, '08:00');
});

test('formule « il faut »', () => {
  const [i] = parseNote('Il faut commander le ciment', now);
  assert.equal(i.title, 'Commander le ciment');
  assert.equal(i.type, 'travail');
});

// Dictées telles que le micro de Chrome les renvoie : minuscules, sans ponctuation
const kinds = (t) => parseNote(t, now).map((i) => [i.type, i.title, i.date, i.time]);

test('dictée sans ponctuation : travail puis rendez-vous', () => {
  assert.deepEqual(kinds("demain je dois couler la dalle et à 14h j'ai rendez-vous avec l'architecte"), [
    ['travail', 'Couler la dalle', '2026-11-18', ''],
    ['rdv', "Rendez-vous avec l'architecte", '2026-11-18', '14:00'],
  ]);
});

test('« puis » garde la date de la phrase précédente', () => {
  assert.deepEqual(kinds('demain pose du carrelage puis réunion de chantier à 16h'), [
    ['travail', 'Pose du carrelage', '2026-11-18', ''],
    ['rdv', 'Réunion de chantier', '2026-11-18', '16:00'],
  ]);
});

test('fait du jour puis livraison à heure fixe', () => {
  assert.deepEqual(kinds("j'ai fini le ferraillage et demain livraison du béton à 8h"), [
    ['journal', "J'ai fini le ferraillage", '2026-11-17', ''],
    ['rdv', 'Livraison du béton', '2026-11-18', '08:00'],
  ]);
});

test('appeler sans heure = tâche, avec heure = rendez-vous', () => {
  assert.equal(kinds('appeler le fournisseur pour les tuiles')[0][0], 'travail');
  assert.equal(kinds('appeler le fournisseur à 15h')[0][0], 'rdv');
});

test('un travail avec une entreprise et une heure reste un travail', () => {
  assert.deepEqual(kinds("jeudi à 9h installer les fenêtres avec l'entreprise dupont")[0].slice(0, 2), ['travail', "Installer les fenêtres avec l'entreprise dupont"]);
});

test('« et » à l’intérieur d’une même tâche ne coupe pas', () => {
  assert.deepEqual(kinds('acheter du ciment et du sable'), [['travail', 'Acheter du ciment et du sable', '2026-11-17', '']]);
});

test('visite et réunion = rendez-vous', () => {
  assert.equal(kinds('vendredi visite du bureau de contrôle à 11h')[0][0], 'rdv');
  assert.equal(kinds("j'ai une réunion avec le client lundi")[0][0], 'rdv');
});

test('passé sans « j’ai »', () => {
  assert.equal(kinds('la dalle est coulée')[0][0], 'journal');
  assert.equal(kinds('il faut que la dalle soit coulée demain')[0][0], 'travail');
});

test('trois idées dans une seule dictée', () => {
  assert.deepEqual(kinds("ce matin on a posé les parpaings et cet après-midi réunion avec le maître d'ouvrage à 15h et demain commander le sable").map((i) => i[0]), ['journal', 'rdv', 'travail']);
});
