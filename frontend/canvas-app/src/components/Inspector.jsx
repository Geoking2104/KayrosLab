import { useCanvas } from '../store.js';
import { PERSONAS_STANDARD } from '@core/canvas/personas.mjs';

/** Panneau lateral : edition, sparring, priorisation, promotion. */
export default function Inspector() {
  const { ws, selection, majNoeud, epingler, swarm, framework, promouvoir, noter, notes, matrice, occupe, flux, cout } = useCanvas();
  const noeud = ws?.nodes.find((n) => n.id === selection);

  if (!noeud) {
    return (
      <aside className="inspecteur vide">
        <p>Sélectionnez un nœud pour l’examiner, le confronter à des personas ou le promouvoir en idée.</p>
        {ws && <Statistiques ws={ws} />}
      </aside>
    );
  }

  const m = matrice();
  const cellule = m?.cellules.find((c) => c.nodeId === noeud.id);
  const note = notes[noeud.id] ?? {};

  return (
    <aside className="inspecteur">
      <label className="champ">
        <span>Titre</span>
        <input value={noeud.titre} onChange={(e) => majNoeud(noeud.id, { titre: e.target.value })} />
      </label>
      <label className="champ">
        <span>Détail</span>
        <textarea rows={4} value={noeud.corps} onChange={(e) => majNoeud(noeud.id, { corps: e.target.value })} />
      </label>

      <button onClick={() => epingler(noeud.id)}>
        {noeud.pinned ? 'Libérer la position' : 'Figer la position'}
      </button>

      <h3>Sparring</h3>
      <div className="personas">
        {PERSONAS_STANDARD.map((p) => (
          <button key={p.id} disabled={!!occupe} onClick={() => swarm(noeud.id, [p.id])} title={p.criteres.join(' · ')}>
            {p.nom}
          </button>
        ))}
        <button className="primaire" disabled={!!occupe} onClick={() => swarm(noeud.id, null)}>
          Tout le swarm
        </button>
      </div>

      <h3>Frameworks</h3>
      <div className="frameworks">
        {[['scamper', 'SCAMPER'], ['six-chapeaux', 'Six chapeaux'], ['premiers-principes', 'Premiers principes'], ['pre-mortem', 'Pré-mortem']]
          .map(([id, nom]) => (
            <button key={id} disabled={!!occupe} onClick={() => framework(noeud.id, id)}>{nom}</button>
          ))}
      </div>

      {cout && (
        <p className="cout">
          {cout.appels} appel(s) · {cout.tokensIn + cout.tokensOut} jetons · {cout.coutUsd.toFixed(4)} USD
        </p>
      )}
      {flux.length > 0 && (
        <ul className="flux">
          {flux.map((f, i) => (
            <li key={i} className={f.ok ? (f.verdict ?? 'neutre') : 'echec'}>
              <strong>{f.persona?.nom}</strong> — {f.ok ? (f.verdict ?? 'sans position') : `échec : ${f.erreur}`}
            </li>
          ))}
        </ul>
      )}

      <h3>Priorisation</h3>
      <div className="notes">
        {['impact', 'effort', 'confiance'].map((c) => (
          <label key={c}>
            <span>{c}</span>
            <input
              type="number" min="0" max="10" value={note[c] ?? ''}
              onChange={(e) => noter(noeud.id, c, e.target.value)}
            />
          </label>
        ))}
      </div>
      {cellule && (
        <p className="quadrant">
          {cellule.quadrant
            ? <>Quadrant : <strong>{cellule.quadrant}</strong> · couverture {Math.round(cellule.couverture * 100)} %</>
            : <em>Non évalué — aucun quadrant n’est supposé.</em>}
        </p>
      )}

      <button className="primaire large" onClick={() => promouvoir(noeud.id)}>
        Promouvoir en idée →
      </button>
    </aside>
  );
}

function Statistiques({ ws }) {
  const agents = ws.nodes.filter((n) => n.authorKind === 'agent').length;
  const contra = ws.edges.filter((e) => e.relation === 'contredit').length;
  return (
    <dl className="stats">
      <div><dt>Nœuds</dt><dd>{ws.nodes.length}</dd></div>
      <div><dt>Dont agents</dt><dd>{agents}</dd></div>
      <div><dt>Clusters</dt><dd>{ws.clusters.length}</dd></div>
      <div><dt>Contradictions</dt><dd>{contra}</dd></div>
      <div><dt>Idées promues</dt><dd>{ws.promotedIdeaIds.length}</dd></div>
    </dl>
  );
}
