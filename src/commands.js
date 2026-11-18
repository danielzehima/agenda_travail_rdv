// Commandes vocales sur des éléments existants : décaler, annuler, valider.
// L'assistant PROPOSE seulement : rien n'est modifié sans la confirmation
// de l'utilisateur (voir VoiceCapture).
//
// Ex. : « décale la réunion avec mon patron à 16h »
//   → { action: 'update', item: <Réunion avec mon patron>, changes: { time: '16:00' } }

import { findDate, findTime } from './parse.js';
import { toKey, fromKey } from './dates.js';

const MOVE = '(?:décaler?|décale|déplacer?|déplace|repousser?|repousse|reporter?|reporte|avancer?|avance|changer?|change|modifier?|modifie|mettre|mets|passer?|passe|bouger|bouge)';
const CANCEL = '(?:annuler?|annule|supprimer?|supprime|effacer?|efface|enlever|enlève|retirer?|retire)';
const VALIDATE = '(?:valider?|valide|cocher?|coche|marquer?|marque)';
const POLITE = "(?:(?:est-ce que )?(?:tu peux|peux-tu|pourrais-tu|tu pourrais|il faut|je veux|je voudrais|on va|on doit|je dois)\\s+)?";

const RE = {
  update: new RegExp(`^${POLITE}${MOVE}(?!\\p{L})\\s+(.+)$`, 'iu'),
  delete: new RegExp(`^${POLITE}${CANCEL}(?!\\p{L})\\s+(.+)$`, 'iu'),
  validate: new RegExp(`^${POLITE}${VALIDATE}(?!\\p{L})\\s+(.+?)(?:\\s+comme\\s+(?:fait|faite|terminée?|validée?))?$`, 'iu'),
};

const STOP = new Set(['le', 'la', 'les', 'l', 'de', 'du', 'des', 'd', 'un', 'une', 'avec', 'a', 'au', 'aux', 'pour', 'et', 'en',
  'sur', 'mon', 'ma', 'mes', 'son', 'sa', 'ses', 'chez', 'ce', 'cet', 'cette', 'que', 'qui', 'prevu', 'prevue', 'lui', 'moi']);

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, ' ');
const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)).map((w) => w.replace(/(s|x)$/, ''));

const RDV_WORDS = /rendez|rdv|reunion|visite|entretien|rencontre/;

// Repérage d'un élément « de demain », « du 25 », « de 14h » : sert à identifier, pas à changer
const ID_HINT = /(?<!\p{L})(?:de|du|d['’])\s+((?:demain|aujourd['’]hui|après-demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|ce matin|cet après-midi|l['’]après-midi)|\d{1,2}(?:er)?\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)|\d{1,2}\s*h(?:\s*\d{2})?)(?!\p{L})/iu;
// Décalage relatif : « de 2 jours », « d'une heure », « de 30 minutes »
const SHIFT = /(?<!\p{L})(?:de|d['’])\s*(un|une|\d+)\s+(jours?|heures?|minutes?|semaines?)(?!\p{L})/iu;

function score(item, target, hint) {
  const want = tokens(target);
  if (!want.length) return 0;
  const have = new Set(tokens(`${item.title} ${item.location || ''}`));
  let hit = want.filter((w) => have.has(w)).length / want.length;
  if (RDV_WORDS.test(norm(target)) && item.type === 'rdv') hit += 0.15;
  if (hint?.date && item.date === hint.date) hit += 0.3;
  if (hint?.time && item.time === hint.time) hit += 0.3;
  return hit;
}

function addMinutes(item, minutes) {
  const [h, m] = (item.time || '08:00').split(':').map(Number);
  const d = fromKey(item.date);
  d.setHours(h, m + minutes, 0, 0);
  return { date: toKey(d), time: item.time ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '' };
}

export function detectCommand(text, items, now = new Date()) {
  const s = text.trim().replace(/[.!?]+$/, '');
  let action = null;
  let rest = '';
  for (const [a, re] of Object.entries(RE)) {
    const m = s.match(re);
    if (m) { action = a; rest = m[1]; break; }
  }
  if (!action) return null;

  // Indices d'identification (« la réunion de demain »)
  const hint = {};
  const id = rest.match(ID_HINT);
  // Pour un déplacement, « de demain » n'identifie que si la nouvelle valeur vient après
  const isHint = id && (action !== 'update' || /\S/.test(rest.slice(id.index + id[0].length)));
  if (isHint) {
    const d = findDate(id[1], now);
    const t = findTime(id[1]);
    if (d) hint.date = toKey(d.date);
    if (t) hint.time = t.time;
    rest = rest.replace(id[0], ' ');
  }

  // Nouvelle valeur (seulement pour un déplacement)
  const changes = {};
  let target = rest;
  if (action === 'update') {
    const sh = rest.match(SHIFT);
    if (sh) {
      const n = /^une?$/i.test(sh[1]) ? 1 : Number(sh[1]);
      const unit = sh[2].toLowerCase();
      const mins = unit.startsWith('minute') ? n : unit.startsWith('heure') ? n * 60 : unit.startsWith('semaine') ? n * 7 * 1440 : n * 1440;
      changes.shiftMinutes = /^avance/i.test(s.replace(new RegExp(`^${POLITE}`, 'iu'), '')) ? -mins : mins;
      target = target.replace(sh[0], ' ');
    } else {
      const d = findDate(rest, now);
      const t = findTime(rest);
      if (d) { changes.date = toKey(d.date); target = target.replace(d.match, ' '); }
      if (t) { changes.time = t.time; target = target.replace(t.match, ' '); }
    }
    target = target.replace(/(?<!\p{L})(?:à|a|au|pour|vers|plutôt|à la place|en)\s*$/iu, ' ');
    if (!Object.keys(changes).length) {
      return { action, error: "Je n'ai pas compris la nouvelle date ou heure. Exemple : « décale la réunion à 16h » ou « déplace la chape à jeudi »." };
    }
  }
  target = target.replace(/\s{2,}/g, ' ').trim();

  // Éléments candidats : de préférence non validés et pas trop anciens
  const today = toKey(now);
  const pool = items.filter((i) => (action === 'delete' || !i.validated || action === 'update') && i.date >= toKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)));
  const ranked = pool
    .map((item) => ({ item, s: score(item, target, hint) + (item.date >= today ? 0.05 : 0) }))
    .filter((r) => r.s >= 0.5)
    .sort((a, b) => b.s - a.s || a.item.date.localeCompare(b.item.date));
  if (!ranked.length) {
    return { action, error: `Je n'ai pas trouvé d'élément correspondant à « ${target} ».` };
  }
  const best = ranked[0].s;
  const candidates = ranked.filter((r) => best - r.s < 0.15).slice(0, 5).map((r) => r.item);
  return { action, target, changes, candidates };
}

// Nouvelle version de l'élément après la modification proposée
export function applyCommand(cmd, item, now = new Date()) {
  if (cmd.action === 'update') {
    const { shiftMinutes, ...fields } = cmd.changes;
    if (shiftMinutes) return { ...item, ...addMinutes(item, shiftMinutes) };
    const next = { ...item, ...fields };
    // Un élément qui devient « fait du jour » n'a plus de case à valider
    if (fields.type === 'journal') Object.assign(next, { validated: false, validatedAt: null });
    return next;
  }
  if (cmd.action === 'validate') return { ...item, validated: true, validatedAt: now.toISOString() };
  return null; // suppression
}
