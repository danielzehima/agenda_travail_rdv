import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Send, Loader2, Undo2, Hammer, CalendarClock, NotebookPen, Bot } from 'lucide-react';
import { getCapability } from '../capabilities.js';
import { browserDictation } from '../speech.js';
import { interpret } from '../interpret.js';
import { formatLong } from '../dates.js';
import { TYPES } from '../store.js';
import { detectCommand } from '../commands.js';
import { askClaude, toProposal } from '../assistant.js';
import CommandProposal from './CommandProposal.jsx';
import AssistantMemory from './AssistantMemory.jsx';

const ICONS = { travail: Hammer, rdv: CalendarClock, journal: NotebookPen };
const SHORT = { travail: 'Travail', rdv: 'RDV', journal: 'Fait' };

export default function VoiceCapture({ items: allItems = [], onCreate, onUndo, onOpen, onChangeType, onCommand, onRestore }) {
  const [text, setText] = useState('');
  const [partial, setPartial] = useState('');
  const [dictation, setDictation] = useState(null);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { items, ids }
  const [queue, setQueue] = useState([]); // modifications en attente de confirmation, une à la fois
  const proposal = queue[0] || null;
  const nextProposal = () => setQueue((q) => q.slice(1));
  const [reply, setReply] = useState(''); // réponse de l'assistant Claude
  const [memoryKey, setMemoryKey] = useState(0); // pour rafraîchir la mémoire affichée
  const [done, setDone] = useState(null); // { action, before, after } après confirmation
  const [error, setError] = useState('');
  const textRef = useRef(null);

  // La dictée de claude.ai si disponible, sinon celle du navigateur
  useEffect(() => {
    let off = [];
    getCapability('dictation').then((cap) => {
      const d = cap || browserDictation();
      if (!d) return;
      setDictation(d);
      off = [
        d.onPartial(({ text: t }) => setPartial(t)),
        d.onFinal(({ text: t }) => { setPartial(''); setText((cur) => (cur ? `${cur} ${t}` : t)); }),
        d.onState(({ state, reason }) => {
          setListening(state === 'listening' || state === 'starting' || state === 'finishing');
          if (state === 'idle' && reason === 'not_granted') { setDictation(null); setError('Micro refusé : utilisez le micro de votre clavier.'); }
          if (state === 'idle' && reason === 'unavailable') setDictation(null);
          if (state === 'idle' && reason === 'upstream_error') setError('Le micro a rencontré un problème. Réessayez ou utilisez le micro du clavier.');
        }),
      ];
    });
    return () => off.forEach((f) => f?.());
  }, []);

  const toggleMic = () => {
    setError('');
    if (!dictation) {
      // Pas de dictée intégrée : on ouvre le clavier, qui a son propre micro
      textRef.current?.focus();
      setError('Touchez le micro de votre clavier pour dicter.');
      return;
    }
    if (listening) { dictation.stop().catch(() => {}); return; }
    dictation.start().catch((e) => {
      if (e?.code === 'not_granted' || e?.code === 'unavailable') {
        setDictation(null);
        textRef.current?.focus();
        setError('Dictée indisponible ici : touchez le micro de votre clavier.');
      }
    });
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (listening) await dictation.stop().catch(() => {});
    const note = (text + (partial ? ` ${partial}` : '')).trim();
    if (!note || busy) return;
    setError('');
    setResult(null);
    setDone(null);
    setReply('');
    setQueue([]);
    setBusy(true);
    try {
      // 1. Claude (serveur) : comprend la note et propose des actions
      const ai = await askClaude(note, allItems);
      if (ai?.unavailable) setReply(`${ai.unavailable} J'utilise l'assistant simple.`);
      if (ai && !ai.unavailable) {
        const creates = ai.actions.filter((a) => a.kind === 'create');
        const changes = ai.actions.filter((a) => a.kind !== 'create').map((a) => toProposal(a, allItems)).filter(Boolean);
        if (creates.length) {
          const fields = creates.map(({ type, title, date, time, location, notes }) => ({ type, title, date, time, location, notes }));
          const ids = onCreate(fields);
          setResult({ items: fields, ids });
        }
        setQueue(changes);
        setReply(ai.reply);
        setMemoryKey((k) => k + 1);
        if (creates.length || changes.length) { setText(''); setPartial(''); }
        return;
      }

      // 2. Sans Claude : assistant simple intégré
      const cmd = detectCommand(note, allItems);
      if (cmd) {
        if (cmd.error) { setError(cmd.error); return; }
        setQueue([cmd]);
        return;
      }
      const { items } = await interpret(note);
      if (!items.length) { setError("Je n'ai rien compris. Reformulez, par exemple : « demain à 10h réunion avec l'architecte »."); return; }
      const ids = onCreate(items);
      setResult({ items, ids });
      setText('');
      setPartial('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card voice">
      <form onSubmit={submit} className="voice-form">
        <button
          type="button"
          className={`mic ${listening ? 'on' : ''}`}
          onClick={toggleMic}
          aria-label={listening ? 'Arrêter la dictée' : 'Dicter une note'}
          title={listening ? 'Arrêter la dictée' : 'Dicter une note'}
        >
          {listening ? <Square size={20} /> : <Mic size={22} />}
        </button>
        <div className="voice-input">
          <label htmlFor="voice-text" className="voice-label">Dites-le à l'assistant</label>
          <textarea
            id="voice-text"
            ref={textRef}
            rows={2}
            value={text + (partial ? (text ? ' ' : '') + partial : '')}
            onChange={(e) => { setText(e.target.value); setPartial(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e); }}
            placeholder="Ex. : demain 10h réunion avec le plombier"
          />
        </div>
        <button type="submit" className="btn primary send" disabled={busy || !(text || partial).trim()} aria-label="Enregistrer">
          {busy ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
          <span>Enregistrer</span>
        </button>
      </form>

      {listening && <p className="voice-hint listening"><span className="pulse" />Je vous écoute… touchez ■ pour arrêter.</p>}
      {error && <p className="voice-hint">{error}</p>}

      <AssistantMemory refreshKey={memoryKey} />

      {reply && <p className="voice-reply"><Bot size={16} />{reply}</p>}

      {proposal && (
        <CommandProposal
          key={`${proposal.target}-${proposal.action}-${queue.length}`}
          cmd={proposal}
          remaining={queue.length - 1}
          onCancel={nextProposal}
          onConfirm={(change) => {
            onCommand(change);
            setDone(change);
            nextProposal();
            setText('');
            setPartial('');
          }}
        />
      )}

      {done && (
        <div className="voice-result">
          <div className="voice-result-head">
            <strong>{{ update: 'Modifié', delete: 'Supprimé', validate: 'Validé' }[done.action]} : « {done.before.title} »</strong>
            <button className="btn small" onClick={() => { onRestore(done.before); setDone(null); }}><Undo2 size={14} />Annuler</button>
          </div>
        </div>
      )}

      {result && (
        <div className="voice-result">
          <div className="voice-result-head">
            <strong>{result.items.length > 1 ? `${result.items.length} éléments enregistrés` : 'Enregistré'}</strong>
            <button className="btn small" onClick={() => { onUndo(result.ids); setResult(null); }}><Undo2 size={14} />Annuler</button>
          </div>
          <ul>
            {result.items.map((i, n) => {
              const Icon = ICONS[i.type];
              return (
                <li key={result.ids[n]}>
                  <button className="voice-item" style={{ '--tc': TYPES[i.type].color }} onClick={() => onOpen(result.ids[n])}>
                    <Icon size={15} />
                    <span className="vi-title">{i.title}</span>
                    <span className="vi-meta">{TYPES[i.type].label} · {formatLong(i.date)}{i.time ? ` à ${i.time}` : ''}{i.location ? ` · ${i.location}` : ''}</span>
                  </button>
                  <div className="vi-types" role="radiogroup" aria-label="Corriger le type">
                    {Object.entries(TYPES).map(([k, t]) => (
                      <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={i.type === k}
                        className={i.type === k ? 'active' : ''}
                        style={{ '--tc': t.color }}
                        onClick={() => {
                          if (i.type === k) return;
                          onChangeType(result.ids[n], k);
                          setResult((r) => ({ ...r, items: r.items.map((it, j) => (j === n ? { ...it, type: k } : it)) }));
                        }}
                      >{SHORT[k]}</button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
