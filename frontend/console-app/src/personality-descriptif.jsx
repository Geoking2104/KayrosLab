import { useState } from 'react';
import {
  DESCRIPTIF_SECTIONS, DESCRIPTIF_TRAITS, DISC_WHEEL, canonicalDisc, descriptifFromDisc, discArchetype, discWheelAngle,
} from '../../../core/personality-descriptif.mjs';

// Descriptif de personnalité éditable d'un agent personnifié : roue DISC,
// archétype, vue d'ensemble, traits 0–100 et sections (communication, confiance,
// motivation, passage à l'action, énergie, angles morts, réunions, écrits…).
// Le descriptif est stocké dans behavioral_profile.descriptif et injecté dans
// le contexte d'exécution de l'agent (core/personality-descriptif.mjs).

const SOURCE_LABELS = {
  crystalknows: 'Prérempli depuis Crystal Knows', disc_template: 'Prérempli depuis le modèle DISC KayrosLab',
  manual: 'Saisie manuelle', anonymised: 'Profil anonymisé (registre partagé)',
};
const QUADRANTS = [['D', 270, '#d9534f'], ['I', 0, '#e0a526'], ['S', 90, '#3f9d63'], ['C', 180, '#3b78c4']];

function polar(cx, cy, r, angleFromTop) {
  const rad = ((angleFromTop - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/** Roue DISC : quatre quadrants, 16 positions, repère du type courant (rayon = intensité). */
export function DiscWheel({ type, intensity = null, size = 168, initials = '' }) {
  const c = size / 2; const r = c - 18;
  const angle = discWheelAngle(type);
  const radius = angle == null ? 0 : r * (0.62 + 0.33 * ((intensity ?? 70) / 100));
  const [mx, my] = angle == null ? [c, c] : polar(c, c, radius, angle);
  return <svg className="disc-wheel" viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={type ? `Roue DISC : type ${type}` : 'Roue DISC : type non précisé'}>
    {QUADRANTS.map(([letter, start, color]) => {
      const [x1, y1] = polar(c, c, r, start); const [x2, y2] = polar(c, c, r, start + 90);
      const [lx, ly] = polar(c, c, r * 0.42, start + 45);
      return <g key={letter}><path d={`M${c},${c} L${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2} Z`} fill={color} fillOpacity={canonicalDisc(type)?.toUpperCase().includes(letter) ? 0.32 : 0.12} stroke={color} strokeOpacity="0.5" />
        <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" className="disc-wheel__letter" fill={color}>{letter}</text></g>;
    })}
    {DISC_WHEEL.map((item, index) => { const [x, y] = polar(c, c, r + 9, 315 + index * 22.5); return <text key={item} x={x} y={y} textAnchor="middle" dominantBaseline="central" className={`disc-wheel__tick ${item === canonicalDisc(type) ? 'is-current' : ''}`}>{item}</text>; })}
    {angle != null && <g className="disc-wheel__marker"><circle cx={mx} cy={my} r="11" /><text x={mx} y={my} textAnchor="middle" dominantBaseline="central">{initials || type}</text></g>}
  </svg>;
}

function ListEditor({ id, label, items, onChange }) {
  const [draft, setDraft] = useState('');
  const set = (index, value) => onChange(items.map((item, i) => (i === index ? value : item)));
  function add() { const value = draft.trim(); if (!value) return; onChange([...items, value]); setDraft(''); }
  return <section className="descriptif-section" aria-labelledby={`${id}-title`}>
    <header><strong id={`${id}-title`}>{label}</strong><small>{items.length}</small></header>
    <ul>{items.map((item, index) => <li key={index}>
      <textarea rows={Math.min(3, Math.max(1, Math.ceil(item.length / 60)))} value={item} aria-label={`${label} · élément ${index + 1}`} onChange={(e) => set(index, e.target.value)} />
      <button type="button" className="icon-button" aria-label={`Retirer l’élément ${index + 1} de « ${label} »`} onClick={() => onChange(items.filter((_, i) => i !== index))}>×</button>
    </li>)}</ul>
    <div className="descriptif-add"><input value={draft} placeholder="Ajouter un élément…" aria-label={`Ajouter à « ${label} »`} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} /><button type="button" className="text-button" onClick={add}>+ Ajouter</button></div>
  </section>;
}

/** Nettoie le descriptif avant envoi (éléments vides retirés). */
export function cleanDescriptif(value) {
  if (!value) return null;
  const sections = Object.fromEntries(Object.entries(value.sections || {}).map(([key, items]) => [key, (items || []).map((item) => String(item).trim()).filter(Boolean)]).filter(([, items]) => items.length));
  const qualities = (value.qualities || []).map((item) => String(item).trim()).filter(Boolean);
  const out = { ...value, sections, qualities };
  for (const key of ['archetype', 'overview']) if (!String(out[key] || '').trim()) delete out[key]; else out[key] = String(out[key]).trim();
  if (out.disc_intensity == null) delete out.disc_intensity;
  return out;
}

export function DescriptifEditor({ value, onChange, discType, onDiscType, name = '', idPrefix = 'descriptif' }) {
  const [confirmReplace, setConfirmReplace] = useState(false);
  const type = canonicalDisc(value?.disc_type || discType) || '';
  const initials = String(name || '').split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  if (!value) {
    return <div className="descriptif-empty">
      <p>Aucun descriptif de personnalité. Créez-le à partir d’un type DISC (modèle KayrosLab, entièrement modifiable) ou partez d’une page vierge.</p>
      <div className="composer-actions">
        <label>Type DISC<select value={type} onChange={(e) => onDiscType?.(e.target.value)}><option value="">Choisir…</option>{DISC_WHEEL.map((item) => <option key={item} value={item}>{item} · {discArchetype(item)}</option>)}</select></label>
        <button type="button" className="button secondary" disabled={!type} onClick={() => onChange(descriptifFromDisc(type))}>Créer depuis le type DISC</button>
        <button type="button" className="text-button" onClick={() => onChange({ disc_type: type || null, sections: {}, traits: {}, qualities: [], source: 'manual' })}>Page vierge</button>
      </div>
    </div>;
  }
  const set = (patch) => onChange({ ...value, ...patch });
  const setSection = (id, items) => set({ sections: { ...(value.sections || {}), [id]: items } });
  const setTrait = (id, score) => set({ traits: { ...(value.traits || {}), [id]: score } });
  function changeType(next) { set({ disc_type: next || null }); onDiscType?.(next); }
  function fillFromTemplate(replace) {
    const template = descriptifFromDisc(type);
    if (!template) return;
    if (replace) { onChange({ ...template, disc_intensity: value.disc_intensity ?? null }); setConfirmReplace(false); return; }
    const sections = { ...(value.sections || {}) };
    for (const [key, items] of Object.entries(template.sections || {})) if (!(sections[key] || []).some((item) => String(item).trim())) sections[key] = items;
    set({ sections, overview: value.overview || template.overview, archetype: value.archetype || template.archetype, qualities: value.qualities?.length ? value.qualities : template.qualities, traits: { ...template.traits, ...(value.traits || {}) } });
  }
  return <div className="descriptif">
    <div className="descriptif-head">
      <DiscWheel type={type} intensity={value.disc_intensity} initials={initials} />
      <div className="descriptif-identity">
        <span className="descriptif-source">{SOURCE_LABELS[value.source] || SOURCE_LABELS.manual}</span>
        <div className="form-grid">
          <label>Type DISC<select value={type} onChange={(e) => changeType(e.target.value)}><option value="">Non précisé</option>{DISC_WHEEL.map((item) => <option key={item} value={item}>{item} · {discArchetype(item)}</option>)}</select></label>
          <label>Archétype<input value={value.archetype || ''} placeholder={discArchetype(type) || 'Ex. Analyste'} onChange={(e) => set({ archetype: e.target.value })} /></label>
        </div>
        <div className="form-grid">
          <label>Intensité du profil · {value.disc_intensity ?? '—'}/100<input type="range" min="0" max="100" value={value.disc_intensity ?? 50} onChange={(e) => set({ disc_intensity: Number(e.target.value) })} /></label>
          <label>Qualités · séparées par des virgules<input value={(value.qualities || []).join(', ')} onChange={(e) => set({ qualities: e.target.value.split(',').map((item) => item.trimStart()) })} placeholder="Ex. rigoureux, réservé, méthodique" /></label>
        </div>
        <div className="descriptif-actions">
          <button type="button" className="text-button" disabled={!type} onClick={() => fillFromTemplate(false)}>Compléter les sections vides avec le modèle {type || 'DISC'}</button>
          {confirmReplace
            ? <span className="descriptif-confirm">Tout remplacer par le modèle {type} ? <button type="button" className="text-button danger" onClick={() => fillFromTemplate(true)}>Oui, remplacer</button><button type="button" className="text-button" onClick={() => setConfirmReplace(false)}>Annuler</button></span>
            : <button type="button" className="text-button" disabled={!type} onClick={() => setConfirmReplace(true)}>Remplacer par le modèle</button>}
          <button type="button" className="text-button" onClick={() => onChange(null)}>Supprimer le descriptif</button>
        </div>
      </div>
    </div>
    <label>Vue d’ensemble<textarea rows={3} value={value.overview || ''} onChange={(e) => set({ overview: e.target.value })} placeholder="Comment cette personne aborde les décisions, ce qu’elle attend de ses interlocuteurs…" /></label>
    <fieldset className="attribute-group descriptif-traits"><legend>Traits comportementaux · 0 à 100</legend>
      {DESCRIPTIF_TRAITS.map(({ id, low, high }) => {
        const score = value.traits?.[id];
        return <div className="trait-slider" key={id}>
          <span>{low}</span>
          <input type="range" min="0" max="100" value={score ?? 50} className={score == null ? 'is-unset' : ''} aria-label={`${low} ↔ ${high}`} aria-valuetext={score == null ? 'non renseigné' : `${score} sur 100`} onChange={(e) => setTrait(id, Number(e.target.value))} id={`${idPrefix}-trait-${id}`} />
          <span>{high}</span>
          <output htmlFor={`${idPrefix}-trait-${id}`}>{score ?? '—'}</output>
        </div>;
      })}
    </fieldset>
    <div className="descriptif-sections">{DESCRIPTIF_SECTIONS.map((section) => <ListEditor key={section.id} id={`${idPrefix}-${section.id}`} label={section.label} items={value.sections?.[section.id] || []} onChange={(items) => setSection(section.id, items)} />)}</div>
  </div>;
}

/** Bloc repliable « Descriptif de personnalité » : ouvert d'office quand un descriptif existe. */
export function DescriptifFieldset({ value, onChange, discType, onDiscType, name, idPrefix = 'descriptif', readOnly = false }) {
  const [open, setOpen] = useState(!!value);
  const sections = Object.values(value?.sections || {}).filter((items) => (items || []).some((item) => String(item).trim()));
  const count = sections.reduce((sum, items) => sum + items.filter((item) => String(item).trim()).length, 0);
  return <fieldset className="attribute-group descriptif-panel"><legend>Descriptif de personnalité</legend>
    <div className="descriptif-toggle">
      <p className="muted">{value ? `Type ${value.disc_type || discType || '—'}${value.archetype ? ` · ${value.archetype}` : ''} · ${count} élément(s) dans ${sections.length} section(s). Injecté dans les instructions de l’agent.` : 'Profil détaillé : roue DISC, traits 0–100, communication, confiance, motivation, passage à l’action, énergie, angles morts, réunions, écrits…'}</p>
      <button type="button" className="button secondary" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Replier le descriptif' : value ? 'Modifier le descriptif' : 'Ouvrir le descriptif'}</button>
    </div>
    {open && <fieldset className="descriptif-body" disabled={readOnly}><DescriptifEditor value={value} onChange={onChange} discType={discType} onDiscType={onDiscType} name={name} idPrefix={idPrefix} /></fieldset>}
  </fieldset>;
}
