import { useState } from 'react';
import { api } from './api.js';

// Agents propres à une session (composés, importés Crystal/DISC, ou agents du
// registre ajustés pour la session) : publication dans le registre partagé du tenant.
// Même droit que la création d'agent (comex/admin) ; un profil réel exige un
// consentement de partage et n'est jamais publié dans le tenant libre-service.
export function sessionOwnAgents(session) {
  return (session?.collective?.agents || []).filter((agent) => agent.session_scoped || agent.session_override);
}

export function SessionOwnAgents({ session, capabilities, onSaved }) {
  const [promoting, setPromoting] = useState(null);
  const own = sessionOwnAgents(session);
  if (!own.length) return null;
  const promotion = capabilities?.registry_promotion || { allowed: false, real_profiles: false };
  return <div className="session-own-agents">
    <small>Agents propres à cette session</small>
    <ul>{own.map((agent) => <li key={agent.agent_id}>
      <span><strong>{agent.display_name}</strong> <em>{agent.session_scoped ? (agent.hybrid ? 'profil réel' : 'composé') : 'ajusté'}</em></span>
      {promotion.allowed
        ? <button type="button" className="text-button" onClick={() => setPromoting(agent)}>Enregistrer dans le registre</button>
        : null}
    </li>)}</ul>
    {!promotion.allowed && <p className="muted small-note">Seul un rôle comex ou admin peut enregistrer ces agents dans le registre partagé ; ils restent utilisables dans cette session.</p>}
    {promoting && <PromoteAgentDialog session={session} agent={promoting} realProfilesAllowed={promotion.real_profiles !== false} onClose={() => setPromoting(null)} onSaved={async (agent) => { setPromoting(null); await onSaved?.(agent); }} />}
  </div>;
}

export function PromoteAgentDialog({ session, agent, realProfilesAllowed, onClose, onSaved }) {
  const real = agent.hybrid === true;
  const [form, setForm] = useState({
    agent_id: agent.session_scoped ? agent.agent_id : `${agent.agent_id}_variante`.slice(0, 64),
    display_name: real && !realProfilesAllowed ? agent.role_name || '' : agent.display_name || '',
    include_human_profile: real && realProfilesAllowed,
    share_consent_confirmed: false,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const needsConsent = real && form.include_human_profile;
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const body = { agent_id: form.agent_id, display_name: form.display_name || undefined, include_human_profile: real ? form.include_human_profile : true };
      if (needsConsent) body.share_consent_confirmed = form.share_consent_confirmed;
      const result = await api.promoteSessionAgent(session.session_id, agent.agent_id, body);
      await onSaved?.(result.agent);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="dialog promote-dialog" role="dialog" aria-modal="true" aria-labelledby="promote-title" onSubmit={submit}>
      <header><h2 id="promote-title">Enregistrer « {agent.display_name} » dans le registre</h2><button type="button" className="icon-button" aria-label="Fermer" onClick={onClose}>×</button></header>
      <div className="dialog-body">
        <p>L’agent rejoint la liste partagée des agents : <strong>tous les membres de l’espace</strong> pourront l’ajouter à leurs sessions. {agent.session_scoped ? 'La session utilisera ensuite l’agent du registre.' : 'L’agent d’origine du registre n’est pas modifié : une variante est créée.'}</p>
        <div className="form-grid">
          <label>Identifiant<input value={form.agent_id} required pattern="[a-z][a-z0-9_]{1,63}" onChange={(event) => setForm({ ...form, agent_id: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} /></label>
          <label>Nom affiché<input value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} /></label>
        </div>
        {real && !realProfilesAllowed && <div className="security-warning"><strong>Espace partagé en libre-service.</strong><p>Le registre de cet espace est commun à tous les comptes inscrits en libre-service : le profil réel ({agent.human_profile?.assigned_name || 'personne importée'}) n’y sera pas publié. Seuls les attributs de l’agent (rôle, mission, règles, style DISC) sont enregistrés — choisissez un nom neutre.</p></div>}
        {real && realProfilesAllowed && <>
          <label className="consent"><input type="checkbox" checked={form.include_human_profile} onChange={(event) => setForm({ ...form, include_human_profile: event.target.checked })} />Inclure le profil réel ({agent.human_profile?.assigned_name || 'personne importée'})</label>
          {form.include_human_profile
            ? <label className="consent"><input type="checkbox" checked={form.share_consent_confirmed} onChange={(event) => setForm({ ...form, share_consent_confirmed: event.target.checked })} />Je confirme que cette personne a consenti au partage de son profil avec tous les membres de l’espace.</label>
            : <p className="muted">Sans profil réel : seuls les attributs de l’agent sont enregistrés. Pensez à remplacer le nom de la personne.</p>}
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <footer className="composer-actions"><button type="button" className="button secondary" onClick={onClose}>Annuler</button><button className="button primary" disabled={busy || (needsConsent && !form.share_consent_confirmed)}>{busy ? 'Enregistrement…' : 'Enregistrer dans le registre'}</button></footer>
    </form>
  </div>;
}
