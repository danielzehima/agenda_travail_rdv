// /api/assistant : l'assistant de chantier, propulsé par Claude.
// Reçoit une phrase dictée + les éléments de l'agenda, renvoie des actions :
//   create   → nouvel élément (appliqué tout de suite, annulable)
//   update   → modification d'un élément existant   ┐ proposées à l'utilisateur,
//   delete   → suppression d'un élément existant    │ appliquées seulement
//   validate → marquer un élément comme fait        ┘ après « Confirmer »
// La clé ANTHROPIC_API_KEY reste côté serveur (variable Vercel).
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { authorized, body } from './_lib/http.js';

const MODEL = 'claude-opus-5-5';

const Action = z.object({
  kind: z.enum(['create', 'update', 'delete', 'validate']),
  item_id: z.string().nullable().describe("Identifiant d'un élément EXISTANT pour update/delete/validate ; null pour create"),
  type: z.enum(['travail', 'rdv', 'journal']).nullable(),
  title: z.string().nullable(),
  date: z.string().nullable().describe('AAAA-MM-JJ'),
  time: z.string().nullable().describe('HH:MM, "" pour aucune heure'),
  location: z.string().nullable(),
  notes: z.string().nullable(),
});

const Answer = z.object({
  reply: z.string().describe("Une phrase courte en français pour l'utilisateur"),
  actions: z.array(Action),
});

// Consignes stables (aucune donnée variable ici)
const SYSTEM = `Tu es l'assistant d'un chef de chantier qui gère son agenda à la voix, depuis son téléphone.
Il te dicte une note (souvent sans ponctuation, avec des erreurs de reconnaissance vocale). Tu la transformes en actions sur son agenda.

Types d'éléments :
- "travail" : une tâche à faire sur le chantier (couler, poser, monter du matériel, commander, appeler quelqu'un sans heure fixe…)
- "rdv" : un rendez-vous avec quelqu'un à un moment donné : réunion, visite, entretien, livraison ou passage à heure fixe
- "journal" : quelque chose déjà fait ou constaté (« j'ai fini… », « la dalle est coulée »)

Actions :
- "create" : un nouvel élément. Une note peut en contenir plusieurs : sépare chaque idée.
- "update" : modifier un élément EXISTANT (décaler, déplacer, changer l'heure, le titre, le lieu, les notes ou le type). Ne remplis que les champs qui changent ; mets null pour les autres.
- "delete" : supprimer un élément existant (« annule », « supprime »).
- "validate" : marquer un élément existant comme fait (« valide », « c'est fait », « j'ai terminé la chape » quand cette chape est déjà dans l'agenda).
Pour update/delete/validate, item_id est l'identifiant exact d'un élément de la liste fournie. Si plusieurs éléments peuvent correspondre et que la note ne permet pas de trancher, ne fais aucune action et pose la question dans "reply".

Règles :
- Dates relatives (demain, jeudi, la semaine prochaine…) calculées à partir de la date du jour fournie, au format AAAA-MM-JJ. Sans date : aujourd'hui, ou la date de l'idée précédente dans la même note.
- "time" en HH:MM, "" s'il n'y a pas d'heure. « L'après-midi » sans heure précise : 14:00.
- "title" : court, clair, à l'infinitif pour un travail (« Poser la chape »), sans la date ni l'heure. Corrige les fautes évidentes de dictée.
- "location" : le lieu ou la personne/entreprise concernée, sinon "".
- Une phrase qui complète un rendez-vous (« je dois lui rappeler… ») va dans les notes de ce rendez-vous, pas dans un nouvel élément.
- Une échéance (« pour demain à 8h ») qui concerne un objet et non le moment de l'action reste dans le titre ou les notes.
- "reply" : une phrase simple qui résume ce que tu as compris, ou une question si c'est ambigu. Pas de jargon.
- N'invente rien qui n'est pas dans la note.`;

let client = null;
export function setClient(c) { client = c; }
function getClient() {
  if (!client) client = new Anthropic(); // lit ANTHROPIC_API_KEY
  return client;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : null);

// Ne garde que des actions sûres et cohérentes avec l'agenda fourni
export function sanitizeActions(actions, items, today) {
  const ids = new Set(items.map((i) => i.id));
  const out = [];
  for (const a of actions || []) {
    const clean = {
      kind: a.kind,
      item_id: a.item_id || null,
      type: ['travail', 'rdv', 'journal'].includes(a.type) ? a.type : null,
      title: str(a.title, 300),
      date: DATE.test(a.date || '') ? a.date : null,
      time: a.time === '' ? '' : TIME.test(a.time || '') ? a.time : null,
      location: str(a.location, 300),
      notes: str(a.notes, 5000),
    };
    if (clean.kind === 'create') {
      if (!clean.title) continue;
      out.push({ ...clean, item_id: null, type: clean.type || 'travail', date: clean.date || today, time: clean.time ?? '', location: clean.location ?? '', notes: clean.notes ?? '' });
    } else if (['update', 'delete', 'validate'].includes(clean.kind) && ids.has(clean.item_id)) {
      out.push(clean);
    }
  }
  return out;
}

export function buildUserMessage({ text, items, today, time, weekday }) {
  const list = items.map((i) => ({
    id: i.id, type: i.type, title: i.title, date: i.date, time: i.time || '', location: i.location || '', notes: i.notes || '', fait: Boolean(i.validated),
  }));
  return `Aujourd'hui : ${weekday} ${today}, il est ${time}.

Agenda actuel (JSON) :
${JSON.stringify(list)}

Note dictée :
"""${text}"""`;
}

export default async function handler(req, res) {
  if (!authorized(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }
  if (!process.env.ANTHROPIC_API_KEY && !client) {
    return res.status(503).json({ error: 'no_key', message: "Clé ANTHROPIC_API_KEY absente : l'assistant simple est utilisé." });
  }

  const b = body(req);
  const text = str(b.text, 4000);
  const today = DATE.test(b.today || '') ? b.today : new Date().toISOString().slice(0, 10);
  const time = TIME.test(b.time || '') ? b.time : '08:00';
  const weekday = str(b.weekday, 20) || '';
  const items = Array.isArray(b.items) ? b.items.filter((i) => i && typeof i.id === 'string').slice(0, 300) : [];
  if (!text) return res.status(400).json({ error: 'Note vide.' });

  try {
    const response = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(Answer) },
      system: SYSTEM,
      messages: [{ role: 'user', content: buildUserMessage({ text, items, today, time, weekday }) }],
    });

    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      return res.status(422).json({ error: 'refusal', message: "L'assistant n'a pas pu traiter cette note." });
    }
    const { reply, actions } = response.parsed_output;
    return res.status(200).json({ reply: str(reply, 500) || '', actions: sanitizeActions(actions, items, today), by: 'claude' });
  } catch (e) {
    console.error(e);
    if (e instanceof Anthropic.AuthenticationError) return res.status(503).json({ error: 'bad_key', message: 'Clé ANTHROPIC_API_KEY refusée.' });
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'rate_limited', message: "Trop de demandes à l'assistant, réessayez dans un instant." });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ error: 'api_error', message: "L'assistant Claude est indisponible." });
    return res.status(500).json({ error: 'server', message: 'Erreur du serveur.' });
  }
}
