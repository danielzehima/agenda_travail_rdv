import { useState } from 'react';
import { HardHat, Lock } from 'lucide-react';

export default function Login({ error, onSubmit }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    try { await onSubmit(pw); } finally { setBusy(false); }
  };

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <span className="logo"><HardHat size={22} /></span>
        <h1>Agenda Chantier</h1>
        <p className="muted">Entrez le mot de passe de votre agenda pour retrouver vos données.</p>
        <label htmlFor="login-pw" className="login-label"><Lock size={14} />Mot de passe</label>
        <input id="login-pw" type="password" autoFocus autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {error && <p className="login-error">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy || !pw}>{busy ? 'Connexion…' : 'Se connecter'}</button>
      </form>
    </div>
  );
}
