import { useState } from 'react';
import { ArrowRight, Check, X, CalendarClock, Trash2, CheckCircle2 } from 'lucide-react';
import { applyCommand } from '../commands.js';
import { fromKey } from '../dates.js';

const TYPE_LABEL = { travail: 'Travail', rdv: 'Rendez-vous', journal: 'Fait du jour' };
const VERB = { update: 'Modifier', delete: 'Supprimer', validate: 'Valider' };
const ICON = { update: CalendarClock, delete: Trash2, validate: CheckCircle2 };

const when = (i) => {
  const d = fromKey(i.date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  return i.time ? `${d} à ${i.time}` : d;
};

// Carte de confirmation : l'assistant propose, l'utilisateur décide.
export default function CommandProposal({ cmd, remaining = 0, onConfirm, onCancel }) {
  const [chosen, setChosen] = useState(cmd.candidates.length === 1 ? cmd.candidates[0].id : null);
  const item = cmd.candidates.find((i) => i.id === chosen);
  const after = item ? applyCommand(cmd, item) : null;
  const Icon = ICON[cmd.action];

  return (
    <div className={`proposal ${cmd.action}`} role="dialog" aria-label="Confirmer la modification">
      <div className="proposal-head">
        <Icon size={16} />
        <strong>{VERB[cmd.action]} {cmd.candidates.length > 1 && !item ? 'quel élément ?' : 'cet élément ?'}</strong>
        {remaining > 0 && <span className="proposal-count">encore {remaining} ensuite</span>}
      </div>

      {cmd.candidates.length > 1 && (
        <ul className="proposal-choices">
          {cmd.candidates.map((c) => (
            <li key={c.id}>
              <button type="button" className={c.id === chosen ? 'active' : ''} aria-pressed={c.id === chosen} onClick={() => setChosen(c.id)}>
                <span className="pc-title">{c.title}</span>
                <span className="pc-meta">{when(c)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {item && (
        <div className="proposal-change">
          <div className="pc-title">« {item.title} »</div>
          {cmd.action === 'update' && (after.date !== item.date || after.time !== item.time) && (
            <div className="pc-diff"><span className="old">{when(item)}</span><ArrowRight size={14} /><span className="new">{when(after)}</span></div>
          )}
          {cmd.action === 'update' && after.title !== item.title && (
            <div className="pc-diff">Titre : <span className="old">{item.title}</span><ArrowRight size={14} /><span className="new">{after.title}</span></div>
          )}
          {cmd.action === 'update' && after.type !== item.type && (
            <div className="pc-diff">Type : <span className="old">{TYPE_LABEL[item.type]}</span><ArrowRight size={14} /><span className="new">{TYPE_LABEL[after.type]}</span></div>
          )}
          {cmd.action === 'update' && (after.location || '') !== (item.location || '') && (
            <div className="pc-diff">Lieu : <span className="new">{after.location || '(aucun)'}</span></div>
          )}
          {cmd.action === 'update' && (after.notes || '') !== (item.notes || '') && (
            <div className="pc-diff">Notes : <span className="new">{after.notes || '(aucune)'}</span></div>
          )}
          {cmd.action === 'delete' && <div className="pc-diff"><span className="old">{when(item)}</span> sera supprimé</div>}
          {cmd.action === 'validate' && <div className="pc-diff">{when(item)} sera marqué comme fait</div>}
        </div>
      )}

      <div className="proposal-actions">
        <button type="button" className="btn ghost" onClick={onCancel}><X size={16} />Annuler</button>
        <button type="button" className={`btn ${cmd.action === 'delete' ? 'danger-solid' : 'primary'}`} disabled={!item} onClick={() => onConfirm({ action: cmd.action, before: item, after })}>
          <Check size={16} />Confirmer
        </button>
      </div>
    </div>
  );
}
