import { useRef, useState } from 'react';
import { X, Download, Upload, Cloud, LogOut } from 'lucide-react';

export default function Settings({ settings, onSave, onClose, onExport, onImport, online, onLogout }) {
  const [s, setS] = useState(settings);
  const fileRef = useRef(null);
  const num = (k) => (e) => setS({ ...s, [k]: Number(e.target.value) });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal card" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSave(s); }}>
        <header className="modal-head">
          <h3>Réglages</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </header>

        <label>Nom du chantier<input value={s.siteName} onChange={(e) => setS({ ...s, siteName: e.target.value })} /></label>

        <h4 className="section-label">Assistant de rappel</h4>
        <div className="row">
          <label>Briefing du matin à<select value={s.morningHour} onChange={num('morningHour')}>{hours()}</select></label>
          <label>Rappel de validation à<select value={s.eveningHour} onChange={num('eveningHour')}>{hours()}</select></label>
        </div>
        <label>Prévenir avant un rendez-vous
          <select value={s.rdvLeadMinutes} onChange={num('rdvLeadMinutes')}>
            {[15, 30, 60, 120, 240].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} h`}</option>)}
          </select>
        </label>

        <h4 className="section-label">Sauvegarde</h4>
        {online ? (
          <p className="muted small server-line"><Cloud size={14} />Vos données sont enregistrées en ligne (base Neon) et sur cet appareil. L'export reste utile comme copie de secours.</p>
        ) : (
          <p className="muted small">Les données sont enregistrées sur cet appareil. Exportez-les régulièrement ou pour changer d'appareil.</p>
        )}
        <div className="row">
          <button type="button" className="btn ghost" onClick={onExport}><Download size={16} />Exporter</button>
          <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}><Upload size={16} />Importer</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />
        </div>

        <footer className="modal-foot">
          {online && <button type="button" className="btn ghost" onClick={onLogout}><LogOut size={16} />Déconnexion</button>}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary">Enregistrer</button>
        </footer>
      </form>
    </div>
  );
}

function hours() {
  return Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>);
}
