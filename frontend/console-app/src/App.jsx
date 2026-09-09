import { useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const platformNames = { slack: 'Slack', discord: 'Discord', teams: 'Microsoft Teams', console: 'Console' };
const pages = [
  ['overview', 'Vue d’ensemble'], ['rooms', 'Salons'], ['agents', 'Agents'], ['activity', 'Décisions'], ['salesoracle', 'Sales Oracle'], ['settings', 'Réglages'],
];
const connectorFields = {
  slack: [['bot_token', 'Jeton du bot', true], ['signing_secret', 'Secret de signature', true], ['webhook_url', 'Webhook sortant (facultatif)', true]],
  discord: [['application_id', 'Application ID', false], ['bot_token', 'Jeton du bot', true], ['public_key', 'Clé publique Ed25519', true], ['webhook_url', 'Webhook sortant (facultatif)', true]],
  teams: [['app_id', 'Microsoft App ID', false], ['bot_password', 'Secret client', true], ['webhook_url', 'Webhook entrant (facultatif)', true]],
};

function splitLines(value) { return String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean); }
function splitCsv(value) { return String(value || '').split(',').map((item) => item.trim()).filter(Boolean); }
function jsonValue(value, fallback = {}) { try { return JSON.parse(value || '{}'); } catch { return fallback; } }
function verdictLabel(value) { return String(value || '—').replaceAll('_', ' '); }

function Mark({ name }) {
  const labels = { overview: '▦', rooms: '▤', agents: '◉', activity: '✓', salesoracle: '◈', settings: '⚙' };
  return <span className="nav-mark" aria-hidden="true">{labels[name]}</span>;
}

function Login({ onLogin }) {
  const resetToken = new URLSearchParams(String(location.hash).split('?')[1] || '').get('token') || '';
  const [mode, setMode] = useState(resetToken ? 'reset' : 'login'); const [name, setName] = useState(''); const [email, setEmail] = useState('');
  const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState(''); const [state, setState] = useState('idle'); const [error, setError] = useState('');
  const registration = mode === 'register'; const forgotten = mode === 'forgot'; const resetting = mode === 'reset';
  useEffect(() => {
    const syncResetLink = () => {
      const token = new URLSearchParams(String(location.hash).split('?')[1] || '').get('token');
      if (String(location.hash).startsWith('#reset-password') && token) { setMode('reset'); setState('idle'); setError(''); }
    };
    addEventListener('hashchange', syncResetLink); syncResetLink();
    return () => removeEventListener('hashchange', syncResetLink);
  }, []);
  async function submit(event) {
    event.preventDefault(); setState('loading'); setError('');
    try {
      if (forgotten) { await api.forgotPassword(email); setState('sent'); return; }
      if (resetting) {
        if (password !== confirmation) throw new Error('Les deux mots de passe ne correspondent pas.');
        await api.resetPassword(resetToken, password); setState('reset'); return;
      }
      if (registration) await api.register(name, email, password);
      const result = await api.login(email, password); setToken(result.token); onLogin();
    }
    catch (err) { setState('error'); setError(err.message); }
  }
  return <main className="login-shell">
    <section className="login-copy"><a className="wordmark" href="/">KayrosLab</a><h1>Décider avec un collectif explicite.</h1><p>Configurez les agents, reliez les salons et gardez chaque verdict sous arbitrage humain.</p></section>
    <form className="login-form" onSubmit={submit}><h2>{registration ? 'Créer votre espace' : forgotten ? 'Mot de passe oublié' : resetting ? 'Choisir un nouveau mot de passe' : 'Ouvrir la console'}</h2>
      {forgotten && <p className="auth-help">Saisissez votre adresse. Si elle correspond à un compte, nous vous enverrons un lien de vérification valable 30 minutes.</p>}
      {resetting && <p className="auth-help">Le lien reçu par e-mail vérifie votre demande. Choisissez un mot de passe d’au moins 10 caractères.</p>}
      {registration && <label>Nom<input value={name} onChange={(event) => setName(event.target.value)} required /></label>}
      {!resetting && <label>Adresse e-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>}
      {!forgotten && <label>Mot de passe<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={(resetting || registration) ? 10 : 1} required /></label>}
      {resetting && <label>Confirmer le mot de passe<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={10} required /></label>}
      {mode === 'login' && <button type="button" className="auth-link forgot-link" onClick={() => { setMode('forgot'); setError(''); setState('idle'); }}>Mot de passe oublié&nbsp;?</button>}
      {state === 'sent' && <p className="auth-success" role="status">Si un compte correspond à cette adresse, un e-mail vient d’être envoyé. Vérifiez aussi vos courriers indésirables.</p>}
      {state === 'sent' && <button type="button" className="button secondary" onClick={() => setState('idle')}>Renvoyer le lien</button>}
      {state === 'reset' && <p className="auth-success" role="status">Votre mot de passe a été réinitialisé. Vous pouvez maintenant vous connecter.</p>}
      <p className={`form-error ${error ? '' : 'is-empty'}`} role={error ? 'alert' : undefined}>{error || '\u00a0'}</p>
      {state !== 'sent' && state !== 'reset' && <button className="button primary" data-state={state} disabled={state === 'loading'}>{state === 'loading' ? 'Envoi…' : registration ? 'Créer mon compte' : forgotten ? 'Envoyer le lien de vérification' : resetting ? 'Réinitialiser le mot de passe' : 'Se connecter'}</button>}
      {(forgotten || resetting || state === 'reset')
        ? <button type="button" className="auth-link" onClick={() => { location.hash = ''; setMode('login'); setState('idle'); setError(''); setPassword(''); setConfirmation(''); }}>Retour à la connexion</button>
        : <button type="button" className="auth-link" onClick={() => setMode(registration ? 'login' : 'register')}>{registration ? 'Déjà inscrit ? Se connecter' : 'Créer un espace de découverte'}</button>}
    </form>
  </main>;
}

function Connection({ connection }) {
  const connected = connection.status === 'connected';
  return <div className="connection"><span className={`status-dot ${connected ? 'is-on' : connection.status === 'error' ? 'is-error' : ''}`} />
    <div><strong>{platformNames[connection.platform]}</strong><small>{connection.rooms} salon{connection.rooms === 1 ? '' : 's'} · {connection.source === 'environment' ? 'variables serveur' : 'console'}</small></div>
    <span className="connection-state">{connected ? 'Connecté' : connection.status === 'configured' ? 'À tester' : connection.status === 'disabled' ? 'Désactivé' : connection.status === 'error' ? 'Erreur' : 'À configurer'}</span>
  </div>;
}

function CreateRoom({ agents, defaultPlatform = 'slack', onClose, onCreated }) {
  const active = agents.filter((agent) => agent.enabled !== false);
  const [form, setForm] = useState({ name: '', platform: defaultPlatform, external_room_id: '', mode: 'mention_only', active_agents: active.slice(0, 3).map((agent) => agent.agent_id) });
  const [state, setState] = useState('idle'); const [error, setError] = useState('');
  function toggle(id) { setForm((current) => ({ ...current, active_agents: current.active_agents.includes(id) ? current.active_agents.filter((item) => item !== id) : [...current.active_agents, id] })); }
  async function submit(event) { event.preventDefault(); setState('loading'); setError(''); try { await api.createRoom(form); await onCreated(); onClose(); } catch (err) { setState('error'); setError(err.message); } }
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog wide" role="dialog" aria-modal="true">
    <header><div><h2>Rattacher un salon</h2><p>Le canal et ce collectif partageront le même dossier de décision.</p></div><button className="icon-button" onClick={onClose}>×</button></header>
    <form onSubmit={submit}><div className="form-grid"><label>Nom<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
      <label>Plateforme<select value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })}>{Object.entries(platformNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
      <label>Identifiant du canal<input value={form.external_room_id} onChange={(event) => setForm({ ...form, external_room_id: event.target.value })} placeholder="C012345, channel ID ou conversation ID" required /></label>
      <fieldset><legend>Collectif actif</legend><div className="agent-picker">{active.map((agent) => <label className="agent-check" key={agent.agent_id}><input type="checkbox" checked={form.active_agents.includes(agent.agent_id)} onChange={() => toggle(agent.agent_id)} />{agent.metadata?.literary?.avatar_url ? <img className="agent-avatar" src={agent.metadata.literary.avatar_url} alt="" /> : null}<span><strong>{agent.display_name || agent.role_name}</strong><small>{agent.department}</small></span></label>)}</div></fieldset>
      <label>Mode<select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })}><option value="mention_only">Sur mention</option><option value="always">Tous les messages</option></select></label>
      <p className={`form-error ${error ? '' : 'is-empty'}`}>{error || '\u00a0'}</p><footer><button type="button" className="button secondary" onClick={onClose}>Annuler</button><button className="button primary" disabled={state === 'loading' || !form.active_agents.length}>{state === 'loading' ? 'Création…' : 'Rattacher'}</button></footer>
    </form>
  </section></div>;
}

function RunDossier({ run }) {
  if (!run) return null;
  const risks = [...new Set((run.analyses || []).flatMap((item) => item.critical_risks || []))];
  const conditions = [...new Set((run.analyses || []).flatMap((item) => item.required_mitigations || []))];
  return <article className="dossier"><header><div><small>Dossier {run.run_id}</small><h3>{run.swarm_name}</h3></div><span className={`verdict is-${String(run.consensus?.verdict || '').toLowerCase()}`}>{verdictLabel(run.consensus?.verdict)}</span></header>
    <p className="synthesis">{run.consensus?.rationale}</p>
    <h4 className="section-kicker">Contributions individuelles</h4><div className="analysis-grid">{(run.analyses || []).map((analysis) => <section key={analysis.agent_id} className="analysis-card"><header><strong>{analysis.role_name || analysis.agent_id}</strong><span>{verdictLabel(analysis.verdict)}</span></header><p>{analysis.primary_reason}</p>
      {!!analysis.strengths_opportunities?.length && <div><small>Preuves et opportunités</small><ul>{analysis.strengths_opportunities.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      {!!analysis.critical_risks?.length && <div><small>Objections</small><ul>{analysis.critical_risks.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      {!!analysis.required_mitigations?.length && <div><small>Conditions</small><ul>{analysis.required_mitigations.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      {!!analysis.metrics?.length && <div><small>Indicateurs</small><ul>{analysis.metrics.map((item) => <li key={item.metric}>{item.metric} : {item.value}</li>)}</ul></div>}
    </section>)}</div>
    {(risks.length > 0 || conditions.length > 0) && <div className="consolidated"><div><strong>Objections consolidées</strong><ul>{risks.map((item) => <li key={item}>{item}</li>)}</ul></div><div><strong>Conditions consolidées</strong><ul>{conditions.map((item) => <li key={item}>{item}</li>)}</ul></div></div>}
  </article>;
}

function DecisionThread({ thread, onChanged }) {
  const [reply, setReply] = useState(''); const [state, setState] = useState('idle'); const [error, setError] = useState('');
  async function answer(event) { event.preventDefault(); setState('loading'); setError(''); try { const result = await api.replyThread(thread.thread_id, reply); setReply(''); setState('success'); onChanged(result.thread); } catch (err) { setState('error'); setError(err.message); } }
  async function arbitrate(action, decision) { setState('loading'); setError(''); try { const result = await api.arbitrateThread(thread.thread_id, { action, decision, justification: action === 'override_veto' ? 'Arbitrage explicite depuis la console.' : '' }); setState('success'); onChanged(result.thread); } catch (err) { setState('error'); setError(err.message); } }
  return <section className="thread-view"><header><div><small>Fil {thread.thread_id} · salon {thread.room_id}</small><h2>{thread.question}</h2></div><span className="thread-status">{thread.status.replaceAll('_', ' ')}</span></header>
    <div className="timeline">{(thread.messages || []).map((message) => <div className={`thread-message is-${message.role}`} key={message.message_id || `${message.kind}-${message.created_at}`}>
      {message.kind === 'run' ? <RunDossier run={message.run} /> : <><small>{message.role === 'human' ? message.author_id || 'Décideur' : 'Collectif Kayros'} · {message.kind}</small>{message.text && <p>{message.text}</p>}{message.questions?.length > 0 && <ol>{message.questions.map((question) => <li key={question}>{question}</li>)}</ol>}{message.decision && <p>Arbitrage : {message.decision.action} · {verdictLabel(message.decision.verdict)}</p>}</>}
    </div>)}</div>
    {thread.status !== 'resolved' && <><form className="thread-reply" onSubmit={answer}><label>Réponse humaine et paramètres complémentaires<textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Budget validé à 120 k€, responsable : …, preuve disponible : …" /></label><button className="button primary" disabled={!reply.trim() || state === 'loading'}>{state === 'loading' ? 'Relance…' : 'Répondre et relancer le même collectif'}</button></form>
      <div className="arbitration"><div><strong>Arbitrage humain</strong><small>Le verdict reste consultatif jusqu’à cette étape.</small></div><button className="button secondary" onClick={() => arbitrate('reevaluate')}>Demander une réévaluation</button><button className="button secondary" onClick={() => arbitrate('override_veto', 'CONDITIONAL_GO')}>Passer sous conditions</button><button className="button primary" onClick={() => arbitrate('accept_consensus')}>Accepter le consensus</button></div></>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}

function Overview({ data, refresh, openRoom, onThread }) {
  const [selectedRoom, setSelectedRoom] = useState(data.rooms[0]?.room_id || null); const [question, setQuestion] = useState(''); const [state, setState] = useState('idle'); const [error, setError] = useState('');
  const room = data.rooms.find((item) => item.room_id === selectedRoom);
  async function run(event) { event.preventDefault(); if (!room) return; setState('loading'); setError(''); try { const result = await api.sendMessage(room.room_id, question); setQuestion(''); setState('success'); onThread(result.thread); await refresh(); } catch (err) { setState('error'); setError(err.message); } }
  return <><header className="console-header"><div><p className="context-line">Espace {data.user.tenantId}</p><h1>Console des agents</h1><p>Configurez les participants, instruisez la question, puis arbitrez sur preuves.</p></div><button className="button primary" onClick={openRoom}>Rattacher un salon</button></header>
    <section className="connection-strip">{data.connections.map((item) => <Connection key={item.platform} connection={item} />)}</section>
    <section className="metric-row"><div><strong>{data.summary.rooms}</strong><span>Salons actifs</span></div><div><strong>{data.summary.agents}</strong><span>Agents actifs</span></div><div><strong>{data.summary.hybrid_agents}</strong><span>Profils hybrides</span></div><div><strong>{data.summary.pending_human_decisions}</strong><span>Arbitrages ouverts</span></div></section>
    <div className="mission-workbench"><section><header><div><h2>Mission rapide</h2><p>Le résultat ouvre un fil durable, pas une simple notification.</p></div></header>
      <label>Salon<select value={selectedRoom || ''} onChange={(event) => setSelectedRoom(event.target.value)}><option value="">Sélectionner…</option>{data.rooms.map((item) => <option value={item.room_id} key={item.room_id}>{item.name} · {platformNames[item.platform]}</option>)}</select></label>
      <form onSubmit={run}><label>Question à instruire<textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Faut-il lancer ce projet maintenant, avec quel budget et sous quelles conditions ?" /></label><button className="button primary" disabled={!room || !question.trim() || state === 'loading'}>{state === 'loading' ? 'Analyses individuelles en cours…' : 'Lancer le collectif'}</button></form>{error && <p className="inline-error">{error}</p>}
    </section><section><header><div><h2>Décisions ouvertes</h2><p>Reprendre une discussion avec tout son contexte.</p></div><a className="text-button" href="#activity">Tout voir</a></header>
      <div className="thread-list">{data.threads.filter((item) => item.status !== 'resolved').slice(0, 6).map((item) => <button key={item.thread_id} onClick={() => onThread(item)}><strong>{item.question}</strong><small>{item.status.replaceAll('_', ' ')} · {item.current_run_id}</small></button>)}{!data.threads.length && <p className="muted">Aucun dossier lancé.</p>}</div>
    </section></div>
  </>;
}

const emptyAgent = { agent_id: '', display_name: '', role_name: '', department: '', seniority: 'senior', primary_focus: '', mission: '', instructions: '', constraints: '', provider: '', model: '', tools: '', connectors: ['console'], rules: '', metadata: '{}', behavioral: '{}', enabled: true, veto_power: false };
function agentForm(agent) { return agent ? { ...agent, constraints: (agent.constraints || []).join('\n'), tools: (agent.tools || []).join(', '), connectors: agent.connectors || ['console'], rules: (agent.rule_configuration?.user_added_rules || []).map((rule) => rule.rule_text).join('\n'), metadata: JSON.stringify(agent.metadata || {}, null, 2), behavioral: JSON.stringify(agent.behavioral_profile || {}, null, 2) } : emptyAgent; }

function AgentEditor({ agent, capabilities, onSaved, onClose }) {
  const editing = !!agent; const [form, setForm] = useState(() => agentForm(agent)); const [state, setState] = useState('idle'); const [error, setError] = useState('');
  const [crystal, setCrystal] = useState({ email: '', linkedin_url: '', consent_confirmed: false });
  function toggleConnector(id) { setForm((current) => ({ ...current, connectors: current.connectors.includes(id) ? current.connectors.filter((item) => item !== id) : [...current.connectors, id] })); }
  function payload() {
    const base = { display_name: form.display_name, role_name: form.role_name, department: form.department, seniority: form.seniority, primary_focus: form.primary_focus || form.mission, mission: form.mission, instructions: form.instructions, constraints: splitLines(form.constraints), provider: form.provider || null, model: form.model || null, tools: splitCsv(form.tools), connectors: form.connectors, enabled: form.enabled, veto_power: form.veto_power, metadata: jsonValue(form.metadata), behavioral_profile: jsonValue(form.behavioral) };
    const system = agent?.rule_configuration?.system_proposed_rules || [];
    base.rule_configuration = { system_proposed_rules: system, user_modified_rules: agent?.rule_configuration?.user_modified_rules || [], user_added_rules: splitLines(form.rules).map((rule_text, index) => ({ rule_id: `USR_${String(form.agent_id).toUpperCase()}_${index + 1}`, rule_text })) };
    return editing ? base : { ...base, agent_id: form.agent_id };
  }
  async function save(event) { event.preventDefault(); setState('loading'); setError(''); try { const result = editing ? await api.updateAgent(agent.agent_id, payload()) : await api.createAgent(payload()); setState('success'); await onSaved(result.agent); } catch (err) { setState('error'); setError(err.message); } }
  async function importCrystal() { setState('loading'); setError(''); try { const result = await api.importCrystal(agent.agent_id, crystal); setState('success'); await onSaved(result.agent); } catch (err) { setState('error'); setError(err.message); } }
  return <div className="dialog-backdrop"><section className="dialog agent-dialog" role="dialog" aria-modal="true"><header><div><h2>{editing ? `Configurer ${agent.agent_id}` : 'Ajouter un agent'}</h2><p>Chaque paramètre devient explicite dans le contexte d’exécution.</p></div><button className="icon-button" onClick={onClose}>×</button></header>
    <form onSubmit={save}><div className="form-grid three"><label>Identifiant<input value={form.agent_id} disabled={editing} onChange={(event) => setForm({ ...form, agent_id: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} required /></label><label>Nom affiché<input value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} /></label><label>Rôle<input value={form.role_name} onChange={(event) => setForm({ ...form, role_name: event.target.value })} required /></label><label>Département<input value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} required /></label><label>Séniorité<select value={form.seniority} onChange={(event) => setForm({ ...form, seniority: event.target.value })}>{['intern', 'junior', 'senior', 'executive'].map((item) => <option key={item}>{item}</option>)}</select></label><label>Provider<select value={form.provider || ''} onChange={(event) => setForm({ ...form, provider: event.target.value })}><option value="">Routage par défaut</option>{capabilities.providers.map((item) => <option key={item}>{item}</option>)}</select></label></div>
      <label>Mission<textarea value={form.mission} onChange={(event) => setForm({ ...form, mission: event.target.value, primary_focus: event.target.value })} required /></label><label>Instructions<textarea value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} /></label>
      <div className="form-grid"><label>Contraintes · une par ligne<textarea value={form.constraints} onChange={(event) => setForm({ ...form, constraints: event.target.value })} /></label><label>Règles de décision · une par ligne<textarea value={form.rules} onChange={(event) => setForm({ ...form, rules: event.target.value })} /></label></div>
      <div className="form-grid"><label>Modèle<input value={form.model || ''} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="Optionnel" /></label><label>Outils · séparés par des virgules<input value={form.tools} onChange={(event) => setForm({ ...form, tools: event.target.value })} /></label></div>
      <fieldset><legend>Connecteurs autorisés</legend><div className="inline-checks">{Object.keys(platformNames).map((id) => <label key={id}><input type="checkbox" checked={form.connectors.includes(id)} onChange={() => toggleConnector(id)} />{platformNames[id]}</label>)}</div></fieldset>
      <div className="form-grid"><label>Métadonnées JSON<textarea className="code-input" value={form.metadata} onChange={(event) => setForm({ ...form, metadata: event.target.value })} /></label><label>Profil comportemental JSON<textarea className="code-input" value={form.behavioral} onChange={(event) => setForm({ ...form, behavioral: event.target.value })} /></label></div>
      <div className="inline-checks"><label><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />Agent activé</label><label><input type="checkbox" checked={form.veto_power} onChange={(event) => setForm({ ...form, veto_power: event.target.checked })} />Pouvoir de veto</label></div>
      <p className={`form-error ${error ? '' : 'is-empty'}`}>{error || '\u00a0'}</p><footer><button type="button" className="button secondary" onClick={onClose}>Fermer</button><button className="button primary" disabled={state === 'loading'}>{state === 'loading' ? 'Enregistrement…' : 'Enregistrer l’agent'}</button></footer>
    </form>
    {editing && <section className="crystal-box"><header><div><h3>Profil Crystal Knows</h3><p>Import facultatif depuis l’API officielle, après consentement explicite.</p></div><span>{capabilities.crystal_knows ? 'Disponible' : 'Identifiants serveur requis'}</span></header><div className="form-grid"><label>E-mail professionnel<input type="email" value={crystal.email} onChange={(event) => setCrystal({ ...crystal, email: event.target.value })} /></label><label>URL LinkedIn autorisée<input value={crystal.linkedin_url} onChange={(event) => setCrystal({ ...crystal, linkedin_url: event.target.value })} /></label></div><label className="consent"><input type="checkbox" checked={crystal.consent_confirmed} onChange={(event) => setCrystal({ ...crystal, consent_confirmed: event.target.checked })} />La personne a consenti à cet usage de profil pour la communication et la collaboration. Pas de recrutement, crédit ou décision à impact matériel.</label><button className="button secondary" disabled={!capabilities.crystal_knows || !crystal.consent_confirmed || (!crystal.email && !crystal.linkedin_url)} onClick={importCrystal}>Importer via Crystal</button></section>}
  </section></div>;
}

const authorAvatarCache = new Map();
function fetchAuthorAvatar(wikipedia) {
  if (!authorAvatarCache.has(wikipedia)) {
    authorAvatarCache.set(wikipedia, fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(String(wikipedia).replace(/ /g, '_'))}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => data?.thumbnail?.source || data?.originalimage?.source || '')
      .catch(() => ''));
  }
  return authorAvatarCache.get(wikipedia);
}

function AuthorPickerDialog({ onClose, onCreated }) {
  const [mode, setMode] = useState('catalogue');
  const [search, setSearch] = useState('');
  const [authors, setAuthors] = useState(null);
  const [avatars, setAvatars] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [liveQuery, setLiveQuery] = useState('');
  const [live, setLive] = useState(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState('');
  const [creation, setCreation] = useState(null);
  useEffect(() => {
    let alive = true;
    api.listAuthors(search).then((result) => { if (alive) setAuthors(result.authors || []); }).catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [search]);
  useEffect(() => {
    (authors || []).forEach((author) => {
      if (avatars[author.id] !== undefined || !author.wikipedia) return;
      fetchAuthorAvatar(author.wikipedia).then((url) => setAvatars((current) => ({ ...current, [author.id]: url })));
    });
  }, [authors, avatars]);
  async function create(author) {
    setBusy(author.id); setError('');
    try {
      const result = await api.createAuthorAgent(author.id);
      setCreation({ author, agent: result.agent, ingestion: result.ingestion, policy: result.policy, proposal: result.proposal || null, attributions: [] });
      await onCreated();
    }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  async function addManualBooks(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get('title') || '').trim();
    const url = String(data.get('url') || '').trim();
    if (!title || !url) { setError('Titre et URL requis.'); return; }
    setBusy('manual'); setError('');
    try {
      const result = await api.addManualBooks(creation.agent.agent_id, [{ title, url, author: creation.author?.name || '' }]);
      setCreation((current) => ({
        ...current,
        attributions: [...(current.attributions || []), ...result.results],
        worksCount: result.works_count,
        proposal: result.works_count < 3 ? current.proposal : { manual_required: false, message: null },
      }));
      event.currentTarget.reset();
    }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  async function runSearch() {
    if (liveQuery.trim().length < 2) { setError('Requête trop courte (2 caractères minimum).'); return; }
    setLiveBusy(true); setError('');
    try { setLive(await api.searchSources(liveQuery.trim())); }
    catch (err) { setError(err.message); }
    finally { setLiveBusy(false); }
  }
  function toggleWork(work) {
    setSelected((current) => current.some((item) => item.url === work.url)
      ? current.filter((item) => item.url !== work.url)
      : [...current, { title: work.title, url: work.url, author: work.author || '', source: work.source || '' }].slice(0, 6));
  }
  async function createWorks() {
    if (!name.trim()) { setError('Donnez un nom à votre agent.'); return; }
    if (!selected.length) { setError('Sélectionnez au moins une œuvre issue de la recherche en ligne.'); return; }
    setBusy('works'); setError('');
    try { await api.createWorksAgent({ display_name: name.trim(), works: selected }); await onCreated(); onClose(); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog author-dialog" role="dialog" aria-modal="true">
    <header><div><h2>Ajouter un auteur du domaine public</h2><p>L’agent est construit sur la somme des œuvres libres choisies — téléchargées en temps réel et intégrées à sa mémoire. Un portrait le représente quand il est disponible.</p></div><button className="icon-button" onClick={onClose}>×</button></header>
    <div className="so-tabs"><button className={mode === 'catalogue' ? 'button primary' : 'button'} onClick={() => setMode('catalogue')}>Catalogue vérifié</button><button className={mode === 'recherche' ? 'button primary' : 'button'} onClick={() => setMode('recherche')}>Recherche en ligne</button></div>
    {creation && <section className="so-creation">
      <h3>{creation.agent.display_name} — {creation.worksCount ?? creation.ingestion?.assigned ?? 0} œuvre(s) intégrée(s)</h3>
      <p className="muted">Plafond 15 œuvres par agent · plancher 3. Chaque décision (cap, plancher, ajout manuel, attribution) est inscrite au registre d'ingestion.</p>
      {(creation.attributions || []).length > 0 && <ul className="so-attributions">{creation.attributions.map((entry) => <li key={entry.url}><strong>{entry.work}</strong> — {entry.justification}</li>)}</ul>}
      {creation.proposal?.manual_required ? <>
        <p className="form-error">{creation.proposal.message}</p>
        <form onSubmit={addManualBooks} className="so-manual">
          <label>Titre du livre<input name="title" required maxLength={240} /></label>
          <label>URL du texte ou du téléchargement<input name="url" type="url" required maxLength={1000} placeholder="https://… (.txt, .html ou .epub)" /></label>
          <button className="button primary" disabled={busy === 'manual'}>{busy === 'manual' ? 'Ingestion et attribution…' : 'Ajouter et laisser l’IA attribuer'}</button>
        </form>
      </> : null}
      <button className="button secondary" onClick={onClose}>Terminer</button>
    </section>}
    {error && <p className="form-error">{error}</p>}
    {mode === 'catalogue' && <>
      <input className="so-search" placeholder="Rechercher un écrivain ou un philosophe…" value={search} onChange={(event) => setSearch(event.target.value)} />
      <div className="so-author-list">{(authors || []).map((author) => <article key={author.id} className="so-author">
        <img className="so-avatar" src={avatars[author.id] || ''} alt="" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} />
        <div className="so-author-meta"><strong>{author.name}</strong><small>{author.kind} · {author.era} · {author.works.length} œuvre(s) libre(s)</small><p>{author.blurb}</p></div>
        <button className="button primary" disabled={busy === author.id} onClick={() => create(author)}>{busy === author.id ? 'Téléchargement…' : 'Créer l’agent'}</button>
      </article>)}</div>
      {authors && !authors.length && <p className="muted">Aucun auteur ne correspond à cette recherche.</p>}
    </>}
    {mode === 'recherche' && <>
      <div className="so-livesearch"><input placeholder="Titre, auteur, thème…" value={liveQuery} onChange={(event) => setLiveQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} /><button className="button primary" disabled={liveBusy} onClick={runSearch}>{liveBusy ? 'Recherche…' : 'Chercher'}</button></div>
      <p className="muted so-note">Sources interrogées en temps réel : Project Gutenberg, NosLivres/efele, Ebooks libres et gratuits, Wikisource (fr/en). Annuaire : {live?.annuaire?.length || '—'} bibliothèques listées.</p>
      {selected.length > 0 && <div className="so-selected"><strong>Œuvres sélectionnées ({selected.length}/6) :</strong><ul>{selected.map((work) => <li key={work.url}><span>{work.title}</span><button className="text-button" onClick={() => toggleWork(work)}>retirer</button></li>)}</ul></div>}
      <label>Nom de l’agent<input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} placeholder="Ex. Victor Hugo, ou « Le comité Voltaire »" /></label>
      <button className="button primary" disabled={busy === 'works' || !selected.length} onClick={createWorks}>{busy === 'works' ? 'Téléchargement et construction…' : `Créer l’agent avec ${selected.length} œuvre(s)`}</button>
      {(live?.sources || []).map((group) => <section key={group.source} className="so-source">
        <h3>{group.source} {group.ok ? <small>({group.results.length} résultat(s))</small> : <small className="so-err">indisponible</small>}</h3>
        {(group.results || []).map((result) => <div key={result.url || result.page} className="so-result">
          <div className="so-result-meta"><strong>{result.title}</strong><small>{result.author ? `${result.author} · ` : ''}{result.source} · {result.ingestable ? 'texte intégral' : 'adresse de téléchargement'}</small></div>
          <div className="so-result-actions"><a className="text-button" href={result.page} target="_blank" rel="noreferrer">voir</a><button className="button secondary" onClick={() => toggleWork(result)}>{selected.some((item) => item.url === result.url) ? 'Retirer' : 'Ajouter'}</button></div>
        </div>)}
      </section>)}
      {live && <div className="so-annuaire"><h3>Annuaire de bibliothèques libres</h3><ul>{(live.annuaire || []).map((entry) => <li key={entry.id}><a href={entry.url} target="_blank" rel="noreferrer">{entry.name}</a> — <span className="muted">{entry.note}</span></li>)}</ul></div>}
    </>}
  </section></div>;
}

function AgentsPage({ data, refresh }) {
  const [editing, setEditing] = useState(undefined);
  const [authorPicker, setAuthorPicker] = useState(false);
  async function toggle(agent) { await api.updateAgent(agent.agent_id, { enabled: agent.enabled === false }); await refresh(); }
  return <section className="page"><header className="page-header"><div><p className="context-line">Registre du tenant</p><h1>Agents</h1><p>Identité, mission, règles, modèles, outils et comportement sont inspectables et modifiables.</p></div><div className="header-actions"><button className="button secondary" onClick={() => setAuthorPicker(true)}>Ajouter un auteur</button><button className="button primary" onClick={() => setEditing(null)}>Ajouter un agent</button></div></header>
    <div className="agent-table">{data.agents.map((agent) => <article key={agent.agent_id} className={agent.enabled === false ? 'is-disabled' : ''}><header><div><small>{agent.agent_id} · {agent.department}</small><h2>{agent.metadata?.literary?.avatar_url ? <img className="agent-avatar" src={agent.metadata.literary.avatar_url} alt="" /> : null}{agent.display_name || agent.role_name}</h2></div><button className="switch" aria-pressed={agent.enabled !== false} onClick={() => toggle(agent)}><span />{agent.enabled === false ? 'Inactif' : 'Actif'}</button></header><p>{agent.mission || agent.primary_focus}</p><dl><div><dt>Rôle</dt><dd>{agent.role_name}</dd></div><div><dt>Modèle</dt><dd>{agent.provider || 'défaut'}{agent.model ? ` / ${agent.model}` : ''}</dd></div><div><dt>Règles</dt><dd>{agent.effective_rules.length}</dd></div><div><dt>Profil</dt><dd>{agent.metadata?.literary ? 'auteur du domaine public' : agent.human_profile ? 'hybride consenti' : 'agent métier'}</dd></div></dl><footer><span>{(agent.tools || []).join(' · ') || 'Aucun outil dédié'}</span><button className="text-button" onClick={() => setEditing(agent)}>Configurer</button></footer></article>)}</div>
    {editing !== undefined && <AgentEditor agent={editing} capabilities={data.capabilities} onClose={() => setEditing(undefined)} onSaved={async () => { await refresh(); setEditing(undefined); }} />}
    {authorPicker && <AuthorPickerDialog onClose={() => setAuthorPicker(false)} onCreated={refresh} />}
  </section>;
}

function ConnectorCard({ connector, secure, refresh, openRoom }) {
  const [secrets, setSecrets] = useState({}); const [state, setState] = useState('idle'); const [error, setError] = useState('');
  async function save(event) { event.preventDefault(); setState('loading'); setError(''); try { await api.configureConnector(connector.platform, { secrets, enabled: true, settings: {} }); setSecrets({}); setState('success'); await refresh(); } catch (err) { setState('error'); setError(err.message); } }
  async function test() { setState('loading'); setError(''); try { await api.testConnector(connector.platform); setState('success'); await refresh(); } catch (err) { setState('error'); setError(err.message); await refresh(); } }
  async function toggle() { try { await api.setConnectorEnabled(connector.platform, !connector.enabled); await refresh(); } catch (err) { setError(err.message); } }
  return <article className="connector-card"><header><div><span className={`status-dot ${connector.status === 'connected' ? 'is-on' : connector.status === 'error' ? 'is-error' : ''}`} /><div><h2>{platformNames[connector.platform]}</h2><small>{connector.status.replaceAll('_', ' ')} · {connector.rooms} salon{connector.rooms === 1 ? '' : 's'}</small></div></div><button className="switch" aria-pressed={connector.enabled} disabled={!connector.connection_id} onClick={toggle}><span />{connector.enabled ? 'Activé' : 'Désactivé'}</button></header>
    <form onSubmit={save}>{connectorFields[connector.platform].map(([id, label, secret]) => <label key={id}>{label}<input type={secret ? 'password' : 'text'} value={secrets[id] || ''} onChange={(event) => setSecrets({ ...secrets, [id]: event.target.value })} placeholder={connector.configured_secret_fields.includes(id) ? 'Déjà configuré — laisser vide pour conserver' : ''} /></label>)}
      <div className="connector-actions"><button className="button secondary" disabled={!secure || state === 'loading'}>{connector.connection_id ? 'Mettre à jour' : 'Enregistrer'}</button><button type="button" className="button secondary" disabled={!connector.connection_id || state === 'loading'} onClick={test}>Tester</button><button type="button" className="button primary" disabled={connector.status !== 'connected'} onClick={() => openRoom(connector.platform)}>Rattacher un salon</button></div></form>
    {connector.webhook_url && <label>URL à déclarer chez le fournisseur<input readOnly value={connector.webhook_url} onFocus={(event) => event.target.select()} /></label>}
    <p className={`form-error ${error ? '' : 'is-empty'}`}>{error || '\u00a0'}</p>{connector.last_tested_at && <small>Dernier test : {new Date(connector.last_tested_at).toLocaleString('fr-FR')}</small>}
  </article>;
}

function SettingsPage({ data, refresh, openRoom }) {
  return <section className="page"><header className="page-header"><div><p className="context-line">Secrets côté serveur</p><h1>Réglages</h1><p>Validez les identifiants, testez la connectivité, puis rattachez les salons.</p></div></header>
    {!data.capabilities.encrypted_connector_storage && <div className="security-warning"><strong>Stockage chiffré non initialisé.</strong><p>Définissez KAYROS_CONNECTOR_ENCRYPTION_KEY avant d’enregistrer des identifiants. Aucun secret ne sera accepté tant que cette clé manque.</p></div>}
    <div className="connector-grid">{data.connections.map((connector) => <ConnectorCard key={connector.platform} connector={connector} secure={data.capabilities.encrypted_connector_storage} refresh={refresh} openRoom={openRoom} />)}</div>
    <section className="privacy-panel"><h2>Crystal Knows</h2><p>État : <strong>{data.capabilities.crystal_knows ? 'API serveur configurée' : 'CRYSTALKNOWS_API_TOKEN absent'}</strong>. L’import ne s’active qu’au niveau d’un agent, avec consentement explicite. Les jetons restent côté serveur ; aucun scraping n’est utilisé.</p></section>
  </section>;
}

function RoomsPage({ data, openRoom, onThread }) {
  return <section className="page"><header className="page-header"><div><p className="context-line">Canaux et collectifs</p><h1>Salons</h1><p>Chaque canal pointe vers un collectif stable et son historique de décisions.</p></div><button className="button primary" onClick={openRoom}>Rattacher un salon</button></header><div className="rooms-grid">{data.rooms.map((room) => <article key={room.room_id}><small>{platformNames[room.platform]} · {room.external_room_id}</small><h2>{room.name}</h2><p>{room.mode === 'always' ? 'Réponse à chaque message' : 'Réponse sur mention'} · collectif {room.swarm_id}</p><div>{data.threads.filter((thread) => thread.room_id === room.room_id).slice(0, 3).map((thread) => <button className="text-button" key={thread.thread_id} onClick={() => onThread(thread)}>{thread.question}</button>)}</div></article>)}</div></section>;
}

function DecisionsPage({ data, selected, onSelect, onChanged }) {
  if (selected) return <section className="page"><button className="text-button back" onClick={() => onSelect(null)}>← Revenir aux dossiers</button><DecisionThread thread={selected} onChanged={onChanged} /></section>;
  return <section className="page"><header className="page-header"><div><p className="context-line">Historique durable</p><h1>Décisions</h1><p>Chaque dossier conserve les analyses, preuves, objections, réponses et arbitrages.</p></div></header><div className="decision-list">{data.threads.map((thread) => <button key={thread.thread_id} onClick={() => onSelect(thread)}><div><small>{thread.thread_id} · {thread.room_id}</small><strong>{thread.question}</strong></div><span>{thread.status.replaceAll('_', ' ')}</span></button>)}</div></section>;
}

const SALES_ORACLE_TOOL_URL = '/assets/sales-oracle-tool.js';
const SALES_ORACLE_USE_CASES = [['rfp', 'Appel d’offres client'], ['comex_decision', 'Décision CODIR'], ['renewal', 'Renouvellement de contrat'], ['negotiation', 'Négociation']];
const SALES_ORACLE_SOURCE_TYPES = [['rfp', 'RFP / exigences'], ['proposal', 'Proposition / réponse'], ['contract', 'Contrat'], ['security', 'Sécurité'], ['financial', 'Finance / ROI'], ['meeting_notes', 'Notes de réunion'], ['organization', 'Organisation / comité'], ['personality_profile', 'Profil de personnalité autorisé'], ['other', 'Autre preuve']];
const SALES_ORACLE_STAGES = { hashing: 'empreinte SHA-256 locale', signing: 'autorisation d’upload sécurisée', uploading: 'upload direct chiffré', verifying: 'vérification d’intégrité', queued: 'mise en file d’ingestion' };

function SalesOraclePage() {
  const clientRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [toolError, setToolError] = useState('');
  const [cases, setCases] = useState([]);
  const [currentCase, setCurrentCase] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [status, setStatus] = useState({ text: 'Ouverture de l’espace sécurisé…', tone: 'neutral' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    import(/* @vite-ignore */ SALES_ORACLE_TOOL_URL).then((mod) => {
      if (!alive) return;
      const client = new mod.SalesOracleClient();
      client.setToken(getToken());
      clientRef.current = client;
      setReady(true);
      setStatus({ text: 'Espace sécurisé connecté avec votre session console.', tone: 'success' });
      client.listCases().then((result) => setCases(result.cases || [])).catch((error) => setStatus({ text: error.message || 'Chargement des dossiers impossible.', tone: 'error' }));
    }).catch(() => {
      if (!alive) return;
      setToolError('Module Sales Oracle non chargé : il est servi avec le site principal (assets du site).');
      setStatus({ text: 'Module non disponible dans ce contexte.', tone: 'error' });
    });
    return () => { alive = false; };
  }, []);

  const openCase = async (client, record) => {
    setCurrentCase(record);
    if (!record) { setDocuments([]); return; }
    const result = await client.listDocuments(record.case_id);
    setDocuments(result.documents || []);
  };

  const selectCase = async (event) => {
    const client = clientRef.current; if (!client) return;
    const record = cases.find((item) => item.case_id === event.target.value) || null;
    setBusy(true);
    try { await openCase(client, record); setStatus({ text: record ? `Dossier actif : ${record.name}` : 'Aucun dossier sélectionné.', tone: 'success' }); }
    catch (error) { setStatus({ text: error.message || 'Erreur.', tone: 'error' }); }
    finally { setBusy(false); }
  };

  const createCase = async (event) => {
    event.preventDefault();
    const client = clientRef.current; if (!client) return;
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    setBusy(true); setStatus({ text: 'Création du dossier gouverné…', tone: 'neutral' });
    try {
      const created = await client.createCase({ name: data.get('name'), use_case: data.get('use_case'), decision_question: data.get('decision_question') });
      const result = await client.listCases(); setCases(result.cases || []);
      await openCase(client, created);
      formElement.reset();
      setStatus({ text: `Dossier « ${created.name || created.case_id} » créé et actif.`, tone: 'success' });
    } catch (error) { setStatus({ text: error.message || 'Erreur.', tone: 'error' }); }
    finally { setBusy(false); }
  };

  const upload = async (event) => {
    event.preventDefault();
    const client = clientRef.current; if (!client || !currentCase) return;
    const formElement = event.currentTarget;
    const files = [...formElement.elements.files.files];
    if (!files.length) { setStatus({ text: 'Sélectionnez au moins un document.', tone: 'error' }); return; }
    const sourceType = new FormData(formElement).get('source_type');
    setBusy(true);
    try {
      for (const file of files) {
        await client.uploadDocument(currentCase.case_id, file, { sourceType, onStage: (stage) => setStatus({ text: `${file.name} · ${SALES_ORACLE_STAGES[stage] || stage}`, tone: 'neutral' }) });
      }
      const result = await client.listDocuments(currentCase.case_id);
      setDocuments(result.documents || []); formElement.reset();
      setStatus({ text: `${files.length} document(s) vérifié(s) et mis en file d’ingestion.`, tone: 'success' });
    } catch (error) { setStatus({ text: error.message || 'Erreur.', tone: 'error' }); }
    finally { setBusy(false); }
  };

  return <section className="page">
    <header className="page-header"><div><p className="context-line">Espace client sécurisé</p><h1>Sales Oracle</h1><p>Cadrez le dossier, chargez les preuves : le corpus reste isolé par client et alimente le collectif d’analyse. La session console est réutilisée, aucun second login.</p></div></header>
    {toolError && <p className="inline-error">{toolError}</p>}
    <p className={`form-error ${status.tone === 'error' ? '' : 'is-empty'}`} role="status" aria-live="polite">{status.text}</p>
    <div className="sales-oracle-grid">
      <section className="so-panel">
        <h2>Dossier de décision</h2>
        <label>Dossiers existants<select value={currentCase?.case_id || ''} onChange={selectCase} disabled={!ready || busy}>{cases.length ? <option value="">Sélectionner…</option> : <option value="">Aucun dossier — créez-en un ci-dessous</option>}{cases.map((item) => <option key={item.case_id} value={item.case_id}>{item.name} · {item.status}</option>)}</select></label>
        <form onSubmit={createCase}>
          <label>Nom du dossier<input name="name" required maxLength={300} /></label>
          <label>Simulation<select name="use_case">{SALES_ORACLE_USE_CASES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Question de décision<textarea name="decision_question" required maxLength={12000} rows={4} /></label>
          <button className="button primary" disabled={!ready || busy}>Créer le dossier</button>
        </form>
      </section>
      <section className="so-panel">
        <h2>Preuves</h2>
        {currentCase ? <form onSubmit={upload}>
          <p className="muted">Dossier actif : <strong>{currentCase.name}</strong></p>
          <label>Rôle du document<select name="source_type">{SALES_ORACLE_SOURCE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Documents<input name="files" type="file" multiple accept=".pdf,.docx,.txt,.md,.csv" /></label>
          <button className="button primary" disabled={busy}>Vérifier et uploader</button>
        </form> : <p className="muted">Sélectionnez ou créez un dossier pour charger les preuves.</p>}
        <h3 className="so-kicker">Corpus actif</h3>
        <ul className="so-documents">{documents.length ? documents.map((item) => <li key={item.document_id}><span>{item.original_filename}</span><span className="so-state">{item.status}</span></li>) : <li className="muted">Aucun document dans le corpus actif.</li>}</ul>
        <p className="muted so-privacy">PDF, DOCX, TXT, Markdown ou CSV · 50 Mo/document · 20 documents/dossier · 250 Mo/dossier. Empreinte SHA-256 calculée localement, envoi par URL signée à durée limitée.</p>
      </section>
    </div>
  </section>;
}

function Console() {
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [page, setPage] = useState(() => location.hash.slice(1) || 'overview');
  const [roomPlatform, setRoomPlatform] = useState(null); const [selectedThread, setSelectedThread] = useState(null);
  async function refresh() { try { setData(await api.overview()); setError(''); } catch (err) { setError(err.message); if (err.status === 401) { setToken(''); location.reload(); } } }
  useEffect(() => { refresh(); const change = () => setPage(location.hash.slice(1) || 'overview'); addEventListener('hashchange', change); const timer = setInterval(refresh, 20000); return () => { removeEventListener('hashchange', change); clearInterval(timer); }; }, []);
  async function openThread(thread) {
    if (!thread) { setSelectedThread(null); return; }
    const result = thread.messages ? { thread } : await api.thread(thread.thread_id);
    setSelectedThread(result.thread);
    location.hash = 'activity';
  }
  if (!data) return <div className="loading-screen">{error || 'Chargement de la console…'}</div>;
  return <div className="app-shell"><aside className="sidebar"><a className="wordmark" href="/">KayrosLab</a><nav>{pages.map(([id, label]) => <a key={id} className={page === id ? 'active' : ''} href={`#${id}`}><Mark name={id} />{label}</a>)}</nav><div className="account"><span>{data.user.email[0].toUpperCase()}</span><div><strong>{data.user.email}</strong><small>{data.user.role}</small></div><button onClick={() => { setToken(''); location.reload(); }}>↗</button></div></aside>
    <main className="console-main">{error && <p className="inline-error">Actualisation impossible : {error}</p>}{page === 'overview' && <Overview data={data} refresh={refresh} openRoom={() => setRoomPlatform('slack')} onThread={openThread} />}{page === 'rooms' && <RoomsPage data={data} openRoom={() => setRoomPlatform('slack')} onThread={openThread} />}{page === 'agents' && <AgentsPage data={data} refresh={refresh} />}{page === 'activity' && <DecisionsPage data={data} selected={selectedThread} onSelect={openThread} onChanged={(thread) => { setSelectedThread(thread); refresh(); }} />}{page === 'salesoracle' && <SalesOraclePage />}{page === 'settings' && <SettingsPage data={data} refresh={refresh} openRoom={setRoomPlatform} />}</main>
    {roomPlatform && <CreateRoom agents={data.agents} defaultPlatform={roomPlatform} onClose={() => setRoomPlatform(null)} onCreated={refresh} />}
  </div>;
}

export default function App() { const [authenticated, setAuthenticated] = useState(Boolean(getToken())); return authenticated ? <Console /> : <Login onLogin={() => setAuthenticated(true)} />; }
