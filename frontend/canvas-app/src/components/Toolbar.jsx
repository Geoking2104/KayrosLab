import { useRef, useState } from 'react';
import { useCanvas } from '../store.js';

export default function Toolbar() {
  const { ajouterNoeud, reclusteriser, ingerer, occupe, distant, deconnecter, presence, connecteTR, statutTR } = useCanvas();
  const [titre, setTitre] = useState('');
  const [type, setType] = useState('idee');
  const fichier = useRef(null);

  const soumettre = (e) => {
    e.preventDefault();
    ajouterNoeud(titre, type);
    setTitre('');
  };

  return (
    <header className="barre">
      <strong className="marque">KayrosLab · Atelier</strong>

      <form onSubmit={soumettre} className="ajout">
        <input
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          placeholder="Une idée, une question, une hypothèse…"
          aria-label="Titre du nœud"
        />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type de nœud">
          {['idee', 'question', 'hypothese', 'preuve', 'critique', 'decision'].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <button type="submit" disabled={!titre.trim()}>Ajouter</button>
      </form>

      <div className="actions">
        <button onClick={reclusteriser} disabled={!!occupe}>Regrouper</button>
        <button onClick={() => fichier.current?.click()} disabled={!!occupe}>Ingérer un document</button>
        <input
          ref={fichier} type="file" hidden accept=".txt,.md,.csv,.html"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) ingerer(f); e.target.value = ''; }}
        />
      </div>

      {occupe && <span className="occupe">{occupe}…</span>}
      <span className={`palier ${distant ? 'distant' : 'local'}`} title={distant ? 'Données et clés côté serveur' : 'Hors ligne — rien ne sort de ce poste'}>
        {distant ? 'backend' : 'local'}
      </span>
      {distant && (
        <span className={`presence ${connecteTR ? 'en-ligne' : 'hors-ligne'}`}
              title={connecteTR ? presence.map((p) => p.email).join(', ') : (statutTR ?? 'déconnecté')}>
          {connecteTR ? `● ${presence.length} en ligne` : `○ ${statutTR ?? 'hors ligne'}`}
        </span>
      )}
      {distant && <button onClick={deconnecter}>Déconnexion</button>}
    </header>
  );
}
