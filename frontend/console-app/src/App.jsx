import { useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const platformNames = { slack: 'Slack', discord: 'Discord', teams: 'Microsoft Teams', console: 'Console' };

function Mark({ name }) {
  const paths = {
    overview: <><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></>,
    rooms: <><path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/></>,
    agents: <><circle cx="12" cy="8" r="4"/><path d="M5 21c.6-4 3-6 7-6s6.4 2 7 6"/></>,
    decisions: <><path d="m5 12 4 4L19 6"/><path d="M4 4h16v16H4z"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/></>,
  };
  return <svg className="mark" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const isRegistration = mode === 'register';
  function switchMode(nextMode) {
    setMode(nextMode); setState('idle'); setError('');
  }
  async function submit(event) {
    event.preventDefault(); setState('loading'); setError('');
    try {
      if (isRegistration) await api.register(name, email, password);
      const result = await api.login(email, password);
      setToken(result.token); setState('success'); onLogin();
    } catch (err) { setState('error'); setError(err.message); }
  }
  return <main className="login-shell">
    <section className="login-copy">
      <a className="wordmark" href="/">KayrosLab</a>
      <h1>Les agents travaillent là où votre équipe décide.</h1>
      <p>Connectez un salon, composez le collectif hybride, puis gardez chaque verdict sous arbitrage humain.</p>
    </section>
    <form className="login-form" onSubmit={submit} aria-busy={state === 'loading'}>
      <h2>{isRegistration ? 'Créer votre espace' : 'Ouvrir la console'}</h2>
      {isRegistration && <label>Nom<input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required /></label>}
      <label>Adresse e-mail<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Mot de passe<input type="password" autoComplete={isRegistration ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} minLength={4} required /></label>
      <p className={`form-error ${error ? '' : 'is-empty'}`} role={error ? 'alert' : undefined}>{error ? `${isRegistration ? 'Inscription' : 'Connexion'} refusée. ${error}` : '\u00a0'}</p>
      <button className="button primary" data-state={state} disabled={state === 'loading'}>
        {state === 'loading' ? (isRegistration ? 'Création…' : 'Connexion…') : (isRegistration ? 'Créer mon compte' : 'Se connecter')}
      </button>
      <p className="auth-switch">
        {isRegistration ? 'Déjà inscrit ? ' : 'Pas encore de compte ? '}
        <button type="button" className="auth-link" onClick={() => switchMode(isRegistration ? 'login' : 'register')}>
          {isRegistration ? 'Se connecter' : 'S’inscrire pour découvrir la console'}
        </button>
      </p>
    </form>
  </main>;
}

function Connection({ connection }) {
  const connected = connection.status === 'connected';
  return <div className="connection">
    <span className={`status-dot ${connected ? 'is-on' : ''}`} aria-hidden="true" />
    <div><strong>{platformNames[connection.platform]}</strong><small>{connected ? `${connection.rooms} salon${connection.rooms === 1 ? '' : 's'}` : 'À configurer'}</small></div>
    <span className="connection-state">{connected ? 'Connecté' : 'Hors ligne'}</span>
  </div>;
}

function RoomCard({ room, selected, onSelect }) {
  return <button className={`room-card ${selected ? 'is-selected' : ''}`} onClick={() => onSelect(room.room_id)}>
    <span className="room-platform">{platformNames[room.platform]}</span>
    <strong>{room.name}</strong>
    <small>{room.mode === 'always' ? 'Répond à chaque message' : 'Répond sur mention'}</small>
    <span className="room-meta"><span className="status-dot is-on" />{room.last_activity_at ? 'Actif récemment' : 'Prêt'}</span>
  </button>;
}

function CreateRoom({ agents, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', platform: 'slack', external_room_id: '', mode: 'mention_only', active_agents: ['cfo', 'cto', 'legal_counsel'] });
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  function toggleAgent(id) {
    setForm((current) => ({ ...current, active_agents: current.active_agents.includes(id) ? current.active_agents.filter((item) => item !== id) : [...current.active_agents, id] }));
  }
  async function submit(event) {
    event.preventDefault(); setState('loading'); setError('');
    try { await api.createRoom(form); setState('success'); await onCreated(); onClose(); }
    catch (err) { setState('error'); setError(err.message); }
  }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="room-title">
      <header><div><h2 id="room-title">Connecter un salon</h2><p>Un salon correspond à un collectif d’agents et à son journal de décision.</p></div><button className="icon-button" onClick={onClose} aria-label="Fermer">×</button></header>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>Nom du salon<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Lancement France" required /></label>
          <label>Plateforme<select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}><option value="slack">Slack</option><option value="discord">Discord</option><option value="teams">Microsoft Teams</option><option value="console">Console uniquement</option></select></label>
        </div>
        <label>Identifiant du canal<input value={form.external_room_id} onChange={(e) => setForm({ ...form, external_room_id: e.target.value })} placeholder="C012345 ou conversation-id" required /></label>
        <fieldset><legend>Agents actifs</legend><div className="agent-picker">{agents.map((agent) => <label className="agent-check" key={agent.agent_id}><input type="checkbox" checked={form.active_agents.includes(agent.agent_id)} onChange={() => toggleAgent(agent.agent_id)} /><span><strong>{agent.role_name}</strong><small>{agent.agent_type === 'hybrid_modified' ? 'Profil hybride' : agent.department}</small></span></label>)}</div></fieldset>
        <label>Mode de réponse<select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}><option value="mention_only">Uniquement sur mention</option><option value="always">Chaque message du salon</option></select></label>
        <p className={`form-error ${error ? '' : 'is-empty'}`} role={error ? 'alert' : undefined}>{error ? `Le salon n’a pas été créé. ${error}` : '\u00a0'}</p>
        <footer><button type="button" className="button secondary" onClick={onClose}>Annuler</button><button className="button primary" data-state={state} disabled={state === 'loading' || form.active_agents.length === 0}>{state === 'loading' ? 'Connexion…' : 'Connecter le salon'}</button></footer>
      </form>
    </section>
  </div>;
}

function Console() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [question, setQuestion] = useState('');
  const [runState, setRunState] = useState('idle');
  const [runResult, setRunResult] = useState(null);
  async function refresh() {
    try { const next = await api.overview(); setData(next); setSelectedRoom((current) => current || next.rooms[0]?.room_id || null); setError(''); }
    catch (err) { setError(err.message); if (err.status === 401) setToken(''); }
  }
  useEffect(() => { refresh(); const timer = setInterval(refresh, 15000); return () => clearInterval(timer); }, []);
  const room = useMemo(() => data?.rooms.find((item) => item.room_id === selectedRoom), [data, selectedRoom]);
  async function runMission(event) {
    event.preventDefault(); if (!room || !question.trim()) return;
    setRunState('loading'); setRunResult(null);
    try { const result = await api.sendMessage(room.room_id, question); setRunResult(result.summary); setQuestion(''); setRunState('success'); await refresh(); }
    catch (err) { setRunResult({ error: err.message }); setRunState('error'); }
  }
  if (!data) return <div className="loading-screen" role="status">{error || 'Chargement de la console…'}</div>;
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="wordmark" href="/">KayrosLab</a>
      <nav aria-label="Navigation principale">
        <a className="active" href="#overview"><Mark name="overview"/>Vue d’ensemble</a>
        <a href="#rooms"><Mark name="rooms"/>Salons</a>
        <a href="#agents"><Mark name="agents"/>Agents</a>
        <a href="#activity"><Mark name="decisions"/>Décisions</a>
        <a href="#settings"><Mark name="settings"/>Réglages</a>
      </nav>
      <div className="account"><span>{data.user.email.slice(0, 1).toUpperCase()}</span><div><strong>{data.user.email}</strong><small>{data.user.role}</small></div><button onClick={() => { setToken(''); location.reload(); }} aria-label="Se déconnecter">↗</button></div>
    </aside>
    <main className="console-main" id="overview">
      <header className="console-header"><div><p className="context-line">Espace {data.user.tenantId}</p><h1>Console des agents</h1><p>Orchestrez les collectifs, puis arbitrez leurs décisions depuis un seul endroit.</p></div><button className="button primary" onClick={() => setShowCreate(true)}>Connecter un salon</button></header>
      {error && <p className="inline-error" role="alert">Les données n’ont pas été actualisées. {error}</p>}
      <section className="connection-strip" aria-label="État des connecteurs">{data.connections.map((item) => <Connection key={item.platform} connection={item}/>)}</section>
      <section className="metric-row" aria-label="Résumé"><div><strong>{data.summary.rooms}</strong><span>Salons actifs</span></div><div><strong>{data.summary.agents}</strong><span>Agents disponibles</span></div><div><strong>{data.summary.hybrid_agents}</strong><span>Profils hybrides</span></div><div><strong>{data.summary.pending_human_decisions}</strong><span>Décisions à revoir</span></div></section>
      <div className="workbench">
        <section className="rooms-panel" id="rooms"><header><div><h2>Salons de travail</h2><p>Chaque salon exécute un seul collectif à la fois.</p></div><button className="text-button" onClick={() => setShowCreate(true)}>Ajouter</button></header>{data.rooms.length ? <div className="room-list">{data.rooms.map((item) => <RoomCard key={item.room_id} room={item} selected={item.room_id === selectedRoom} onSelect={setSelectedRoom}/>)}</div> : <div className="empty"><strong>Aucun salon connecté.</strong><p>Reliez un canal pour donner un espace de travail aux agents.</p><button className="button secondary" onClick={() => setShowCreate(true)}>Connecter le premier salon</button></div>}</section>
        <section className="mission-panel"><header><div><h2>Mission rapide</h2><p>{room ? `Tester le collectif de “${room.name}”.` : 'Sélectionnez ou créez un salon.'}</p></div>{room && <span className="platform-pill">{platformNames[room.platform]}</span>}</header><form onSubmit={runMission}><label htmlFor="mission">Question à instruire</label><textarea id="mission" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Faut-il lancer ce projet maintenant ?" disabled={!room || runState === 'loading'} /><button className="button primary" data-state={runState} disabled={!room || !question.trim() || runState === 'loading'}>{runState === 'loading' ? 'Les agents analysent…' : 'Lancer le collectif'}</button></form>{runResult && <article className={`run-result ${runResult.error ? 'is-error' : ''}`} aria-live="polite"><strong>{runResult.error ? 'Analyse interrompue' : runResult.title}</strong><p>{runResult.error || runResult.text}</p></article>}</section>
        <section className="activity-panel" id="activity"><header><div><h2>Activité</h2><p>Journal commun à la console et aux messageries.</p></div><span className="live-label"><span className="status-dot is-on"/>Direct</span></header>{data.activity.length ? <ol>{[...data.activity].reverse().map((event) => <li key={event.sequence}><span className={`event-mark ${event.verdict ? `is-${event.verdict.toLowerCase()}` : ''}`}/><div><strong>{event.type === 'collaboration.run.completed' ? `Verdict ${event.verdict?.replaceAll('_', ' ')}` : event.type === 'collaboration.room.connected' ? 'Salon connecté' : 'Message reçu'}</strong><small>{event.platform ? platformNames[event.platform] : 'KayrosLab'} · {new Date(event.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</small></div></li>)}</ol> : <div className="empty compact"><strong>Aucune activité.</strong><p>Les messages et verdicts apparaîtront ici.</p></div>}</section>
      </div>
    </main>
    {showCreate && <CreateRoom agents={data.agents} onClose={() => setShowCreate(false)} onCreated={refresh}/>}
  </div>;
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(Boolean(getToken()));
  return authenticated ? <Console /> : <Login onLogin={() => setAuthenticated(true)} />;
}
