import { useState } from 'react';
import { api } from './api.js';
import { AgentAttributesForm, customAgentFromDraft, draftErrors, draftFromAgent } from './agent-composer.jsx';
import { ConsensusHelp, ConsensusHint, CONSENSUS_OPTIONS } from './consensus-help.jsx';

// Connecteur « profils réels » : Crystal Knows (API Data v4 côté serveur), export
// JSON Crystal collé ou chargé, ou simple type DISC. Le serveur normalise le
// profil (POST /v1/console/personality/preview) et propose des attributs d'agent
// que l'utilisateur relit avant de les ajouter à un comité.

const TRAIT_LABELS = { dominance: 'Dominance', expressiveness: 'Expressivité', leniency: 'Indulgence', pace: 'Rythme', pragmatism: 'Pragmatisme', risk_aversion: 'Aversion au risque', skepticism: 'Scepticisme', social: 'Sociabilité' };
const SOURCES = [['crystalknows', 'Crystal Knows · recherche API'], ['export', 'Crystal Knows · export JSON (coller ou fichier)'], ['disc', 'Type DISC saisi']];
const blankQuery = { email: '', linkedin_url: '', full_name: '', company_name: '', job_title: '', json: '', disc_type: '', assigned_name: '' };

function readText(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(new Error('Lecture du fichier impossible.')); reader.readAsText(file); }); }

export function ProfileTraits({ profile }) {
  const traits = Object.entries(profile?.behavioral_traits || {});
  return <div className="profile-card">
    <dl className="profile-summary">
      <div><dt>Personne</dt><dd>{profile?.assigned_name || '—'}</dd></div>
      <div><dt>DISC</dt><dd>{profile?.disc_type || '—'}</dd></div>
      <div><dt>Archétype</dt><dd>{profile?.behavioral_archetype || '—'}</dd></div>
      <div><dt>Source</dt><dd>{(profile?.profile_sources || []).map((item) => (item.import_mode === 'disc_type' ? 'DISC saisi' : item.source === 'crystalknows' ? `Crystal${item.import_mode === 'official_api' ? ' (API)' : ' (export)'}${item.verified ? ' · vérifié' : ''}` : item.source)).join(', ') || '—'}</dd></div>
    </dl>
    {traits.length > 0 && <ul className="trait-bars" aria-label="Traits comportementaux (0 à 100)">{traits.map(([key, value]) => <li key={key}><span>{TRAIT_LABELS[key] || key}</span><span className="trait-bar" aria-hidden="true"><span style={{ width: `${value}%` }} /></span><strong>{value}</strong></li>)}</ul>}
    {(profile?.core_motivators || []).length > 0 && <p className="muted so-note">Motivations : {profile.core_motivators.slice(0, 4).join(' · ')}</p>}
    {(profile?.communication_style?.stress_triggers || []).length > 0 && <p className="muted so-note">À éviter : {profile.communication_style.stress_triggers.slice(0, 3).join(' · ')}</p>}
  </div>;
}

/** Saisie + aperçu d'un profil réel ; `onAdd({ draft, profile })` quand l'utilisateur valide. */
export function RealProfileImporter({ canUseApi, apiConfigured, onAdd, addLabel = 'Ajouter au comité' }) {
  const [source, setSource] = useState(apiConfigured && canUseApi ? 'crystalknows' : 'export');
  const [query, setQuery] = useState(blankQuery);
  const [consent, setConsent] = useState(false);
  const [preview, setPreview] = useState(null);
  const [draft, setDraft] = useState(null);
  const [state, setState] = useState('idle'); const [error, setError] = useState('');
  const set = (patch) => setQuery((current) => ({ ...current, ...patch }));
  const apiBlocked = source === 'crystalknows' && (!canUseApi || !apiConfigured);

  async function pickFile(event) {
    const chosen = event.target.files?.[0]; if (!chosen) return;
    try { set({ json: await readText(chosen) }); setError(''); } catch (err) { setError(err.message); }
  }
  async function runPreview() {
    setError('');
    if (!consent) { setError('Consentement explicite requis avant tout import de profil réel.'); return; }
    const body = { consent_confirmed: true, source };
    if (source === 'crystalknows') {
      for (const key of ['email', 'linkedin_url', 'full_name', 'company_name', 'job_title']) if (query[key].trim()) body[key] = query[key].trim();
      if (!body.email && !body.linkedin_url && !body.full_name) { setError('Renseignez un e-mail, une URL LinkedIn ou un nom complet (avec l’entreprise).'); return; }
    } else if (source === 'export') {
      try { body.profile_data = JSON.parse(query.json || ''); } catch { setError('JSON illisible : collez la réponse de l’API Crystal ou un export de profil.'); return; }
      if (!body.profile_data || typeof body.profile_data !== 'object' || Array.isArray(body.profile_data)) { setError('Le JSON doit être un objet de profil.'); return; }
      if (query.assigned_name.trim()) body.assigned_name = query.assigned_name.trim();
    } else {
      if (!query.disc_type.trim()) { setError('Indiquez un type DISC (ex. D, Di, Sc, C).'); return; }
      body.disc_type = query.disc_type.trim(); if (query.assigned_name.trim()) body.assigned_name = query.assigned_name.trim();
    }
    setState('loading');
    try { const result = await api.previewPersonality(body); setPreview(result); setDraft(draftFromAgent(result.agent)); setState('idle'); }
    catch (err) { setState('error'); setError(err.message); }
  }
  function add() {
    const missing = draftErrors(draft); if (missing) { setError(missing); return; }
    onAdd({ draft, profile: preview.profile });
    setPreview(null); setDraft(null); setQuery(blankQuery); setConsent(false); setError('');
  }

  return <section className="real-profile-importer">
    {!preview ? <>
      <label>Source du profil<select value={source} onChange={(e) => { setSource(e.target.value); setError(''); }}>{SOURCES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      {source === 'crystalknows' && <>
        {apiBlocked && <p className="muted so-note" role="note">{!apiConfigured ? 'API Crystal non configurée sur le serveur (CRYSTALKNOWS_API_TOKEN). Utilisez un export JSON ou le type DISC.' : 'La recherche API consomme des crédits Crystal : réservée aux rôles comex ou admin. Utilisez un export JSON ou le type DISC.'}</p>}
        <div className="form-grid"><label>E-mail professionnel<input type="email" value={query.email} onChange={(e) => set({ email: e.target.value })} disabled={apiBlocked} placeholder="prenom.nom@entreprise.com" /></label><label>URL LinkedIn<input value={query.linkedin_url} onChange={(e) => set({ linkedin_url: e.target.value })} disabled={apiBlocked} placeholder="https://www.linkedin.com/in/…" /></label></div>
        <div className="form-grid three"><label>Nom complet<input value={query.full_name} onChange={(e) => set({ full_name: e.target.value })} disabled={apiBlocked} /></label><label>Entreprise<input value={query.company_name} onChange={(e) => set({ company_name: e.target.value })} disabled={apiBlocked} /></label><label>Fonction<input value={query.job_title} onChange={(e) => set({ job_title: e.target.value })} disabled={apiBlocked} /></label></div>
        <small className="muted">Un seul identifiant suffit (e-mail ou LinkedIn) ; le nom complet s’utilise avec l’entreprise et la fonction.</small>
      </>}
      {source === 'export' && <>
        <label>Profil Crystal (JSON)<textarea className="code-input" value={query.json} onChange={(e) => set({ json: e.target.value })} placeholder={'{ "data": { "first_name": "…", "personalities": { "disc_type": "Dc", "behavioral_traits": { … } }, "content": { … } } }'} /></label>
        <div className="form-grid"><label>Ou fichier (.json)<input type="file" accept=".json,application/json" onChange={pickFile} /></label><label>Nom (si absent du JSON)<input value={query.assigned_name} onChange={(e) => set({ assigned_name: e.target.value })} /></label></div>
      </>}
      {source === 'disc' && <div className="form-grid"><label>Personne<input value={query.assigned_name} onChange={(e) => set({ assigned_name: e.target.value })} placeholder="Ex. Claire Martin" /></label><label>Type DISC<input value={query.disc_type} onChange={(e) => set({ disc_type: e.target.value })} placeholder="Ex. D, Di, Sc, C" /></label></div>}
      <label className="consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />La personne a consenti à cet usage de son profil pour simuler ses réactions dans un comité. Pas de recrutement, crédit ou décision à effet matériel.</label>
      <p className={`form-error ${error ? '' : 'is-empty'}`} role={error ? 'alert' : undefined}>{error || '\u00a0'}</p>
      <div className="connector-actions"><button type="button" className="button secondary" onClick={runPreview} disabled={state === 'loading' || apiBlocked}>{state === 'loading' ? 'Analyse du profil…' : 'Prévisualiser le profil'}</button></div>
    </> : <>
      <ProfileTraits profile={preview.profile} />
      <p className="muted so-note">Attributs proposés à partir du profil : vérifiez-les et ajustez-les avant de l’ajouter.</p>
      <AgentAttributesForm draft={draft} onChange={setDraft} idPrefix="import" />
      <p className={`form-error ${error ? '' : 'is-empty'}`} role={error ? 'alert' : undefined}>{error || '\u00a0'}</p>
      <div className="connector-actions"><button type="button" className="button secondary" onClick={() => { setPreview(null); setDraft(null); }}>Revenir</button><button type="button" className="button primary" onClick={add}>{addLabel}</button></div>
    </>}
  </section>;
}

/** Dialogue autonome : ajouter des profils réels à un comité existant ou en construire un nouveau. */
export function RealProfilesDialog({ data, canUseApi, onClose, onDone }) {
  const [members, setMembers] = useState([]);
  const [target, setTarget] = useState(data.sessions.length ? 'existing' : 'new');
  const [sessionId, setSessionId] = useState(data.sessions[0]?.session_id || '');
  const [form, setForm] = useState({ name: '', voting_threshold: 'majority', presets: [] });
  const [state, setState] = useState('idle'); const [error, setError] = useState(''); const [done, setDone] = useState(null);
  const presets = data.agents.filter((agent) => agent.enabled !== false);
  const payload = () => members.map((member) => customAgentFromDraft(member.draft, { human_profile: member.profile }));
  async function submit() {
    setError('');
    if (!members.length) { setError('Ajoutez au moins un profil.'); return; }
    setState('loading');
    try {
      if (target === 'existing') {
        if (!sessionId) throw new Error('Choisissez le comité à compléter.');
        const result = await api.updateSessionCollective(sessionId, { add_custom_agents: payload() });
        setDone({ session: result.session, mode: 'existing' });
      } else {
        if (!form.name.trim()) throw new Error('Nommez le nouveau comité.');
        if (members.length + form.presets.length < 2) throw new Error('Un comité réunit au moins deux membres : ajoutez un profil ou un agent proposé.');
        const result = await api.createSession({ name: form.name.trim(), voting_threshold: form.voting_threshold, active_agents: form.presets, custom_agents: payload(), personality_simulation_enabled: true });
        setDone({ session: result.session, mode: 'new' });
      }
      setState('success'); await onDone?.();
    } catch (err) { setState('error'); setError(err.message); }
  }
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog wide" role="dialog" aria-modal="true" aria-labelledby="real-profiles-title">
    <header><div><h2 id="real-profiles-title">Importer des personnalités réelles</h2><p>Crystal Knows (API ou export) ou type DISC : chaque profil devient un membre du comité qui réagit selon cette personnalité (réactions simulées, jamais des citations réelles).</p></div><button className="icon-button" aria-label="Fermer" onClick={onClose}>×</button></header>
    {done ? <>
      <p className="auth-success" role="status">{done.mode === 'existing' ? 'Comité complété' : 'Comité créé'} : « {done.session.name} » réunit désormais {done.session.collective.agents.length} membre(s) : {done.session.collective.agents.map((agent) => agent.display_name).join(' · ')}.</p>
      <footer><button type="button" className="button primary" onClick={onClose}>Terminer</button></footer>
    </> : <div className="dialog-body">
      <RealProfileImporter canUseApi={canUseApi} apiConfigured={data.capabilities?.crystal_knows === true} onAdd={(member) => setMembers((current) => [...current, member])} />
      <fieldset><legend>Profils prêts ({members.length})</legend>
        {!members.length && <p className="muted so-note">Aucun profil pour l’instant : prévisualisez puis ajoutez un profil ci-dessus.</p>}
        <ul className="member-list">{members.map((member, index) => <li key={`${member.draft.display_name}-${index}`}><span><strong>{member.draft.display_name || member.draft.role_name}</strong><small>{[member.draft.role_name, member.profile.disc_type && `DISC ${member.profile.disc_type}`].filter(Boolean).join(' · ')}</small></span><button type="button" className="text-button" onClick={() => setMembers((current) => current.filter((_, i) => i !== index))}>Retirer</button></li>)}</ul>
      </fieldset>
      <fieldset><legend>Destination</legend>
        <div className="inline-checks">
          <label><input type="radio" name="real-target" checked={target === 'existing'} disabled={!data.sessions.length} onChange={() => setTarget('existing')} />Ajouter à un comité existant</label>
          <label><input type="radio" name="real-target" checked={target === 'new'} onChange={() => setTarget('new')} />Construire un nouveau comité</label>
        </div>
        {target === 'existing' ? <label>Comité (session)<select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>{data.sessions.map((session) => <option key={session.session_id} value={session.session_id}>{session.name} · {session.collective.active_agents.length} membre(s)</option>)}</select></label>
          : <>
            <label>Nom du comité<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex. Comité d’achat Acme" /></label>
            <div className="threshold-field"><label>Seuil de consensus<select value={form.voting_threshold} onChange={(e) => setForm({ ...form, voting_threshold: e.target.value })}>{CONSENSUS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><ConsensusHelp value={form.voting_threshold} /></div>
            <ConsensusHint value={form.voting_threshold} />
            {presets.length > 0 && <details><summary>Ajouter aussi des agents proposés (facultatif)</summary><div className="inline-checks">{presets.map((agent) => <label key={agent.agent_id}><input type="checkbox" checked={form.presets.includes(agent.agent_id)} onChange={() => setForm((current) => ({ ...current, presets: current.presets.includes(agent.agent_id) ? current.presets.filter((id) => id !== agent.agent_id) : [...current.presets, agent.agent_id] }))} />{agent.display_name || agent.role_name}</label>)}</div></details>}
          </>}
      </fieldset>
      <p className={`form-error ${error ? '' : 'is-empty'}`} role={error ? 'alert' : undefined}>{error || '\u00a0'}</p>
      <footer><button type="button" className="button secondary" onClick={onClose}>Annuler</button><button type="button" className="button primary" onClick={submit} disabled={state === 'loading' || !members.length}>{state === 'loading' ? 'Enregistrement…' : target === 'existing' ? 'Ajouter au comité' : 'Créer le comité'}</button></footer>
    </div>}
  </section></div>;
}
