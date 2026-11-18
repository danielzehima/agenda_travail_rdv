// Appel de l'assistant Claude (serveur /api/assistant).
// Renvoie null si Claude n'est pas disponible (pas de serveur, pas de clé,
// pas de réseau…) : l'app utilise alors l'assistant simple intégré.
import { api } from './sync.js';
import { toKey } from './dates.js';

export async function askClaude(text, items, now = new Date()) {
  const from = toKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14));
  const to = toKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 120));
  const relevant = items
    .filter((i) => i.date >= from && i.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 300);
  try {
    const r = await api('POST', 'assistant', {
      text,
      items: relevant,
      today: toKey(now),
      time: now.toTimeString().slice(0, 5),
      weekday: now.toLocaleDateString('fr-FR', { weekday: 'long' }),
    });
    return { reply: r.reply || '', actions: Array.isArray(r.actions) ? r.actions : [] };
  } catch (e) {
    // Claude configuré mais en échec (clé refusée, crédit épuisé, panne…) : on le signale
    if (e.reason && e.reason !== 'no_key') return { unavailable: e.message };
    return null;
  }
}

// Action Claude (update/delete/validate) → proposition à confirmer
export function toProposal(action, items) {
  const item = items.find((i) => i.id === action.item_id);
  if (!item) return null;
  const changes = {};
  if (action.kind === 'update') {
    for (const k of ['type', 'title', 'date', 'time', 'location', 'notes']) {
      if (action[k] !== null && action[k] !== undefined && action[k] !== item[k]) changes[k] = action[k];
    }
    if (!Object.keys(changes).length) return null;
  }
  return { action: action.kind, target: item.title, candidates: [item], changes };
}
