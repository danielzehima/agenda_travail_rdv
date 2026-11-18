import { useEffect, useState } from 'react';
import { MessagesSquare, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { api } from '../sync.js';

// Ce dont l'assistant se souvient (mémoire stockée dans Neon), et un bouton pour l'effacer.
export default function AssistantMemory({ refreshKey }) {
  const [memory, setMemory] = useState(null); // null = indisponible (mode local)
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    let alive = true;
    api('GET', 'assistant')
      .then((r) => { if (alive) setMemory(r.memory || []); })
      .catch(() => { if (alive) setMemory(null); });
    return () => { alive = false; };
  }, [refreshKey]);

  if (memory === null) return null;
  const exchanges = memory.filter((m) => m.role === 'user').length;

  const clear = async () => {
    if (!confirm) { setConfirm(true); return; }
    try { await api('DELETE', 'assistant'); setMemory([]); } catch { /* réessaiera plus tard */ }
    setConfirm(false);
    setOpen(false);
  };

  return (
    <div className="memory">
      <button type="button" className="memory-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <MessagesSquare size={14} />
        {exchanges ? `L'assistant se souvient de ${exchanges} échange${exchanges > 1 ? 's' : ''}` : "L'assistant n'a encore rien en mémoire"}
        {exchanges > 0 && (open ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
      </button>
      {open && exchanges > 0 && (
        <div className="memory-panel">
          <ul>
            {memory.map((m, i) => (
              <li key={i} className={`mem ${m.role}`}>
                <span className="mem-who">{m.role === 'user' ? 'Vous' : 'Assistant'}</span>
                <span className="mem-text">{m.role === 'user' ? m.content.replace(/^\([^)]*\)\s*/, '') : m.content.split('\n')[0]}</span>
              </li>
            ))}
          </ul>
          <button type="button" className={`btn small ${confirm ? 'danger-solid' : ''}`} onClick={clear}>
            <Trash2 size={14} />{confirm ? "Confirmer : tout oublier" : 'Oublier la conversation'}
          </button>
        </div>
      )}
    </div>
  );
}
