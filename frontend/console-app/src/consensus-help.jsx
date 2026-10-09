import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Explications du seuil de consensus, alignées sur aggregateSwarmConsensus
// (core/swarm.mjs) : chaque agent rend GO, NO_GO ou CONDITIONAL_GO, puis le
// seuil choisi agrège ces verdicts. Le verdict reste consultatif : l'arbitrage
// humain est toujours requis.
export const CONSENSUS_OPTIONS = [
  {
    id: 'majority', label: 'Majorité',
    rule: 'GO si plus de la moitié des agents rendent GO ; NO_GO si plus de la moitié rendent NO_GO ; sinon GO sous conditions.',
    when: 'Comité large ou exploratoire, quand vous voulez avancer vite et faire ressortir l’avis dominant.',
    effect: 'Décision plus rapide, mais une minorité opposée peut être mise en minorité : lisez ses objections dans le dossier.',
  },
  {
    id: 'unanimous', label: 'Unanimité',
    rule: 'GO seulement si tous les agents rendent GO ; un seul NO_GO suffit pour un NO_GO ; sinon GO sous conditions.',
    when: 'Décision engageante ou irréversible (investissement, conformité, sécurité) où chaque expertise doit être satisfaite.',
    effect: 'Accord le plus solide, mais plus lent : avec beaucoup d’agents, le verdict tombe souvent en « sous conditions » ou en NO_GO.',
  },
  {
    id: 'veto_power_csuite', label: 'Veto comité exécutif',
    rule: 'Comme la majorité, mais tout NO_GO d’un agent de séniorité « executive » (CFO, CTO, juriste…) bloque la décision.',
    when: 'Quand la direction doit pouvoir arrêter un projet seule, même si le reste du collectif est favorable.',
    effect: 'Protège les points de vue de direction ; un seul dirigeant opposé suffit à rendre NO_GO.',
  },
];

export function consensusOption(id) { return CONSENSUS_OPTIONS.find((option) => option.id === id) || CONSENSUS_OPTIONS[0]; }

/** Bouton « ? » ouvrant une explication accessible (Échap ou clic extérieur pour fermer). */
export function ConsensusHelp({ value }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef(null);
  const closeRef = useRef(null);
  function close() { setOpen(false); buttonRef.current?.focus(); }
  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    // Échap ferme l'explication sans fermer la boîte de dialogue qui la contient.
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [open]);
  return <span className="help-anchor">
    <button ref={buttonRef} type="button" className="help-button" aria-expanded={open} aria-controls={open ? panelId : undefined} aria-label="Comprendre le seuil de consensus" title="Comprendre le seuil de consensus" onClick={() => setOpen((current) => !current)}>?</button>
    {open && createPortal(<div className="help-backdrop" onMouseDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) close(); }}>
      <section className="help-panel" id={panelId} role="dialog" aria-modal="true" aria-labelledby={`${panelId}-title`}>
        <header><strong id={`${panelId}-title`}>Comment choisir le seuil de consensus ?</strong><button ref={closeRef} type="button" className="icon-button" aria-label="Fermer l’explication" onClick={close}>×</button></header>
        <p>Chaque agent du collectif rend un verdict <code>GO</code>, <code>NO_GO</code> ou <code>GO sous conditions</code>. Le seuil fixe la règle qui transforme ces verdicts en verdict du collectif.</p>
        <ul className="help-options">{CONSENSUS_OPTIONS.map((option) => <li key={option.id} className={option.id === value ? 'is-current' : ''}>
          <strong>{option.label}{option.id === value ? ' · choix actuel' : ''}</strong>
          <span><em>Règle :</em> {option.rule}</span>
          <span><em>Quand le choisir :</em> {option.when}</span>
          <span><em>Conséquence :</em> {option.effect}</span>
        </li>)}</ul>
        <p className="help-note">Dans tous les cas : un agent doté du <strong>pouvoir de veto</strong> qui rend NO_GO bloque la décision, quel que soit le seuil. Le verdict reste consultatif : un humain (rôle comex ou admin) l’accepte, demande une réévaluation ou le fait passer sous conditions.</p>
      </section>
    </div>, document.body)}
  </span>;
}

/** Rappel court sous le sélecteur : la règle du seuil actuellement choisi. */
export function ConsensusHint({ value }) {
  const option = consensusOption(value);
  return <small className="consensus-hint">{option.label} : {option.rule}</small>;
}
