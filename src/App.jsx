import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HardHat, Settings as SettingsIcon, CheckCircle2, ListTodo, AlertTriangle, Cloud, CloudOff, RefreshCw } from 'lucide-react';
import Calendar from './components/Calendar.jsx';
import DayPanel from './components/DayPanel.jsx';
import AgentPanel from './components/AgentPanel.jsx';
import ItemForm from './components/ItemForm.jsx';
import Settings from './components/Settings.jsx';
import VoiceCapture from './components/VoiceCapture.jsx';
import Login from './components/Login.jsx';
import { enqueue, flush, pull, pendingCount, setPassword, getPassword, hasSyncedOnce, markSynced } from './sync.js';
import { getCapability } from './capabilities.js';
import { enablePush, disablePush, pushState, sendTestPush, showLocal } from './pwa.js';
import { load, save, makeItem, exportJson, parseImport } from './store.js';
import { computeReminders, notifyNew } from './agent.js';
import { todayKey, fromKey } from './dates.js';

export default function App() {
  const [state, setState] = useState(load);
  const [now, setNow] = useState(() => new Date());
  const today = todayKey(now);
  const [selected, setSelected] = useState(today);
  const [view, setView] = useState(() => ({ year: now.getFullYear(), month: now.getMonth() }));
  const [editing, setEditing] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState('');
  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  const { items, settings } = state;

  // --- Synchronisation serveur ---
  // mode : checking | local | login | online | offline | error
  const [sync, setSync] = useState({ mode: 'checking', pending: pendingCount(), message: '' });
  const stateRef = useRef(state);
  stateRef.current = state;
  const modeRef = useRef('checking');

  const setMode = useCallback((mode, message = '') => {
    modeRef.current = mode;
    setSync({ mode, pending: pendingCount(), message });
  }, []);

  const handleError = useCallback((e) => {
    const map = { no_api: 'local', unauthorized: 'login', offline: 'offline' };
    setMode(map[e.code] || 'error', e.message);
  }, [setMode]);

  const connect = useCallback(async () => {
    try {
      await flush();
      const remote = await pull();
      const local = stateRef.current;
      // Premier branchement : on envoie les données déjà saisies sur cet appareil
      if (!hasSyncedOnce() && remote.items.length === 0 && local.items.length > 0) {
        enqueue({ op: 'upsert', items: local.items });
        enqueue({ op: 'settings', settings: local.settings });
        await flush();
        remote.items = local.items;
      }
      markSynced();
      if (pendingCount() === 0) {
        setState((s) => ({ ...s, items: remote.items, settings: { ...s.settings, ...remote.settings } }));
      }
      setMode('online');
    } catch (e) {
      handleError(e);
    }
  }, [handleError, setMode]);

  // Envoie une modification au serveur (rien à faire en mode local)
  const push = (op) => {
    if (modeRef.current === 'local' || modeRef.current === 'checking') return;
    enqueue(op);
    setSync((s) => ({ ...s, pending: pendingCount() }));
    flush().then(() => setMode('online')).catch(handleError);
  };

  useEffect(() => {
    connect();
    const t = setInterval(() => { if (['online', 'offline', 'error'].includes(modeRef.current)) connect(); }, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible' && modeRef.current !== 'local' && modeRef.current !== 'login') connect(); };
    window.addEventListener('online', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); window.removeEventListener('online', onVisible); document.removeEventListener('visibilitychange', onVisible); };
  }, [connect]);

  const login = async (pw) => {
    setPassword(pw);
    await connect();
  };

  const logout = () => {
    setPassword('');
    setShowSettings(false);
    setMode('login');
  };

  // Persistance
  useEffect(() => { save(state); }, [state]);

  // L'agent se réveille toutes les 30 secondes
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const reminders = useMemo(() => computeReminders(items, settings, now), [items, settings, now]);

  // Notifications système pour les nouveaux rappels
  useEffect(() => {
    const fresh = reminders.some((r) => !state.sentReminders[r.key]);
    if (!fresh) return;
    const sentReminders = notifyNew(reminders, state.sentReminders, showLocal);
    setState((s) => ({ ...s, sentReminders }));
  }, [reminders, state.sentReminders]);

  // Titre de l'onglet avec le nombre de rappels urgents
  useEffect(() => {
    const n = reminders.filter((r) => r.level !== 'info').length;
    document.title = n ? `(${n}) Agenda Chantier` : 'Agenda Chantier';
  }, [reminders]);

  const update = (fn) => setState((s) => ({ ...s, items: fn(s.items) }));

  const saveItem = (item) => {
    push({ op: 'upsert', items: [item] });
    update((list) => (list.some((i) => i.id === item.id) ? list.map((i) => (i.id === item.id ? item : i)) : [...list, item]));
    setEditing(null);
    setSelected(item.date);
    const d = fromKey(item.date);
    setView({ year: d.getFullYear(), month: d.getMonth() });
  };

  const deleteItem = (id) => {
    push({ op: 'delete', ids: [id] });
    update((list) => list.filter((i) => i.id !== id));
    setEditing(null);
  };

  const createFromVoice = (fields) => {
    const created = fields.map((f) => makeItem(f));
    update((list) => [...list, ...created]);
    push({ op: 'upsert', items: created });
    return created.map((i) => i.id);
  };

  const changeType = (id, type) => {
    const it = stateRef.current.items.find((i) => i.id === id);
    if (!it) return;
    const next = { ...it, type, validated: type === 'journal' ? false : it.validated, validatedAt: type === 'journal' ? null : it.validatedAt };
    push({ op: 'upsert', items: [next] });
    update((list) => list.map((i) => (i.id === id ? next : i)));
  };

  // Commande vocale confirmée par l'utilisateur
  const applyVoiceCommand = ({ action, before, after }) => {
    if (action === 'delete') {
      push({ op: 'delete', ids: [before.id] });
      update((list) => list.filter((i) => i.id !== before.id));
      return;
    }
    push({ op: 'upsert', items: [after] });
    update((list) => list.map((i) => (i.id === after.id ? after : i)));
    setSelected(after.date);
    const d = fromKey(after.date);
    setView({ year: d.getFullYear(), month: d.getMonth() });
  };

  // « Annuler » après une commande : remet l'élément tel qu'il était
  const restoreItem = (item) => {
    push({ op: 'upsert', items: [item] });
    update((list) => (list.some((i) => i.id === item.id) ? list.map((i) => (i.id === item.id ? item : i)) : [...list, item]));
  };

  const removeIds = (ids) => {
    push({ op: 'delete', ids });
    update((list) => list.filter((i) => !ids.includes(i.id)));
  };

  const openItem = (id) => {
    const it = state.items.find((i) => i.id === id);
    if (!it) return;
    setSelected(it.date);
    const d = fromKey(it.date);
    setView({ year: d.getFullYear(), month: d.getMonth() });
    setEditing(it);
  };

  const setValidated = (ids, value) => {
    const stamp = new Date().toISOString();
    const changed = stateRef.current.items
      .filter((i) => ids.includes(i.id))
      .map((i) => ({ ...i, validated: value, validatedAt: value ? stamp : null }));
    if (changed.length) push({ op: 'upsert', items: changed });
    update((list) => list.map((i) => (ids.includes(i.id) ? { ...i, validated: value, validatedAt: value ? stamp : null } : i)));
  };

  const toggle = (id) => {
    const it = items.find((i) => i.id === id);
    if (it) setValidated([id], !it.validated);
  };

  // Rappels par notification (programme à 7h, bilan à 17h), même app fermée
  const [pushStatus, setPushStatus] = useState('off');
  useEffect(() => { pushState().then(setPushStatus); }, []);

  const enableNotifications = async () => {
    try {
      const { timezone } = await enablePush();
      setPushStatus('on');
      setState((s) => ({ ...s, settings: { ...s.settings, notifications: true } }));
      await sendTestPush().catch(() => {});
      flash(`Rappels activés (fuseau ${timezone}) : programme à ${settings.morningHour}h, bilan à ${settings.eveningHour}h.`);
    } catch (e) {
      setPushStatus(await pushState());
      flash(e.message || "Impossible d'activer les rappels.");
    }
  };

  const disableNotifications = async () => {
    await disablePush();
    setPushStatus('off');
    flash('Rappels désactivés sur cet appareil.');
  };

  // Ouverture depuis une notification : « #aujourdhui » ou « #bilan »
  useEffect(() => {
    const go = (hash) => {
      if (!['#aujourdhui', '#bilan'].includes(hash)) return;
      const n = new Date();
      setSelected(todayKey(n));
      setView({ year: n.getFullYear(), month: n.getMonth() });
      setTimeout(() => document.getElementById(hash === '#bilan' ? 'agent' : 'jour')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
      history.replaceState(null, '', location.pathname);
    };
    go(location.hash);
    const onHash = () => go(location.hash);
    const onMsg = (e) => { if (e.data?.type === 'open') go(new URL(e.data.url).hash); };
    window.addEventListener('hashchange', onHash);
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => { window.removeEventListener('hashchange', onHash); navigator.serviceWorker?.removeEventListener('message', onMsg); };
  }, []);

  const doExport = async () => {
    const downloads = await getCapability('downloads');
    if (downloads) {
      try {
        await downloads.save({ filename: `chantier-${today}.json`, data: exportJson(state) });
        flash('Sauvegarde exportée.');
      } catch {
        flash("Export annulé.");
      }
      return;
    }
    const blob = new Blob([exportJson(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chantier-${today}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImport = async (file) => {
    try {
      const data = parseImport(await file.text());
      setState((s) => ({ ...s, ...data }));
      push({ op: 'upsert', items: data.items, replace: true });
      push({ op: 'settings', settings: data.settings });
      setShowSettings(false);
      flash(`${data.items.length} éléments importés.`);
    } catch (e) {
      flash(`Import impossible : ${e.message}`);
    }
  };

  // Indicateurs
  const tasks = items.filter((i) => i.type !== 'journal');
  const todayTasks = tasks.filter((i) => i.date === today);
  const stats = {
    todayDone: todayTasks.filter((i) => i.validated).length,
    todayTotal: todayTasks.length,
    upcoming: tasks.filter((i) => !i.validated && i.date > today).length,
    late: tasks.filter((i) => !i.validated && i.date < today).length,
  };

  if (sync.mode === 'login') return <Login error={getPasswordError(sync)} onSubmit={login} />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo"><HardHat size={20} /></span>
          <div>
            <h1>{settings.siteName}</h1>
            <p>Agenda de chantier</p>
          </div>
        </div>
        <div className="topbar-actions">
          <SyncBadge sync={sync} onRetry={connect} />
          <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Réglages"><SettingsIcon size={18} /></button>
        </div>
      </header>

      <div className="stats">
        <Stat icon={CheckCircle2} label="Validés aujourd'hui" value={`${stats.todayDone}/${stats.todayTotal}`} tone="ok" />
        <Stat icon={ListTodo} label="À venir" value={stats.upcoming} />
        <Stat icon={AlertTriangle} label="En retard" value={stats.late} tone={stats.late ? 'late' : ''} />
      </div>

      <VoiceCapture items={items} onCreate={createFromVoice} onUndo={removeIds} onOpen={openItem} onChangeType={changeType} onCommand={applyVoiceCommand} onRestore={restoreItem} />

      <main className="layout">
        <div className="col-main">
          <Calendar
            year={view.year}
            month={view.month}
            items={items}
            selected={selected}
            today={today}
            onSelect={setSelected}
            onMonthChange={(year, month) => setView({ year, month })}
          />
          <DayPanel
            dateKey={selected}
            items={items}
            today={today}
            onAdd={(type) => setEditing(makeItem({ type, date: selected }))}
            onEdit={setEditing}
            onToggle={toggle}
          />
        </div>
        <aside className="col-side">
          <AgentPanel
            reminders={reminders}
            items={items}
            notifications={pushStatus === 'on'}
            onEnableNotifications={enableNotifications}
            onValidateAll={(ids) => setValidated(ids, true)}
            onOpenItem={(i) => { setSelected(i.date); const d = fromKey(i.date); setView({ year: d.getFullYear(), month: d.getMonth() }); }}
            onAddJournal={() => { setSelected(today); setEditing(makeItem({ type: 'journal', date: today })); }}
          />
        </aside>
      </main>

      {toast && <div className="toast" role="status">{toast}</div>}
      {editing && <ItemForm key={editing.id} initial={editing} onSave={saveItem} onCancel={() => setEditing(null)} onDelete={deleteItem} />}
      {showSettings && (
        <Settings
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={(s) => { setState((st) => ({ ...st, settings: s })); push({ op: 'settings', settings: s }); setShowSettings(false); }}
          online={sync.mode !== 'local' && sync.mode !== 'checking'}
          push={pushStatus}
          onEnablePush={enableNotifications}
          onDisablePush={disableNotifications}
          onTestPush={() => sendTestPush().then(() => flash('Notification de test envoyée.')).catch((e) => flash(e.message))}
          onLogout={logout}
          onExport={doExport}
          onImport={doImport}
        />
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone = '' }) {
  return (
    <div className={`stat card ${tone}`}>
      <Icon size={18} />
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

// Pas de message d'erreur à la toute première ouverture (aucun mot de passe saisi)
function getPasswordError(sync) {
  return getPassword() ? sync.message : '';
}

function SyncBadge({ sync, onRetry }) {
  if (sync.mode === 'local' || sync.mode === 'checking') return null;
  if (sync.mode === 'online' && sync.pending === 0) {
    return <span className="sync ok" title="Données enregistrées sur le serveur"><Cloud size={14} />Synchronisé</span>;
  }
  const label = sync.mode === 'error' ? 'Erreur serveur' : sync.mode === 'offline' ? 'Hors ligne' : 'Envoi…';
  return (
    <button className={`sync ${sync.mode === 'error' ? 'err' : 'wait'}`} onClick={onRetry} title={sync.message || 'Réessayer'}>
      {sync.mode === 'online' ? <RefreshCw size={14} className="spin" /> : <CloudOff size={14} />}
      {label}{sync.pending > 0 ? ` · ${sync.pending} en attente` : ''}
    </button>
  );
}
