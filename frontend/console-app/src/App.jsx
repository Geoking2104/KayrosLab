import { useEffect, useRef, useState } from 'react';
import { api, getToken, setToken } from './api.js';

// La console est un harness d'agents : registre d'agents (métier ou hybride),
// collectifs, sessions gouvernées, missions, dossiers et arbitrage humain.
// L'expérience littéraire vit dans une application séparée, hors de cette surface.
const platformNames = { slack: 'Slack', discord: 'Discord', teams: 'Microsoft Teams', console: 'Console' };
const pages = [
  ['overview', 'Harness'], ['sessions', 'Sessions'], ['agents', 'Agents'], ['activity', 'Décisions'], ['settings', 'Réglages'],
];
const votingThresholds = [['majority', 'Majorité'], ['unanimous', 'Unanimité'], ['veto_power_csuite', 'Veto comité exécutif']];
const votingLabel = (value) => votingThresholds.find(([id]) => id === value)?.[1] || 'Majorité';
const connectorFields = {
  slack: [['bot_token', 'Jeton du bot', true], ['signing_secret', 'Secret de signature', true], ['webhook_url', 'Webhook sortant (facultatif)', true]],
  discord: [['application_id', 'Application ID', false], ['bot_token', 'Jeton du bot', true], ['public_key', 'Clé publique Ed25519', true], ['webhook_url', 'Webhook sortant (facultatif)', true]],
  teams: [['app_id', 'Microsoft App ID', false], ['bot_password', 'Secret client', true], ['webhook_url', 'Webhook entrant (facultatif)', true]],
};
const connectLabel = { slack: 'Connecter Slack', discord: 'Ajouter le bot Discord', teams: 'Autoriser Microsoft Teams' };

function splitLines(value) { return String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean); }
function splitCsv(value) { return String(value || '').split(',').map((item) => item.trim()).filter(Boolean); }
function jsonValue(value, fallback = {}) { try { return JSON.parse(value || '{}'); } catch { return fallback; } }
function verdictLabel(value) { return String(value || '—').replaceAll('_', ' '); }
function readFileText(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(new Error('Lecture du fichier impossible.')); reader.readAsText(file); }); }

function randomUrlToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let bin = '';
  buf.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const bytes = Array.from(new Uint8Array(digest));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function ssoRedirectUri() {
  const path = location.pathname.replace(/index\.html$/, '');
  const normalized = `${path.endsWith('/') ? path : `${path}/`}` || '/console/';
  return `${location.origin}${normalized.startsWith('/console') ? normalized : '/console/'}`;
}

function Mark({ name }) {
  const labels = { overview: '▦', sessions: '▤', agents: '◉', activity: '✓', settings: '⚙' };
  return <span className="nav-mark" aria-hidden="true">{labels[name]}</span>;
}

function Login({ onLogin }) {
  const resetToken = new URLSearchParams(String(location.hash).split('?')[1] || '').get('token') || '';
  const [mode, setMode] = useState(resetToken ? 'reset' : 'login'); const [name, setName] = useState(''); const [email, setEmail] = useState('');
  const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState(''); const [state, setState] = useState('idle'); const [error, setError] = useState('');
  const [sso, setSso] = useState(null);
  const registration = mode === 'register'; const forgotten = mode === 'forgot'; const resetting = mode === 'reset';
  useEffect(() => {
    const syncResetLink = () => {
      const token = new URLSearchParams(String(location.hash).split('?')[1] || '').get('token');
      if (String(location.hash).startsWith('#reset-password') && token) { setMode('reset'); setState('idle'); setError(''); }
    };
    addEventListener('hashchange', syncResetLink); syncResetLink();
    return () => removeEventListener('hashchange', syncResetLink);
  }, []);
  useEffect(() => {
    let cancelled = false;
    api.ssoConfig().then((config) => { if (!cancelled) setSso(config); }).catch(() => { if (!cancelled) setSso({ enabled: false }); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const returnedState = params.get('state');
    if (!code || !returnedState) return;
    const stored = sessionStorage.getItem('kayros_sso');
    history.replaceState({}, '', location.pathname);
    if (!stored) { setError('Session SSO expirée. Recommencez.'); return; }
    let payload;
    try { payload = JSON.parse(stored); } catch { setError('Session SSO illisible.'); return; }
    sessionStorage.removeItem('kayros_sso');
    if (payload.state !== returnedState) { setError('État SSO invalide.'); return; }
    setState('loading');
    api.ssoCallback({
      code,
      codeVerifier: payload.verifier,
      redirectUri: payload.redirectUri,
      nonce: payload.nonce,
    }).then((result) => {
      setToken(result.token);
      onLogin();
    }).catch((err) => { setState('error'); setError(err.message); });
  }, [onLogin]);
  async function startSso() {
    setState('loading'); setError('');
    try {
      const verifier = randomUrlToken(48);
      const state = randomUrlToken(16);
      const nonce = randomUrlToken(16);
      const challenge = await pkceChallenge(verifier);
      const redirectUri = ssoRedirectUri();
      sessionStorage.setItem('kayros_sso', JSON.stringify({ verifier, state, nonce, redirectUri }));
      const started = await api.ssoStart({ redirectUri, state, challenge, nonce });
      location.assign(started.url);
    } catch (err) { setState('error'); setError(err.message); }
  }
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
  const showSso = sso?.enabled && !forgotten && !resetting && state !== 'sent' && state !== 'reset';
  return <main className="login-shell">
    <section className="login-copy"><a className="wordmark" href="/">KayrosLab</a><h1>Décider avec un collectif explicite.</h1><p>Composez des collectifs d'agents, lancez des missions gouvernées et gardez chaque verdict sous arbitrage humain.</p></section>
    <form className="login-form" onSubmit={submit}><h2>{registration ? 'Créer votre espace' : forgotten ? 'Mot de passe oublié' : resetting ? 'Choisir un nouveau mot de passe' : 'Ouvrir la console'}</h2>
      {forgotten && <p className="auth-help">Saisissez votre adresse. Si elle correspond à un compte, nous vous enverrons un lien de vérification valable 30 minutes.</p>}
      {resetting && <p className="auth-help">Le lien reçu par e-mail vérifie votre demande. Choisissez un mot de passe d’au moins 10 caractères.</p>}
      {showSso && <button type="button" className="button secondary sso-button" onClick={startSso} disabled={state === 'loading'}>{state === 'loading' ? 'Redirection…' : 'Continuer avec SSO'}</button>}
      {showSso && <p className="auth-or">OpenID Connect · hébergé ici</p>}
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
    <div><strong>{platformNames[connection.platform]}</strong><small>{connection.source === 'environment' ? 'variables serveur' : 'console'}</small></div>
    <span className="connection-state">{connected ? 'Connecté' : connection.status === 'configured' ? 'À tester' : connection.status === 'disabled' ? 'Désactivé' : connection.status === 'error' ? 'Erreur' : 'À configurer'}</span>
  </div>;
}

function AgentChips({ agents }) {
  if (!agents?.length) return null;
  return <div className="collective-chips">{agents.map((agent) => <span className="collective-chip" key={agent.agent_id}>
    <span><strong>{agent.display_name}</strong><small>{agent.department}</small></span>
    {agent.hybrid ? <em title="Profil hybride conssenti">hybride</em> : null}
    {agent.impersonator ? <em title="Persona simulée (impersonator)">persona</em> : null}
    {agent.veto_power ? <em title="Pouvoir de veto">veto</em> : null}
  </span>)}</div>;
}

function CreateSession({ agents, onClose, onCreated }) {
  const active = agents.filter((agent) => agent.enabled !== false);
  const [form, setForm] = useState({ name: '', active_agents: active.slice(0, 3).map((agent) => agent.agent_id), voting_threshold: 'majority' });
  const [state, setState] = useState('idle'); const [error, setError] = useState('');
  function toggle(id) { setForm((current) => ({ ...current, active_agents: current.active_agents.includes(id) ? current.active_agents.filter((item) => item !== id) : [...current.active_agents, id] })); }
  async function submit(event) { event.preventDefault(); setState('loading'); setError(''); try { await api.createSession(form); await onCreated(); onClose(); } catch (err) { setState('error'); setError(err.message); } }
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog wide" role="dialog" aria-modal="true">
    <header><div><h2>Ouvrir une session</h2><p>Une session fixe un collectif stable : elle garde son journal d'exécution et ses dossiers.</p></div><button className="icon-button" onClick={onClose}>×</button></header>
    <form onSubmit={submit}><label>Nom de la session<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex. Comité d'investissement" required /></label>
      <fieldset><legend>Collectif actif</legend><div className="agent-picker">{active.map((agent) => <label className="agent-check" key={agent.agent_id}><input type="checkbox" checked={form.active_agents.includes(agent.agent_id)} onChange={() => toggle(agent.agent_id)} /><span><strong>{agent.display_name || agent.role_name}</strong><small>{agent.department}</small></span></label>)}</div></fieldset>
      <label>Seuil de consensus<select value={form.voting_threshold} onChange={(event) => setForm({ ...form, voting_threshold: event.target.value })}>{votingThresholds.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <p className={`form-error ${error ? '' : 'is-empty'}`}>{error || '\u00a0'}</p><footer><button type="button" className="button secondary" onClick={onClose}>Annuler</button><button className="button primary" disabled={state === 'loading' || !form.active_agents.length}>{state === 'loading' ? 'Ouverture…' : 'Ouvrir la session'}</button></footer>
    </form>
  </section></div>;
}

/** Trace d'exécution : une mission = instruction humaine → une étape par agent → consensus → arbitrage. */
function RunTrace({ run }) {
  const steps = [];
  for (const entry of run?.audit || []) {
    if (entry.type === 'swarm.agent.verdict') steps.push({ key: `agent-${entry.agent_id}`, label: `Analyse · ${entry.agent_id}`, value: verdictLabel(entry.verdict) });
    else if (entry.type === 'swarm.run.completed') steps.push({ key: 'consensus', label: 'Agrégation du consensus', value: verdictLabel(entry.consensus) });
  }
  if (!steps.length) return null;
  return <div className="harness-trace"><p className="section-kicker">Trace du harness</p><ol>{steps.map((step, index) => <li key={step.key}><span>{String(index + 1).padStart(2, '0')}</span><strong>{step.label}</strong><em>{step.value}</em></li>)}</ol></div>;
}

function RunDossier({ run }) {
  if (!run) return null;
  const risks = [...new Set((run.analyses || []).flatMap((item) => item.critical_risks || []))];
  const conditions = [...new Set((run.analyses || []).flatMap((item) => item.required_mitigations || []))];
  return <article className="dossier"><header><div><small>Dossier {run.run_id}</small><h3>{run.swarm_name}</h3></div><span className={`verdict is-${String(run.consensus?.verdict || '').toLowerCase()}`}>{verdictLabel(run.consensus?.verdict)}</span></header>
    <p className="synthesis">{run.consensus?.rationale}</p>
    <RunTrace run={run} />
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
  return <section className="thread-view"><header><div><small>Fil {thread.thread_id} · session {thread.room_id}</small><h2>{thread.question}</h2></div><span className="thread-status">{thread.status.replaceAll('_', ' ')}</span></header>
    <div className="timeline">{(thread.messages || []).map((message) => <div className={`thread-message is-${message.role}`} key={message.message_id || `${message.kind}-${message.created_at}`}>
      {message.kind === 'run' ? <RunDossier run={message.run} /> : <><small>{message.role === 'human' ? message.author_id || 'Décideur' : 'Collectif Kayros'} · {message.kind}</small>{message.text && <p>{message.text}</p>}{message.questions?.length > 0 && <ol>{message.questions.map((question) => <li key={question}>{question}</li>)}</ol>}{message.decision && <p>Arbitrage : {message.decision.action} · {verdictLabel(message.decision.verdict)}</p>}</>}
    </div>)}</div>
    {thread.status !== 'resolved' && <><form className="thread-reply" onSubmit={answer}><label>Réponse humaine et paramètres complémentaires<textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Budget validé à 120 k€, responsable : …, preuve disponible : …" /></label><button className="button primary" disabled={!reply.trim() || state === 'loading'}>{state === 'loading' ? 'Relance…' : 'Répondre et relancer le même collectif'}</button></form>
      <div className="arbitration"><div><strong>Arbitrage humain</strong><small>Le verdict reste consultatif jusqu’à cette étape.</small></div><button className="button secondary" onClick={() => arbitrate('reevaluate')}>Demander une réévaluation</button><button className="button secondary" onClick={() => arbitrate('override_veto', 'CONDITIONAL_GO')}>Passer sous conditions</button><button className="button primary" onClick={() => arbitrate('accept_consensus')}>Accepter le consensus</button></div></>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}

function Overview({ data, refresh, openSession, onThread }) {
  const [selectedSession, setSelectedSession] = useState(() => data.sessions[0]?.session_id || null);
  useEffect(() => {
    setSelectedSession((current) => (current && data.sessions.some((session) => session.session_id === current) ? current : (data.sessions[0]?.session_id || '')));
  }, [data.sessions]);
  const [question, setQuestion] = useState(''); const [state, setState] = useState('idle'); const [error, setError] = useState('');
  const soClientRef = useRef(null);
  const [soReady, setSoReady] = useState(false);
  const [soCases, setSoCases] = useState([]);
  const [soCaseId, setSoCaseId] = useState('');
  const [soDocs, setSoDocs] = useState([]);
  const [soManage, setSoManage] = useState(false);
  const [soStatus, setSoStatus] = useState(null);
  const soCase = soCases.find((item) => item.case_id === soCaseId) || null;
  useEffect(() => {
    let alive = true;
    import(/* @vite-ignore */ SALES_ORACLE_TOOL_URL).then((mod) => {
      if (!alive) return;
      const client = new mod.SalesOracleClient();
      client.setToken(getToken());
      soClientRef.current = client;
      setSoReady(true);
      client.listCases().then((result) => { if (alive) setSoCases(result.cases || []); }).catch(() => {});
    }).catch(() => { /* module indisponible : la mission gouvernée fonctionne sans dossier client */ });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const client = soClientRef.current;
    if (!client || !soCaseId) { setSoDocs([]); return; }
    let alive = true;
    client.listDocuments(soCaseId).then((result) => { if (alive) setSoDocs(result.documents || []); }).catch(() => { if (alive) setSoDocs([]); });
    return () => { alive = false; };
  }, [soCaseId, soReady]);
  const session = data.sessions.find((item) => item.session_id === selectedSession);
  async function run(event) {
    event.preventDefault(); if (!session) return; setState('loading'); setError('');
    try {
      let context;
      if (soCase) {
        const lines = soDocs.map((doc) => `- ${doc.original_filename} (${soSourceTypeLabel(doc.source_type)} · ${doc.status})`);
        context = [
          `Dossier Sales Oracle « ${soCase.name} » — ${soUseCaseLabel(soCase.use_case)}`,
          `Question du dossier : ${soCase.decision_question}`,
          lines.length ? `Corpus joint (${lines.length} document(s)) :\n${lines.join('\n')}` : 'Corpus : aucun document chargé pour ce dossier.',
        ].join('\n').slice(0, SALES_ORACLE_CONTEXT_LIMIT);
      }
      const result = await api.runMission(session.session_id, question, context);
      setQuestion(''); setState('success'); onThread(result.thread); await refresh();
    } catch (err) { setState('error'); setError(err.message); }
  }
  return <><header className="console-header"><div><p className="context-line">Espace {data.user.tenantId}</p><h1>Console harness</h1><p>Composez un collectif, lancez une mission gouvernée, arbitrez sur preuves.</p></div><button className="button primary" onClick={openSession}>Nouvelle session</button></header>
    <section className="connection-strip">{data.connections.map((item) => <Connection key={item.platform} connection={item} />)}</section>
    <section className="metric-row"><div><strong>{data.summary.agents}</strong><span>Agents actifs</span></div><div><strong>{data.summary.sessions}</strong><span>Sessions</span></div><div><strong>{data.summary.executions}</strong><span>Exécutions</span></div><div><strong>{data.summary.pending_human_decisions}</strong><span>Arbitrages ouverts</span></div></section>
    <div className="mission-workbench"><section><header><div><h2>Mission gouvernée</h2><p>Instruction → une étape par agent → consensus → dossier durable → arbitrage.</p></div></header>
      <label>Session<select value={selectedSession || ''} onChange={(event) => setSelectedSession(event.target.value)}><option value="">Sélectionner…</option>{data.sessions.map((item) => <option value={item.session_id} key={item.session_id}>{item.name} · {item.collective.active_agents.length} agents</option>)}</select></label>
      {session && <AgentChips agents={session.collective.agents} />}
      {!data.sessions.length && <p className="muted">Aucune session — ouvrez-en une pour lancer une mission.</p>}
      <form onSubmit={run}><label>Question à instruire<textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Faut-il lancer ce projet maintenant, avec quel budget et sous quelles conditions ?" /></label><button className="button primary" disabled={!session || !question.trim() || state === 'loading'}>{state === 'loading' ? 'Analyses individuelles en cours…' : 'Lancer le collectif'}</button></form>
      <section className="so-strip">
        <h3 className="so-kicker">Dossier Sales Oracle — preuves client (facultatif)</h3>
        <label>Dossier à joindre au collectif<select value={soCaseId} onChange={(event) => setSoCaseId(event.target.value)} disabled={!soReady}><option value="">Aucun dossier</option>{soCases.map((item) => <option key={item.case_id} value={item.case_id}>{item.name} · {soUseCaseLabel(item.use_case)}</option>)}</select></label>
        {soCase && <p className="muted so-note">Corpus : {soDocs.length} document(s) — la question du dossier et la liste des preuves sont injectées dans le contexte du collectif.</p>}
        <button type="button" className="text-button" onClick={() => setSoManage((current) => !current)}>{soManage ? 'Masquer la gestion des dossiers' : 'Créer un dossier / charger des preuves'}</button>
        {soManage && <SalesOracleManager ready={soReady} clientRef={soClientRef} currentCase={soCase} documents={soDocs} onCases={setSoCases} onDocs={setSoDocs} onStatus={setSoStatus} />}
        {soStatus && <p className={`form-error ${soStatus.tone === 'error' ? '' : 'is-empty'}`} role="status">{soStatus.text || '\u00a0'}</p>}
      </section>
      {error && <p className="inline-error">{error}</p>}
    </section><section><header><div><h2>Exécutions récentes</h2><p>Reprendre une mission avec tout son contexte.</p></div><a className="text-button" href="#activity">Tout voir</a></header>
      <div className="thread-list">{data.threads.filter((item) => item.status !== 'resolved').slice(0, 6).map((item) => <button key={item.thread_id} onClick={() => onThread(item)}><strong>{item.question}</strong><small>{item.status.replaceAll('_', ' ')} · {item.current_run_id}</small></button>)}{!data.threads.length && <p className="muted">Aucune mission lancée.</p>}</div>
    </section></div>
  </>;
}

/** Panneau de profil humain : import Crystal Knows / LinkedIn, export autorisé ou saisie manuelle. */
function HumanProfilePanel({ onImported, disabled }) {
  const [source, setSource] = useState('crystalknows');
  const [email, setEmail] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [exportSource, setExportSource] = useState('crystalknows');
  const [file, setFile] = useState(null);
  const [manual, setManual] = useState({ assigned_name: '', disc_type: '', tone: '', motivators: '', directives: '', summary: '' });
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState('idle'); const [error, setError] = useState('');

  function payload() {
    if (source === 'manual') {
      const manual_profile = {
        assigned_name: manual.assigned_name || undefined,
        disc_type: manual.disc_type || undefined,
        core_motivators: splitCsv(manual.motivators),
        profile_summary: splitLines(manual.summary),
        communication_style: { tone: manual.tone || undefined, communication_directives: splitCsv(manual.directives) },
        consent_confirmed: true,
      };
      return { consent_confirmed: true, manual_profile };
    }
    if (source === 'upload') {
      if (!file) throw new Error('Sélectionnez un fichier de profil (JSON ou texte).');
      return { consent_confirmed: true, imports: [{ source: exportSource, profile_data: jsonValue(file.text, null) || { name: file.text } }] };
    }
    if (source === 'linkedin') {
      if (!linkedin.trim()) throw new Error('URL LinkedIn requise.');
      return { consent_confirmed: true, imports: [{ source: 'linkedin', linkedin_url: linkedin.trim() }] };
    }
    if (!email.trim() && !linkedin.trim()) throw new Error('E-mail ou URL LinkedIn requis pour Crystal Knows.');
    return { consent_confirmed: true, imports: [{ source: 'crystalknows', email: email.trim() || undefined, linkedin_url: linkedin.trim() || undefined }] };
  }

  async function pickFile(event) {
    const chosen = event.target.files?.[0]; if (!chosen) return;
    try { setFile({ name: chosen.name, text: await readFileText(chosen) }); setError(''); }
    catch (err) { setError(err.message); }
  }

  async function submit(event) {
    event.preventDefault(); setError('');
    if (!consent) { setError('Consentement explicite requis avant tout import de profil.'); return; }
    setState('loading');
    try { const body = payload(); await onImported(body); setState('success'); }
    catch (err) { setState('error'); setError(err.message); }
  }

  return <section className="profile-panel">
    <h3 className="so-kicker">Profil humain (facultatif)</h3>
    <p className="muted so-note">Un agent hybride combine une mission explicite et un profil de communication consenti. Importez un profil Crystal Knows / LinkedIn, chargez un export autorisé, ou saisissez-le.</p>
    <label>Source du profil<select value={source} onChange={(event) => { setSource(event.target.value); setError(''); }} disabled={disabled}>
      <option value="crystalknows">Crystal Knows (e-mail / LinkedIn)</option>
      <option value="linkedin">LinkedIn (profil autorisé)</option>
      <option value="upload">Export autorisé (fichier)</option>
      <option value="manual">Saisie manuelle</option>
    </select></label>
    {(source === 'crystalknows' || source === 'linkedin') && <>
      <div className="form-grid"><label>E-mail professionnel<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Optionnel" /></label><label>URL LinkedIn<input value={linkedin} onChange={(event) => setLinkedin(event.target.value)} placeholder="https://www.linkedin.com/in/…" /></label></div>
    </>}
    {source === 'upload' && <>
      <label>Type d'export<select value={exportSource} onChange={(event) => setExportSource(event.target.value)}><option value="crystalknows">Crystal Knows</option><option value="linkedin">LinkedIn</option></select></label>
      <label>Fichier de profil (.json / .txt)<input type="file" accept=".json,.txt,.md" onChange={pickFile} />{file ? <small>{file.name}</small> : null}</label>
    </>}
    {source === 'manual' && <>
      <div className="form-grid"><label>Nom du profil<input value={manual.assigned_name} onChange={(event) => setManual({ ...manual, assigned_name: event.target.value })} /></label><label>Profil DISC<input value={manual.disc_type} onChange={(event) => setManual({ ...manual, disc_type: event.target.value })} placeholder="Ex. D/C" /></label></div>
      <label>Ton préféré<input value={manual.tone} onChange={(event) => setManual({ ...manual, tone: event.target.value })} /></label>
      <label>Motivateurs · séparés par des virgules<input value={manual.motivators} onChange={(event) => setManual({ ...manual, motivators: event.target.value })} /></label>
      <label>Directives de communication · séparées par des virgules<input value={manual.directives} onChange={(event) => setManual({ ...manual, directives: event.target.value })} /></label>
      <label>Résumé · une ligne par élément<textarea value={manual.summary} onChange={(event) => setManual({ ...manual, summary: event.target.value })} /></label>
    </>}
    <label className="consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />La personne a consenti à cet usage de profil pour la communication et la collaboration. Pas de recrutement, crédit ou décision à impact matériel.</label>
    <p className={`form-error ${error ? '' : 'is-empty'}`} role={error ? 'alert' : undefined}>{error || '\u00a0'}</p>
    <div className="connector-actions"><button type="button" className="button secondary" onClick={submit} disabled={disabled || state === 'loading'}>{state === 'loading' ? 'Import…' : 'Importer le profil'}</button></div>
  </section>;
}

const emptyAgent = { agent_id: '', display_name: '', role_name: '', department: '', seniority: 'senior', primary_focus: '', mission: '', instructions: '', constraints: '', provider: '', model: '', tools: '', connectors: ['console'], rules: '', metadata: '{}', behavioral: '{}', enabled: true, veto_power: false };

/** Agent impersonateur : persona reconstruite depuis des indices (LinkedIn / Crystal Knows) pour éprouver une idée. */
function ImpersonatorDialog({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', role: '', company: '', source: 'linkedin', linkedin_url: '', report_url: '', email: '', purpose: 'idea_test', clues: '', veto_power: true, agent_id: '' });
  const [exportSource, setExportSource] = useState('crystalknows');
  const [file, setFile] = useState(null);
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState('idle'); const [error, setError] = useState(''); const [result, setResult] = useState(null);
  async function pickFile(event) { const chosen = event.target.files?.[0]; if (!chosen) return; try { setFile({ name: chosen.name, text: await readFileText(chosen) }); setError(''); } catch (err) { setError(err.message); } }
  async function submit(event) {
    event.preventDefault(); setError('');
    if (!consent) { setError('Consentement explicite requis avant de reconstruire une persona.'); return; }
    setState('loading');
    try {
      const body = {
        name: form.name.trim(), role: form.role.trim() || undefined, company: form.company.trim() || undefined,
        source: form.source, purpose: form.purpose, veto_power: form.veto_power,
        clues: splitLines(form.clues), agent_id: form.agent_id.trim() || undefined,
        consent_confirmed: true,
      };
      if (form.source === 'linkedin') body.linkedin_url = form.linkedin_url.trim() || undefined;
      if (form.source === 'crystalknows') { body.email = form.email.trim() || undefined; body.linkedin_url = form.linkedin_url.trim() || undefined; body.report_url = form.report_url.trim() || undefined; }
      if (form.source === 'export') { if (!file) throw new Error('Sélectionnez un export autorisé (JSON).'); body.export_source = exportSource; body.profile_data = jsonValue(file.text, null) || { name: form.name, summary: file.text }; }
      const response = await api.createImpersonator(body);
      setResult(response); setState('success'); await onCreated(response.agent);
    } catch (err) { setState('error'); setError(err.message); }
  }
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog wide" role="dialog" aria-modal="true">
    <header><div><h2>Ajouter un agent impersonator</h2><p>Reconstruire la persona d'une partie prenante à partir d'indices autorisés (LinkedIn, rapport Crystal Knows, export) pour éprouver une idée.</p></div><button className="icon-button" onClick={onClose}>×</button></header>
    {!result ? <form onSubmit={submit}>
      <div className="form-grid three"><label>Personne simulée<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Ex. Directrice achats" /></label><label>Fonction<input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Ex. VP Procurement" /></label><label>Organisation<input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label></div>
      <div className="form-grid"><label>Source des indices<select value={form.source} onChange={(e) => { setForm({ ...form, source: e.target.value }); setError(''); }}><option value="linkedin">Profil LinkedIn (indices)</option><option value="crystalknows">Rapport Crystal Knows</option><option value="export">Export autorisé (fichier)</option><option value="manual">Indices manuels</option></select></label><label>Objectif<select value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}><option value="idea_test">Éprouver une idée</option><option value="objection_rehearsal">Répétition des objections</option><option value="pitch_review">Revue de pitch</option></select></label></div>
      {(form.source === 'linkedin' || form.source === 'crystalknows') && <div className="form-grid"><label>URL LinkedIn<input value={form.linkedin_url} onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })} placeholder="https://www.linkedin.com/in/…" /></label><label>E-mail (Crystal Knows)<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Optionnel" /></label></div>}
      {form.source === 'crystalknows' && <label>URL du rapport Crystal Knows<input value={form.report_url} onChange={(e) => setForm({ ...form, report_url: e.target.value })} placeholder="https://…crystalknows.com/…" /></label>}
      {form.source === 'export' && <div className="form-grid"><label>Type d'export<select value={exportSource} onChange={(e) => setExportSource(e.target.value)}><option value="crystalknows">Crystal Knows</option><option value="linkedin">LinkedIn</option></select></label><label>Fichier (.json)<input type="file" accept=".json,.txt" onChange={pickFile} />{file ? <small>{file.name}</small> : null}</label></div>}
      {form.source === 'manual' && <label>Indices · une ligne par élément<textarea value={form.clues} onChange={(e) => setForm({ ...form, clues: e.target.value })} placeholder="Ex. décide vite, exige des preuves chiffrées, sceptique sur le TCO…" /></label>}
      <div className="form-grid"><label>Identifiant (optionnel)<input value={form.agent_id} onChange={(e) => setForm({ ...form, agent_id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} placeholder="auto" /></label><label className="consent"><input type="checkbox" checked={form.veto_power} onChange={(e) => setForm({ ...form, veto_power: e.target.checked })} />Pouvoir de veto (objection bloquante)</label></div>
      <label className="consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />La personne concernée a consenti à cette simulation pour éprouver l'idée. Aucun usage pour une décision à effet matériel.</label>
      <p className={`form-error ${error ? '' : 'is-empty'}`} role={error ? 'alert' : undefined}>{error || '\u00a0'}</p>
      <footer><button type="button" className="button secondary" onClick={onClose}>Annuler</button><button className="button primary" disabled={state === 'loading'}>{state === 'loading' ? 'Reconstruction…' : 'Créer l\'agent impersonator'}</button></footer>
    </form> : <>
      <p className="auth-success" role="status">Agent « {result.agent.display_name} » créé ({result.agent.agent_id}). Personnalité intégrée au registre : ajoutez-le à un collectif pour éprouver l'idée.</p>
      <h3 className="so-kicker">Persona reconstruite</h3>
      <dl className="profile-summary"><div><dt>DISC</dt><dd>{result.persona?.disc || '—'}</dd></div><div><dt>Archétype</dt><dd>{result.persona?.archetype || '—'}</dd></div><div><dt>Ton</dt><dd>{result.persona?.tone || '—'}</dd></div><div><dt>Motivateurs</dt><dd>{(result.persona?.motivators || []).join(', ') || '—'}</dd></div></dl>
      <h3 className="so-kicker">Garde-fous appliqués</h3>
      <ul className="so-booklist">{(result.guardrails || []).map((g) => <li key={g.rule_id}><span className="so-book-meta"><strong>{g.rule_id}</strong><small>{g.rule_text}</small></span></li>)}</ul>
      {result.enrichment_error && <p className="inline-error">Enrichissement du profil partiel : {result.enrichment_error}</p>}
      <footer><button type="button" className="button primary" onClick={onClose}>Terminer</button></footer>
    </>}
  </section></div>;
}
function agentForm(agent) { return agent ? { ...agent, constraints: (agent.constraints || []).join('\n'), tools: (agent.tools || []).join(', '), connectors: agent.connectors || ['console'], rules: (agent.rule_configuration?.user_added_rules || []).map((rule) => rule.rule_text).join('\n'), metadata: JSON.stringify(agent.metadata || {}, null, 2), behavioral: JSON.stringify(agent.behavioral_profile || {}, null, 2) } : emptyAgent; }

function AgentEditor({ agent, capabilities, onSaved, onClose }) {
  const editing = !!agent; const [form, setForm] = useState(() => agentForm(agent)); const [state, setState] = useState('idle'); const [error, setError] = useState('');
  function toggleConnector(id) { setForm((current) => ({ ...current, connectors: current.connectors.includes(id) ? current.connectors.filter((item) => item !== id) : [...current.connectors, id] })); }
  function payload() {
    const base = { display_name: form.display_name, role_name: form.role_name, department: form.department, seniority: form.seniority, primary_focus: form.primary_focus || form.mission, mission: form.mission, instructions: form.instructions, constraints: splitLines(form.constraints), provider: form.provider || null, model: form.model || null, tools: splitCsv(form.tools), connectors: form.connectors, enabled: form.enabled, veto_power: form.veto_power, metadata: jsonValue(form.metadata), behavioral_profile: jsonValue(form.behavioral) };
    const system = agent?.rule_configuration?.system_proposed_rules || [];
    base.rule_configuration = { system_proposed_rules: system, user_modified_rules: agent?.rule_configuration?.user_modified_rules || [], user_added_rules: splitLines(form.rules).map((rule_text, index) => ({ rule_id: `USR_${String(form.agent_id).toUpperCase()}_${index + 1}`, rule_text })) };
    return editing ? base : { ...base, agent_id: form.agent_id };
  }
  async function save(event) { event.preventDefault(); setState('loading'); setError(''); try { const result = editing ? await api.updateAgent(agent.agent_id, payload()) : await api.createAgent(payload()); setState('success'); await onSaved(result.agent); } catch (err) { setState('error'); setError(err.message); } }
  async function importProfile(body) { const result = await api.importPersonality(agent.agent_id, body); await onSaved(result.agent); }
  const profile = agent?.human_profile;
  return <div className="dialog-backdrop"><section className="dialog agent-dialog" role="dialog" aria-modal="true"><header><div><h2>{editing ? `Configurer ${agent.agent_id}` : 'Ajouter un agent'}</h2><p>Chaque paramètre devient explicite dans le contexte d’exécution.</p></div><button className="icon-button" onClick={onClose}>×</button></header>
    <form onSubmit={save}><div className="form-grid three"><label>Identifiant<input value={form.agent_id} disabled={editing} onChange={(event) => setForm({ ...form, agent_id: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} required /></label><label>Nom affiché<input value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} /></label><label>Rôle<input value={form.role_name} onChange={(event) => setForm({ ...form, role_name: event.target.value })} required /></label><label>Département<input value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} required /></label><label>Séniorité<select value={form.seniority} onChange={(event) => setForm({ ...form, seniority: event.target.value })}>{['intern', 'junior', 'senior', 'executive'].map((item) => <option key={item}>{item}</option>)}</select></label><label>Provider<select value={form.provider || ''} onChange={(event) => setForm({ ...form, provider: event.target.value })}><option value="">Routage par défaut</option>{capabilities.providers.map((item) => <option key={item}>{item}</option>)}</select></label></div>
      <label>Mission<textarea value={form.mission} onChange={(event) => setForm({ ...form, mission: event.target.value, primary_focus: event.target.value })} required /></label><label>Instructions<textarea value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} /></label>
      <div className="form-grid"><label>Contraintes · une par ligne<textarea value={form.constraints} onChange={(event) => setForm({ ...form, constraints: event.target.value })} /></label><label>Règles de décision · une par ligne<textarea value={form.rules} onChange={(event) => setForm({ ...form, rules: event.target.value })} /></label></div>
      <div className="form-grid"><label>Modèle<input value={form.model || ''} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="Optionnel" /></label><label>Outils · séparés par des virgules<input value={form.tools} onChange={(event) => setForm({ ...form, tools: event.target.value })} /></label></div>
      <fieldset><legend>Canaux autorisés</legend><div className="inline-checks">{Object.keys(platformNames).map((id) => <label key={id}><input type="checkbox" checked={form.connectors.includes(id)} onChange={() => toggleConnector(id)} />{platformNames[id]}</label>)}</div></fieldset>
      <div className="form-grid"><label>Métadonnées JSON<textarea className="code-input" value={form.metadata} onChange={(event) => setForm({ ...form, metadata: event.target.value })} /></label><label>Profil comportemental JSON<textarea className="code-input" value={form.behavioral} onChange={(event) => setForm({ ...form, behavioral: event.target.value })} /></label></div>
      <div className="inline-checks"><label><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />Agent activé</label><label><input type="checkbox" checked={form.veto_power} onChange={(event) => setForm({ ...form, veto_power: event.target.checked })} />Pouvoir de veto</label></div>
      <p className={`form-error ${error ? '' : 'is-empty'}`}>{error || '\u00a0'}</p><footer><button type="button" className="button secondary" onClick={onClose}>Fermer</button><button className="button primary" disabled={state === 'loading'}>{state === 'loading' ? 'Enregistrement…' : 'Enregistrer l’agent'}</button></footer>
    </form>
    {editing && <section className="crystal-box"><header><div><h3>Agent hybride</h3><p>{profile ? 'Profil humain consenti attaché à cet agent.' : 'Aucun profil humain pour l’instant.'}</p></div><span>{profile ? 'Hybride' : 'Agent métier'}</span></header>
      {profile && <dl className="profile-summary"><div><dt>Nom</dt><dd>{profile.assigned_name || '—'}</dd></div><div><dt>DISC</dt><dd>{profile.disc_type || '—'}</dd></div><div><dt>Ton</dt><dd>{profile.communication_style?.tone || '—'}</dd></div><div><dt>Sources</dt><dd>{(profile.profile_sources || []).map((item) => item.source).join(', ') || '—'}</dd></div></dl>}
      <HumanProfilePanel disabled={state === 'loading'} onImported={importProfile} />
    </section>}
  </section></div>;
}

/** Création d'un agent hybride : identité + mission + profil humain consenti, en un seul passage. */
function HybridAgentDialog({ onClose, onCreated }) {
  const [form, setForm] = useState({ agent_id: '', display_name: '', role_name: '', department: '', seniority: 'senior', mission: '', veto_power: false });
  const [state, setState] = useState('idle'); const [error, setError] = useState(''); const [created, setCreated] = useState(null);
  async function createHybrid(event) {
    event.preventDefault(); setState('loading'); setError('');
    try {
      const result = await api.createAgent({
        agent_id: form.agent_id, display_name: form.display_name || undefined, role_name: form.role_name,
        department: form.department, seniority: form.seniority, primary_focus: form.mission, mission: form.mission,
        connectors: ['console'], enabled: true, veto_power: form.veto_power,
      });
      setCreated(result.agent); await onCreated(result.agent);
    } catch (err) { setState('error'); setError(err.message); }
    finally { setState((current) => (current === 'loading' ? 'idle' : current)); }
  }
  async function importProfile(body) {
    const result = await api.importPersonality(created.agent_id, body);
    setCreated(result.agent); await onCreated(result.agent); setState('success');
  }
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog wide" role="dialog" aria-modal="true">
    <header><div><h2>Ajouter un agent hybride</h2><p>Un agent hybride porte une mission explicite et un profil de communication consenti.</p></div><button className="icon-button" onClick={onClose}>×</button></header>
    {!created ? <form onSubmit={createHybrid}>
      <div className="form-grid three"><label>Identifiant<input value={form.agent_id} onChange={(event) => setForm({ ...form, agent_id: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} placeholder="ex. client_cfo" required /></label><label>Nom affiché<input value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} /></label><label>Rôle<input value={form.role_name} onChange={(event) => setForm({ ...form, role_name: event.target.value })} required /></label></div>
      <div className="form-grid three"><label>Département<input value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} required /></label><label>Séniorité<select value={form.seniority} onChange={(event) => setForm({ ...form, seniority: event.target.value })}>{['intern', 'junior', 'senior', 'executive'].map((item) => <option key={item}>{item}</option>)}</select></label><label className="consent"><input type="checkbox" checked={form.veto_power} onChange={(event) => setForm({ ...form, veto_power: event.target.checked })} />Pouvoir de veto</label></div>
      <label>Mission<textarea value={form.mission} onChange={(event) => setForm({ ...form, mission: event.target.value })} required /></label>
      <div className="hybrid-steps"><span className="step is-on">1 · Identité</span><span className={`step ${created ? 'is-on' : ''}`}>2 · Profil humain</span></div>
      <p className={`form-error ${error ? '' : 'is-empty'}`} role={error ? 'alert' : undefined}>{error || '\u00a0'}</p>
      <footer><button type="button" className="button secondary" onClick={onClose}>Annuler</button><button className="button primary" disabled={state === 'loading'}>{state === 'loading' ? 'Création…' : 'Créer puis importer le profil'}</button></footer>
    </form> : <>
      <p className="auth-success" role="status">Agent « {created.display_name || created.agent_id} » créé. Importez maintenant son profil humain (facultatif).</p>
      <HumanProfilePanel disabled={state === 'loading'} onImported={importProfile} />
      <footer><button type="button" className="button primary" onClick={onClose}>Terminer</button></footer>
    </>}
  </section></div>;
}

function AgentsPage({ data, refresh }) {
  const [editing, setEditing] = useState(undefined);
  const [hybrid, setHybrid] = useState(false);
  const [impersonator, setImpersonator] = useState(false);
  async function toggle(agent) { await api.updateAgent(agent.agent_id, { enabled: agent.enabled === false }); await refresh(); }
  return <section className="page"><header className="page-header"><div><p className="context-line">Registre du tenant</p><h1>Agents</h1><p>Identité, mission, règles, modèles, outils, profil hybride consenti et personas simulées sont inspectables et modifiables.</p></div><div className="header-actions"><button className="button secondary" onClick={() => setEditing(null)}>Ajouter un agent</button><button className="button secondary" onClick={() => setHybrid(true)}>Agent hybride</button><button className="button primary" onClick={() => setImpersonator(true)}>Agent impersonator</button></div></header>
    {!data.agents.length && <p className="muted">Aucun agent — commencez par « Ajouter un agent hybride » pour rejouer le point de vue d'une partie prenante.</p>}
    <div className="agent-table">{data.agents.map((agent) => <article key={agent.agent_id} className={agent.enabled === false ? 'is-disabled' : ''}><header><div><small>{agent.agent_id} · {agent.department}</small><h2>{agent.display_name || agent.role_name}</h2></div><button className="switch" aria-pressed={agent.enabled !== false} onClick={() => toggle(agent)}><span />{agent.enabled === false ? 'Inactif' : 'Actif'}</button></header><p>{agent.mission || agent.primary_focus}</p><dl><div><dt>Rôle</dt><dd>{agent.role_name}</dd></div><div><dt>Modèle</dt><dd>{agent.provider || 'défaut'}{agent.model ? ` / ${agent.model}` : ''}</dd></div><div><dt>Règles</dt><dd>{agent.effective_rules.length}</dd></div><div><dt>Profil</dt><dd>{agent.human_profile ? 'hybride consenti' : 'agent métier'}</dd></div><div><dt>Type</dt><dd>{agent.metadata?.impersonator ? 'impersonator' : agent.human_profile ? 'hybride' : 'métier'}</dd></div></dl><footer><span>{(agent.tools || []).join(' · ') || 'Aucun outil dédié'}</span><button className="text-button" onClick={() => setEditing(agent)}>Configurer</button></footer></article>)}</div>
    {editing !== undefined && <AgentEditor agent={editing} capabilities={data.capabilities} onClose={() => setEditing(undefined)} onSaved={async () => { await refresh(); setEditing(undefined); }} />}
    {hybrid && <HybridAgentDialog onClose={() => setHybrid(false)} onCreated={async () => { await refresh(); }} />}
    {impersonator && <ImpersonatorDialog onClose={() => setImpersonator(false)} onCreated={async () => { await refresh(); }} />}
  </section>;
}

function ConnectorCard({ connector, secure, refresh }) {
  const [secrets, setSecrets] = useState({}); const [state, setState] = useState('idle'); const [error, setError] = useState('');
  async function save(event) { event.preventDefault(); setState('loading'); setError(''); try { await api.configureConnector(connector.platform, { secrets, enabled: true, settings: {} }); setSecrets({}); setState('success'); await refresh(); } catch (err) { setState('error'); setError(err.message); } }
  async function test() { setState('loading'); setError(''); try { await api.testConnector(connector.platform); setState('success'); await refresh(); } catch (err) { setState('error'); setError(err.message); await refresh(); } }
  async function toggle() { try { await api.setConnectorEnabled(connector.platform, !connector.enabled); await refresh(); } catch (err) { setError(err.message); } }
  async function connect() { setState('loading'); setError(''); try { const result = await api.connectConnector(connector.platform); location.assign(result.url); } catch (err) { setState('error'); setError(err.message); } }
  const connected = connector.status === 'connected';
  return <article className="connector-card"><header><div><span className={`status-dot ${connected ? 'is-on' : connector.status === 'error' ? 'is-error' : ''}`} /><div><h2>{platformNames[connector.platform]}</h2><small>{connector.status.replaceAll('_', ' ')}</small></div></div><button className="switch" aria-pressed={connector.enabled} disabled={!connector.connection_id} onClick={toggle}><span />{connector.enabled ? 'Activé' : 'Désactivé'}</button></header>
    {connector.one_click && !connected && <button className="button primary" onClick={connect} disabled={state === 'loading'}>{state === 'loading' ? 'Redirection…' : connectLabel[connector.platform]}</button>}
    {!connector.one_click && !connected && <p className="muted so-note">Connexion simplifiée indisponible : les identifiants d’application du fournisseur doivent être configurés côté serveur. En attendant, utilisez la configuration avancée ci-dessous.</p>}
    {connected && <div className="connector-actions"><button type="button" className="button secondary" disabled={state === 'loading'} onClick={test}>Tester</button>{connector.webhook_url && <span className="muted so-note">Webhook : <code>{connector.webhook_url}</code></span>}</div>}
    <details className="connector-advanced"><summary>Configuration avancée (jetons)</summary>
      <form onSubmit={save}>{connectorFields[connector.platform].map(([id, label, secret]) => <label key={id}>{label}<input type={secret ? 'password' : 'text'} value={secrets[id] || ''} onChange={(event) => setSecrets({ ...secrets, [id]: event.target.value })} placeholder={connector.configured_secret_fields.includes(id) ? 'Déjà configuré — laisser vide pour conserver' : ''} /></label>)}
        <div className="connector-actions"><button className="button secondary" disabled={!secure || state === 'loading'}>{connector.connection_id ? 'Mettre à jour' : 'Enregistrer'}</button></div></form>
      {connector.webhook_url && <label>URL à déclarer chez le fournisseur<input readOnly value={connector.webhook_url} onFocus={(event) => event.target.select()} /></label>}
    </details>
    <p className={`form-error ${error ? '' : 'is-empty'}`}>{error || '\u00a0'}</p>{connector.last_tested_at && <small>Dernier test : {new Date(connector.last_tested_at).toLocaleString('fr-FR')}</small>}
  </article>;
}

function SettingsPage({ data, refresh }) {
  const params = new URLSearchParams(String(location.hash).split('?')[1] || '');
  const connected = params.get('connected');
  const connectError = params.get('connect_error');
  return <section className="page"><header className="page-header"><div><p className="context-line">Canaux externes</p><h1>Réglages</h1><p>Connectez Slack, Teams ou Discord en un clic. Les jetons restent chiffrés côté serveur.</p></div></header>
    {connected && <p className="auth-success" role="status">{platformNames[connected] || connected} connecté. Testez la connexion puis rattachez un canal depuis l'application de conversation.</p>}
    {connectError && <p className="inline-error" role="alert">Connexion échouée : {connectError}</p>}
    {!data.capabilities.encrypted_connector_storage && <div className="security-warning"><strong>Stockage chiffré non initialisé.</strong><p>Définissez KAYROS_CONNECTOR_ENCRYPTION_KEY avant d’enregistrer des identifiants. Aucun secret ne sera accepté tant que cette clé manque.</p></div>}
    <div className="connector-grid">{data.connections.map((connector) => <ConnectorCard key={connector.platform} connector={connector} secure={data.capabilities.encrypted_connector_storage} refresh={refresh} />)}</div>
    <section className="privacy-panel"><h2>Crystal Knows</h2><p>État : <strong>{data.capabilities.crystal_knows ? 'API serveur configurée' : 'CRYSTALKNOWS_API_TOKEN absent'}</strong>. L’import ne s’active qu’au niveau d’un agent hybride, avec consentement explicite. Les jetons restent côté serveur ; aucun scraping n’est utilisé.</p></section>
  </section>;
}

function SessionsPage({ data, onCreate, onThread }) {
  return <section className="page"><header className="page-header"><div><p className="context-line">Collectifs exécutables</p><h1>Sessions</h1><p>Chaque session est un collectif stable : son journal d'exécution et ses dossiers restent attachés.</p></div><button className="button primary" onClick={onCreate}>Nouvelle session</button></header>
    {!data.sessions.length && <p className="muted">Aucune session — ouvrez-en une pour composer un collectif et lancer une mission.</p>}
    <div className="session-grid">{data.sessions.map((session) => <article key={session.session_id}>
      <small>{session.collective.active_agents.length} agent(s) · {session.executions?.length || 0} exécution(s) · {votingLabel(session.collective.voting_threshold)}</small>
      <h2>{session.name}</h2>
      <AgentChips agents={session.collective.agents} />
      <div>{(session.executions || []).slice(0, 3).map((thread) => <button className="text-button" key={thread.thread_id} onClick={() => onThread(thread)}>{thread.question}</button>)}{!(session.executions || []).length && <span className="muted">Aucune mission pour cette session.</span>}</div>
    </article>)}</div>
  </section>;
}

function DecisionsPage({ data, selected, onSelect, onChanged }) {
  if (selected) return <section className="page"><button className="text-button back" onClick={() => onSelect(null)}>← Revenir aux dossiers</button><DecisionThread thread={selected} onChanged={onChanged} /></section>;
  return <section className="page"><header className="page-header"><div><p className="context-line">Historique durable</p><h1>Décisions</h1><p>Chaque dossier conserve les analyses, preuves, objections, réponses et arbitrages.</p></div></header><div className="decision-list">{data.threads.map((thread) => <button key={thread.thread_id} onClick={() => onSelect(thread)}><div><small>{thread.thread_id} · {thread.room_id}</small><strong>{thread.question}</strong></div><span>{thread.status.replaceAll('_', ' ')}</span></button>)}</div></section>;
}

const SALES_ORACLE_TOOL_URL = '/assets/sales-oracle-tool.js';
const SALES_ORACLE_USE_CASES = [['rfp', 'Appel d’offres client'], ['comex_decision', 'Décision CODIR'], ['renewal', 'Renouvellement de contrat'], ['negotiation', 'Négociation']];
const SALES_ORACLE_SOURCE_TYPES = [['rfp', 'RFP / exigences'], ['proposal', 'Proposition / réponse'], ['contract', 'Contrat'], ['security', 'Sécurité'], ['financial', 'Finance / ROI'], ['meeting_notes', 'Notes de réunion'], ['organization', 'Organisation / comité'], ['personality_profile', 'Profil de personnalité autorisé'], ['other', 'Autre preuve']];
const SALES_ORACLE_STAGES = { hashing: 'empreinte SHA-256 locale', signing: 'autorisation d’upload sécurisée', uploading: 'upload direct chiffré', verifying: 'vérification d’intégrité', queued: 'mise en file d’ingestion' };
const SALES_ORACLE_CONTEXT_LIMIT = 24000;
const soUseCaseLabel = (value) => SALES_ORACLE_USE_CASES.find(([id]) => id === value)?.[1] || String(value || '—');
const soSourceTypeLabel = (value) => SALES_ORACLE_SOURCE_TYPES.find(([id]) => id === value)?.[1] || String(value || 'preuve');

/** Gestion des dossiers Sales Oracle (création + preuves), intégrée au processus global de la console. */
function SalesOracleManager({ ready, clientRef, currentCase, documents, onCases, onDocs, onStatus }) {
  const [busy, setBusy] = useState(false);
  async function createCase(event) {
    event.preventDefault();
    const client = clientRef.current; if (!client) return;
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    setBusy(true); onStatus({ text: 'Création du dossier gouverné…', tone: 'neutral' });
    try {
      const created = await client.createCase({ name: data.get('name'), use_case: data.get('use_case'), decision_question: data.get('decision_question') });
      const result = await client.listCases(); onCases(result.cases || []);
      formElement.reset();
      onStatus({ text: `Dossier « ${created.name || created.case_id} » créé — sélectionnez-le ci-dessus pour l’instruire.`, tone: 'success' });
    } catch (error) { onStatus({ text: error.message || 'Erreur.', tone: 'error' }); }
    finally { setBusy(false); }
  }
  async function upload(event) {
    event.preventDefault();
    const client = clientRef.current; if (!client || !currentCase) return;
    const formElement = event.currentTarget;
    const files = [...formElement.elements.files.files];
    if (!files.length) { onStatus({ text: 'Sélectionnez au moins un document.', tone: 'error' }); return; }
    const sourceType = new FormData(formElement).get('source_type');
    setBusy(true);
    try {
      for (const file of files) {
        await client.uploadDocument(currentCase.case_id, file, { sourceType, onStage: (stage) => onStatus({ text: `${file.name} · ${SALES_ORACLE_STAGES[stage] || stage}`, tone: 'neutral' }) });
      }
      const result = await client.listDocuments(currentCase.case_id);
      onDocs(result.documents || []); formElement.reset();
      onStatus({ text: `${files.length} document(s) vérifié(s) et mis en file d’ingestion.`, tone: 'success' });
    } catch (error) { onStatus({ text: error.message || 'Erreur.', tone: 'error' }); }
    finally { setBusy(false); }
  }
  return <div className="so-manager">
    <form onSubmit={createCase}>
      <label>Nom du dossier<input name="name" required maxLength={300} /></label>
      <label>Simulation<select name="use_case">{SALES_ORACLE_USE_CASES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Question de décision<textarea name="decision_question" required maxLength={12000} rows={3} /></label>
      <button className="button secondary" disabled={!ready || busy}>Créer le dossier</button>
    </form>
    <section>
      <h4 className="so-kicker">Preuves du dossier actif</h4>
      {currentCase ? <form onSubmit={upload}>
        <p className="muted so-note">Dossier actif : <strong>{currentCase.name}</strong></p>
        <label>Rôle du document<select name="source_type">{SALES_ORACLE_SOURCE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Documents<input name="files" type="file" multiple accept=".pdf,.docx,.txt,.md,.csv" /></label>
        <button className="button secondary" disabled={busy}>Vérifier et uploader</button>
      </form> : <p className="muted so-note">Sélectionnez un dossier pour charger les preuves.</p>}
      <ul className="so-documents">{documents.length ? documents.map((item) => <li key={item.document_id}><span>{item.original_filename}</span><span className="so-state">{item.status}</span></li>) : <li className="muted">Aucun document dans le corpus actif.</li>}</ul>
      <p className="muted so-privacy">PDF, DOCX, TXT, Markdown ou CSV · 50 Mo/document · 20 documents/dossier · 250 Mo/dossier. Empreinte SHA-256 calculée localement, envoi par URL signée à durée limitée.</p>
    </section>
  </div>;
}

function Console() {
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [page, setPage] = useState(() => location.hash.slice(1) || 'overview');
  const [creatingSession, setCreatingSession] = useState(false); const [selectedThread, setSelectedThread] = useState(null);
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
    <main className="console-main">{error && <p className="inline-error">Actualisation impossible : {error}</p>}{page === 'overview' && <Overview data={data} refresh={refresh} openSession={() => setCreatingSession(true)} onThread={openThread} />}{page === 'sessions' && <SessionsPage data={data} onCreate={() => setCreatingSession(true)} onThread={openThread} />}{page === 'agents' && <AgentsPage data={data} refresh={refresh} />}{page === 'activity' && <DecisionsPage data={data} selected={selectedThread} onSelect={openThread} onChanged={(thread) => { setSelectedThread(thread); refresh(); }} />}{page === 'settings' && <SettingsPage data={data} refresh={refresh} />}</main>
    {creatingSession && <CreateSession agents={data.agents} onClose={() => setCreatingSession(false)} onCreated={refresh} />}
  </div>;
}

export default function App() { const [authenticated, setAuthenticated] = useState(Boolean(getToken())); return authenticated ? <Console /> : <Login onLogin={() => setAuthenticated(true)} />; }
