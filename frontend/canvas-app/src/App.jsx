import { useEffect } from 'react';
import { useCanvas } from './store.js';
import ReactFlowRenderer from './renderer/ReactFlowRenderer.jsx';
import Toolbar from './components/Toolbar.jsx';
import Inspector from './components/Inspector.jsx';
import Connexion from './components/Connexion.jsx';

export default function App() {
  const { ws, selection, init, selectionner, deplacer, relier, message, effacerMessage, distant, jeton } = useCanvas();

  useEffect(() => { if (!distant || jeton) init(); }, [init, distant, jeton]);

  // En mode distant sans jeton, on demande la connexion plutot que d'afficher
  // un atelier vide qui echouerait a chaque action.
  if (distant && !jeton) return <Connexion />;
  if (!ws) return <div className="chargement">Initialisation de l’atelier…</div>;

  return (
    <div className="app">
      <Toolbar />
      {message && (
        <div className="message" role="status">
          {message}
          <button onClick={effacerMessage} aria-label="Fermer">×</button>
        </div>
      )}
      <main>
        <ReactFlowRenderer
          ws={ws}
          selection={selection}
          onSelect={selectionner}
          onMove={deplacer}
          onConnect={relier}
        />
        <Inspector />
      </main>
    </div>
  );
}
