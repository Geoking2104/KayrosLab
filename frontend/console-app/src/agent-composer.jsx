// Composition et vérification des agents d'une session : attributs d'identité,
// mission, règles et profil comportemental (caractéristiques injectées dans le
// contexte d'exécution de l'agent, cf. behavioralContext dans core/swarm.mjs).

export const SENIORITIES = [['intern', 'Stagiaire'], ['junior', 'Junior'], ['senior', 'Senior'], ['executive', 'Dirigeant (executive)']];
export const DISC_OPTIONS = [['', 'Non précisé'], ['D', 'D · Dominance (direct, orienté résultats)'], ['I', 'I · Influence (enthousiaste, relationnel)'], ['S', 'S · Stabilité (posé, coopératif)'], ['C', 'C · Conformité (précis, analytique)'], ['Di', 'Di'], ['Dc', 'Dc'], ['Id', 'Id'], ['Is', 'Is'], ['Si', 'Si'], ['Sc', 'Sc'], ['Cs', 'Cs'], ['Cd', 'Cd']];
export const DECISION_STYLES = ['', 'analytique, exige des preuves', 'rapide et pragmatique', 'réfléchi, recherche le consensus', 'directif', 'intuitif, orienté vision'];
export const RISK_OPTIONS = ['', 'prudent', 'équilibré', 'audacieux'];
const BEHAVIORAL_KEYS = ['disc_type', 'archetype', 'tone', 'decision_style', 'risk_appetite', 'traits', 'motivators', 'communication_directives'];

function lines(value) { return String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean); }
function csv(value) { return String(value || '').split(',').map((item) => item.trim()).filter(Boolean); }
function list(value) { return Array.isArray(value) ? value.join(', ') : String(value || ''); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

export function emptyDraft() {
  return {
    display_name: '', role_name: '', department: '', seniority: 'senior', mission: '', instructions: '', constraints: '', veto_power: false,
    behavioral: { disc_type: '', archetype: '', tone: '', decision_style: '', risk_appetite: '', traits: '', motivators: '', communication_directives: '' },
    extraBehavioral: {}, systemRules: [], added: '',
  };
}

/** Brouillon éditable à partir d'un agent du registre (ou d'attributs proposés par un import). */
export function draftFromAgent(agent = {}) {
  const behavioral = agent.behavioral_profile || {};
  const extraBehavioral = Object.fromEntries(Object.entries(behavioral).filter(([key]) => !BEHAVIORAL_KEYS.includes(key)));
  const rc = agent.rule_configuration || {};
  const modified = new Map((rc.user_modified_rules || []).map((rule) => [rule.replaces_rule_id, rule.modified_text]));
  return {
    display_name: agent.display_name || agent.role_name || '', role_name: agent.role_name || '', department: agent.department || '',
    seniority: agent.seniority || 'senior', mission: agent.mission || agent.primary_focus || '', instructions: agent.instructions || '',
    constraints: (agent.constraints || []).join('\n'), veto_power: agent.veto_power === true,
    behavioral: Object.fromEntries(BEHAVIORAL_KEYS.map((key) => [key, list(behavioral[key])])),
    extraBehavioral,
    systemRules: (rc.system_proposed_rules || []).map((rule) => ({
      rule_id: rule.rule_id, original: rule.rule_text, enabled: rule.status !== 'disabled',
      text: modified.get(rule.rule_id) || rule.rule_text,
    })),
    added: (rc.user_added_rules || []).map((rule) => rule.rule_text).join('\n'),
  };
}

function behavioralFromDraft(draft) {
  const out = { ...draft.extraBehavioral };
  for (const key of BEHAVIORAL_KEYS) {
    const value = draft.behavioral[key];
    if (['traits', 'motivators', 'communication_directives'].includes(key)) { const items = csv(value); if (items.length) out[key] = items; }
    else if (String(value || '').trim()) out[key] = String(value).trim();
  }
  return out;
}

/** Surcharge de session : seuls les champs modifiés par rapport à l'agent du registre. */
export function overrideFromDraft(agent, draft) {
  const base = draftFromAgent(agent);
  const patch = {};
  for (const field of ['display_name', 'role_name', 'department', 'seniority', 'mission', 'instructions']) {
    if (String(draft[field] || '').trim() !== String(base[field] || '').trim() && String(draft[field] || '').trim()) patch[field] = String(draft[field]).trim();
  }
  if (draft.instructions !== base.instructions && !String(draft.instructions || '').trim()) patch.instructions = '';
  if (!same(lines(draft.constraints), lines(base.constraints))) patch.constraints = lines(draft.constraints);
  if (draft.veto_power !== base.veto_power) patch.veto_power = draft.veto_power;
  const behavioral = behavioralFromDraft(draft);
  if (!same(behavioral, behavioralFromDraft(base))) patch.behavioral_profile = behavioral;
  const disabled = draft.systemRules.filter((rule, index) => !rule.enabled && base.systemRules[index]?.enabled).map((rule) => rule.rule_id);
  if (disabled.length) patch.disabled_rules = disabled;
  const modified = draft.systemRules.filter((rule, index) => rule.enabled && rule.text.trim() && rule.text.trim() !== base.systemRules[index]?.text.trim())
    .map((rule) => ({ replaces_rule_id: rule.rule_id, modified_text: rule.text.trim() }));
  if (modified.length) patch.modified_rules = modified;
  const baseAdded = new Set(lines(base.added));
  const added = lines(draft.added).filter((rule) => !baseAdded.has(rule));
  if (added.length) patch.added_rules = added;
  return Object.keys(patch).length ? patch : null;
}

/** Agent composé pour la session (format `custom_agents` de POST /v1/console/sessions). */
export function customAgentFromDraft(draft, { human_profile = null } = {}) {
  return {
    display_name: draft.display_name.trim() || draft.role_name.trim(), role_name: draft.role_name.trim(), department: draft.department.trim(),
    seniority: draft.seniority, mission: draft.mission.trim(), instructions: draft.instructions.trim() || undefined,
    constraints: lines(draft.constraints), rules: [...draft.systemRules.filter((rule) => rule.enabled).map((rule) => rule.text.trim()), ...lines(draft.added)].filter(Boolean),
    veto_power: draft.veto_power, behavioral_profile: behavioralFromDraft(draft),
    ...(human_profile ? { human_profile } : {}),
  };
}

export function draftErrors(draft) {
  const missing = [];
  if (!draft.role_name.trim()) missing.push('rôle');
  if (!draft.department.trim()) missing.push('département');
  if (!draft.mission.trim()) missing.push('mission');
  return missing.length ? `À compléter : ${missing.join(', ')}.` : '';
}

/** Formulaire d'attributs d'un agent (identité, mission, règles, profil comportemental). */
export function AgentAttributesForm({ draft, onChange, idPrefix = 'agent' }) {
  const set = (patch) => onChange({ ...draft, ...patch });
  const setBehavioral = (patch) => onChange({ ...draft, behavioral: { ...draft.behavioral, ...patch } });
  const setRule = (index, patch) => onChange({ ...draft, systemRules: draft.systemRules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) });
  return <div className="agent-attributes">
    <div className="form-grid three">
      <label>Nom affiché<input value={draft.display_name} onChange={(e) => set({ display_name: e.target.value })} placeholder="Ex. DAF prudente" /></label>
      <label>Rôle *<input value={draft.role_name} onChange={(e) => set({ role_name: e.target.value })} placeholder="Ex. Directrice financière" /></label>
      <label>Département *<input value={draft.department} onChange={(e) => set({ department: e.target.value })} placeholder="Ex. Finance" /></label>
    </div>
    <div className="form-grid">
      <label>Séniorité<select value={draft.seniority} onChange={(e) => set({ seniority: e.target.value })}>{SENIORITIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><small>« Dirigeant » compte pour le seuil « Veto comité exécutif ».</small></label>
      <label className="consent"><input type="checkbox" checked={draft.veto_power} onChange={(e) => set({ veto_power: e.target.checked })} />Pouvoir de veto : un NO_GO de cet agent bloque la décision, quel que soit le seuil.</label>
    </div>
    <label>Mission *<textarea value={draft.mission} onChange={(e) => set({ mission: e.target.value })} placeholder="Ce que l’agent doit éprouver dans chaque mission." /></label>
    <label>Instructions<textarea value={draft.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="Facultatif : méthode, angle d’analyse, livrables attendus…" /></label>
    <fieldset className="attribute-group"><legend>Personnalité et caractéristiques</legend>
      <div className="form-grid three">
        <label>Profil DISC<select value={draft.behavioral.disc_type} onChange={(e) => setBehavioral({ disc_type: e.target.value })}>{DISC_OPTIONS.some(([id]) => id === draft.behavioral.disc_type) ? null : <option value={draft.behavioral.disc_type}>{draft.behavioral.disc_type}</option>}{DISC_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>Style de décision<select value={draft.behavioral.decision_style} onChange={(e) => setBehavioral({ decision_style: e.target.value })}>{DECISION_STYLES.includes(draft.behavioral.decision_style) ? null : <option value={draft.behavioral.decision_style}>{draft.behavioral.decision_style}</option>}{DECISION_STYLES.map((item) => <option key={item} value={item}>{item || 'Non précisé'}</option>)}</select></label>
        <label>Appétence au risque<select value={draft.behavioral.risk_appetite} onChange={(e) => setBehavioral({ risk_appetite: e.target.value })}>{RISK_OPTIONS.includes(draft.behavioral.risk_appetite) ? null : <option value={draft.behavioral.risk_appetite}>{draft.behavioral.risk_appetite}</option>}{RISK_OPTIONS.map((item) => <option key={item} value={item}>{item || 'Non précisée'}</option>)}</select></label>
      </div>
      <div className="form-grid">
        <label>Ton<input value={draft.behavioral.tone} onChange={(e) => setBehavioral({ tone: e.target.value })} placeholder="Ex. direct et factuel" /></label>
        <label>Archétype<input value={draft.behavioral.archetype} onChange={(e) => setBehavioral({ archetype: e.target.value })} placeholder="Ex. Sceptique bienveillant" /></label>
      </div>
      <div className="form-grid">
        <label>Traits · séparés par des virgules<input value={draft.behavioral.traits} onChange={(e) => setBehavioral({ traits: e.target.value })} placeholder="Ex. exigeant, curieux, orienté client" /></label>
        <label>Motivations · séparées par des virgules<input value={draft.behavioral.motivators} onChange={(e) => setBehavioral({ motivators: e.target.value })} /></label>
      </div>
      <label>Directives de communication · séparées par des virgules<input value={draft.behavioral.communication_directives} onChange={(e) => setBehavioral({ communication_directives: e.target.value })} placeholder="Ex. chiffrer chaque affirmation, conclure par une recommandation" /></label>
    </fieldset>
    <div className="form-grid">
      <label>Contraintes · une par ligne<textarea value={draft.constraints} onChange={(e) => set({ constraints: e.target.value })} /></label>
      <label>Règles ajoutées · une par ligne<textarea value={draft.added} onChange={(e) => set({ added: e.target.value })} placeholder="Ex. Refuser tout projet sans sponsor identifié." /></label>
    </div>
    {draft.systemRules.length > 0 && <fieldset className="attribute-group"><legend>Règles proposées par le système</legend>
      {draft.systemRules.map((rule, index) => <div className="rule-row" key={rule.rule_id}>
        <label className="consent"><input type="checkbox" checked={rule.enabled} onChange={(e) => setRule(index, { enabled: e.target.checked })} aria-label={`Activer ${rule.rule_id}`} /><code>{rule.rule_id}</code></label>
        <input id={`${idPrefix}-${rule.rule_id}`} value={rule.text} disabled={!rule.enabled} onChange={(e) => setRule(index, { text: e.target.value })} aria-label={`Texte de ${rule.rule_id}`} />
      </div>)}
    </fieldset>}
  </div>;
}

/** Résumé compact des attributs (lecture rapide avant modification). */
export function AgentAttributesSummary({ agent, draft }) {
  const d = draft || draftFromAgent(agent);
  const traits = [d.behavioral.disc_type && `DISC ${d.behavioral.disc_type}`, d.behavioral.decision_style, d.behavioral.risk_appetite && `risque : ${d.behavioral.risk_appetite}`, d.behavioral.tone].filter(Boolean);
  const activeRules = d.systemRules.filter((rule) => rule.enabled).length + lines(d.added).length;
  return <dl className="profile-summary attribute-summary">
    <div><dt>Rôle</dt><dd>{d.role_name || '—'}</dd></div>
    <div><dt>Séniorité</dt><dd>{SENIORITIES.find(([id]) => id === d.seniority)?.[1] || d.seniority}</dd></div>
    <div><dt>Veto</dt><dd>{d.veto_power ? 'oui' : 'non'}</dd></div>
    <div><dt>Règles actives</dt><dd>{activeRules}</dd></div>
    <div className="wide"><dt>Mission</dt><dd>{d.mission || '—'}</dd></div>
    <div className="wide"><dt>Personnalité</dt><dd>{traits.join(' · ') || 'non précisée'}</dd></div>
  </dl>;
}
